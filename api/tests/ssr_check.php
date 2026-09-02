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
    check('the build recorded a grid wrapper', str_starts_with((string) ($built['grid']['open'] ?? ''), '<ul'), $built['grid'] ?? null);

    $wanted = [];
    foreach (Flags::STATES as $state) {
        foreach ([false, true] as $hot) {
            foreach ([false, true] as $week) {
                foreach ([false, true] as $showAll) {
                    $wanted[] = Page::variantKey($state, $hot, $week, $showAll);
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
    // is a no-op and every soon card says nothing.
    $firstSlug = $built['week'][0];
    check(
        'a soon variant still carries the reason sentinel',
        str_contains((string) ($built['cards'][$firstSlug]['soon:0:0:0'] ?? ''), Page::REASON_SENTINEL)
            || ($built['cards'][$firstSlug]['soon:0:0:0'] ?? '') === '',
        $built['cards'][$firstSlug]['soon:0:0:0'] ?? null,
    );

    check('the build also recorded a week order', is_array($built['week'] ?? null) && count($built['week']) > 0, $built['week'] ?? null);
    check('and a soon order', is_array($built['soon'] ?? null), $built['soon'] ?? null);

    /*
     * Real week/hot pinning, against the real markup — the failure mode HOT and WEEK
     * each guard is the same: a forgotten `hot`/`week` prop in ssr.mjs makes the tagged
     * variant byte-identical to the untagged one, and it is the pinning itself (issue
     * #4: WEEK leads, then HOT) that a stale `Flags::hubSections()` port would silently
     * stop doing.
     *
     * `$fixedNow` is ISO week 2 (Jan 8 2024) rather than week 1: week 1 spotlights
     * index 0 of the alphabetical list, which is already first with nothing pinned —
     * indistinguishable from a WEEK that pins nothing at all. Week 2 spotlights index
     * 1, so pinning it actually moves something. Fixed rather than "now" for every
     * call below, so none of this depends on which real day the check happens to run.
     */
    $fixedNow = (int) gmdate('U', strtotime('2024-01-08T00:00:00Z'));
    $weekOrder = $built['week'];
    $soonOrder = $built['soon'] ?? [];
    check('there are enough live games to tell the tiers apart', count($weekOrder) >= 3, count($weekOrder));
    $weekSlug = $weekOrder[1];
    $third = $weekOrder[2];

    $real = Page::grid($built['cards'], [], false, [], $weekOrder, $fixedNow, $soonOrder);
    check('the real cards assemble into a non-empty grid', strlen($real) > 1000, strlen($real));
    preg_match_all('#href="/([a-z0-9-]+)/"#', $real, $mPlain);
    // Random Game is a live card with a real link but excluded from $weekOrder
    // (Page::grid()'s own doc comment) — every check below accounts for the extra one.
    check('every live game rendered its link, plus Random Game', count($mPlain[1]) === count($weekOrder) + 1, count($mPlain[1]));
    check('Random Game leads', ($mPlain[1][0] ?? null) === 'random-game', $mPlain[1]);
    check('the week\'s own card leads the rest, with nothing else pinned', ($mPlain[1][1] ?? null) === $weekSlug, $mPlain[1]);
    check('the week\'s own card wears the WEEK badge exactly once', substr_count($real, 'game-card__badge--week') === 1,
        substr_count($real, 'game-card__badge--week'));
    check('and it is on the right card', str_contains($real, "/{$weekSlug}/") && strpos($real, 'game-card__badge--week') > strpos($real, "/{$weekSlug}/"));
    check('while nothing wears the HOT badge yet', !str_contains($real, 'game-card__badge--hot'));
    // A not-yet-live card carries no <a href> at all (GameCardTile.tsx: a link the Worker
    // would refuse is worse than none), so its presence is counted by the shared `<li
    // class="game-card` prefix instead, and its position by the badge text rather than a
    // link — this is the actual issue #4 regression this build was fixed to catch.
    $liCount = substr_count($real, '<li class="game-card');
    check('and every not-yet-live game rendered too, not vanished', $liCount === count($weekOrder) + 1 + count($soonOrder), $liCount);
    check(
        'the not-yet-live tier trails behind every live card',
        $soonOrder === [] || strpos($real, 'game-card__badge--soon') > strrpos($real, 'href="/'),
        $soonOrder,
    );

    $withHot = Page::grid($built['cards'], [], false, [$third => 3], $weekOrder, $fixedNow, $soonOrder);
    preg_match_all('#href="/([a-z0-9-]+)/"#', $withHot, $mHot);
    check('Random Game still leads, unaffected by hot', ($mHot[1][0] ?? null) === 'random-game', $mHot[1]);
    check('the week\'s own card still leads the rest', ($mHot[1][1] ?? null) === $weekSlug, $mHot[1]);
    check('the most-played card follows it, ahead of everything cold', ($mHot[1][2] ?? null) === $third, $mHot[1]);
    check('and it wears the HOT badge', substr_count($withHot, 'game-card__badge--hot') === 1,
        substr_count($withHot, 'game-card__badge--hot'));
}

group('the generated index.php itself still runs');

/*
 * Every check above calls `Page::grid()` directly, with arguments this file wrote by
 * hand — so a mismatch between the REAL literal call site `ssr.mjs` bakes into
 * `dist/index.php` and `Page::grid()`'s actual signature is invisible to every one of
 * them. That is exactly the bug that reached `dev` as a 500: a positional argument
 * shifted by one when `$soonOrder` was added, so `$built['soon']` (an array) landed in
 * `$now` (`?int`) — a `TypeError`, on every request, on the one page every visitor
 * hits first. `php -l` would not have caught it either; it only checks syntax, and this
 * is a type error raised at call time. Running the real generated file end to end is
 * the only check that would have.
 */
$indexPhp = __DIR__ . '/../../dist/index.php';
if (!is_readable($indexPhp)) {
    check('dist/index.php was produced by the build', false, $indexPhp);
} else {
    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $process = proc_open(['php', $indexPhp], $descriptors, $pipes, dirname($indexPhp));
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    check('it exits cleanly rather than fataling', $exitCode === 0, ['exit' => $exitCode, 'stderr' => $stderr]);
    check('and says nothing to stderr', trim($stderr) === '', $stderr);
    check('the page it renders is real HTML, not an error page', str_contains($stdout, '<!doctype html>'), substr($stdout, 0, 200));
    check('with a grid in it', str_contains($stdout, 'hub__grid'), strlen($stdout));
}

// Standalone, so it prints its own verdict. Named `ssr_check.php` rather than
// `*_test.php` precisely so `run.php`'s glob does NOT pick it up — `npm test` must stay
// free of any dependency on build output.
exit(summary());
