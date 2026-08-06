<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/Flags.php';
require_once __DIR__ . '/../lib/Page.php';

/**
 * Assembling the server-rendered page.
 * Spec: docs/specs/seo.md §4
 *
 * The failures guarded here are the ones that only a crawler would ever see, plus one
 * that is a genuine injection: a `reason` is operator-supplied text and it lands both in
 * the HTML and in a JSON payload in the same document.
 *
 * Everything here runs against a hand-built fixture and needs **no build output**, which
 * is deliberate: `npm test` runs before `npm run build`. The one check that does need the
 * real generated `dist/_hub/cards.php` lives in `ssr_check.php` and runs as `postbuild`.
 */

/** A stand-in for what ssr.mjs emits, so the pure logic is testable with no build. */
function fakeCards(): array
{
    $cards = [];
    foreach (['tap-duel', 'spill', 'ghost-tag'] as $slug) {
        foreach (['active', 'disabled', 'hidden'] as $availability) {
            foreach ([0, 1] as $isNew) {
                foreach ([0, 1] as $showAll) {
                    $key = "{$availability}:{$isNew}:{$showAll}";
                    // A hidden game is absent on prod and present on dev, which is what
                    // cardState() decides and what ssr.mjs bakes in.
                    $absent = $availability === 'hidden' && $showAll === 0;
                    $cards[$slug][$key] = $absent
                        ? ''
                        : "<li data-slug=\"{$slug}\" data-key=\"{$key}\">%%REASON%%</li>";
                }
            }
        }
    }

    return $cards;
}

const ORDER = ['tap-duel', 'spill', 'ghost-tag'];

group('the grid keeps the curated order');

$grid = Page::grid(ORDER, fakeCards(), [], false);
preg_match_all('/data-slug="([^"]+)"/', $grid, $m);
// Order comes from the build. Iterating the flags map instead would silently replace the
// curated order (hub.md §2) with whatever order the JSON happened to be written in.
check('all three cards, in the order given', $m[1] === ORDER, $m[1]);

$reversed = Page::grid(['ghost-tag', 'spill', 'tap-duel'], fakeCards(), [], false);
preg_match_all('/data-slug="([^"]+)"/', $reversed, $m2);
check('and it follows the order it was handed', $m2[1] === ['ghost-tag', 'spill', 'tap-duel'], $m2[1]);

group('a flag selects the variant');

$grid = Page::grid(ORDER, fakeCards(), ['spill' => ['availability' => 'disabled', 'isNew' => false]], false);
check('a disabled game gets the disabled variant', str_contains($grid, 'data-key="disabled:0:0"'), $grid);
check('and the others stay active', substr_count($grid, 'data-key="active:0:0"') === 2);

$grid = Page::grid(ORDER, fakeCards(), ['spill' => ['availability' => 'active', 'isNew' => true]], false);
check('isNew picks its own variant', str_contains($grid, 'data-key="active:1:0"'));

$grid = Page::grid(ORDER, fakeCards(), ['spill' => ['availability' => 'active', 'isNew' => false]], true);
check('showAll picks its own variant', str_contains($grid, 'data-key="active:0:1"'));

group('a hidden game is ABSENT, not merely dimmed');

$flags = ['spill' => ['availability' => 'hidden', 'isNew' => false]];
$prod = Page::grid(ORDER, fakeCards(), $flags, false);
// Not `display:none`, which would still put its title and its link in the document for
// anyone who read the source — and for a crawler, which does exactly that.
check('nothing for it reaches the document on prod', !str_contains($prod, 'data-slug="spill"'), $prod);
check('the other two are still there', substr_count($prod, '<li ') === 2, $prod);

$dev = Page::grid(ORDER, fakeCards(), $flags, true);
check('but dev shows it, badged', str_contains($dev, 'data-key="hidden:0:1"'), $dev);

group('the flags fail open, exactly as everything else does');

