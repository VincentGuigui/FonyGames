import { arrange, type ScoreRow } from './Scoreboard';
import type { PlayerId } from '../../../../shared/protocol';

/**
 * The score panel's two rules.
 * Component: core/ui/Scoreboard.tsx · spec: docs/design/game-chrome.md §6
 *
 * Both of them are the kind of thing that looks right in the game you happened to
 * open and is wrong in another:
 *
 * - **You are the top row.** Trivial until the round you are not in the list at all
 *   (Cat and Mouse's cat) or have not been given a seat yet.
 * - **The leader is bold, and only when there is one.** Two games are won by the
 *   LOWEST number, so a single hard-coded `>` would print the bold beside whoever is
 *   losing in Spill and Sling Puck — visible only to somebody who plays those two and
 *   thinks about it.
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

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;

const row = (id: PlayerId, value: string | number, out?: boolean): ScoreRow => ({
  id,
  avatar: '🙂',
  name: id.toUpperCase(),
  value,
  ...(out ? { out: true } : {}),
});

console.log('\nyou are the top row');

{
  const rows = [row(A, 1), row(B, 2), row(C, 3)];
  const out = arrange(rows, B, 'high');
  check('whoever is holding the phone comes first', out[0]?.id === B, out.map((r) => r.id));
  check('and is marked as such', out[0]?.me === true);
  // Room order, not score order: a list that reorders under your eyes mid-round is a
  // list you have to read again to find anything.
  check('everyone else keeps room order', out[1]?.id === A && out[2]?.id === C, out.map((r) => r.id));
  check('and nobody else is marked as you', out.filter((r) => r.me).length === 1);
}

{
  // Cat and Mouse's cat is not in the list — it has no lives to count — and Sling
  // Puck's board renders for a frame or two before the client has an id.
  const rows = [row(A, 1), row(B, 2)];
  check('a player who is not in the list changes nothing', arrange(rows, C, 'high')[0]?.id === A);
  check('nor does having no id yet', arrange(rows, null, 'high')[0]?.id === A);
  check('and then no row claims to be you', arrange(rows, undefined, 'high').every((r) => !r.me));
}

console.log('\nthe leader, and only when there is one');

{
  const rows = [row(A, 1), row(B, 5), row(C, 3)];
  const high = arrange(rows, A, 'high');
  check('most is the lead where high wins', high.find((r) => r.best)?.id === B);
  check('and exactly one row has it', high.filter((r) => r.best).length === 1);

  // THE check. Spill counts water and Sling Puck counts pucks left: in both, the
  // player with the biggest number is the one about to lose.
  const low = arrange(rows, A, 'low');
  check('fewest is the lead where low wins', low.find((r) => r.best)?.id === A, low.filter((r) => r.best));
}

{
  // Every round starts level. Bolding four tied rows says nothing and makes the panel
  // look like it is shouting.
  const level = arrange([row(A, 0), row(B, 0), row(C, 0)], A, 'high');
  check('a tie has no leader', level.every((r) => !r.best));

  const shared = arrange([row(A, 4), row(B, 4), row(C, 1)], A, 'high');
  check('and neither does a shared lead', shared.every((r) => !r.best), shared.filter((r) => r.best));

  const clear = arrange([row(A, 4), row(B, 4), row(C, 9)], A, 'high');
  check('but one player out in front does', clear.find((r) => r.best)?.id === C);
}

{
  // Pass the Bomb has no score at all: its value is "has it" / "clear". Steady Hand's
  // is a row of pips. Ranking either would be inventing a winner.
  const words = [row(A, 'has it'), row(B, 'clear'), row(C, 'clear')];
  check('a game with no ranking bolds nobody', arrange(words, A, 'none').every((r) => !r.best));
  // And a word that is not a number must not accidentally rank as one: `Number('clear')`
  // is NaN, which loses every comparison instead of throwing.
  check(
    'nor does a game whose values are words',
    arrange(words, A, 'high').every((r) => !r.best),
    arrange(words, A, 'high').filter((r) => r.best),
  );
  check('even asked for the lowest', arrange(words, A, 'low').every((r) => !r.best));
}

{
  // A knocked-out player is not "the best", whatever their last number was.
  const rows = [row(A, 3), row(B, 9, true), row(C, 5)];
  const out = arrange(rows, A, 'high');
  check('somebody out of the round cannot be the leader', out.find((r) => r.best)?.id === C, out.filter((r) => r.best));
  check('but they are still listed', out.length === 3);
  check('and still marked out', out.find((r) => r.id === B)?.out === true);
}

{
  // One player left in it and the rest out: there is no race, so nothing is bold.
  const rows = [row(A, 3), row(B, 9, true)];
  check('a single survivor is not a leader', arrange(rows, A, 'high').every((r) => !r.best));
}

console.log('\nnothing is lost or invented');

{
  const rows = [row(A, 1), row(B, 2), row(C, 3)];
  const out = arrange(rows, B, 'high');
  check('every player comes back', out.length === 3);
  check('with their own values', out.find((r) => r.id === C)?.value === 3);
  // Preact keys on `id`, so a duplicate or a dropped row is a rendering bug that only
  // shows up as a row not updating.
  check('and no duplicates', new Set(out.map((r) => r.id)).size === 3);
  check('the input is not mutated', rows[0]?.id === A && !('me' in (rows[0] as object)));
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
