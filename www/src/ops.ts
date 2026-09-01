/**
 * The admin centre.
 * Spec: docs/specs/backoffice.md §2b, §4
 *
 * Plain DOM, no Preact. Not a style preference — this page has one user, four
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
import { setSoloTesting, soloTesting } from './core/solo';
import './core/ui/theme.css';
import './ops.css';
import { citiesForCountry, sortStatsRows, type StatsValue } from './core/admin/stats';

const API = '/api/index.php';

type State = {
  flags: Record<string, GameFlag>;
  history: Array<{ slug: string; state: string; reason: string | null; at: number }>;
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
  /**
   * Break-glass bearer, for the one case a session cannot cover: on an empty database the
   * magic link CANNOT work, because signing in writes to `admin_link_attempt` — a table the
   * migrations create. Never stored; it lives as long as the keystroke.
   */
  bearer?: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-Admin'] = '1';
  }
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`;
    // And again in a header Apache cannot eat. Behind a CGI/FastCGI/FPM handler Apache
    // consumes `Authorization` and does not forward it to PHP without `CGIPassAuth`, so on
    // a shared host the break-glass token silently never arrives — which reads as "the
    // token is wrong" at the exact moment the operator has no other way in. The API
    // prefers the standard header when it is there (Auth::presentedToken).
    headers['X-Admin-Token'] = bearer;
  }

  const res = await fetch(`${API}?a=${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
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

type AdminSection = 'games' | 'analytics' | 'diagnostics';
type DiagnosticTab = 'cloudflare' | 'ipinfo' | 'stale';

/** Build links from the current admin root; the deployed path is intentionally secret. */
function adminRoot(): string {
  const marker = location.pathname.indexOf('/stats/');
  if (marker >= 0) return location.pathname.slice(0, marker + 1);
  return location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
}

function adminNav(active: AdminSection, diagnosticTab: DiagnosticTab = 'ipinfo'): HTMLElement {
  const rootPath = adminRoot();
  const nav = el('nav', 'ops__nav');
  nav.setAttribute('aria-label', 'Admin navigation');
  const main = el('div', 'ops__nav-main');
  const games = el('a', `ops__nav-link${active === 'games' ? ' is-on' : ''}`, 'Games');
  games.href = rootPath;
  const analytics = el('a', `ops__nav-link${active === 'analytics' ? ' is-on' : ''}`, 'Analytics');
  analytics.href = `${rootPath}stats/?tab=analytics`;
  const diagnostics = el('a', `ops__nav-link${active === 'diagnostics' ? ' is-on' : ''}`, 'Diagnostics');
  diagnostics.href = `${rootPath}stats/diagnostic/`;
  main.append(games, analytics, diagnostics);
  nav.append(main);
  if (active === 'diagnostics') {
    const tabs = el('div', 'ops__nav-sub');
    tabs.setAttribute('role', 'tablist');
    const cloudflare = el('a', `ops__nav-link ops__nav-link--sub${diagnosticTab === 'cloudflare' ? ' is-on' : ''}`, 'Cloudflare');
    cloudflare.href = `${rootPath}stats/diagnostic/?tab=cloudflare`;
    cloudflare.setAttribute('role', 'tab');
    cloudflare.setAttribute('aria-selected', String(diagnosticTab === 'cloudflare'));
    const ipinfo = el('a', `ops__nav-link ops__nav-link--sub${diagnosticTab === 'ipinfo' ? ' is-on' : ''}`, 'IPinfo');
    ipinfo.href = `${rootPath}stats/diagnostic/?tab=ipinfo`;
    ipinfo.setAttribute('role', 'tab');
    ipinfo.setAttribute('aria-selected', String(diagnosticTab === 'ipinfo'));
    const stale = el('a', `ops__nav-link ops__nav-link--sub${diagnosticTab === 'stale' ? ' is-on' : ''}`, 'Stale files');
    stale.href = `${rootPath}stats/diagnostic/?tab=stale`;
    stale.setAttribute('role', 'tab');
    stale.setAttribute('aria-selected', String(diagnosticTab === 'stale'));
    tabs.append(cloudflare, ipinfo, stale);
    nav.append(tabs);
  }
  return nav;
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
  root!.append(adminNav('games'));
  root!.append(soloPanel());

  const list = el('ul', 'ops__games');

  for (const game of catalogue()) {
    const flag = state.flags[game.slug] ?? DEFAULT_FLAG;
    const row = el('li', 'ops__game');

    // `soon` games have no live page to link to, and cardState() below would call them
    // `soon` regardless of the flag anyway (spec §2b) — the stricter of the two always
    // wins, so the title already knows not to link before either check runs.
    const buildTimeSoon = game.status === 'soon';

    const name = el('div', 'ops__name');
    if (buildTimeSoon) {
      name.append(el('strong', undefined, game.title));
    } else {
      const link = el('a', 'ops__title-link', game.title);
      link.href = `/${game.slug}/`;
      name.append(link);
    }
    name.append(el('span', 'ops__slug', game.slug));

    // The same function the hub and the server-side renderer use. `showAll: false`, so
    // this shows what **prod** would do — the panel's job is to answer "what does a
    // player see", and dev's show-everything rule would hide exactly that.
    const view = cardState(game.status, flag, false);

    // Prefixed, because the badge is the OUTCOME and the buttons below are the INPUTS.
    // Unlabelled, a "NEW" badge sitting beside a NEW button reads as a bug.
    name.append(
      el(
        'span',
        `ops__badge ops__badge--${flag.state}`,
        `player sees: ${view.badge ?? (view.playable ? 'playable' : 'not playable')}`,
      ),
    );

    // Showing four live buttons that provably cannot change anything would be a UI
    // that lies, so they are disabled and the reason is on screen.
    if (buildTimeSoon) {
      name.append(el('span', 'ops__slug', 'not built — a flag cannot make it playable'));
    }

    row.append(name);

    const controls = el('div', 'ops__controls');

    for (const value of ['new', 'active', 'soon', 'hidden'] as FlagState[]) {
      const b = el('button', 'ops__choice', value);
      if (flag.state === value) b.classList.add('is-on');
      b.disabled = buildTimeSoon;
      b.addEventListener('click', () => {
        void write({ slug: game.slug, state: value });
      });
      controls.append(b);
    }

    // Only where it can be seen. A reason is rendered beside a `soon`-state card, so on
    // an active one the field is an invitation to type something nobody will ever read.
    if (flag.state === 'soon') {
      const reason = el('input', 'ops__reason');
      reason.type = 'text';
      reason.placeholder = 'reason, shown beside the soon card';
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
        el('li', undefined, `${when}  ${h.slug} → ${h.state}${h.reason ? ` (${h.reason})` : ''}`),
      );
    }
    log.append(items);
    root!.append(log);
  }

  const notice = el('p', 'ops__note');
  notice.id = 'ops-notice';
  root!.append(notice);

  const schema = el('section', 'ops__log');
  schema.id = 'ops-schema';
  root!.append(schema);
  void loadSchema(schema);

  // Health and Cloudflare usage moved to their own route — see `stats()`. Flag
  // switches make an outbound call each (health checks, the Cloudflare API) with their
  // own timeouts, and they were sharing this page with switches that must stay usable
  // however slow those calls are.
}

