import { cardState, DEFAULT_FLAG, flagFor, gameOfWeek, hottest, hubSections, isoWeek, isPlayable, mayOpenRoom, type GameFlag } from './flags';

/**
 * `cardState` — the one function that decides what a player sees on a card.
 *
 * It is called from four places (the hub, `GameCardTile`, the admin centre and
 * `scripts/ssr.mjs`, which bakes its answers into PHP). A game is now exactly one
 * of `new` / `active` / `soon` / `hidden` — never two at once — so the checks
 * below are about that one value's own transitions, in both directions, for
 * every game.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const flag = (over: Partial<GameFlag> = {}): GameFlag => ({ ...DEFAULT_FLAG, ...over });

console.log('\nnothing is NEW until an operator says so');

{
  const view = cardState('live', DEFAULT_FLAG, false);
  check('a game with no flag at all has no badge', view.badge === null, view);
  check('and is playable', view.playable === true);
  check('and shows', view.show === true);
  // The whole point: a fresh install advertises nothing as new. NEW is something an
  // operator turns on when it is worth pointing at, not the state everything ships in.
  check('the default flag is active, not new', DEFAULT_FLAG.state === 'active');
}

console.log('\nthe NEW state, in both directions');

{
  check('new shows the badge', cardState('live', flag({ state: 'new' }), false).badge === 'new');
  check('active removes it', cardState('live', flag({ state: 'active' }), false).badge === null);
  check('and new is still playable', cardState('live', flag({ state: 'new' }), false).playable === true);
}

console.log('\nsoon still beats everything, because the code does not exist');

{
  const view = cardState('soon', flag({ state: 'new' }), false);
  check('a soon game is soon however it is flagged', view.badge === 'soon', view);
  check('and is never playable', view.playable === false);
  check('but it does show, because it is an advert', view.show === true);
  check('even in dev', cardState('soon', DEFAULT_FLAG, true).playable === false);
}

console.log('\nsoon and hidden');

{
  const off = cardState('live', flag({ state: 'soon' }), false);
  check('a soon game says so', off.badge === 'soon', off);
  check('and is not playable', off.playable === false);
  check('a reason replaces the default word',
    cardState('live', flag({ state: 'soon', reason: 'server maintenance' }), false).badge ===
      'server maintenance');
  // dev shows everything, with a badge stating what prod would do.
  check('dev sees the word "soon" rather than the excuse',
    cardState('live', flag({ state: 'soon', reason: 'x' }), true).badge === 'soon');
  check('and can still play it', cardState('live', flag({ state: 'soon' }), true).playable === true);

  const hidden = cardState('live', flag({ state: 'hidden' }), false);
  check('a hidden game does not show at all', hidden.show === false);
  check('and reads hidden', hidden.badge === 'hidden');
  check('dev sees it', cardState('live', flag({ state: 'hidden' }), true).show === true);
}

console.log('\nthe flag lookup');

{
  check('an unknown slug gets the default', flagFor({}, 'nothing').state === 'active');
  const flags = { spill: flag({ state: 'new' }) };
  check('a known slug gets its own', flagFor(flags, 'spill').state === 'new');

  // The one that actually gates a socket, as opposed to a badge. `occupied` is the
  // in-flight rule: disabling blocks NEW rooms and never interrupts a round already
  // being played.
  const empty = false;
  check('an active game may open a room', mayOpenRoom(flags, 'spill', empty) === true);
  check('so may a new one', mayOpenRoom({ spill: flag({ state: 'new' }) }, 'spill', empty) === true);
  check('a soon one may not', mayOpenRoom({ spill: flag({ state: 'soon' }) }, 'spill', empty) === false);
  check('a hidden one may not', mayOpenRoom({ spill: flag({ state: 'hidden' }) }, 'spill', empty) === false);
  check('and an unknown one may, because flags fail open', mayOpenRoom({}, 'anything', empty) === true);
  check('but a round already in progress is never cut off',
    mayOpenRoom({ spill: flag({ state: 'soon' }) }, 'spill', true) === true);
  check('not even a hidden one', mayOpenRoom({ spill: flag({ state: 'hidden' }) }, 'spill', true) === true);

  check('isPlayable agrees: active and new both are', isPlayable('active') && isPlayable('new'));
  check('soon and hidden are not', !isPlayable('soon') && !isPlayable('hidden'));
}

console.log('\nthe hot game');

{
  /*
   * Mirrored, case for case, in `api/tests/flags_test.php`. The server orders the grid
   * and the client hydrates it, so PHP and this file have to answer identically — a grid
   * ordered two ways is a hydration mismatch on every card after the first.
   */
  const all = ['tap-duel', 'spill', 'ghost-hunt'];

  check('the leader wins', hottest({ spill: 3, 'tap-duel': 1 }, all) === 'spill');
  check('a tie has no winner', hottest({ spill: 3, 'tap-duel': 3 }, all) === null);
  check('nothing played, nobody hot', hottest({}, all) === null);
  check('no counts at all is not an error', hottest(undefined, all) === null);
  check('zero is not a play', hottest({ spill: 0 }, all) === null);
  check('and neither is a negative', hottest({ spill: -4, 'tap-duel': 1 }, all) === 'tap-duel');
  // A count survives a game being deleted; promoting it would badge nothing and reorder
  // nothing, so it is ignored rather than trusted.
  check('a slug outside the catalogue cannot win', hottest({ 'zone-rush': 99, spill: 1 }, all) === 'spill');
  // The file is public and hand-editable; nonsense in it must not decide the shelf.
  check('nonsense is not a count', hottest({ spill: NaN, 'tap-duel': 2 }, all) === 'tap-duel');

  // hubSections' own three tiers (issue #4): week + hot pinned, then NEW alphabetical,
  // then the rest alphabetical. `all` here is already alphabetical (ghost-hunt, spill,
  // tap-duel would be the true sort — reusing the literal array from above instead,
  // since hubSections trusts its caller for that, the same as gameOfWeek already does).
  const alphabetical = ['ghost-hunt', 'spill', 'tap-duel'];
  const flags = { spill: flag({ state: 'new' }) };

  check(
    'hot and week both pinned, hot first',
    hubSections(alphabetical, {}, 'tap-duel', 'ghost-hunt').pinned.join() === 'ghost-hunt,tap-duel',
  );
  check(
    'the same slug pinned twice shows once',
    hubSections(alphabetical, {}, 'ghost-hunt', 'ghost-hunt').pinned.join() === 'ghost-hunt',
  );
  check('neither hot nor week pins anything', hubSections(alphabetical, {}, null, null).pinned.length === 0);
  check('a NEW game not pinned lands in fresh', hubSections(alphabetical, flags, null, null).fresh.join() === 'spill');
  check(
    'everything else lands in rest, still alphabetical',
    hubSections(alphabetical, flags, null, null).rest.join() === 'ghost-hunt,tap-duel',
  );
  check(
    'a pinned game is never also in fresh or rest',
    (() => {
      const sections = hubSections(alphabetical, flags, 'spill', null);
      return !sections.fresh.includes('spill') && !sections.rest.includes('spill');
    })(),
  );

  // HOT replaces NEW rather than stacking with it: one badge slot, and a card claiming
  // both says nothing.
  check('the hot card wears HOT', cardState('live', flag({}), false, true).badge === 'hot');
  check('even when it is also new', cardState('live', flag({ state: 'new' }), false, true).badge === 'hot');
  check('and it is still playable', cardState('live', flag({}), false, true).playable === true);
  // The other states' badges are caveats, and a caveat outranks a boast.
  check('a soon game does not boast', cardState('live', flag({ state: 'soon' }), false, true).badge === 'soon');
  check('nor does one that is not built yet', cardState('soon', flag({}), false, true).badge === 'soon');
}

