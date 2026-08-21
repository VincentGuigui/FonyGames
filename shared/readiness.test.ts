import { guestsReady, resetReadiness, type ReadyPlayer } from './readiness';

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

const host = (): ReadyPlayer => ({ id: 'host', connected: true, ready: false });
const guest = (id: string, ready: boolean, connected = true): ReadyPlayer => ({
  id,
  connected,
  ready,
});

console.log('\nwho must be ready');

check('the host is implicit', guestsReady([host()], 'host'));
check('one unready guest blocks start', !guestsReady([host(), guest('a', false)], 'host'));
check('every connected guest unblocks it', guestsReady([host(), guest('a', true), guest('b', true)], 'host'));
check('an away guest does not strand the room', guestsReady([host(), guest('a', false, false)], 'host'));
check('a room without a host still requires every connected player', !guestsReady([guest('a', false)], null));

console.log('\na round consumes readiness');

const players = [host(), guest('a', true), guest('b', true)];
resetReadiness(players);
check('every flag is cleared', players.every((player) => !player.ready));

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