/**
 * Two views of "is anyone playing", on their own page.
 * Spec: docs/specs/analytics.md §7
 *
 * Cloudflare monitoring used to share the main page with the flag switches — moved
 * here for the reason its own loader already gave: it makes an outbound call with its
 * own timeout, and the switches must stay usable regardless of how that call is going.
 * A full replace on every tap rather than a partial update, same as `signIn()`/`render()`
 * already do: this page has one user, and the cost of re-rendering a handful of DOM
 * nodes is not worth tracking which half changed.
 */
function stats(): void {
  root!.replaceChildren();

  const head = el('header', 'ops__head');
  head.append(el('h1', 'ops__title', 'FonyGames stats'));
  const back = el('a', 'ops__link', '← back');
  back.href = '../';
  head.append(back);
  const diagnosticLink = el('a', 'ops__link', 'IPinfo diagnostic');
  diagnosticLink.href = 'diagnostic/';
  head.append(diagnosticLink);
  root!.append(head);
  root!.append(adminNav('analytics'));

  const panel = el('section', 'ops__log');
  panel.append(el('p', 'ops__note', 'checking…'));
  root!.append(panel);

  void loadAnalytics(panel, 7);
}

function diagnosticPage(tab: DiagnosticTab = 'ipinfo'): void {
  root!.replaceChildren();
  const head = el('header', 'ops__head');
  const title = tab === 'cloudflare' ? 'Cloudflare diagnostic' : tab === 'stale' ? 'Stale build files' : 'IPinfo diagnostic';
  head.append(el('h1', 'ops__title', title));
  const back = el('a', 'ops__link', '← back to stats');
  back.href = '../';
  head.append(back);
  root!.append(head);
  root!.append(adminNav('diagnostics', tab));
  const panel = el('section', 'ops__log ops__diagnostic');
  panel.append(el('p', 'ops__note', 'Checking…'));
  root!.append(panel);
  if (tab === 'cloudflare') void loadUsage(panel);
  else if (tab === 'stale') void loadStaleAssets(panel);
  else void loadIpInfoDiagnostic(panel);
}

