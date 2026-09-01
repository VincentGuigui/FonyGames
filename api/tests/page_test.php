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
    foreach (['tap-duel', 'spill', 'ghost-tag', 'zone-rush'] as $slug) {
        foreach (['new', 'active', 'soon', 'hidden'] as $state) {
            foreach ([0, 1] as $hot) {
                foreach ([0, 1] as $week) {
                    foreach ([0, 1] as $showAll) {
                        $key = "{$state}:{$hot}:{$week}:{$showAll}";
                        // A hidden game is absent on prod and present on dev, which is what
                        // cardState() decides and what ssr.mjs bakes in.
                        $absent = $state === 'hidden' && $showAll === 0;
                        $cards[$slug][$key] = $absent
                            ? ''
                            : "<li data-slug=\"{$slug}\" data-key=\"{$key}\">%%REASON%%</li>";
                    }
                }
            }
        }
    }

    return $cards;
}

/**
 * Every live game, alphabetical by title — `weekOrder()` in `scripts/ssr.mjs`, and now
 * the one list `Page::grid()` builds all three tiers from (issue #4). It has replaced
 * `$order` in the grid's own signature entirely: `gameOfWeek()` can never return null for
 * a non-empty list, so this one list is both what the grid iterates and what decides
 * WEEK — there is no longer a separate "curated order" to diverge from it.
 */
const ALPHA = ['ghost-tag', 'spill', 'tap-duel'];

/**
 * `zone-rush` stands in for a not-yet-live game — `soonOrder()` in `scripts/ssr.mjs`,
 * appended verbatim as the grid's fourth tier (issue #4). It never appears in `ALPHA`:
 * `hubSections()` only ever sorts live games, so this list plays no part in deciding
 * WEEK, HOT or NEW at all.
 */
const SOON = ['zone-rush'];

/** ISO week 1 of 2024 (Jan 1) picks ALPHA[0] — already first, so pinning it is invisible
 *  in the order, only in the WEEK bit. */
$week1 = (int) gmdate('U', strtotime('2024-01-01T00:00:00Z'));
/** ISO week 2 (Jan 8) picks ALPHA[1] instead — pinning it actually moves something,
 *  which is what most of the checks below want to see. */
$week2 = (int) gmdate('U', strtotime('2024-01-08T00:00:00Z'));

function slugsIn(string $grid): array
{
    preg_match_all('/data-slug="([^"]+)"/', $grid, $m);
    return $m[1];
}

group("the week's own game always leads — gameOfWeek never spotlights nobody");

$plain = Page::grid(fakeCards(), [], false, [], ALPHA, $week1);
check('week 1 pins the already-first card, so the order is untouched', slugsIn($plain) === ALPHA, slugsIn($plain));
check('a spacer still marks the pinned tier, even though nothing visibly moved', str_contains($plain, 'hub__spacer'), $plain);
check('it still wears the WEEK variant', str_contains($plain, 'data-slug="ghost-tag" data-key="active:0:1:0"'), $plain);

group('a single-game catalogue has nothing left to separate a spacer from');

$solo = Page::grid(fakeCards(), [], false, [], ['ghost-tag'], $week1);
check('the lone game is pinned — every game is the week\'s own pick', slugsIn($solo) === ['ghost-tag'], slugsIn($solo));
check('no spacer when the pinned tier is the whole grid', !str_contains($solo, 'hub__spacer'), $solo);

group("the week's own game moves the order when it isn't already first");

$withWeek = Page::grid(fakeCards(), [], false, [], ALPHA, $week2);
check('week 2 pins a different card, which now visibly leads', slugsIn($withWeek) === ['spill', 'ghost-tag', 'tap-duel'], slugsIn($withWeek));
check('a spacer separates it from the rest', str_contains($withWeek, 'hub__spacer'), $withWeek);
check('the week\'s own game gets the week variant', str_contains($withWeek, 'data-slug="spill" data-key="active:0:1:0"'), $withWeek);
check('the other two stay untagged', substr_count($withWeek, ':0:0:0"') === 2, $withWeek);

