import { MERGE_MALUS_MOVES } from '../../../../shared/protocol';
import { CLEAR, afflict, played, stoned, swallow, type Effects } from './effects';

/** What maluses still do, in moves. Module: double-fusion/effects.ts · spec §3.1 */

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

console.log('\nmaluses last three moves, not seconds (§3.1)');
check('three moves', MERGE_MALUS_MOVES === 3);
check('a freeze, fog and gravity last three moves', afflict(CLEAR, 'freeze').frozen === 3 && afflict(CLEAR, 'fog').fog === 3 && afflict(CLEAR, 'gravity').gravity === 3);
check('an explosion and a tile last no time at all', afflict(CLEAR, 'explode') === CLEAR && afflict(CLEAR, 'add') === CLEAR);
check('a stone is counted once it has a cell', stoned(CLEAR).stone === 3 && afflict(CLEAR, 'stone').stone === 0);

let e: Effects = afflict(CLEAR, 'freeze');
const swallowed: boolean[] = [];
for (let i = 0; i < 4; i++) {
  const r = swallow(e);
  swallowed.push(r.swallowed);
  e = r.effects;
}
check('a freeze swallows the next three swipes, then lets go', swallowed.join() === 'true,true,true,false');
check('and never counts a played move', played(afflict(CLEAR, 'freeze')).effects.frozen === 3);

e = afflict(CLEAR, 'gravity');
const falls: boolean[] = [];
for (let i = 0; i < 5; i++) {
  const r = played(e);
  falls.push(r.fall);
  e = r.effects;
}
check('gravity pulls everything down after each of the next three moves', falls.join() === 'true,true,true,false,false', falls);

e = afflict(CLEAR, 'fog');
const fog: number[] = [];
for (let i = 0; i < 4; i++) {
  fog.push(e.fog);
  e = played(e).effects;
}
check('fog hides the numbers for three moves', fog.join() === '3,2,1,0', fog);

e = stoned(CLEAR);
const crumbled: boolean[] = [];
for (let i = 0; i < 4; i++) {
  const r = played(e);
  crumbled.push(r.crumbled);
  e = r.effects;
}
check('a stone crumbles on the third move', crumbled.join() === 'false,false,true,false', crumbled);
check('a second malus of a kind starts it over', afflict(afflict(CLEAR, 'fog'), 'fog').fog === 3 && afflict({ ...CLEAR, fog: 1 }, 'fog').fog === 3);

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