$grid = Page::grid(ORDER, fakeCards(), ['spill' => ['availability' => 'banana']], false);
check('an availability outside the enum renders as active', str_contains($grid, 'data-key="active:0:0"'));
check('rather than vanishing', substr_count($grid, '<li ') === 3, $grid);

$grid = Page::grid(ORDER, fakeCards(), [], false);
check('no flags at all means every game active', substr_count($grid, 'data-key="active:0:0"') === 3);

$grid = Page::grid(['tap-duel', 'a-game-the-build-never-saw'], fakeCards(), [], false);
check('a slug with no rendered variant is skipped, not invented', substr_count($grid, '<li ') === 1, $grid);

group('a reason is operator text, and is escaped where it becomes HTML');

$nasty = '<img src=x onerror="alert(1)">';
$grid = Page::grid(ORDER, fakeCards(), [
    'spill' => ['availability' => 'disabled', 'isNew' => false, 'reason' => $nasty],
], false);
check('the raw tag does not reach the markup', !str_contains($grid, '<img src=x'), $grid);
check('it is escaped', str_contains($grid, '&lt;img src=x'), $grid);
check('and the quotes with it', str_contains($grid, '&quot;alert(1)&quot;'), $grid);

$grid = Page::grid(ORDER, fakeCards(), ['spill' => ['availability' => 'disabled']], false);
// cardState()'s own fallback word, so a disabled card with no reason still says something
// rather than showing an empty badge.
check('a disabled game with no reason says "paused"', str_contains($grid, '>paused</li>'), $grid);

group('the inlined payload cannot break out of its script element');

$script = Page::flagsScript([
    'spill' => ['availability' => 'disabled', 'isNew' => false, 'reason' => '</script><img src=x onerror=alert(1)>'],
], false);
// `</script` ends the element wherever it appears, INCLUDING inside a JSON string, and
// JSON escaping alone does not touch it. JSON_HEX_TAG is what closes that.
check('no literal </script inside the payload', !str_contains($script, '</script><'), $script);
// Asserting the HEX FORM, not the presence of '</script>' — an earlier version of this
// line did the latter and passed on the element's own closing tag, which is trivially
// there. The payload must contain the escape, and the element must contain exactly one
// closing tag.
check('the angle brackets are hex-escaped', str_contains($script, '\\u003C/script\\u003E'), $script);
check('so the element closes exactly once', substr_count($script, '</script>') === 1, $script);
check('and it is still valid JSON that round-trips', json_decode(
    (string) preg_replace('#^<script[^>]*>|</script>$#', '', $script),
    true,
)['flags']['spill']['reason'] === '</script><img src=x onerror=alert(1)>');

$empty = Page::flagsScript([], false);
// PHP's empty array encodes as `[]`; the client does `parsed.flags[slug]`, which on an
// array is a different kind of nothing. It must be an object.
check('an empty map is an object, not an array', str_contains($empty, '"flags":{}'), $empty);
check('showAll is a real boolean', str_contains($empty, '"showAll":false'));

group('the page is assembled without authoring markup');

$template = "<!doctype html>\n<html>\n  <head><title>x</title>\n  </head>\n  <body><div id=\"app\"></div></body>\n</html>\n";
$shell = '<div class="hub"><header>h</header>' . Page::GRID_MARKER . '<footer>f</footer></div>';
$html = Page::render($template, $shell, '<ul class="hub__grid">', '</ul>', '<li>one</li>', [], false);

check('the shell landed inside #app', str_contains($html, '<div id="app"><div class="hub">'), $html);
check('the grid replaced the marker', str_contains($html, '<ul class="hub__grid"><li>one</li></ul>'));
check('and the marker is gone', !str_contains($html, Page::GRID_MARKER));
check('the flags payload is in the head', str_contains($html, 'id="fony-flags"') && strpos($html, 'fony-flags') < strpos($html, '<body>'));
check('the template head survived untouched', str_contains($html, '<title>x</title>'));