console.log('\nISO week number, UTC — mirrored in api/tests/flags_test.php against gmdate(\'W\')');

{
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  check('the first Monday of an ordinary year is week 1', isoWeek(day('2024-01-01')) === 1);
  check('the last day of that same week is still week 1', isoWeek(day('2024-01-07')) === 1);
  check('the next day rolls over to week 2', isoWeek(day('2024-01-08')) === 2);
  // 2020 has an ISO week 53 — Dec 28, 2020 through Jan 3, 2021.
  check('the extra 53rd week of 2020 exists', isoWeek(day('2020-12-28')) === 53);
  check('new year\'s eve can fall inside it', isoWeek(day('2020-12-31')) === 53);
  check('so can the first days of the following January', isoWeek(day('2021-01-03')) === 53);
  check('until the 4th, which is always week 1', isoWeek(day('2021-01-04')) === 1);
  // 2025 begins on a Wednesday, so week 1 reaches back into the last two days of 2024.
  check('the last days of 2024 already belong to 2025\'s week 1', isoWeek(day('2024-12-31')) === 1);
  check('and so does New Year\'s Day itself', isoWeek(day('2025-01-01')) === 1);
  // 2023 begins on a Sunday, so New Year's Day itself is still the OLD year's last week.
  check('a year starting on a Sunday leaves Jan 1 in the old year\'s week', isoWeek(day('2023-01-01')) === 52);
  check('and the very next day starts the new year\'s week 1', isoWeek(day('2023-01-02')) === 1);
}

