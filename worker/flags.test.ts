/**
 * Logic harness for worker/flags.ts.
 *
 * The interesting cases are all failures, because the failures are what decide
 * whether a bad flags file can take the catalogue down. A test suite here that only
 * proved "a disabled game reads as disabled" would have missed every one of them.
 */

import {
  FLAGS_TIMEOUT_MS,
  makeFlagsReader,
  parseFlags,
  timedFetch,
  type Fetcher,
} from './flags';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const URL_ = 'https://example.test/flags.json';

/** A fetcher that answers from a script, and records what it was asked. */
function scripted(steps: Array<() => Promise<Response>>) {
  const calls: Array<{ url: string; timeoutMs: number }> = [];
  let i = 0;
  const fetcher: Fetcher = async (url, timeoutMs) => {
    calls.push({ url, timeoutMs });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    if (!step) throw new Error('no step');
    return step();
  };
  return { fetcher, calls, count: () => i };
}

function ok(flags: unknown): () => Promise<Response> {
  return async () => new Response(JSON.stringify({ flags }), { status: 200 });
}

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

async function parsing(): Promise<void> {
  console.log('\nparsing the published document');

  const good = parseFlags({ flags: { spill: { availability: 'disabled', isNew: true } } });
  check('a well-formed flag survives', good['spill']?.availability === 'disabled', good);
  check('and its badge', good['spill']?.isNew === true);

  const reason = parseFlags({ flags: { spill: { availability: 'disabled', reason: '  back Friday ' } } });
  check('a reason is trimmed', reason['spill']?.reason === 'back Friday', reason);
  check(
    'a blank reason is absent, not empty',
    !('reason' in (parseFlags({ flags: { spill: { availability: 'disabled', reason: '   ' } } })['spill'] ?? {})),
  );

  check('a missing flags key is an empty map', Object.keys(parseFlags({})).length === 0);
  check('null is an empty map', Object.keys(parseFlags(null)).length === 0);
  check('a string is an empty map', Object.keys(parseFlags('nope')).length === 0);
  // A JSON array would give `Object.entries` numeric keys, which the slug guard
  // rejects — but bailing out explicitly is cheaper than relying on that.
  check('an array of flags is an empty map', Object.keys(parseFlags({ flags: [] })).length === 0);

  const bad = parseFlags({
    flags: {
      '../etc/passwd': { availability: 'hidden', isNew: false },
      '//evil.test': { availability: 'hidden', isNew: false },
      spill: { availability: 'hidden', isNew: false },
    },
  });
  check('a slug that is not a slug is dropped', Object.keys(bad).join() === 'spill', bad);
  check('and the good one beside it survives', bad['spill']?.availability === 'hidden');

  const weird = parseFlags({ flags: { spill: { availability: 'banana', isNew: 1 } } });
  check('an availability outside the enum falls back to active', weird['spill']?.availability === 'active', weird);
  check('a truthy non-boolean isNew is not trusted', weird['spill']?.isNew === false, weird);
}

async function caching(): Promise<void> {
  console.log('\ncaching');

  const c = clock();
  const s = scripted([ok({ spill: { availability: 'disabled', isNew: false } })]);
  const reader = makeFlagsReader({ url: URL_, now: c.now, fetcher: s.fetcher });

  check('the first read fetches', (await reader.availabilityOf('spill')) === 'disabled');
  check('once', s.count() === 1, s.count());

  await reader.availabilityOf('spill');
  await reader.availabilityOf('tap-duel');
  check('further reads inside the TTL do not', s.count() === 1, s.count());

  c.advance(59_000);
  await reader.availabilityOf('spill');
  check('still not at 59 s', s.count() === 1, s.count());

  c.advance(2_000);
  await reader.availabilityOf('spill');
  check('and refetches once past 60 s', s.count() === 2, s.count());

  check('an unknown slug is active', (await reader.availabilityOf('ghost-tag')) === 'active');
  check('the timeout is passed to the fetcher', s.calls[0]?.timeoutMs === FLAGS_TIMEOUT_MS, s.calls[0]);
}

async function coalescing(): Promise<void> {
  console.log('\nconcurrent room-opens share one fetch');

  const c = clock();
  // Assigned a no-op first: the Promise executor runs synchronously, but TypeScript
  // cannot see that, and `let release: (() => void) | null = null` narrows to `null`
  // for the rest of the function.
  let release = (): void => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });

  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    await gate;
    return new Response(JSON.stringify({ flags: { spill: { availability: 'hidden' } } }), {
      status: 200,
    });
  };

  const reader = makeFlagsReader({ url: URL_, now: c.now, fetcher });

  // Twenty joins arriving on a cold isolate. Without coalescing this is twenty
  // requests to the web host, all for the same 200-byte file.
  const all = Promise.all(Array.from({ length: 20 }, () => reader.availabilityOf('spill')));
  release();
  const answers = await all;

  check('one fetch served twenty readers', calls === 1, calls);
  check('and they all got the answer', answers.every((a) => a === 'hidden'), answers);
}

