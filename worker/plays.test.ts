import { endsRound, playsUrl, reportPlay, roundKey } from './plays';
import type { BombMatch, PlayerId, ServerMessage } from '../shared/protocol';

/**
 * What counts as a game played.
 * Spec: docs/specs/backoffice.md §7 · the rule: worker/plays.ts
 *
 * This decides one number on the hub — how many times a game has been played — and it is
 * the kind of rule that is never noticed when it is wrong, only wrong. A frame matched by
 * mistake would count a game once per tick and pin the HOT badge to it forever; a frame
 * missed would leave a game showing nil while people play it all evening. Neither shows up
 * as a failure anywhere.
 *
 * So every game's end frame is here, in both its won and its abandoned form, plus the
 * mid-round frames each one broadcasts on the way — because "does a tick count" is exactly
 * the question a `switch` on `msg.t` gets wrong when a new message type is added.
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

/** Standings nothing in this file depends on — a bomb frame simply has to carry some. */
const MATCH: BombMatch = { round: 1, rounds: 5, wins: {}, champion: null, done: false };

console.log('\na round somebody won counts');

{
  const won = (msg: ServerMessage, what: string): void => check(what, endsRound(msg) === true, msg);
  const not = (msg: ServerMessage, what: string): void => check(what, endsRound(msg) === false, msg);

  // Tap Duel: the MATCH is the game, not the duel. Counting each duel would make one
  // evening of Tap Duel look like ten of anything else.
  const result = (matchWinnerId: PlayerId | null): ServerMessage => ({
    t: 'result',
    s: 1,
    d: { roundId: 1, ranking: [], winnerId: A, scores: {}, matchWinnerId, noContest: false },
  });
  won(result(A), 'tap duel: the match');
  not(result(null), 'tap duel: not each duel inside it');

  /*
   * Pass the Bomb is a match too: five rounds at three or more players, or three at two.
   * The match that decides it is the game played — counting each round on its own would
   * make one evening of it look like several of anything else, the same trap `result`
   * above avoids.
   */
  const bombed = (over: Partial<BombMatch>): ServerMessage => ({
    t: 'boom',
    s: 1,
    d: {
      roundId: 1,
      victim: B,
      alive: [A],
      over: true,
      match: { round: 5, rounds: 5, wins: { [A]: 3, [B]: 2 }, champion: null, done: false, ...over },
    },
  });
  won(bombed({ done: true, champion: A }), 'pass the bomb: the match');
  not(bombed({}), 'pass the bomb: not each round inside it');
  not(bombed({ done: true, champion: null }), 'pass the bomb: not a match nobody took');

  won({ t: 'steady-end', s: 1, d: { roundId: 1, winner: A, times: {} } }, 'steady hand: a survivor');
  not({ t: 'steady-end', s: 1, d: { roundId: 1, winner: null, times: {} } }, 'steady hand: not a round nobody won');

  const hunt = (scores: Record<PlayerId, number>): ServerMessage => ({
    t: 'hunt-end',
    s: 1,
    d: { roundId: 1, scores, totals: {}, points: {}, fastest: {}, slowest: {} },
  });
  won(hunt({ [A]: 5, [B]: 2 }), 'ghost hunt: somebody caught something');
  not(hunt({ [A]: 0, [B]: 0 }), 'ghost hunt: not a round with no catches');

  const rush = (at: Record<PlayerId, number>, order: PlayerId[]): ServerMessage => ({
    t: 'rush-end',
    s: 1,
    d: { roundId: 1, order, at },
  });
  won(rush({ [A]: 120, [B]: 40 }, [A, B]), 'shake rush: a race');
  // `order` is filled even when nobody moved — it falls back to the furthest of the rest.
  not(rush({ [A]: 0, [B]: 0 }, [A, B]), 'shake rush: not a room of still phones');

  won({ t: 'spill-over', s: 1, d: { roundId: 1, winnerId: A, levels: {} } }, 'spill: a winner');
  not({ t: 'spill-over', s: 1, d: { roundId: 1, winnerId: null, levels: {} } }, 'spill: not an abandoned round');
  won({ t: 'siege-over', s: 1, d: { roundId: 1, winnerId: A, cabbages: {} } }, 'goat siege: a winner');
  not({ t: 'siege-over', s: 1, d: { roundId: 1, winnerId: null, cabbages: {} } }, 'goat siege: not an abandoned round');
  won({ t: 'sling-over', s: 1, d: { roundId: 1, winnerId: A, pucks: {} } }, 'sling puck: a winner');
  not({ t: 'sling-over', s: 1, d: { roundId: 1, winnerId: null, pucks: {} } }, 'sling puck: not an abandoned round');

  // The one game where both sides can win, so both count.
  const cm = (catWins: boolean, survivors: PlayerId[]): ServerMessage => ({
    t: 'cm-over',
    s: 1,
    d: { roundId: 1, catWins, survivors, lastedMs: 1000 },
  });
  won(cm(true, []), 'cat and mouse: the cat');
  won(cm(false, [B]), 'cat and mouse: the mice');
  not(cm(false, []), 'cat and mouse: not an emptied floor');

  // Squash Mosquitoes ends the same way Grid Attack does: phase and winner in the
  // same frame, and a cap that ends in a tie has no winner.
  const squash = (phase: 'running' | 'done', winner: PlayerId | null): ServerMessage => ({
    t: 'squash',
    s: 1,
    d: { roundId: 1, startsAt: 0, endsAt: 1, pattern: [], scores: {}, winner, phase },
  });
  won(squash('done', A), 'squash mosquitoes: somebody squashed all 66');
  not(squash('done', null), 'squash mosquitoes: not a tie at the cap');
  not(squash('running', null), 'squash mosquitoes: not mid-round');

  // Neon Fall ends the same way: phase and winner in the same frame. Unlike
  // Squash Mosquitoes, the safety cap always names a winner (the glider
  // survived it), so there is no "tie at the cap" case here.
  const neon = (phase: 'running' | 'done', winner: PlayerId | null): ServerMessage => ({
    t: 'neon',
    s: 1,
    d: {
      roundId: 1,
      startsAt: 0,
      endsAt: 1,
      gliderId: A,
      protectorId: B,
      lane: 2,
      y: 0,
      lives: 3,
      bounceUntil: 0,
      ammo: 3,
      cooldownUntil: 0,
      bolts: [],
      winner,
      phase,
    },
  });
  won(neon('done', A), 'neon fall: the glider reached the floor');
  won(neon('done', B), 'neon fall: the protector took every life');
  not(neon('running', null), 'neon fall: not mid-round');
}