console.log('\nthe week\'s own spotlighted game');

{
  const alphabetical = ['aliens-love-cows', 'ghost-hunt', 'spill', 'tap-duel'];

  check('week 1 picks the first title alphabetically',
    gameOfWeek(alphabetical, new Date('2024-01-01T00:00:00Z')) === 'aliens-love-cows');
  check('week 2 picks the second',
    gameOfWeek(alphabetical, new Date('2024-01-08T00:00:00Z')) === 'ghost-hunt');
  // Week 5 wraps back around to the first game — 4 games, and (5-1) % 4 === 0.
  check('the rotation wraps once every game has had a week',
    gameOfWeek(alphabetical, new Date('2024-01-29T00:00:00Z')) === 'aliens-love-cows');
  check('an empty catalogue spotlights nothing', gameOfWeek([], new Date()) === null);
  check('a single game is always it', gameOfWeek(['spill'], new Date('2024-01-01T00:00:00Z')) === 'spill');

  // The whole point of taking a plain list rather than computing the order here:
  // the same week produces the same slug every single call, with no hidden state.
  const now = new Date('2026-08-30T00:00:00Z');
  check('the same inputs always answer the same way',
    gameOfWeek(alphabetical, now) === gameOfWeek(alphabetical, now));
}

console.log('\nWEEK, ranked between HOT and NEW');

{
  // Mirrored, case for case, in api/tests/flags_test.php — same reasoning as the hot
  // game's own mirrored table: the server orders and badges the grid, the client
  // hydrates it, and the two must agree.
  check('the week\'s own game wears WEEK',
    cardState('live', flag({}), false, false, true).badge === 'week');
  check('even when it is also flagged new', cardState('live', flag({ state: 'new' }), false, false, true).badge === 'week');
  check('but HOT still outranks it', cardState('live', flag({}), false, true, true).badge === 'hot');
  check('and it is still playable', cardState('live', flag({}), false, false, true).playable === true);
  check('a soon game does not get spotlighted either',
    cardState('live', flag({ state: 'soon' }), false, false, true).badge === 'soon');
  check('nor a game that is not built yet', cardState('soon', flag({}), false, false, true).badge === 'soon');
  // Without week, the existing NEW/nothing rule is exactly as it always was.
  check('no week, no change to a plain new card', cardState('live', flag({ state: 'new' }), false).badge === 'new');
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
