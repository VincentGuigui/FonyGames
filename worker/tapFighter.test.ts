import { confront, resolveFight } from '../shared/tapFighter';
import { onFighterLock, startTapFighter, tick, type TapFighter } from './tapFighter';
import type { ServerMessage } from '../shared/protocol';

function check(name: string, pass: boolean): void { if (!pass) throw new Error(name); console.log(`  ok   ${name}`); }

check('kick against kick hits both', confront('kick', 'kick').blue && confront('kick', 'kick').green);
check('kick misses jump', !confront('kick', 'jump').green);
check('punch misses crouch', !confront('punch', 'crouch').green);
check('punch hits jump', confront('punch', 'jump').green);
check('crouching into kick gets hit', confront('crouch', 'kick').blue);

const resolved = resolveFight(
  ['punch', 'punch', 'punch', 'crouch', 'jump', 'kick'],
  ['jump', 'jump', 'jump', 'punch', 'kick', 'crouch'],
);
check('fewer received impacts wins', resolved.winner === 'blue');
check('loser reaches zero health', resolved.beats.at(-1)?.greenHealth === 0);

let now = 1_000;
let state: TapFighter | null = null;
const sent: ServerMessage[] = [];
const ctx = { now: () => now, nextSeq: () => sent.length + 1, broadcast: (message: ServerMessage) => sent.push(message), load: async () => state, save: async (next: TapFighter) => { state = next; }, setAlarm: async () => {} };
await startTapFighter(ctx, 1, ['a', 'b']);
const plan = ['punch', 'kick', 'jump', 'crouch', 'punch', 'kick'] as const;
await onFighterLock(ctx, 'a', 1, [...plan]);
const privateFrame = sent.at(-1);
check('one locked plan stays private', privateFrame?.t === 'fighter' && privateFrame.d.actions === null);
await onFighterLock(ctx, 'b', 1, [...plan]);
check('both plans start the automatic fight', state !== null && (state as TapFighter).phase === 'fighting');
check('six choreographed beats last twenty-seven seconds', (state as unknown as TapFighter).endsAt - (state as unknown as TapFighter).startsAt === 27_000);
now = (state as unknown as TapFighter).endsAt;
await tick(ctx);
check('equal plans produce a round draw', state !== null && (state as TapFighter).phase === 'round-over' && (state as TapFighter).draw);

for (let round = 2; round <= 4; round++) {
  await startTapFighter(ctx, round, ['a', 'b']);
  await onFighterLock(ctx, 'a', round, Array(6).fill('punch'));
  await onFighterLock(ctx, 'b', round, Array(6).fill('jump'));
  now = (state as unknown as TapFighter).endsAt;
  await tick(ctx);
}
check('first fighter to three rounds wins the match', state !== null && (state as TapFighter).phase === 'match-over' && (state as TapFighter).matchWinner === 'blue' && (state as TapFighter).roundWins.blue === 3);

console.log('tap fighter referee passed');
