import { goFullscreen, keepAwake, lockUpright, requestGameScreen, type Fullscreenish, type Visibility, type WakeLockish } from './screen';

/**
 * Keeping the screen awake, and giving it back.
 * Implementation: core/screen.ts · rules: docs/device-capabilities.md §5
 *
 * The interesting behaviour is **re-acquisition**, and it is invisible from the outside: a
 * wake lock is dropped by the browser every time the page stops being visible and is not
 * restored on the way back, so a one-shot `request()` keeps the screen alive until the
 * first notification shade and then silently stops. That version looks identical to this
 * one in a screenshot, in a code review, and in a five-minute test — it only shows up as
 * "my phone kept going dark" a week later.
 *
 * So the fakes below can be made to go away and come back, and the assertions are about
 * how many locks are held afterwards.
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

/** A scriptable page: it can be hidden, shown, and asked how many locks it is holding. */
function fakePage(opts: { supported?: boolean; refuse?: boolean } = {}) {
  const { supported = true, refuse = false } = opts;
  let listener: (() => void) | null = null;
  let held = 0;
  let requests = 0;

  const doc: Visibility & { hide: () => void; show: () => void } = {
    visibilityState: 'visible',
    addEventListener: (_t, fn) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
    hide: () => {
      doc.visibilityState = 'hidden';
      // What a browser really does: the lock is gone before the event arrives.
      held = 0;
      listener?.();
    },
    show: () => {
      doc.visibilityState = 'visible';
      listener?.();
    },
  };

  const nav: WakeLockish = supported
    ? {
        wakeLock: {
          request: async () => {
            requests += 1;
            if (refuse) throw new Error('refused');
            held += 1;
            return {
              release: async () => {
                held -= 1;
              },
            };
          },
        },
      }
    : {};

  return { nav, doc, locks: () => held, requests: () => requests, listening: () => listener !== null };
}