/**
 * The activity stats route's own tab.
 * Spec: docs/specs/analytics.md §7
 *
 * Every number here is a count or a `GROUP BY` — the same shape `Analytics::summary()`
 * answers with, and no coincidence: this panel cannot show what one visitor did because
 * the endpoint behind it cannot answer that question.
 */
type AnalyticsSummary = {
  windowDays: number;
  totals: Record<string, number>;
  uniqueVisitors: number;
  topGames: Array<{
    slug: string;
    gameSelect: number;
    roomCreate: number;
    roomJoin: number;
    gameStart: number;
    gamePlayed: number;
  }>;
  countries: Array<{ country: string; count: number }>;
  cities: Array<{ country: string; city: string; count: number }>;
  referrers: Array<{ host: string; count: number }>;
};

/** Turns `game_played` into "played", for a heading a player-facing label pattern already uses. */
function actionLabel(action: string): string {
  return action.replace(/^(hub|game|room)_/, '').replace(/_/g, ' ');
}

async function loadAnalytics(panel: HTMLElement, days: number): Promise<void> {
  const { status, data } = await api(`analytics&days=${days}`);
  panel.replaceChildren();

  const windowRow = el('div', 'ops__controls');
  for (const choice of [7, 30, 90]) {
    const b = el('button', 'ops__choice', `${choice}d`);
    if (choice === days) b.classList.add('is-on');
    b.addEventListener('click', () => void loadAnalytics(panel, choice));
    windowRow.append(b);
  }
  panel.append(windowRow);

  if (status !== 200) {
    panel.append(el('p', 'ops__note ops__warn', `Could not read it (${status}).`));
    return;
  }

  const summary = data as unknown as AnalyticsSummary;

  panel.append(
    el(
      'p',
      'ops__note',
      `${summary.uniqueVisitors} visitor(s) over the last ${summary.windowDays} day(s).`,
    ),
  );

  const totals = el('ul');
  for (const [action, count] of Object.entries(summary.totals)) {
    totals.append(el('li', undefined, `${actionLabel(action)}: ${count}`));
  }
  panel.append(el('h2', 'ops__subtitle', 'events'), totals);

  panel.append(el('h2', 'ops__subtitle', 'games'));
  if (summary.topGames.length === 0) {
    panel.append(el('p', 'ops__note', 'Nothing yet.'));
  } else {
    panel.append(sortableTable(
      [
        ['slug', 'Game'], ['gameSelect', 'Selected'], ['roomCreate', 'Created'],
        ['roomJoin', 'Joined'], ['gameStart', 'Started'], ['gamePlayed', 'Played'],
      ],
      summary.topGames,
      'gamePlayed',
    ));
  }

  placesMasterDetail(panel, summary.countries, summary.cities);
  countedList(panel, 'referrers', summary.referrers.map((r) => [r.host, r.count]));
}

