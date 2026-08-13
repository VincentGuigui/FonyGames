import { cardState, DEFAULT_FLAG, flagFor, mayOpenRoom, type GameFlag } from './flags';

/**
 * `cardState` — the one function that decides what a player sees on a card.
 *
 * It is called from four places (the hub, `GameCardTile`, the admin centre and
 * `scripts/ssr.mjs`, which bakes its answers into PHP), and it had no test of its
 * own. That is how this shipped:
 *
 *     const isNew = flag.isNew || status === 'new';
 *
 * The `||` made the admin's NEW toggle a no-op for every game whose card said
 * `status: 'new'` — switching the flag off left the badge on, because the
 * build-time half still held, and no amount of clicking could clear it. Nothing
 * failed, nothing logged; the button just did nothing.
 *
 * So the checks below are written from the operator's side: press the toggle, and
 * the badge must follow it, in both directions, for every game.
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
  check('the default flag is not new', DEFAULT_FLAG.isNew === false);
}

console.log('\nthe NEW toggle, in both directions');

{
  check('on shows the badge', cardState('live', flag({ isNew: true }), false).badge === 'new');
  check('off removes it', cardState('live', flag({ isNew: false }), false).badge === null);
  // The regression, stated as plainly as it can be: there is no second source of NEW.
  // If a build-time value is ever OR'd back in, this is the check that fails.
  check('and nothing else can put it back',
    cardState('live', flag({ isNew: false }), false).badge === null &&
      cardState('live', flag({ isNew: false }), true).badge === null);
  check('turning it off leaves the game playable', cardState('live', flag({ isNew: false }), false).playable === true);
}

console.log('\nsoon still beats everything, because the code does not exist');

{
  const view = cardState('soon', flag({ isNew: true, availability: 'active' }), false);
  check('a soon game is soon however it is flagged', view.badge === 'soon', view);
  check('and is never playable', view.playable === false);
  check('but it does show, because it is an advert', view.show === true);
  check('even in dev', cardState('soon', DEFAULT_FLAG, true).playable === false);
}

console.log('\ndisabled and hidden are unaffected by NEW');

{
  const off = cardState('live', flag({ availability: 'disabled', isNew: true }), false);
  check('a disabled game says why, not NEW', off.badge === 'paused', off);
  check('and is not playable', off.playable === false);
  check('a reason replaces the default word',
    cardState('live', flag({ availability: 'disabled', reason: 'server maintenance' }), false).badge ===
      'server maintenance');
  // dev shows everything, with a badge stating what prod would do.
  check('dev sees the state rather than the excuse',
    cardState('live', flag({ availability: 'disabled', reason: 'x' }), true).badge === 'disabled');
  check('and can still play it', cardState('live', flag({ availability: 'disabled' }), true).playable === true);

  const hidden = cardState('live', flag({ availability: 'hidden', isNew: true }), false);
  check('a hidden game does not show at all', hidden.show === false);
  check('NEW cannot drag it back onto the hub', hidden.badge === 'hidden');
  check('dev sees it', cardState('live', flag({ availability: 'hidden' }), true).show === true);
}

console.log('\nthe flag lookup');

{
  check('an unknown slug gets the default', flagFor({}, 'nothing').isNew === false);
  check('and is active', flagFor({}, 'nothing').availability === 'active');
  const flags = { spill: flag({ isNew: true }) };
  check('a known slug gets its own', flagFor(flags, 'spill').isNew === true);

  // The one that actually gates a socket, as opposed to a badge. `occupied` is the
  // in-flight rule: disabling blocks NEW rooms and never interrupts a round already
  // being played.
  const empty = false;
  check('an active game may open a room', mayOpenRoom(flags, 'spill', empty) === true);
  check('a disabled one may not', mayOpenRoom({ spill: flag({ availability: 'disabled' }) }, 'spill', empty) === false);
  check('a hidden one may not', mayOpenRoom({ spill: flag({ availability: 'hidden' }) }, 'spill', empty) === false);
  check('and an unknown one may, because flags fail open', mayOpenRoom({}, 'anything', empty) === true);
  check('but a round already in progress is never cut off',
    mayOpenRoom({ spill: flag({ availability: 'disabled' }) }, 'spill', true) === true);
  check('not even a hidden one', mayOpenRoom({ spill: flag({ availability: 'hidden' }) }, 'spill', true) === true);
  // Worth stating next to the lines above: NEW is a merchandising switch, not a
  // security control, and shared/flags.ts says so.
  check('NEW never gates a room', mayOpenRoom({ spill: flag({ isNew: true }) }, 'spill', empty) === true);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
