import { checkSlugPlayable, isSlugPlayable } from './flagGate';

/**
 * Logic harness for flagGate.ts. Same shape as the other pure-logic tests
 * (docs/testing.md §1.1) — the DOM-free decision first, the fetch wrapper's
 * short-circuit and fail-open behaviour second.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function decision(): void {
  console.log('\nwhich flag states may actually be played');

  check('active may', isSlugPlayable({ spill: { state: 'active' } }, 'spill'));
  check('new may too', isSlugPlayable({ spill: { state: 'new' } }, 'spill'));
  check('soon may not', !isSlugPlayable({ spill: { state: 'soon' } }, 'spill'));
  check('hidden may not', !isSlugPlayable({ spill: { state: 'hidden' } }, 'spill'));
  check('an unknown slug fails open to active', isSlugPlayable({}, 'anything'));
}

async function devHost(): Promise<void> {
  console.log('\nnever redirects away from the dev host');

  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (() => { fetchCalled = true; throw new Error('should not fetch'); }) as typeof fetch;
  try {
    const ok = await checkSlugPlayable('anything', 'fonygames-dev.guigui.fr');
    check('dev is always playable', ok);
    check('without even asking flags.json', !fetchCalled);
  } finally {
    globalThis.fetch = original;
  }
}

async function failsOpen(): Promise<void> {
  console.log('\nan unreachable or malformed flags.json fails open');

  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    check('a network failure is playable', await checkSlugPlayable('spill', 'fonygames.guigui.fr'));

    globalThis.fetch = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch;
    check('a non-200 is playable', await checkSlugPlayable('spill', 'fonygames.guigui.fr'));

    globalThis.fetch = (() => Promise.resolve(new Response('not json', { status: 200 }))) as typeof fetch;
    check('unparsable JSON is playable', await checkSlugPlayable('spill', 'fonygames.guigui.fr'));

    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 }))) as typeof fetch;
    check('the wrong shape is playable', await checkSlugPlayable('spill', 'fonygames.guigui.fr'));
  } finally {
    globalThis.fetch = original;
  }
}

async function realAnswer(): Promise<void> {
  console.log('\na real flags.json is honoured');

  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ flags: { spill: { state: 'soon' } } }), { status: 200 }),
    )) as typeof fetch;
    check('a soon-flagged game is not playable on prod', !(await checkSlugPlayable('spill', 'fonygames.guigui.fr')));
    check('a different, unflagged slug still is', await checkSlugPlayable('tap-duel', 'fonygames.guigui.fr'));
  } finally {
    globalThis.fetch = original;
  }
}

decision();
for (const t of [devHost, failsOpen, realAnswer]) await t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