async function loadIpInfoDiagnostic(panel: HTMLElement): Promise<void> {
  const { status, data } = await api('ipinfo-diagnostic');
  panel.replaceChildren(el('h2', 'ops__subtitle', 'IPinfo diagnostic (8.8.8.8)'));
  panel.append(el('p', 'ops__note', `Referer used: ${String(data['referer'] ?? 'not returned')}`));
  if (status !== 200) {
    panel.append(el('p', 'ops__note ops__warn', `Could not read it (${status}).`));
    const raw = el('pre', 'ops__diagnostic-result');
    raw.textContent = JSON.stringify(data, null, 2);
    panel.append(raw);
    return;
  }
  const diagnostic = (data['diagnostic'] ?? {}) as { status?: number | null; ok?: boolean; raw?: string | null; error?: string | null; result?: Record<string, unknown> | null };
  panel.append(el('p', 'ops__note', `IPinfo response: ${diagnostic.status ?? 'not queried'} (${diagnostic.ok ? 'ok' : 'unavailable'})${diagnostic.error ? ` — ${diagnostic.error}` : ''}`));

  if (!diagnostic.result || Object.keys(diagnostic.result).length === 0) {
    panel.append(el('p', 'ops__note', 'No parsed lookup result.'));
    const raw = el('pre', 'ops__diagnostic-result');
    raw.textContent = diagnostic.raw ?? '(empty response)';
    panel.append(raw);
    return;
  }

  const result = el('pre', 'ops__diagnostic-result');
  result.textContent = JSON.stringify(diagnostic.result, null, 2);
  panel.append(result);

  // `result` is `raw` parsed and passed through the same depth/length truncation the
  // real Analytics collector applies (`Analytics::diagnostic()`) — identical to `raw`
  // for a normal, shallow ipinfo lookup. Showing both then was two blocks of the same
  // data back to back; the raw block is only worth a second look when that truncation,
  // or a parse failure, actually changed something.
  const rawMatchesResult = ((): boolean => {
    if (diagnostic.raw == null) return true;
    try {
      return JSON.stringify(JSON.parse(diagnostic.raw)) === JSON.stringify(diagnostic.result);
    } catch {
      return false;
    }
  })();
  if (!rawMatchesResult) {
    panel.append(el('p', 'ops__note', 'Raw response (differs from the parsed result above):'));
    const raw = el('pre', 'ops__diagnostic-result');
    raw.textContent = diagnostic.raw ?? '(empty response)';
    panel.append(raw);
  }
}

/**
 * Files sitting in the deployed `assets/` that no current page references — orphaned
 * by the deploy's `full` sync, which never deletes on the remote (docs/deployment.md
 * §5). Compared against the current build's own manifest, never by upload date: a
 * file whose content hasn't changed across builds never gets re-uploaded, so its
 * remote date can be old while it is still exactly what the live pages use
 * (api/lib/StaleAssets.php, docs/specs/backoffice.md §8).
 */
async function loadStaleAssets(panel: HTMLElement): Promise<void> {
  const { status, data } = await api('stale-assets');
  panel.replaceChildren(el('h2', 'ops__subtitle', 'stale build files'));

  if (status !== 200) {
    panel.append(el('p', 'ops__note ops__warn', `Could not read it (${status}).`));
    return;
  }

  const files = (data['files'] as string[] | undefined) ?? [];

  if (files.length === 0) {
    panel.append(el('p', 'ops__note', 'No stale files — assets/ matches the current build.'));
    return;
  }

  panel.append(el('p', 'ops__note', `${files.length} file(s) in assets/ that no current page references.`));

  const del = el('button', 'ops__button', `Delete ${files.length} stale file(s)`);
  const said = el('p', 'ops__note');
  del.addEventListener('click', () => {
    del.disabled = true;
    said.textContent = 'deleting…';
    void api('delete-stale-assets', {}).then(({ status: st, data: d }) => {
      del.disabled = false;
      if (st === 200) {
        said.textContent = `Deleted ${d['deletedCount'] as number}.`;
        void loadStaleAssets(panel);
        return;
      }
      said.className = 'ops__note ops__warn';
      said.textContent = `Could not delete (${st}).`;
    });
  });
  panel.append(del, said);
}

