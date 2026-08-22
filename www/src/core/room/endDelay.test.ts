import { endsPresentation, RESULT_HOLD_MS } from './client';
import type { ServerMessage } from '../../../../shared/protocol';

function check(name: string, pass: boolean): void { if (!pass) throw new Error(name); console.log(`  ok   ${name}`); }
const frame = (phase: 'running' | 'done'): ServerMessage => ({ t: 'taptap', s: 1, d: { roundId: 1, startsAt: 0, endsAt: 1, order: [], remaining: {}, finishedAt: {}, winner: null, phase } });
check('the board-only hold is half a second', RESULT_HOLD_MS === 500);
check('a running frame stays immediate', !endsPresentation(frame('running')));
check('an end frame holds the board', endsPresentation(frame('done')));
check('tap fighter holds both round and match results', endsPresentation({ t: 'fighter', s: 1, d: { roundId: 1, matchRound: 1, phase: 'round-over', seats: { blue: 'a', green: 'b' }, ready: { blue: true, green: true }, actions: null, beats: [], roundWins: { blue: 1, green: 0 }, startsAt: 0, endsAt: 1, roundWinner: 'blue', matchWinner: null, draw: false, solo: false } }));
console.log('shared result hold passed');
