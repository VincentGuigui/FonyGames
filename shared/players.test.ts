import { canSwitchToGame, switchableGames } from './players';

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}`);
}

console.log('\nroom game switching eligibility');
check('a two-player game accepts two connected players', canSwitchToGame('tap-fighter', 2));
check('a two-player game rejects a third connected player', !canSwitchToGame('tap-fighter', 3));
check('a range game accepts its minimum roster', canSwitchToGame('spill', 2));
check('a range game accepts its maximum roster', canSwitchToGame('spill', 4));
check('a range game rejects a roster above its maximum', !canSwitchToGame('spill', 5));
check('an unknown route is never switchable', !canSwitchToGame('not-a-game', 2));
check('the current game is excluded from destinations', !switchableGames('tap-fighter', 2).includes('tap-fighter'));
check('only compatible destinations are offered',
  switchableGames('tap-fighter', 3).every((game) => game !== 'tap-fighter' && canSwitchToGame(game, 3)));

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