group('an empty week order is a fail-open empty grid, not an error');

check('nothing to order means nothing rendered', Page::grid(fakeCards(), [], false) === '');

group('the most-played game is pinned right behind the week\'s own pick');

/*
 * The counts are data PHP owns, and pinning the hot game is one of the two things
 * allowed to move a card off its alphabetical position (hub.md §2) — WEEK, above, is
 * the other, and it is listed first in `hubSections()`'s own call, so it leads whenever
 * the two differ.
 *
 * The client applies the same rule to the same numbers (`hottest`/`hubSections` in
 * shared/flags.ts) before hydrating this markup — so these cases are duplicated in the
 * TypeScript harness, deliberately, the same way the slug guard is.
 */
$hot = Page::grid(fakeCards(), [], false, ['tap-duel' => 4], ALPHA, $week1);
check('week leads, the hot game jumps up right behind it', slugsIn($hot) === ['ghost-tag', 'tap-duel', 'spill'], slugsIn($hot));
check('a spacer separates the pinned tier from the rest', str_contains($hot, 'hub__spacer'), $hot);
check('and it gets the hot variant', str_contains($hot, 'data-slug="tap-duel" data-key="active:1:0:0"'), $hot);
check('while the week\'s own pick keeps only its own bit', str_contains($hot, 'data-slug="ghost-tag" data-key="active:0:1:0"'), $hot);

// A tie is not a winner: two games on the same count pins nobody extra.
$tie = Page::grid(fakeCards(), [], false, ['spill' => 4, 'tap-duel' => 4], ALPHA, $week1);
check('a tie pins nobody beyond the week\'s own pick', slugsIn($tie) === ALPHA, slugsIn($tie));
check('the week\'s own tier still gets its spacer', str_contains($tie, 'hub__spacer'), $tie);
check('and badges nobody hot', !str_contains($tie, ':1:0:0"'), $tie);

// Zero is "never played", not "played least".
$zero = Page::grid(fakeCards(), [], false, ['tap-duel' => 0], ALPHA, $week1);
check('zero plays is not hot', slugsIn($zero) === ALPHA, slugsIn($zero));

// Counts outlive a deleted game; pinning one would drop the badge and reorder nothing.
$gone = Page::grid(fakeCards(), [], false, ['a-game-that-was-deleted' => 99, 'spill' => 2], ALPHA, $week1);
check('a count for a game the build never saw is ignored; the real hot game still follows the week pin', slugsIn($gone) === ['ghost-tag', 'spill', 'tap-duel'], slugsIn($gone));

/*
 * HOT and WEEK can both be true, on the same or different slugs — the variant key just
 * carries both bits — but a pinned game is never duplicated: shown once, with whichever
 * bits actually apply to it.
 */
$same = Page::grid(fakeCards(), [], false, ['spill' => 4], ALPHA, $week2);
check('the shared slug appears exactly once', substr_count($same, 'data-slug="spill"') === 1, $same);
check('wearing both bits', str_contains($same, 'data-slug="spill" data-key="active:1:1:0"'), $same);
check('still leading everyone else', (slugsIn($same)[0] ?? null) === 'spill', slugsIn($same));

group('a NEW-flagged game moves to its own tier, ahead of everything else that is not pinned');

$fresh = Page::grid(fakeCards(), ['tap-duel' => ['state' => 'new']], false, [], ALPHA, $week1);
check('week still leads, then NEW, then the rest', slugsIn($fresh) === ['ghost-tag', 'tap-duel', 'spill'], slugsIn($fresh));
// Only one spacer now, not two: hot/week leading straight into NEW gets none.
check('one spacer, not two — pinned flows straight into NEW', substr_count($fresh, 'hub__spacer') === 1, $fresh);
$betweenPinnedAndFresh = substr($fresh, (int) strpos($fresh, 'ghost-tag'), (int) strpos($fresh, 'tap-duel') - (int) strpos($fresh, 'ghost-tag'));
check('specifically: nothing between the pinned tier and NEW', !str_contains($betweenPinnedAndFresh, 'hub__spacer'), $betweenPinnedAndFresh);
$betweenFreshAndRest = substr($fresh, (int) strpos($fresh, 'tap-duel'), (int) strpos($fresh, 'spill') - (int) strpos($fresh, 'tap-duel'));
check('but NEW and the rest still get one', str_contains($betweenFreshAndRest, 'hub__spacer'), $betweenFreshAndRest);
check('the new state picks its own variant', str_contains($fresh, 'data-key="new:0:0:0"'), $fresh);

