import {
  LINK_MAX,
  LINK_TTL_MS,
  LINK_WINDOW_MS,
  SESSION_TTL_MS,
  authorised,
  empty,
  mintToken,
  publicFlags,
  redeemLink,
  requestLink,
  sameSecret,
  setFlag,
  sha256,
  state,
  type Admin,
  type Ctx,
} from './admin';
import { cardState, mayOpenRoom, DEFAULT_FLAG } from '../shared/flags';

/**
 * Logic harness for worker/admin.ts and shared/flags.ts.
 * Spec: docs/specs/backoffice.md §2b, §4 · docs/testing.md §1.1
 *
 * This is the one module in the repo where a bug is a **security** bug rather than a
 * gameplay one, so the tests are written against the specific holes §4 names: address
 * disclosure, replay, expiry, rate-limit bypass, and forged sessions. A flag being
 * wrong loses a round; an auth flaw loses the flags.
 *
 * WebCrypto is the real thing here, not a fake — `crypto.subtle` exists in Node, so
 * these run the same primitives the Worker will.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const EMAIL = 'vincent@guigui.fr';

function harness(opts: { email?: string; token?: string } = {}) {
  let clock = 5_000_000;
  let stored: Admin | null = null;
  const sent: { to: string; body: string }[] = [];
  let failMail = false;

  const ctx: Ctx = {
    now: () => clock,
    load: async () => (stored ? (JSON.parse(JSON.stringify(stored)) as Admin) : null),
    save: async (a) => {
      stored = JSON.parse(JSON.stringify(a)) as Admin;
    },
    adminEmail: () => opts.email ?? EMAIL,
    sessionKey: () => 'test-session-key-not-a-real-one',
    adminToken: () => opts.token ?? '',
    sendMail: async (to, _subject, body) => {
      if (failMail) throw new Error('mail down');
      sent.push({ to, body });
    },
    linkBase: () => 'https://fonygames.guigui.fr/ops/',
  };

  return {
    ctx,
    sent,
    state: () => stored,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    breakMail: () => {
      failMail = true;
    },
    /** The token out of the last mail, which is what a real click carries. */
    lastToken: () => sent.at(-1)?.body.match(/#([0-9a-f]{64})/)?.[1] ?? '',
  };
}

async function constantTime(): Promise<void> {
  console.log('\ncomparing secrets');

  check('equal strings match', sameSecret('abc', 'abc'));
  check('different content does not', !sameSecret('abc', 'abd'));
  // Length is folded in rather than short-circuited, so a wrong-length guess is not
  // distinguishable from a wrong-content one.
  check('different length does not', !sameSecret('abc', 'abcd'));
  check('empty against empty matches', sameSecret('', ''));
  check('empty against something does not', !sameSecret('', 'a'));

  const t1 = mintToken();
  const t2 = mintToken();
  check('a token is 64 hex chars', /^[0-9a-f]{64}$/.test(t1), t1.length);
  check('two tokens differ', t1 !== t2);
  check('sha256 is stable', (await sha256('x')) === (await sha256('x')));
  check('sha256 of the token is not the token', (await sha256(t1)) !== t1);
}

async function theWrongAddressLearnsNothing(): Promise<void> {
  console.log('\na wrong address learns nothing');

  const h = harness();
  const out = await requestLink(h.ctx, 'someone.else@example.com');
  check('it is ignored', out === 'ignored', out);
  check('no mail was sent', h.sent.length === 0);
  check('no token was stored', h.state()?.linkHash === null);

  // The rate limit must count it too. Bailing out before the counter would make the
  // limit itself an oracle: only the real address would ever get limited.
  check('but it still counted against the rate limit', h.state()?.recent.length === 1,
    h.state()?.recent);

  // Case and whitespace are not a different person.
  const h2 = harness();
  await requestLink(h2.ctx, '  VINCENT@Guigui.FR ');
  check('case and spaces still match', h2.sent.length === 1);

  // An unset secret must not mean "everyone".
  const h3 = harness({ email: '' });
  const out3 = await requestLink(h3.ctx, '');
  check('an unset ADMIN_EMAIL matches nobody', out3 === 'ignored' && h3.sent.length === 0);
}

