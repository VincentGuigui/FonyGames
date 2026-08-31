import { HEARTBEAT_START_BPM, HEARTBEAT_STEP_BPM, heartbeatBpm } from './heartbeat';

/**
 * The heartbeat's tempo. Module: pass-the-bomb/heartbeat.ts · issue #12
 *
 * `heartbeatBpm` is the one pure piece of a file that otherwise only talks to a real
 * `AudioContext` — the loop itself is a side effect, not a return value, so there is nothing
 * to assert about it beyond "the tempo it was told to play at is the tempo issue #12 asked for".
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

console.log('\nstarts at 60, gets 15 after each pass (issue #12)');

check('no passes yet is the starting tempo', heartbeatBpm(0) === 60, heartbeatBpm(0));
check('one pass is 75', heartbeatBpm(1) === 75, heartbeatBpm(1));
check('two passes is 90', heartbeatBpm(2) === 90, heartbeatBpm(2));
check('ten passes keeps climbing by the same step', heartbeatBpm(10) === 210, heartbeatBpm(10));
check('the constants match the issue\'s own numbers', HEARTBEAT_START_BPM === 60 && HEARTBEAT_STEP_BPM === 15);

console.log('\na pass count is never negative in practice, but the function does not misbehave if it were');

check('a negative count floors at the starting tempo rather than going below it', heartbeatBpm(-3) === 60, heartbeatBpm(-3));

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