// Pinned always outranks NEW — a hot-and-new game is not also duplicated into the NEW tier.
$hotAndNew = Page::grid(fakeCards(), ['tap-duel' => ['state' => 'new']], false, ['tap-duel' => 4], ALPHA, $week1);
check('a pinned game is never duplicated into the NEW tier', substr_count($hotAndNew, 'data-slug="tap-duel"') === 1, $hotAndNew);
check('it leads on its pinned rank, right behind the week\'s own pick', slugsIn($hotAndNew) === ['ghost-tag', 'tap-duel', 'spill'], slugsIn($hotAndNew));

group('a not-yet-live game trails everything, in its own curated order (issue #4)');

// Without a $soonOrder, nothing changes — every case above passed one implicitly by
// never supplying it, which is the same as the build having no `soon`-status game at all.
$withSoon = Page::grid(fakeCards(), [], false, [], ALPHA, $week1, SOON);
check('it renders after every live tier', slugsIn($withSoon) === [...ALPHA, 'zone-rush'], slugsIn($withSoon));
check('a spacer separates it from each non-empty live tier before it', substr_count($withSoon, 'hub__spacer') === 2, $withSoon);
check('with no bits of its own', str_contains($withSoon, 'data-slug="zone-rush" data-key="active:0:0:0"'), $withSoon);

$withSoonAndNew = Page::grid(fakeCards(), ['tap-duel' => ['state' => 'new']], false, [], ALPHA, $week1, SOON);
check(
    'it still trails behind every live tier, NEW included',
    slugsIn($withSoonAndNew) === ['ghost-tag', 'tap-duel', 'spill', 'zone-rush'],
    slugsIn($withSoonAndNew),
);
// Four tiers, but only two spacers: pinned→NEW still gets none, NEW→rest and rest→soon do.
check('two spacers, not three — pinned still flows straight into NEW', substr_count($withSoonAndNew, 'hub__spacer') === 2, $withSoonAndNew);

// hubSections() never sees $soonOrder at all, so a play count for a not-yet-live game
// cannot promote it — the same fail-open rule `Flags::hottest` already applies to a
// count for a slug outside `$weekOrder` entirely.
$noPromote = Page::grid(fakeCards(), [], false, ['zone-rush' => 99], ALPHA, $week1, SOON);
check('a not-yet-live game earns no HOT badge no matter how many plays it has', !str_contains($noPromote, 'data-slug="zone-rush" data-key="active:1'), $noPromote);
check('and stays put at the very end', slugsIn($noPromote) === [...ALPHA, 'zone-rush'], slugsIn($noPromote));

group('a flag selects the variant');

$grid = Page::grid(fakeCards(), ['spill' => ['state' => 'soon']], false, [], ALPHA, $week1);
check('a soon game gets the soon variant', str_contains($grid, 'data-key="soon:0:0:0"'), $grid);
check('and the others stay active', substr_count($grid, 'data-key="active:0:0:0"') === 1);

$grid = Page::grid(fakeCards(), ['spill' => ['state' => 'active']], true, [], ALPHA, $week1);
check('showAll picks its own variant', str_contains($grid, 'data-key="active:0:0:1"'));

group('a hidden game is ABSENT, not merely dimmed');