console.log('\nnothing mid-round counts');

{
  const ticks: ServerMessage[] = [
    { t: 'presence', s: 1, d: { code: 'ABCDEF', players: [], hostId: null } },
    { t: 'pong', d: { at: 1, serverTime: 1 } },
    { t: 'arm', s: 1, d: { roundId: 1, fireAt: 2, startsAt: 1, target: { x: 0.5, y: 0.5 }, speed: 1 } },
    { t: 'false-start', d: { roundId: 1 } },
    { t: 'bomb', s: 1, d: { roundId: 1, holder: A, alive: [A, B], match: MATCH } },
    { t: 'rush', s: 1, d: { roundId: 1, endsAt: 9, at: {}, finished: [], away: [] } },
    { t: 'hunt', s: 1, d: { roundId: 1, targets: [], index: {}, endsAt: 9, scores: {}, totals: {}, points: {} } },
    { t: 'cm-frame', s: 1, d: { roundId: 1, at: 1, pos: {} } },
    { t: 'squash', s: 1, d: { roundId: 1, startsAt: 0, endsAt: 1, pattern: [], scores: {}, winner: null, phase: 'running' } },
    { t: 'error', d: { code: 'rate-limited', message: 'Slow down.' } },
  ];

  check(
    'not one of the frames a live round sends',
    ticks.every((m) => !endsRound(m)),
    ticks.filter((m) => endsRound(m)).map((m) => m.t),
  );
}

console.log('\none round is counted once');

{
  const over: ServerMessage = { t: 'spill-over', s: 1, d: { roundId: 7, winnerId: A, levels: {} } };
  check('an end frame has a key', roundKey(over) === 'spill-over:7');
  check('the same round twice is the same key', roundKey({ ...over, s: 2 }) === roundKey(over));
  // A new round is a new key, or "race again" would never be counted.
  check('a later round is a different key',
    roundKey({ ...over, d: { ...over.d, roundId: 8 } }) !== roundKey(over));
  check('a mid-round frame has none', roundKey({ t: 'bomb', s: 1, d: { roundId: 7, holder: A, alive: [A, B], match: MATCH } }) === null);
  // Two games ending on the same round number are not the same round.
  check('and two games do not collide',
    roundKey({ t: 'siege-over', s: 1, d: { roundId: 7, winnerId: A, cabbages: {} } }) !== roundKey(over));
}

console.log('\nthe endpoint is derived from where the flags live');

{
  // One host, two files: deriving means there is no second URL to configure, and no way
  // for a dev Worker to count into production because one var was updated and not the other.
  check('beside the flags', playsUrl('https://fonygames-dev.guigui.fr/flags.json') ===
    'https://fonygames-dev.guigui.fr/api/played.php');
  check('whatever path the flags are on', playsUrl('http://localhost:5173/flags.json') ===
    'http://localhost:5173/api/played.php');
  check('no flags url, no counting', playsUrl(undefined) === null);
  check('and nonsense does not throw', playsUrl('not a url') === null);
}

console.log('\nreporting never breaks a round');

{
  // The result is already on every screen by the time this runs. Nothing about it may
  // throw, and nothing about it may be waited on.
  const posted: { url: string; init: RequestInit | undefined }[] = [];
  const ok = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const sent = await reportPlay('spill', { url: 'https://host.test/api/played.php', fetcher: ok });
  check('a 200 is a success', sent === true);
  check('it posts', posted[0]?.init?.method === 'POST');
  check('the slug, as JSON', posted[0]?.init?.body === '{"slug":"spill"}', posted[0]?.init?.body);
  check('with no token when there is none',
    !Object.keys((posted[0]?.init?.headers ?? {}) as Record<string, string>).includes('X-Plays-Token'));

  await reportPlay('spill', { url: 'https://host.test/api/played.php', token: 's3cret', fetcher: ok });
  check('and with one when there is',
    ((posted[1]?.init?.headers ?? {}) as Record<string, string>)['X-Plays-Token'] === 's3cret');

  const refused = (async () => {
    throw new Error('connection refused');
  }) as unknown as typeof fetch;
  check('a host that is down is reported, not thrown',
    (await reportPlay('spill', { url: 'https://host.test/api/played.php', fetcher: refused })) === false);

  const missing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
  check('and so is a refusal', (await reportPlay('spill', { url: 'https://host.test/api/played.php', fetcher: missing })) === false);

  // A host that accepts the connection and then never answers must not hold the object
  // open; the timeout is what turns that into a `false`.
  const hangs = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const started = Date.now();
  check('a hanging host gives up',
    (await reportPlay('spill', { url: 'https://host.test/api/played.php', fetcher: hangs, timeoutMs: 50 })) === false);
  check('quickly', Date.now() - started < 1000, Date.now() - started);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