/** Sorts entirely in this browser; changing a column never repeats the API query. */
function sortableTable(
  columns: Array<[string, string]>,
  source: Array<Record<string, StatsValue>>,
  initial: string,
): HTMLTableElement {
  const table = el('table', 'ops__table');
  const head = el('thead');
  const headRow = el('tr');
  const body = el('tbody');
  let sortKey = initial;
  let ascending = false;

  const render = (): void => {
    body.replaceChildren();
    const rows = sortStatsRows(source, sortKey, ascending);
    for (const row of rows) {
      const tr = el('tr');
      for (const [key] of columns) tr.append(el('td', undefined, String(row[key] ?? '')));
      body.append(tr);
    }
  };

  for (const [key, label] of columns) {
    const th = el('th');
    const button = el('button', 'ops__sort', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      ascending = sortKey === key ? !ascending : false;
      sortKey = key;
      render();
    });
    th.append(button);
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head, body);
  render();
  return table;
}

function placesMasterDetail(
  panel: HTMLElement,
  countries: Array<{ country: string; count: number }>,
  cities: Array<{ country: string; city: string; count: number }>,
): void {
  panel.append(el('h2', 'ops__subtitle', 'countries and cities'));
  if (countries.length === 0) {
    panel.append(el('p', 'ops__note', 'None yet.'));
    return;
  }
  const layout = el('div', 'ops__master-detail');
  const master = el('table', 'ops__table');
  const masterHead = el('thead');
  const masterHeadRow = el('tr');
  masterHeadRow.append(el('th', undefined, 'Country'), el('th', undefined, 'Events'));
  masterHead.append(masterHeadRow);
  const masterBody = el('tbody');
  const detail = el('div');

  const show = (country: string): void => {
    detail.replaceChildren(el('h3', 'ops__subtitle', `Cities in ${country}`));
    const rows = citiesForCountry(cities, country);
    if (rows.length === 0) detail.append(el('p', 'ops__note', 'No city reported.'));
    else detail.append(sortableTable([['city', 'City'], ['count', 'Events']], rows, 'count'));
    for (const button of masterBody.querySelectorAll('button')) {
      button.classList.toggle('is-on', button.dataset.country === country);
    }
  };

  for (const row of countries) {
    const tr = el('tr');
    const cell = el('td');
    const button = el('button', 'ops__master', row.country);
    button.type = 'button';
    button.dataset.country = row.country;
    button.addEventListener('click', () => show(row.country));
    cell.append(button);
    tr.append(cell, el('td', undefined, String(row.count)));
    masterBody.append(tr);
  }
  master.append(masterHead, masterBody);
  layout.append(master, detail);
  panel.append(layout);
  show(countries[0]?.country ?? '');
}

/** A `<h2>` plus its list of "label: count" rows, or a "none yet" line when there are none. */
function countedList(panel: HTMLElement, label: string, rows: Array<[string, number]>): void {
  panel.append(el('h2', 'ops__subtitle', label));
  if (rows.length === 0) {
    panel.append(el('p', 'ops__note', 'None yet.'));
    return;
  }
  const list = el('ul');
  for (const [value, count] of rows) {
    list.append(el('li', undefined, `${value}: ${count}`));
  }
  panel.append(list);
}

/**
 * Solo testing: start a round alone, to look at a game.
 * Spec: docs/specs/backoffice.md §6 · the rule it relaxes: `enoughToStart` in
 * shared/players.ts
 *
 * It lives here and nowhere else because *here* is the one page you can only reach by
 * signing in, and the switch it flips is a per-browser one (see core/solo.ts). Nothing
 * is sent to the server: the flag is read by the lobby of whichever game you open next,
 * in this browser, and the referee is told at start time.
 *
 * The copy is deliberate about the two things it does NOT do. It changes no rule other
 * than the minimum head-count and "last one standing", and it is not a permission —
 * anyone can set the same key from a console and all they win is the ability to play by
 * themselves.
 */