async function failing(): Promise<void> {
  console.log('\nfailure is always an answer, never an error');

  const c = clock();

  // No copy yet, and the fetch fails: every game is active.
  const dead = makeFlagsReader({
    url: URL_,
    now: c.now,
    fetcher: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  check('a dead host means every game is active', (await dead.availabilityOf('spill')) === 'active');
  check('and it does not reject', true);

  const c2 = clock();
  const notFound = makeFlagsReader({
    url: URL_,
    now: c2.now,
    fetcher: async () => new Response('nope', { status: 404 }),
  });
  check('a 404 means active', (await notFound.availabilityOf('spill')) === 'active');

  const c3 = clock();
  const garbage = makeFlagsReader({
    url: URL_,
    now: c3.now,
    fetcher: async () => new Response('{"flags":{"spill":{"availab', { status: 200 }),
  });
  check('half a document means active', (await garbage.availabilityOf('spill')) === 'active');

  // No URL configured at all — the state of a Worker deployed before the PHP side
  // exists. It must not fetch, and it must not break.
  const unset = makeFlagsReader({
    url: undefined,
    now: clock().now,
    fetcher: async () => {
      throw new Error('should not be called');
    },
  });
  check('an unconfigured URL means active, with no request', (await unset.availabilityOf('spill')) === 'active');
}

async function staleness(): Promise<void> {
  console.log('\nstale beats dark');

  const c = clock();
  let mode: 'ok' | 'fail' = 'ok';
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    if (mode === 'fail') throw new Error('gone');
    return new Response(JSON.stringify({ flags: { spill: { availability: 'disabled' } } }), {
      status: 200,
    });
  };

  const reader = makeFlagsReader({ url: URL_, now: c.now, fetcher });
  check('a good copy is read', (await reader.availabilityOf('spill')) === 'disabled');

  mode = 'fail';
  c.advance(10 * 60_000);

  // The decisive one. Ten minutes past the TTL with the host down, the last good
  // answer still stands — a *disabled* game stays disabled rather than silently
  // becoming playable because the flags file went away.
  check('ten minutes later, with the host down, the old answer stands', (await reader.availabilityOf('spill')) === 'disabled');
  check('and it kept trying rather than giving up', calls === 2, calls);

  c.advance(10 * 60_000);
  await reader.availabilityOf('spill');
  check('it tries again on the next expiry, not on every read', calls === 3, calls);

  // And a failed refresh must not wedge the reader: once the host is back, the next
  // read past the TTL picks up the new answer.
  mode = 'ok';
  c.advance(10 * 60_000);
  check('recovery needs no restart', (await reader.availabilityOf('spill')) === 'disabled');
  check('and the fetch happened', calls === 4, calls);
}

async function realTimeout(): Promise<void> {
  console.log('\nthe real fetcher has a deadline');

  // A real `AbortSignal.timeout`, with `fetch` stubbed by a request that never
  // settles on its own — which is precisely how a struggling shared host behaves:
  // the connection is accepted and then nothing comes back. Without the signal this
  // hangs on the room-open path until the platform decides to give up.
  //
  // Stubbing `fetch` rather than standing up a server, because there is no
  // `@types/node` in this project by choice, so a test file cannot import
  // `node:http`. It also isolates the thing under test: what `timedFetch` adds is the
  // signal, and this asserts the signal and nothing else.
  const original = globalThis.fetch;
  let sawSignal = false;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as typeof fetch;

  // Node's `AbortSignal.timeout` uses an **unref'd** timer, so it does not by itself
  // keep the event loop alive: with nothing else pending, the process exits before the
  // abort ever fires and this await never settles. A plain interval holds the loop
  // open for the duration. Node-only — workerd has no unref concept — but the test
  // runs on Node, so it is the test's problem.
  const keepAlive = setInterval(() => {}, 10);

  const started = Date.now();
  let threw = false;
  try {
    await timedFetch('https://example.test/flags.json', 60);
  } catch {
    threw = true;
  }
  const elapsed = Date.now() - started;
  clearInterval(keepAlive);
  globalThis.fetch = original;

  check('a signal is passed', sawSignal);
  check('a silent host aborts rather than hanging', threw);
  // Generous upper bound, but far below the tens of seconds a platform connection
  // timeout would take — so this cannot pass with the signal removed.
  check('at roughly the configured timeout', elapsed >= 50 && elapsed < 1_000, elapsed);
}

for (const t of [parsing, caching, coalescing, failing, staleness, realTimeout]) {
  await t();
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
