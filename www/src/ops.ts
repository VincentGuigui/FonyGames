/**
 * The admin centre.
 * Spec: docs/specs/backoffice.md §2b, §4
 *
 * Plain DOM, no Preact. Not a style preference — this page has one user, three
 * controls per game and no shared state worth a component tree, and keeping it off the
 * hub's dependency graph means the admin can never accidentally grow into the
 * catalogue's bundle.
 *
 * It reads the game list from the compiled registry, so the grid here is exactly the
 * grid the hub renders. A hand-written list would be a second catalogue, and it would
 * be wrong the first time a game was added.
 */

import { catalogue } from './games/registry';
import { cardState, DEFAULT_FLAG, type FlagState, type GameFlag } from '../../shared/flags';
import './core/ui/theme.css';
import './ops.css';

const API = '/api/index.php';

type State = {
  flags: Record<string, GameFlag>;
  history: Array<{ slug: string; availability: string; isNew: boolean; reason: string | null; at: number }>;
  revision: string | null;
};

const root = document.getElementById('ops');
if (!root) throw new Error('#ops missing');

/**
 * Every call is same-origin and carries the session cookie automatically. `X-Admin: 1`
 * is the CSRF lock — a cross-origin caller cannot set it without a preflight, and the
 * API answers no CORS headers.
 */
async function api(
  action: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${API}?a=${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Admin': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let data: Record<string, unknown> = {};
  if (res.status !== 204) {
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // A non-JSON body means the host answered instead of PHP — a 500 page, or the
      // handler serving source. Either way there is nothing to read.
    }
  }
  return { status: res.status, data };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ── Signing in ──────────────────────────────────────────────────────────── */

function signIn(message?: string): void {
  root!.replaceChildren();
  const box = el('div', 'ops__gate');
  box.append(el('h1', 'ops__title', 'FonyGames ops'));

  if (message) box.append(el('p', 'ops__note', message));

  const form = el('form', 'ops__form');
  const input = el('input', 'ops__input');
  input.type = 'email';
  input.name = 'email';
  input.placeholder = 'your address';
  input.autocomplete = 'email';
  input.required = true;

  const button = el('button', 'ops__button', 'Send me a link');
  button.type = 'submit';

  const said = el('p', 'ops__note');
  form.append(input, button, said);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    button.disabled = true;
    void api('link', { email: input.value }).then(({ status }) => {
      button.disabled = false;
      // The API answers 204 for a wrong address, a rate limit and a successful send
      // alike (spec §4), so this copy has to be true of all three. Saying "check your
      // inbox" would be a lie two thirds of the time and, worse, a hint that the
      // address was right.
      said.textContent =
        status === 502
          ? 'The mailer refused the message. That is a fault on our side.'
          : status === 503
            ? 'This host has no admin configured.'
            : 'If that address is the operator’s, a link is on its way. It works once and lasts ten minutes.';
    });
  });

  box.append(form);
  root!.append(box);
}

/* ── The console ─────────────────────────────────────────────────────────── */