function soloPanel(): HTMLElement {
  const panel = el('section', 'ops__log');
  panel.append(el('h2', 'ops__subtitle', 'solo testing'));
  panel.append(
    el(
      'p',
      'ops__note',
      'Start any game on your own, in this browser, to see how it renders. Nothing else' +
        ' changes: every rule, timer and score is the one the game normally uses, and a' +
        ' round that would normally end when one player is left simply runs to its clock.',
    ),
  );

  const said = el('p', 'ops__note');

  const toggle = el('button', 'ops__choice', 'solo start');
  const paint = (on: boolean): void => {
    toggle.classList.toggle('is-on', on);
    toggle.setAttribute('aria-pressed', String(on));
    said.textContent = on
      ? 'On. Open a game and Start round is enabled with one player.'
      : 'Off. Games need their usual minimum.';
  };
  paint(soloTesting());

  toggle.addEventListener('click', () => {
    const next = !soloTesting();
    setSoloTesting(next);
    // Read back rather than trusting the write: in private mode the setter is a no-op,
    // and a button that lights up while nothing happened is the worst of both.
    paint(soloTesting());
    if (soloTesting() !== next) said.textContent = 'This browser refuses to store it — private mode?';
  });

  const controls = el('div', 'ops__controls');
  controls.append(toggle);
  panel.append(controls, said);

  // Named, because the alternative is discovering it on the one game where the button
  // stays dead. Sling Puck is two phones facing each other across a gap; a solo board
  // has no opposite half, so there is nothing to render alone.
  panel.append(el('p', 'ops__slug', 'Sling Puck is excluded — it needs a second phone to have a board at all.'));

  return panel;
}

type Schema = {
  installed: boolean;
  applied: Record<string, number>;
  pending: string[];
  files: string[];
};

/**
 * The schema panel.
 *
 * Lists every migration file as applied or pending, and runs the pending ones. Also the
 * only screen that works on an empty database, which is why it is loaded separately from
 * `state`.
 */
async function loadSchema(panel: HTMLElement, bearer?: string): Promise<void> {
  const { status, data } = await api('schema', undefined, bearer);
  panel.replaceChildren(el('h2', 'ops__subtitle', 'database schema'));

  if (status !== 200) {
    panel.append(el('p', 'ops__note ops__warn', `Could not read the schema (${status}).`));
    return;
  }

  const schema = data as unknown as Schema;

  // No "not installed" line here. This panel only ever sees an uninstalled schema from
  // the bootstrap screen, whose heading already says it — the signed-in path cannot reach
  // render() without a schema. Saying it twice reads as two different problems.

  const list = el('ul');
  for (const file of schema.files) {
    const at = schema.applied[file];
    const when = at === undefined ? 'pending' : new Date(at).toISOString().slice(0, 16).replace('T', ' ');
    const line = el('li', undefined, `${at === undefined ? '○' : '●'} ${file} — ${when}`);
    if (at === undefined) line.className = 'ops__warn';
    list.append(line);
  }
  panel.append(list);

  if (schema.files.length === 0) {
    panel.append(el('p', 'ops__note', 'No migration files reached this host — check the deploy staged db/.'));
    return;
  }

  if (schema.pending.length === 0) {
    panel.append(el('p', 'ops__note', 'Nothing pending.'));
    return;
  }

  const run = el('button', 'ops__button', `Run ${schema.pending.length} pending`);
  const said = el('p', 'ops__note');
  run.addEventListener('click', () => {
    run.disabled = true;
    said.textContent = 'running…';
    void api('migrate', {}, bearer).then(({ status: st, data: d }) => {
      run.disabled = false;
      const applied = (d['applied'] as string[] | undefined) ?? [];
      const failed = d['failed'] as { file: string; statement: number; error: string } | undefined;

      if (st === 200 && !failed) {
        // `published` matters as much as the migration: a migrated host with no flags.json
        // leaves the Worker failing open, so it is reported either way.
        const note =
          `Applied ${applied.length} migration(s).` +
          (d['published'] === true
            ? ' flags.json published.'
            : ' But flags.json could NOT be written — the Worker is failing open.');

        if (bearer) {
          /*
           * We came in through the bootstrap screen, whose heading says the schema is not
           * installed. It is now, so that heading is stale and false — and re-rendering only
           * the panel would leave it there while ALSO wiping this message, which is how the
           * operator ends up never learning whether flags.json was written.
           *
           * So hand off to the normal flow: the schema exists, a magic link works now.
           */
          signIn(`${note} You can sign in with a magic link now.`);
          return;
        }

        said.textContent = note;
        said.className = d['published'] === true ? 'ops__note' : 'ops__note ops__warn';
        void loadSchema(panel, bearer);
        return;
      }

      // The file and the statement, because "migration failed" sends you opening files by
      // hand at the moment you are most likely to make it worse.
      said.className = 'ops__note ops__warn';
      said.textContent = failed
        ? `FAILED in ${failed.file}, statement ${failed.statement}: ${failed.error}` +
          ` — nothing was rolled back (MariaDB commits DDL as it goes). The file is not` +
          ` recorded as applied, so fix it and run again.`
        : `Could not migrate (${st}).`;
    });
  });
  panel.append(run, said);
}

