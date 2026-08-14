<?php

declare(strict_types=1);

require_once __DIR__ . '/harness.php';
require_once __DIR__ . '/../lib/Flags.php';
require_once __DIR__ . '/../lib/Page.php';

/**
 * The one coupling between `scripts/ssr.mjs` and `api/lib/Page.php`.
 * Spec: docs/specs/seo.md §4
 *
 * `ssr.mjs` invents the variant-key format and `Page::variantKey()` reconstructs it. If
 * they drift, every lookup returns `''`, the hub renders an empty grid, and **nothing
 * errors anywhere** — so this is checked against the real generated file rather than a
 * fixture.
 *
 * ## Why this is `postbuild` and not part of `npm test`
 *
 * It needs `dist/_hub/cards.php`, which only exists after a build. It used to live in
 * `page_test.php`, which broke the dev deploy: the workflow runs `npm test` **before**
 * `npm run build`, so in CI the file was not there yet. It passed locally only because a
 * build had already happened.
 *
 * **The fix is not to build first.** `prebuild` runs `art:outlines` and `art:og`, which
 * regenerate the committed generated files, and `npm test` then verifies they are current
 * with `--check`. Building first would make both of those guards check files the build had
 * just rewritten — two staleness guards silently disarmed to fix one ordering bug. So
 * test-before-build stays, and this check belongs to the build that produces its input.
 */

group('PHP and the renderer still agree on the variant keys');

// The one coupling between scripts/ssr.mjs and this file. If it drifts, every lookup
// returns '' and the hub renders an empty grid — with no error anywhere.
$generated = __DIR__ . '/../../dist/_hub/cards.php';
if (!is_readable($generated)) {
    // Not a skip. This file only ever runs as `postbuild`, so the build output is
    // guaranteed to be there — its absence means the build did not produce it.
    check('dist/_hub/cards.php was produced by the build', false, $generated);
} else {
    $built = require $generated;
    check('the build recorded an order', is_array($built['order'] ?? null) && count($built['order']) > 0);
    check('and a grid wrapper', str_starts_with((string) ($built['grid']['open'] ?? ''), '<ul'), $built['grid'] ?? null);

    $wanted = [];
    foreach (Flags::STATES as $availability) {
        foreach ([false, true] as $isNew) {
            foreach ([false, true] as $hot) {
                foreach ([false, true] as $showAll) {
                    $wanted[] = Page::variantKey($availability, $isNew, $hot, $showAll);
                }
            }
        }
    }

    $missing = [];
    foreach ($built['cards'] as $slug => $variants) {
        foreach ($wanted as $key) {
            if (!array_key_exists($key, $variants)) {
                $missing[] = "{$slug}/{$key}";
            }
        }
    }
    check('every key PHP asks for exists in the generated file', $missing === [], array_slice($missing, 0, 5));

    // And nothing extra, so a key format change fails here rather than half-working.
    $extra = [];
    foreach ($built['cards'] as $slug => $variants) {
        foreach (array_keys($variants) as $key) {
            if (!in_array($key, $wanted, true)) {
                $extra[] = "{$slug}/{$key}";
            }
        }
    }
    check('and no keys PHP would never ask for', $extra === [], array_slice($extra, 0, 5));

    // The sentinel has to survive into the generated markup, or the reason substitution
    // is a no-op and every disabled card says nothing.
    $firstSlug = $built['order'][0];
    check(
        'a disabled variant still carries the reason sentinel',
        str_contains((string) ($built['cards'][$firstSlug]['disabled:0:0:0'] ?? ''), Page::REASON_SENTINEL)
            || ($built['cards'][$firstSlug]['disabled:0:0:0'] ?? '') === '',
        $built['cards'][$firstSlug]['disabled:0:0:0'] ?? null,
    );

    // And a real end-to-end assembly against the real strings.
    $real = Page::grid($built['order'], $built['cards'], [], false);
    check('the real cards assemble into a non-empty grid', strlen($real) > 1000, strlen($real));
    check('and every one of them rendered', substr_count($real, '<li ') === count($built['order']), substr_count($real, '<li '));

    /*
     * The hot card, against the real markup. `hottest()` picks the second slug, so this
     * fails if the promotion is a no-op — and the badge check fails if the generated hot
     * variant is the same string as the cold one, which is what a forgotten `hot` prop in
     * ssr.mjs would produce.
     */
    $first = $built['order'][0];
    $second = $built['order'][1];
    $withHot = Page::grid($built['order'], $built['cards'], [], false, [$second => 3]);
    check(
        'the most-played card is rendered first',
        strpos($withHot, "/{$second}/") < strpos($withHot, "/{$first}/"),
        ['hot' => $second, 'was first' => $first],
    );
    check('and it wears the HOT badge', substr_count($withHot, 'game-card__badge--hot') === 1,
        substr_count($withHot, 'game-card__badge--hot'));
    check('while the cold grid has none', !str_contains($real, 'game-card__badge--hot'));
}

// Standalone, so it prints its own verdict. Named `ssr_check.php` rather than
// `*_test.php` precisely so `run.php`'s glob does NOT pick it up — `npm test` must stay
// free of any dependency on build output.
exit(summary());
