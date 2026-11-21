import { formatDuration, timerTone } from './timer';

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

console.log('\na Highlander solve is a duration (§3)');
check('under a minute', formatDuration(42_100) === '0:42.1');
check('over a minute', formatDuration(83_400) === '1:23.4');
check('the full three minutes', formatDuration(180_000) === '3:00.0');
check('to the tenth, rounded', formatDuration(59_960) === '1:00.0');
check('never negative', formatDuration(-5) === '0:00.0');

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