/**
 * The one screen a fresh database can show.
 *
 * On an empty database `?a=state` answers 503 and the magic link cannot work at all —
 * `requestLink` writes to `admin_link_attempt`. So this asks for `ADMIN_TOKEN`, which
 * authenticates against config alone and touches no table.
 */
function bootstrap(pending: string[]): void {
  root!.replaceChildren();
  const box = el('div', 'ops__gate');
  box.append(el('h1', 'ops__title', 'FonyGames ops'));
  box.append(
    el(
      'p',
      'ops__note ops__warn',
      `The database schema is not installed — ${pending.length} migration(s) pending.`,
    ),
  );
  box.append(
    el(
      'p',
      'ops__note',
      'A magic link cannot work yet: signing in writes to a table the migrations create.' +
        ' Paste ADMIN_TOKEN to run them. It is sent once and never stored.',
    ),
  );

  const form = el('form', 'ops__form');
  const input = el('input', 'ops__input');
  input.type = 'password';
  input.placeholder = 'ADMIN_TOKEN';
  input.autocomplete = 'off';
  input.required = true;
  const button = el('button', 'ops__button', 'Run migrations');
  button.type = 'submit';
  form.append(input, button);

  const panel = el('section', 'ops__log');
  panel.id = 'ops-schema';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadSchema(panel, input.value);
  });

  box.append(form, panel);
  root!.append(box);
}

type Usage = {
  flagsFile: { ok: boolean; detail: string };
  health: Array<{ label: string; url: string; ok: boolean; status: number; detail: string }>;
  cloudflare: {
    ok: boolean;
    reason?: string;
    days?: Array<{ date: string; requests: number | null; gbSeconds: number | null }>;
    ceilings: { requests: number; gbSeconds: number };
  };
};