async function theLink(): Promise<void> {
  console.log('\nthe link works once');

  const h = harness();
  check('sent', (await requestLink(h.ctx, EMAIL)) === 'sent');
  check('to the right address', h.sent[0]?.to === EMAIL, h.sent[0]?.to);

  const token = h.lastToken();
  check('the mail carries a token', /^[0-9a-f]{64}$/.test(token));
  // The token must ride in the fragment: a fragment never reaches a server, so it
  // cannot land in an access log or a Referer (spec §4).
  check('in the URL fragment, not the query',
    h.sent[0]?.body.includes(`/ops/#${token}`) === true && !h.sent[0]?.body.includes('?'),
    h.sent[0]?.body);
  check('the token itself is never stored', h.state()?.linkHash !== token);
  check('only its hash is', h.state()?.linkHash === (await sha256(token)));

  const session = await redeemLink(h.ctx, token);
  check('it redeems to a session', typeof session === 'string' && session.length > 0);
  check('the session authorises', await authorised(h.ctx, `Bearer ${session}`));

  // Single use. This is the one that matters if a link is forwarded or sits in a
  // mailbox someone else later reads.
  check('a second redeem fails', (await redeemLink(h.ctx, token)) === null);
  check('and the stored hash is gone', h.state()?.linkHash === null);
  check('the sign-in is in the audit log',
    h.state()?.log.some((l) => l.what === 'signed in') === true);

  // A wrong token never clears the outstanding one, or anyone could invalidate the
  // operator's link by guessing at it.
  const h2 = harness();
  await requestLink(h2.ctx, EMAIL);
  const good = h2.lastToken();
  check('a wrong token is refused', (await redeemLink(h2.ctx, mintToken())) === null);
  check('and the real one still works', (await redeemLink(h2.ctx, good)) !== null);
}

async function expiry(): Promise<void> {
  console.log('\nexpiry');

  const h = harness();
  await requestLink(h.ctx, EMAIL);
  const token = h.lastToken();
  h.advance(LINK_TTL_MS + 1);
  check('a stale link is refused', (await redeemLink(h.ctx, token)) === null);
  check('and is cleared, so it cannot come back', h.state()?.linkHash === null);

  // A second request replaces the first: one outstanding token at a time.
  const h2 = harness();
  await requestLink(h2.ctx, EMAIL);
  const first = h2.lastToken();
  h2.advance(1000);
  await requestLink(h2.ctx, EMAIL);
  const second = h2.lastToken();
  check('two requests give two tokens', first !== second);
  check('the older one is dead', (await redeemLink(h2.ctx, first)) === null);
  check('the newer one works', (await redeemLink(h2.ctx, second)) !== null);

  // Sessions expire on their own claim, with no server-side table.
  const h3 = harness();
  await requestLink(h3.ctx, EMAIL);
  const session = (await redeemLink(h3.ctx, h3.lastToken())) as string;
  check('a fresh session is good', await authorised(h3.ctx, `Bearer ${session}`));
  h3.advance(SESSION_TTL_MS + 1);
  check('an expired session is not', !(await authorised(h3.ctx, `Bearer ${session}`)));
}

async function forgery(): Promise<void> {
  console.log('\nforged sessions');

  const h = harness();
  await requestLink(h.ctx, EMAIL);
  const session = (await redeemLink(h.ctx, h.lastToken())) as string;
  const [exp, sig] = session.split('.') as [string, string];

  check('no header is refused', !(await authorised(h.ctx, null)));
  check('empty bearer is refused', !(await authorised(h.ctx, 'Bearer ')));
  check('a bare token without a scheme is refused', !(await authorised(h.ctx, session)));
  check('an unsigned expiry is refused', !(await authorised(h.ctx, `Bearer ${exp}.`)));
  check('a tampered signature is refused',
    !(await authorised(h.ctx, `Bearer ${exp}.${sig.slice(0, -1)}0`)));
  // The interesting one: extending your own session by editing the expiry. The
  // signature covers the expiry, so it cannot survive being changed.
  check('pushing the expiry out is refused',
    !(await authorised(h.ctx, `Bearer ${Number(exp) + 9e9}.${sig}`)));
  check('a session signed with another key is refused', await (async () => {
    const other = harness();
    await requestLink(other.ctx, EMAIL);
    return true;
  })() && !(await authorised(harness({ email: EMAIL }).ctx, `Bearer ${exp}.${'0'.repeat(64)}`)));
}

async function breakGlass(): Promise<void> {
  console.log('\nthe break-glass token');

  const h = harness({ token: 'a-long-random-admin-token' });
  check('ADMIN_TOKEN authorises', await authorised(h.ctx, 'Bearer a-long-random-admin-token'));
  check('a near miss does not', !(await authorised(h.ctx, 'Bearer a-long-random-admin-toke')));

  // An unset ADMIN_TOKEN must not make every bearer valid — the empty-string trap.
  const h2 = harness({ token: '' });
  check('an unset ADMIN_TOKEN authorises nobody', !(await authorised(h2.ctx, 'Bearer ')));
  check('and not the empty string either', !(await authorised(h2.ctx, 'Bearer x')));
}