$flags = ['spill' => ['state' => 'hidden']];
$prod = Page::grid(fakeCards(), $flags, false, [], ALPHA, $week1);
// Not `display:none`, which would still put its title and its link in the document for
// anyone who read the source — and for a crawler, which does exactly that.
check('nothing for it reaches the document on prod', !str_contains($prod, 'data-slug="spill"'), $prod);
check('the other two are still there', count(slugsIn($prod)) === 2, $prod);

$dev = Page::grid(fakeCards(), $flags, true, [], ALPHA, $week1);
check('but dev shows it, badged', str_contains($dev, 'data-key="hidden:0:0:1"'), $dev);

group('the flags fail open, exactly as everything else does');

$grid = Page::grid(fakeCards(), ['spill' => ['state' => 'banana']], false, [], ALPHA, $week1);
check('a state outside the enum renders as active', str_contains($grid, 'data-key="active:0:0:0"'));
check('rather than vanishing', count(slugsIn($grid)) === 3, $grid);

$grid = Page::grid(fakeCards(), [], false, [], ALPHA, $week1);
check('no flags at all means every game active, bar the week\'s own pin', substr_count($grid, 'data-key="active:0:0:0"') === 2);

$grid = Page::grid(fakeCards(), [], false, [], ['tap-duel', 'a-game-the-build-never-saw'], $week1);
check('a slug with no rendered variant is skipped, not invented', count(slugsIn($grid)) === 1, $grid);

group('a reason is operator text, and is escaped where it becomes HTML');

$nasty = '<img src=x onerror="alert(1)">';
$grid = Page::grid(fakeCards(), [
    'spill' => ['state' => 'soon', 'reason' => $nasty],
], false, [], ALPHA, $week1);
check('the raw tag does not reach the markup', !str_contains($grid, '<img src=x'), $grid);
check('it is escaped', str_contains($grid, '&lt;img src=x'), $grid);
check('and the quotes with it', str_contains($grid, '&quot;alert(1)&quot;'), $grid);

$grid = Page::grid(fakeCards(), ['spill' => ['state' => 'soon']], false, [], ALPHA, $week1);
// cardState()'s own fallback word, so a soon card with no reason still says something
// rather than showing an empty badge.
check('a soon game with no reason says "soon"', str_contains($grid, '>soon</li>'), $grid);

group('the inlined payload cannot break out of its script element');

$script = Page::flagsScript([
    'spill' => ['state' => 'soon', 'reason' => '</script><img src=x onerror=alert(1)>'],
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

$withPlays = Page::flagsScript([], false, ['spill' => 7]);
// The client orders the grid from these before it hydrates, so they have to be in the
// page — not fetched afterwards, which would reorder the cards after paint.
check('the counts are inlined for the client', str_contains($withPlays, '"plays":{"spill":7}'), $withPlays);

$empty = Page::flagsScript([], false);
// PHP's empty array encodes as `[]`; the client does `parsed.flags[slug]`, which on an
// array is a different kind of nothing. It must be an object.
check('an empty map is an object, not an array', str_contains($empty, '"flags":{}'), $empty);
check('showAll is a real boolean', str_contains($empty, '"showAll":false'));
check('and so is an empty count map', str_contains($empty, '"plays":{}'), $empty);

group('the page is assembled without authoring markup');

$template = "<!doctype html>\n<html>\n  <head><title>x</title>\n  </head>\n  <body><div id=\"app\"></div></body>\n</html>\n";
$shell = '<div class="hub"><header>h</header>' . Page::GRID_MARKER . '<footer>f</footer></div>';
$html = Page::render($template, $shell, '<ul class="hub__grid">', '</ul>', '<li>one</li>', [], false);

check('the shell landed inside #app', str_contains($html, '<div id="app"><div class="hub">'), $html);
check('the grid replaced the marker', str_contains($html, '<ul class="hub__grid"><li>one</li></ul>'));
check('and the marker is gone', !str_contains($html, Page::GRID_MARKER));
check('the flags payload is in the head', str_contains($html, 'id="fony-flags"') && strpos($html, 'fony-flags') < strpos($html, '<body>'));
check('the template head survived untouched', str_contains($html, '<title>x</title>'));