async function loadUsage(panel: HTMLElement): Promise<void> {
  const { status, data } = await api('usage');
  panel.replaceChildren(el('h2', 'ops__subtitle', 'health and usage'));

  if (status !== 200) {
    panel.append(el('p', 'ops__note', `Could not read it (${status}).`));
    return;
  }

  const usage = data as unknown as Usage;

  // First, because a missing flags.json makes every switch above this panel a lie.
  if (usage.flagsFile) {
    const line = el('p', 'ops__note', usage.flagsFile.detail);
    if (!usage.flagsFile.ok) line.className = 'ops__note ops__warn';
    panel.append(line);
  }

  const list = el('ul');
  for (const row of usage.health) {
    // The status number is included even when it is fine: "up (200)" and "up" cost the
    // same to read, and the number is what you quote to somebody else.
    const state = row.ok ? `up (${row.status})` : row.status === 0 ? 'unreachable' : `down (${row.status})`;
    const line = el('li', undefined, `${row.label}: ${state}`);
    if (!row.ok && row.detail) line.append(el('span', 'ops__slug', ` ${row.detail}`));
    list.append(line);
  }
  panel.append(list);

  const cf = usage.cloudflare;
  if (!cf.ok) {
    // Says WHY, and never shows a zero. A row of zeroes against the free-tier ceiling
    // would read as "plenty of headroom" on the day the token expired.
    panel.append(el('p', 'ops__note', `Cloudflare usage unavailable — ${cf.reason ?? 'no reason given'}`));
    return;
  }

  const usageList = el('ul');
  for (const day of cf.days ?? []) {
    const pct =
      day.requests === null ? null : Math.round((day.requests / cf.ceilings.requests) * 100);
    usageList.append(
      el(
        'li',
        undefined,
        `${day.date}: ${day.requests ?? '?'} DO requests` +
          (pct === null ? '' : ` — ${pct}% of the ${cf.ceilings.requests.toLocaleString()}/day free tier`),
      ),
    );
  }
  panel.append(usageList);
  // Stated rather than left as a blank column: the query deliberately does not ask for
  // GB-seconds, because one unknown field name would fail the whole query.
  panel.append(
    el('p', 'ops__note', `GB-seconds are not fetched yet — see api/lib/Usage.php. Ceiling is ${cf.ceilings.gbSeconds.toLocaleString()}/day.`),
  );
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
  // The API now says WHY when it could not write, because "check the web root is writable"
  // was a guess and the real cause is usually invisible: tempnam() falls back to the system
  // temp dir, so the failure surfaces as a rename error rather than a permission one.
  const why = typeof data['publishWhy'] === 'string' ? ` ${data['publishWhy']}.` : '';
  await load();
  say(
    published
      ? 'Saved.'
      : 'Saved to the database, but flags.json was NOT rewritten — the Worker and the hub are'
        + ` still on the old answer.${why}`,
  );

  if (!published) {
    const retry = el('button', 'ops__link', 'republish');
    retry.addEventListener('click', () => {
      void api('republish', {}).then(({ data: d }) => {
        const reason = typeof d['publishWhy'] === 'string' ? ` ${d['publishWhy']}.` : '';
        say(d['published'] === true ? 'Published.' : `Still could not write flags.json.${reason}`);
      });
    });
    document.getElementById('ops-notice')?.append(' ', retry);
  }
}

async function load(): Promise<void> {
  const { status, data } = await api('state');
  if (status === 401) {
    // A 401 means "not signed in" — but it says that on an empty database too, where a
    // magic link CANNOT work. So ask the one question that is answerable without
    // credentials before offering a form that would go nowhere.
    const probe = await api('schema');
    if (probe.status === 200 && probe.data['installed'] === false) {
      bootstrap((probe.data['pending'] as string[] | undefined) ?? []);
      return;
    }
    signIn();
    return;
  }
  if (status === 503) {
    // Three different 503s, and telling them apart is the difference between a useful
    // screen and a shrug. Only `schemaMissing` has something the operator can fix here.
    if (data['schemaMissing'] === true) {
      bootstrap((data['pending'] as string[] | undefined) ?? []);
      return;
    }
    if (data['dbUnreachable'] === true) {
      // NOT the bootstrap panel: there is nothing to migrate into. Offering the migrate
      // button here would be proposing a fix that cannot work — which is what this used
      // to do, because a refused connection reported itself as a missing schema.
      const detail = typeof data['dbError'] === 'string' ? ` ${data['dbError']}` : '';
      signIn(`The database is not reachable from this host.${detail}`);
      return;
    }
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

  if (/\/stats\/diagnostic\/?$/.test(location.pathname)) {
    const { status } = await api('usage');
    if (status === 401) { signIn(); return; }
    if (status !== 200) { signIn(`The admin API answered ${status}.`); return; }
    const tabParam = new URLSearchParams(location.search).get('tab');
    const diagnosticTab: DiagnosticTab = tabParam === 'cloudflare' ? 'cloudflare' : tabParam === 'stale' ? 'stale' : 'ipinfo';
    diagnosticPage(diagnosticTab);
    return;
  }
  if (/\/stats\/?$/.test(location.pathname)) {
    const { status } = await api('usage');
    if (status === 401) { signIn(); return; }
    if (status !== 200) { signIn(`The admin API answered ${status}.`); return; }
    if (new URLSearchParams(location.search).get('tab') === 'cloudflare') diagnosticPage('cloudflare');
    else stats();
    return;
  }

  await load();
}

void boot();