function render(state: State): void {
  root!.replaceChildren();

  const head = el('header', 'ops__head');
  head.append(el('h1', 'ops__title', 'FonyGames ops'));
  head.append(
    el(
      'p',
      'ops__note',
      state.revision ? `live revision ${state.revision.slice(0, 8)}` : 'revision unknown',
    ),
  );

  const out = el('button', 'ops__link', 'sign out');
  out.addEventListener('click', () => {
    void api('logout', {}).then(() => signIn('Signed out.'));
  });
  head.append(out);
  root!.append(head);

  const list = el('ul', 'ops__games');

  for (const game of catalogue()) {
    const flag = state.flags[game.slug] ?? DEFAULT_FLAG;
    const row = el('li', 'ops__game');

    const name = el('div', 'ops__name');
    name.append(el('strong', undefined, game.title));
    name.append(el('span', 'ops__slug', game.slug));

    // The same function the hub and the server-side renderer use. `showAll: false`, so
    // this shows what **prod** would do — the panel's job is to answer "what does a
    // player see", and dev's show-everything rule would hide exactly that.
    const view = cardState(game.status, flag, false);

    // Prefixed, because the badge is the OUTCOME and the buttons below are the INPUTS.
    // Unlabelled, a "NEW" badge sitting next to a "NEW off" button reads as a bug — it
    // is not: `status: 'new'` is compiled into card.ts and the flag is a separate,
    // additional way to switch the badge on (spec §5).
    name.append(
      el(
        'span',
        `ops__badge ops__badge--${flag.availability}`,
        `player sees: ${view.badge ?? (view.playable ? 'playable' : 'not playable')}`,
      ),
    );

    // `soon` is build-time truth: the game does not exist yet, so cardState returns
    // `soon` whatever the flag says — the stricter of the two always wins (spec §2b).
    // Showing four live buttons that provably cannot change anything would be a UI
    // that lies, so they are disabled and the reason is on screen.
    const buildTimeSoon = game.status === 'soon';
    if (buildTimeSoon) {
      name.append(el('span', 'ops__slug', 'not built — a flag cannot make it playable'));
    } else if (game.status === 'new') {
      name.append(el('span', 'ops__slug', 'status: new, so the badge is on either way'));
    }

    row.append(name);

    const controls = el('div', 'ops__controls');

    for (const value of ['active', 'disabled', 'hidden'] as FlagState[]) {
      const b = el('button', 'ops__choice', value);
      if (flag.availability === value) b.classList.add('is-on');
      b.disabled = buildTimeSoon;
      b.addEventListener('click', () => {
        void write({ slug: game.slug, availability: value });
      });
      controls.append(b);
    }

    const isNew = el('button', 'ops__choice', flag.isNew ? 'NEW flag on' : 'NEW flag off');
    if (flag.isNew) isNew.classList.add('is-on');
    isNew.disabled = buildTimeSoon;
    isNew.addEventListener('click', () => {
      void write({ slug: game.slug, isNew: !flag.isNew });
    });
    controls.append(isNew);

    // Only where it can be seen. A reason is rendered beside a *disabled* card, so on
    // an active one the field is an invitation to type something nobody will ever read.
    if (flag.availability === 'disabled') {
      const reason = el('input', 'ops__reason');
      reason.type = 'text';
      reason.placeholder = 'reason, shown beside the disabled card';
      reason.value = flag.reason ?? '';
      reason.maxLength = 120;
      // On change rather than on every keystroke: each save is a database write, an
      // audit row and a rewrite of flags.json.
      reason.addEventListener('change', () => {
        void write({ slug: game.slug, reason: reason.value });
      });
      controls.append(reason);
    }

    row.append(controls);
    list.append(row);
  }

  root!.append(list);

  if (state.history.length > 0) {
    const log = el('section', 'ops__log');
    log.append(el('h2', 'ops__subtitle', 'recent changes'));
    const items = el('ul');
    for (const h of state.history) {
      const when = new Date(h.at).toISOString().replace('T', ' ').slice(0, 16);
      items.append(
        el('li', undefined, `${when}  ${h.slug} → ${h.availability}${h.isNew ? ' +NEW' : ''}${h.reason ? ` (${h.reason})` : ''}`),
      );
    }
    log.append(items);
    root!.append(log);
  }

  const notice = el('p', 'ops__note');
  notice.id = 'ops-notice';
  root!.append(notice);
}

function say(text: string): void {
  const n = document.getElementById('ops-notice');
  if (n) n.textContent = text;
}

async function write(patch: Record<string, unknown>): Promise<void> {
  const { status, data } = await api('flags', patch);
  if (status === 401) {
    signIn('That session has expired.');
    return;
  }
  if (status !== 200) {
    say(`Could not save: ${String(data['error'] ?? status)}`);
    return;
  }

  // `published: false` is the state worth shouting about: the database took the change
  // and the file everything READS did not, so the Worker is still enforcing the old
  // answer while this page shows the new one.
  const published = data['published'] === true;
  await load();
  say(
    published
      ? 'Saved.'
      : 'Saved to the database, but flags.json was NOT rewritten — the Worker and the hub are still on the old answer. Check the web root is writable, then use republish.',
  );

  if (!published) {
    const retry = el('button', 'ops__link', 'republish');
    retry.addEventListener('click', () => {
      void api('republish', {}).then(({ data: d }) => {
        say(d['published'] === true ? 'Published.' : 'Still could not write flags.json.');
      });
    });
    document.getElementById('ops-notice')?.append(' ', retry);
  }
}

async function load(): Promise<void> {
  const { status, data } = await api('state');
  if (status === 401) {
    signIn();
    return;
  }
  if (status === 503) {
    signIn('This host has no admin configured.');
    return;
  }
  if (status !== 200) {
    signIn(`The admin API answered ${status}.`);
    return;
  }

  render({
    flags: (data['flags'] as Record<string, GameFlag>) ?? {},
    history: (data['history'] as State['history']) ?? [],
    revision: typeof data['revision'] === 'string' ? data['revision'] : null,
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

/**
 * A token in the fragment means we arrived from a magic link.
 *
 * The hash is cleared **before** the exchange, so the token is out of the address bar,
 * the back button and any screenshot as early as possible. `replaceState` rather than
 * assigning `location.hash`, which would leave a `#` and add a history entry.
 */
async function boot(): Promise<void> {
  const token = location.hash.replace(/^#/, '');
  if (/^[0-9a-f]{64}$/.test(token)) {
    history.replaceState(null, '', location.pathname + location.search);
    const { status } = await api('session', { token });
    if (status !== 200) {
      signIn('That link has been used already, or it expired.');
      return;
    }
  }

  await load();
}

void boot();