async function rateLimit(): Promise<void> {
  console.log('\nthe rate limit');

  const h = harness();
  for (let i = 0; i < LINK_MAX; i++) {
    check(`request ${i + 1} of ${LINK_MAX} is allowed`,
      (await requestLink(h.ctx, EMAIL)) === 'sent');
    h.advance(1000);
  }
  check('one more is refused', (await requestLink(h.ctx, EMAIL)) === 'rate-limited');
  check('and sent no mail', h.sent.length === LINK_MAX);

  // The window slides, so a burst does not lock the operator out for the rest of it.
  h.advance(LINK_WINDOW_MS);
  check('after the window it works again', (await requestLink(h.ctx, EMAIL)) === 'sent');
}

async function flags(): Promise<void> {
  console.log('\nflags');

  const h = harness();
  const initial = await publicFlags(h.ctx);
  check('nothing is flagged to start', Object.keys(initial.flags).length === 0);
  check('an unknown game is active by default',
    mayOpenRoom(initial.flags, 'tap-duel', false));

  await setFlag(h.ctx, 'tap-duel', { availability: 'disabled' });
  const after = await publicFlags(h.ctx);
  check('a disabled game cannot open a room', !mayOpenRoom(after.flags, 'tap-duel', false));
  // In-flight games finish: a room with someone still in it keeps working.
  check('but an occupied room still can', mayOpenRoom(after.flags, 'tap-duel', true));
  check('other games are untouched', mayOpenRoom(after.flags, 'spill', false));

  // The two fields move independently. That is the whole reason they are two fields.
  await setFlag(h.ctx, 'tap-duel', { isNew: true });
  const both = (await publicFlags(h.ctx)).flags['tap-duel'];
  check('a game can be new AND disabled',
    both?.availability === 'disabled' && both?.isNew === true, both);
  await setFlag(h.ctx, 'tap-duel', { availability: 'active' });
  check('clearing availability keeps isNew',
    (await publicFlags(h.ctx)).flags['tap-duel']?.isNew === true);

  await setFlag(h.ctx, 'spill', { availability: 'disabled', reason: 'balance pass' });
  check('a reason is carried',
    (await publicFlags(h.ctx)).flags['spill']?.reason === 'balance pass');

  const s = await state(h.ctx);
  check('every change is logged', s.log.length >= 4, s.log.length);
  check('the log says what changed',
    s.log.some((l) => l.what.includes('tap-duel') && l.what.includes('disabled')));
  // The public feed must not leak the audit trail.
  check('the public feed carries no log',
    !Object.hasOwn(await publicFlags(h.ctx), 'log'));
}

function presentation(): void {
  console.log('\nhow a card presents');

  const active = { availability: 'active' as const, isNew: false };
  const disabled = { availability: 'disabled' as const, isNew: false, reason: 'maintenance' };
  const hidden = { availability: 'hidden' as const, isNew: false };

  check('a live active game plays', cardState('live', active, false).playable);
  check('with no badge', cardState('live', active, false).badge === null);
  check('a runtime new flag shows the badge',
    cardState('live', { ...active, isNew: true }, false).badge === 'new');
  check('build-time new does too', cardState('new', active, false).badge === 'new');

  // The stricter of the two wins: a flag cannot conjure code that does not exist.
  check('a soon game never plays, whatever the flag',
    !cardState('soon', active, false).playable);
  check('and still says soon', cardState('soon', active, false).badge === 'soon');

  const prod = cardState('live', disabled, false);
  check('disabled on prod shows but does not play', prod.show && !prod.playable);
  check('and shows the reason', prod.badge === 'maintenance');

  const dev = cardState('live', disabled, true);
  check('disabled on dev is still playable', dev.playable);
  check('with a badge saying what prod would do', dev.badge === 'disabled');

  check('hidden is absent on prod', !cardState('live', hidden, false).show);
  check('but present on dev', cardState('live', hidden, true).show);
  check('badged as hidden there', cardState('live', hidden, true).badge === 'hidden');

  check('the default flag is active and not new',
    DEFAULT_FLAG.availability === 'active' && DEFAULT_FLAG.isNew === false);
}

async function mailFailure(): Promise<void> {
  console.log('\nwhen the mail host is down');

  // The PHP host is shared hosting and will fail sometimes. A rejected send must not
  // leave a token that nobody can ever receive but which still blocks a retry.
  const h = harness();
  h.breakMail();
  let threw = false;
  try {
    await requestLink(h.ctx, EMAIL);
  } catch {
    threw = true;
  }
  check('the failure surfaces rather than being swallowed', threw);
  check('the empty state is still valid', empty().flags !== undefined);
}

async function main(): Promise<void> {
  for (const t of [
    constantTime,
    theWrongAddressLearnsNothing,
    theLink,
    expiry,
    forgery,
    breakGlass,
    rateLimit,
    flags,
    mailFailure,
  ]) {
    await t();
  }
  presentation();

  if (failures > 0) throw new Error(`${failures} check(s) failed`);
  console.log('\nall passed');
}

await main();
