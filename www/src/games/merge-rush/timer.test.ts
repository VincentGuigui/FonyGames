import { timerTone } from './timer';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`);
  }
}

console.log('\nthe clock gets louder as it runs down (§4)');
check('a full round is calm', timerTone(120) === 'calm');
check('31 seconds is still calm', timerTone(31) === 'calm');
check('30 seconds is orange', timerTone(30) === 'warn');
check('16 seconds is still orange', timerTone(16) === 'warn');
check('15 seconds is red and blinking', timerTone(15) === 'urgent');
check('and stays so to the end', timerTone(1) === 'urgent' && timerTone(0) === 'urgent');

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
