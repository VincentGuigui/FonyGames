import { createAvatarColorStore } from './avatarColor';

/**
 * Logic harness for avatarColor.ts. Same shape as `flagGate.test.ts` —
 * the fetch wrapper's fail-open behaviour is the whole thing worth pinning,
 * since `colorFor` itself is a one-line lookup.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

async function before(): Promise<void> {
  console.log('\nbefore the fetch resolves, or if it never runs');

  const store = createAvatarColorStore();
  check('nothing is known yet', store.colorFor('🦊') === null);
}

async function realAnswer(): Promise<void> {
  console.log('\na real config file is honoured');

  const store = createAvatarColorStore();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ '🦊': '#F97316', '🐙': '#EC4899' }), { status: 200 }),
    )) as typeof fetch;
    store.load();
    await new Promise((r) => setTimeout(r, 0));
    check('a known avatar gets its colour', store.colorFor('🦊') === '#F97316', store.colorFor('🦊'));
    check('a different known avatar gets its own', store.colorFor('🐙') === '#EC4899', store.colorFor('🐙'));
    check('an avatar the file does not mention has none', store.colorFor('🐸') === null);
  } finally {
    globalThis.fetch = original;
  }
}

async function failsOpen(): Promise<void> {
  console.log('\nan unreachable or malformed config file fails open — no tint, not a crash');

  const cases: Array<[string, () => Promise<Response>]> = [
    ['a network failure', () => Promise.reject(new Error('offline')) as unknown as Promise<Response>],
    ['a non-200', () => Promise.resolve(new Response('nope', { status: 500 }))],
    ['unparsable JSON', () => Promise.resolve(new Response('not json', { status: 200 }))],
    ['an array instead of a map', () => Promise.resolve(new Response(JSON.stringify(['#F97316']), { status: 200 }))],
    ['non-string values', () => Promise.resolve(new Response(JSON.stringify({ '🦊': 5 }), { status: 200 }))],
  ];

  const original = globalThis.fetch;
  try {
    for (const [label, impl] of cases) {
      const store = createAvatarColorStore();
      globalThis.fetch = impl as typeof fetch;
      store.load();
      await new Promise((r) => setTimeout(r, 0));
      check(`${label} leaves every avatar untinted`, store.colorFor('🦊') === null);
    }
  } finally {
    globalThis.fetch = original;
  }
}

async function idempotent(): Promise<void> {
  console.log('\nload() fetches once, however many times it is called');

  const store = createAvatarColorStore();
  let calls = 0;
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ '🦊': '#F97316' }), { status: 200 }));
    }) as typeof fetch;
    store.load();
    store.load();
    store.load();
    await new Promise((r) => setTimeout(r, 0));
    check('one fetch for three calls', calls === 1, calls);
    check('and the colour is still there', store.colorFor('🦊') === '#F97316');
  } finally {
    globalThis.fetch = original;
  }
}

async function independentStores(): Promise<void> {
  console.log('\ntwo stores never share a cache');

  const a = createAvatarColorStore();
  const b = createAvatarColorStore();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ '🦊': '#111111' }), { status: 200 }))) as typeof fetch;
    a.load();
    await new Promise((r) => setTimeout(r, 0));
    check('the loaded store knows its colour', a.colorFor('🦊') === '#111111');
    check('an untouched store does not', b.colorFor('🦊') === null);
  } finally {
    globalThis.fetch = original;
  }
}

for (const t of [before, realAnswer, failsOpen, idempotent, independentStores]) await t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