/** The hook's work is asynchronous; let the microtasks settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

console.log('\nholding the screen awake');

{
  const page = fakePage();
  const stop = keepAwake(page.nav, page.doc);
  await settle();
  check('a lock is taken', page.locks() === 1, page.locks());

  stop();
  await settle();
  check('and given back on the way out', page.locks() === 0, page.locks());
  check('with nothing still listening', !page.listening());
}

console.log('\ncoming back from a tab switch — the bit that rots');

{
  const page = fakePage();
  const stop = keepAwake(page.nav, page.doc);
  await settle();

  page.doc.hide();
  await settle();
  check('hidden, the browser has taken it', page.locks() === 0);

  page.doc.show();
  await settle();
  check('visible again, it is re-acquired', page.locks() === 1, page.locks());
  check('which took a second request', page.requests() === 2, page.requests());

  // Twice round, because a flag left set by the first round trip would pass the check above
  // and fail here.
  page.doc.hide();
  await settle();
  page.doc.show();
  await settle();
  check('and again, every time', page.locks() === 1, page.locks());

  stop();
  await settle();
  check('still released at the end', page.locks() === 0);
}

console.log('\nnot holding two at once');

{
  const page = fakePage();
  const stop = keepAwake(page.nav, page.doc);
  await settle();
  // A visibility event while already visible — browsers fire spurious ones, and a second
  // lock would be a leak that survives the release.
  page.doc.show();
  page.doc.show();
  await settle();
  check('a spurious wake-up asks for nothing', page.requests() === 1, page.requests());
  stop();
  await settle();
  check('and the single lock is released', page.locks() === 0);
}

console.log('\nwhen the browser will not play');

{
  // Safari before 16.4, or any page over plain http. The screen dims as it always did.
  const page = fakePage({ supported: false });
  const stop = keepAwake(page.nav, page.doc);
  await settle();
  check('no wakeLock at all is not an error', page.locks() === 0);
  page.doc.show();
  stop();
  check('and stopping is still safe', true);

  const refused = fakePage({ refuse: true });
  const stopRefused = keepAwake(refused.nav, refused.doc);
  await settle();
  check('a refused request is swallowed', refused.locks() === 0);
  stopRefused();
  await settle();
  check('and leaves nothing behind', refused.locks() === 0);
}

console.log('\nasking for portrait');

{
  const calls: string[] = [];
  const scr = {
    orientation: {
      lock: async (o: 'portrait' | 'landscape') => {
        calls.push(`lock:${o}`);
      },
      unlock: () => {
        calls.push('unlock');
      },
    },
  };
  const release = lockUpright(scr);
  await settle();
  check('portrait is asked for', calls[0] === 'lock:portrait', calls);
  release();

  // And the other way, for a game whose board is sideways (Grid Attack). Same call, same
  // shrug when the browser will not do it.
  const sideways = lockUpright(scr, 'landscape');
  await settle();
  check('landscape can be asked for too', calls.includes('lock:landscape'), calls);
  sideways();
  // Handing it back matters: pinning a player's phone for the rest of their session
  // because they once opened a game is not ours to do.
  check('and handed back on the way out', calls.includes('unlock'), calls);

  // iOS Safari: no `orientation.lock` at all, and never has had one.
  const bare = lockUpright({});
  await settle();
  check('a browser without the API is not an error', true);
  bare();

  // Android Chrome outside fullscreen: the promise REJECTS rather than throwing, and an
  // unhandled rejection would be a console error on every game page.
  const rejects = lockUpright({
    orientation: { lock: () => Promise.reject(new Error('not available')) },
  });
  await settle();
  check('a rejected lock is caught', true);
  rejects();
}

console.log('\ngoing fullscreen');

{
  const calls: string[] = [];
  const el: Fullscreenish = { requestFullscreen: async () => { calls.push('request'); } };
  check('a working element reports success', await goFullscreen(el));
  check('and was actually asked', calls.length === 1);

  // iPhone Safari: no element fullscreen at all.
  check('an element without the API reports failure, not a throw', (await goFullscreen({})) === false);

  // Every other browser, refusing outside a gesture or because the player said no.
  const refused: Fullscreenish = { requestFullscreen: () => Promise.reject(new Error('denied')) };
  check('a rejected request reports failure rather than throwing', (await goFullscreen(refused)) === false);
}

console.log('\nasking a card\'s screen for what it wants (§5b)');

{
  const calls: string[] = [];
  const el: Fullscreenish = { requestFullscreen: async () => { calls.push('fullscreen'); } };
  const scr = {
    orientation: {
      lock: async (o: 'portrait' | 'landscape') => { calls.push(`lock:${o}`); },
      unlock: () => { calls.push('unlock'); },
    },
  };

  await requestGameScreen(undefined, el, scr);
  check('a game that asks for nothing gets nothing', calls.length === 0, calls);

  await requestGameScreen({}, el, scr);
  check('an empty request is the same as none', calls.length === 0, calls);

  calls.length = 0;
  await requestGameScreen({ orientation: 'free' }, el, scr);
  check('"free" locks nothing, even when named explicitly', calls.length === 0, calls);

  calls.length = 0;
  await requestGameScreen({ fullscreen: true }, el, scr);
  check('fullscreen alone asks for fullscreen and nothing else', calls.join(',') === 'fullscreen', calls);

  calls.length = 0;
  await requestGameScreen({ orientation: 'portrait' }, el, scr);
  check('portrait alone locks portrait and asks for no fullscreen', calls.join(',') === 'lock:portrait', calls);

  calls.length = 0;
  await requestGameScreen({ orientation: 'landscape', fullscreen: true }, el, scr);
  check('both together ask for fullscreen BEFORE the lock', calls.join(',') === 'fullscreen,lock:landscape', calls);

  // The one browser that actually enforces the lock refuses it outside fullscreen, so
  // asking before fullscreen has taken hold would race the case this exists for.
  const slow: Fullscreenish = {
    requestFullscreen: () => new Promise((resolve) => setTimeout(() => { calls.push('fullscreen'); resolve(); }, 5)),
  };
  calls.length = 0;
  await requestGameScreen({ orientation: 'landscape', fullscreen: true }, slow, scr);
  check('the lock still waits for a slow fullscreen to actually resolve', calls.join(',') === 'fullscreen,lock:landscape', calls);

  calls.length = 0;
  await requestGameScreen({ orientation: 'landscape', fullscreen: false }, el, scr);
  check('a lock with no fullscreen still tries — some browsers allow it installed', calls.join(',') === 'lock:landscape', calls);

  // Never gates: a refused fullscreen and an unsupported lock are not thrown either.
  const refused: Fullscreenish = { requestFullscreen: () => Promise.reject(new Error('denied')) };
  await requestGameScreen({ orientation: 'portrait', fullscreen: true }, refused, {});
  check('a refused fullscreen and a bare orientation object are not errors', true);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
