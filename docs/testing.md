# Testing

> Status: a **logic harness runs today** (`npm test`). A general test framework
> is still an open choice — see §1.1 and [roadmap.md](roadmap.md).

Sensors, permissions and multi-device timing cannot be fully faked. So: automate
what is deterministic, and keep a short, ruthless manual pass for the rest.

## 1. Layers

| Layer | Scope | Tool |
| --- | --- | --- |
| Unit | Pure logic: bump detection on recorded sample data, scoring, timers, room-code generation, geo maths | **`npm test`** today; Vitest proposed |
| Unit (server) | The admin centre's auth rules and the flag store | **`npm run test:php`** on plain `php` (§1.1a) |
| Contract | Client/server message schemas, round state machine | Drive the real module through a fake `Ctx` (§1.1) |
| End-to-end | Simulated players joining a room and playing a round | Real WebSockets against `wrangler dev` (§1.2) |
| Manual | Real phones, real permissions, real network | The checklist in §3 |

### 1.1 `npm test` — the logic harness

`worker/spill.test.ts` is the pattern to copy. It bundles with esbuild (already
present via Vite, so no new dependency) and runs on plain Node:

```
npm test
```

Every game module is written against a `Ctx` interface — `now()`, `broadcast()`,
`load()`, `save()`, `setAlarm()` — for exactly this reason. The harness supplies
a fake one with **a clock it controls**, so timing rules (launch locks, approach
windows, hold expiry) are *tested* rather than raced against. No wrangler, no
sockets, no sleeping.

Deciding on Vitest (D10-adjacent) would replace the hand-rolled `check()` and
give watch mode; it would not change the shape of the tests, because the shape
comes from `Ctx`, not the runner.

**Not all of it is referee logic.** Sling Puck simulates its board on the phone
(its [spec](specs/games/sling-puck.md) §4), so
`www/src/games/sling-puck/physics.test.ts` runs the same way but has no `Ctx` at
all — it is pure arithmetic over board units, and it earns its place because the
bounce behaviour and the sling are *stated requirements* rather than looks. Two of
the bugs it caught could not have been seen on a screenshot: an equal-mass
collision impulse missing its `(1 + e)` factor, and an accessibility fallback that
could not reach the gap from three of the five starting positions.

### 1.1a `npm run test:php` — the same harness shape, in PHP

The backoffice lives in PHP ([specs/backoffice.md](specs/backoffice.md)), and the
rules it enforces are the kind that must be tested rather than eyeballed: a
magic-link flow has a replay hole, an expiry hole, a rate-limit-as-oracle hole and a
single-use hole, and none of them is visible in a browser.

So `api/tests/run.php` is deliberately the same shape as the Node harness — no
framework, a `check()` counter, a non-zero exit — and it runs on the plain `php`
binary, which is present locally and preinstalled on GitHub's `ubuntu-latest`
runners. `npm test` runs both halves; CI therefore does too.

**The suite runs against real MariaDB, built from the shipped `db/init.sql`.** It used
to build a hand-translated SQLite schema, which was a real hole: the DDL that shipped
was never the DDL the tests ran, so a MariaDB-only error passed CI and would have
failed on the host. `api/tests/schema.php` now applies the real file to a real server,
and CI runs a `mariadb:11` service container. There is **no SQLite fallback** — a
suite that skips silently proves nothing, so a missing server is a hard failure with
the command to fix it. Details and the two safety guards: [database.md](database.md)
§4 rule 3, §5.

The clock stays injected, so timing rules are still tested rather than raced against.

**Deliberately not covered**, so nobody reads a green suite as more than it is:
whether `mail()` actually delivers, and whether the *host's* database has actually had
the migrations applied. The first is manual; the second is what the admin centre's
schema panel is for.

### 1.1a-bis Driving the admin centre locally

The PHP suite covers the rules; it does not cover PHP's own session handling, the
routing, or the page. Those need a real server, and they can have one without touching
the host:

```bash
npm run build                       # also stages api/ into dist/api
# a SQLite database with the same columns db/init.sql declares
# a dist/api/config.php with:
#   'db_dsn'    => 'sqlite:/path/to/fony.sqlite'
#   'mail_sink' => '/path/to/mail.log'   ← writes the magic link to a FILE
mv dist/ops-placeholder dist/ops-local
cd dist && php -S 127.0.0.1:8099
```

`mail_sink` exists for exactly this: a laptop has no working `mail()`, and without it the
magic-link flow could only ever be exercised in production. **Never set it on the host** —
the sink would be a file full of valid links.

Then `curl` the flow and read the token out of the sink, or open
`http://127.0.0.1:8099/ops-local/#<token>` in a browser to walk in through the front
door. What that is worth checking for, beyond the happy path: an unauthenticated `state`
is 401, a write without `X-Admin` is 400, a wrong address and the right one both answer
204, a replayed token is 401, the break-glass bearer works with no cookie, and
`flags.json` appears in the web root and is readable anonymously — because that last one
is what the Worker fetches.

⚠️ **Reset the database between runs.** The rate limit and the outstanding link both
persist, so a second run starts throttled and everything after the first link request
fails. A suite that passes exactly once is not a suite.

⚠️ **Do not kill background servers with `pkill -f "php -S …"`.** The pattern matches the
shell's own command line — the script that starts the server contains the string too —
so it kills the shell and leaves the server running, and then the next assertions test
the *old* process. Write the PID to a file when you start it and kill that. This wasted
two debugging rounds and produced one convincing false failure.

### 1.1c Checking the server-rendered hub

`api/tests/page_test.php` covers the assembly against a fixture and needs **no build
output** — that matters, see below.

The one coupling worth naming lives in `api/tests/ssr_check.php`, which runs as
**`postbuild`**: `scripts/ssr.mjs` invents the variant-key format and `Page::variantKey()`
reconstructs it, so it reads the **real generated `dist/_hub/cards.php`** and asserts every
key PHP would ask for exists and no key exists that it would not. If those drift, every
card resolves to `''` and the hub renders an empty grid with no error anywhere.

⚠️ **`npm test` must keep running BEFORE `npm run build`, and this check must not move back
into it.** That ordering bug already broke a dev deploy once: the check lived in
`page_test.php`, needed `dist/`, and CI runs the tests first — it had only ever passed
locally because a build had already happened.

The tempting fix is to build first. **Don't.** `prebuild` runs `art:outlines` and
`art:og`, which *regenerate* the committed generated files, and `npm test` then verifies
they are current with `--check`. Build first and both of those checks verify files the
build just rewrote — two staleness guards silently disarmed to fix one ordering bug. A
check that needs build output belongs to the build.

What the harness cannot see needs a server and a browser:

```bash
npm run build && cd dist && php -S 127.0.0.1:8100     # with an api/config.php, as §1.1a-bis
curl -s http://127.0.0.1:8100/ | grep -c '<li class="game-card'   # 13, no JS involved
```

Then **the check that is the whole justification for rendering per request**: disable a
game in the admin and `curl` again *without rebuilding*. The card must change state in the
response. Also worth confirming, because each has its own failure mode: a `hidden` game's
title is **absent** rather than dimmed with CSS (a crawler reads the source), a `disabled`
game's badge carries the operator's reason **escaped**, and `sitemap.php` drops the hidden
game while keeping the disabled one.

### 1.1d Hydration: what can and cannot be proved

**"No console errors" does not prove hydration worked.** Preact's production build is
silent on a mismatch, so a full replacement looks exactly like a clean adoption.

The way to actually see it is a `MutationObserver` installed via CDP's
`Page.addScriptToEvaluateOnNewDocument`, which runs *before* the page's own scripts: count
`li.game-card` nodes removed and added during boot, and compare the object identity of the
first card before and after. A correct hydration removes none, adds none, and keeps the
same node.

⚠️ **And a finding that corrects an earlier assumption in this repo.** That test does *not*
distinguish `hydrate()` from `render()`. Both were run in a real browser on the Preact this
project ships: `render()` over server markup adopts the existing children rather than
replacing them, and `hydrate()` into an empty container renders fine. So the branch in
`main.tsx` is a statement of intent and a small saving, **not** a fix for a crash — and
anyone told otherwise will go looking for a bug that is not there.

The mutation that exposed that also exposed a trap in *how* to run one: `npm run build`
was failing on an unused import while its output went to `/dev/null`, so the old assets
were still being served and the mutation "passed". **Check the emitted asset hash changes
before believing a mutation was tested.**

### 1.1e The health and usage panels

`api/tests/usage_test.php` is almost entirely failure cases, because the panel exists to
be looked at when something is wrong. The one behaviour worth naming: **it must never show
a number it does not have.** A row of zeroes against the free-tier ceiling reads as
"plenty of headroom" on the day the analytics token expires, so every failure path returns
`ok: false` with a reason and the raw body, and `pressure()` returns `null` — not 0 — for
unknown usage.

Two traps in there that are easy to get wrong:

- **Cloudflare's GraphQL API reports its own errors with HTTP 200.** Treating 200 as
  success would report an authentication failure as "0 requests today".
- **A self-check against your own origin deadlocks on `php -S`**, which is
  single-threaded, so a request made from inside a request never completes. There is no
  self-check for that reason and because it is near-worthless anyway — if the code is
  answering, the site is up. What *is* reported about the host is whether `flags.json`
  exists, which is a disk read.

⚠️ **What these tests do not prove.** Every Cloudflare response body in them is
hand-written from the documented schema, not recorded: this sandbox cannot reach
`api.cloudflare.com` and the analytics token does not exist yet. They prove the parser
degrades honestly on anything unexpected. They do **not** prove the field names are right —
that needs one look at a real response, and `api/lib/Usage.php` says so at the top.

### 1.1b The rules live in TypeScript, and only once

`shared/flags.ts` decides everything about a flag — `mayOpenRoom`, `cardState`,
`flagFor` — and it is covered by the Node harness. **PHP re-implements none of it.**
The server-rendered page picks between markup variants the *build* produced by
calling `cardState()` for each combination ([specs/seo.md](specs/seo.md) §4), so
there is no second copy of the rules to keep in step and no PHP test that could
disagree with a TypeScript one.

### 1.2 End-to-end against a real Worker

The harness proves the referee. It cannot prove that `Room.ts` routes to it, that
the wire types survive `JSON.stringify`, or that a refresh really reclaims a
seat. For that, connect real `WebSocket`s (Node has one built in) to
`wrangler dev` and play a round.

Two traps that have already cost time:

- **Kill any stale `wrangler`/`workerd` by PID before starting.** A leftover on
  8787 answers `/health` happily and you will test the previous build. By **PID**,
  not `pkill -f wrangler` — a pattern kill matches the shell running it as well as
  the target, so it kills the command mid-flight (exit 144) and takes the dev
  servers with it. The aftermath looks like a broken lobby, not like a botched
  cleanup: Chromium shows its own "Reload / Details" error page and you spend the
  next twenty minutes debugging code that never ran.
- **A room code is six characters, and the rest is thrown away.** `codeFromLocation`
  sanitises against the code alphabet (no `O`, `0`, `I`, `1`) and truncates, so
  `#SIEGRA`, `#SIEGRB` and `#SIEGRC` are all the room `SIEG`. Three "fresh" codes, one
  room, and a test that quietly picks up the players and the live round from the run
  before. Use four legal characters and nothing more.

  An **illegal** character fails differently: `#TDNI` has an `I`, sanitises to three
  characters, and no longer validates — so every tab lands on "This room doesn't
  exist" instead of a room. Nine tabs, nine failures, and it reads like a broken join
  gate. Both traps come from the same line of `normaliseRoomCode`.

  **The worst version of this is a test that passes.** Checking that a disabled game
  cannot open a room, with the code `GTA1`: the `1` is stripped, the code fails
  `isRoomCode`, the Worker answers `400`, and the assertion "the socket was refused"
  is satisfied by the wrong cause. The same run reported the in-flight rule *broken*
  for the same reason. A negative assertion about a refusal has to pin the reason, or
  a legal code has to be used — and a legal code is now a **shape**, not just a set of
  characters: six letters as two vowel/consonant-alternating triplets, `TAK-OBE`. Six
  letters picked at random will not do; roughly thirty-nine times in forty they are
  refused before anything under test is reached.
- **Use a fresh room code for every run.** Codes are just names —
  `idFromName(code)` resolves to the *same* Durable Object as last time, live round
  and all. Rejoin a code from an earlier run and `start` is **silently refused**
  because a round is already in progress, so the test sits waiting for a board that
  will never mount and reports the bug as "start round does nothing".
- **The Worker's origin allow-list is real.** `ALLOWED_ORIGINS` permits port
  **5173** — serve the built site there (`vite preview --port 5173`) or every
  socket is correctly refused and the page just says "reconnecting".
- **Wait for the pre-round panel to *appear* before waiting for it to go.** Every
  game shows it for 4 s after "start round"
  ([design/game-chrome.md](design/game-chrome.md) §4), and `!document.querySelector('.preround')`
  is trivially true for the beat before the board mounts — so a naive wait returns
  instantly and the test then drives a board that is still rejecting input.
- **A backgrounded tab stops running `requestAnimationFrame`.** Screenshotting one
  page brings it to the front and therefore backgrounds the other. For a game that
  animates on rAF this *freezes its simulation* — which is real, documented
  behaviour (sling-puck.md §9), not a bug, and it looks exactly like broken
  physics. Bring the page you are driving back to the front first.

  Worse, it also **delays Preact's effects**, so a background tab can be a whole
  second behind on state that is written from a `useEffect` rather than a render:
  `useEffect` callbacks are flushed on the next animation frame with a ~100 ms
  `setTimeout` as the only fallback, and a hidden tab has no frames and throttles
  that timer. Reading such a tab straight after a phase change returns the *previous*
  phase's value. This produced a convincing false alarm — two tabs appearing to
  disagree about where Tap Duel's target froze, which is the one property that
  design rests on, when in fact the reading was simply early. Give a hidden tab a
  second before believing it, and **decompose the measurement**: reading `left`,
  `top`, `transform` and `innerWidth` separately says *which* part differs, where a
  bare `getBoundingClientRect()` centre cannot tell a stale animation from a
  different viewport.

- **Dispatch the first `mouseMoved` a beat after `mousePressed`, not in the same
  instant.** Sent together, the move can arrive before the page has handled
  `pointerdown` — so nothing has grabbed yet and the move is dropped. With a single
  move per gesture that is the whole gesture gone, and it reads as the feature being
  broken: Cat and Mouse's `direct` drag measured **0 px of travel** this way while
  working perfectly in a test that happened to send twenty small moves. 80 ms is
  plenty.
- **Locate canvas-drawn things by sampling pixels, and cluster carefully.** There is
  no DOM to query, so `getImageData` plus a colour window is the only handle. Two
  traps: an icon drawn from more than one shape yields **more blobs than there are
  objects** (a mouse's body and its ear clustered as two mice), and anything on a
  timer must be sampled *while it is on screen* — a 2 s grace ring probed after a 2.4 s
  hold is long gone, which looks exactly like a ring that never drew.

For browser-level checks, Chromium is preinstalled but Playwright is not, and
headless Chrome **ignores `--window-size`** — it renders at 500px and crops,
which looks exactly like a CSS overflow bug. Drive it over CDP and set
`Emulation.setDeviceMetricsOverride` explicitly, and call `Page.bringToFront`
before a screenshot or a backgrounded tab never composites and the capture
hangs.

### 1.3 The payload proof

Two budgets in [architecture.md](architecture.md) §4 are invisible to `npm test`
because they are properties of the *build*, not of the logic. Check them by hand
after any change to the hub or to game art:

```bash
npm run build
grep -c 'data:image/svg' dist/assets/hub-*.js   # 0 — nothing was base64-inlined
grep -o '"M[0-9]' dist/assets/hub-*.js | wc -l  # 0 — no SVG path data left in JS
ls dist/assets/*.svg                             # one hashed file per illustration
gzip -9c dist/assets/hub-*.js | wc -c            # write the number down
```

**Write the numbers down**, because a regression here fails nothing — the page just
gets heavier. Measured on 2026-08-04:

| | Hub chunk | Whole hub page | A game page |
| --- | --- | --- | --- |
| Art inline in the JS | 10,125 / **3,444 gz** | 10,995 gz, 2 files | 23,061 gz (tap-duel) |
| Art as files | 8,328 / **3,639 gz** | 11,224 gz, 2 files | 21,920 gz |

The hub *chunk* barely moved and the *page* is 229 bytes heavier — because the
illustrations left, but thirteen `card.ts` files and four duplicated cards arrived.
That is the honest result: **the win was the rule, not the bytes.** The art is now a
set of separately cacheable files that a redraw does not rebuild the JS for, the
below-fold ones are never fetched at all, and every game page is 1.1–1.5 KB lighter
because it carries one card instead of thirteen.

Why `?no-inline` is what keeps the first two greps at zero:
[design/illustrations.md](design/illustrations.md) §2.

Sensor input in automated tests is injected as **recorded traces** (JSON arrays
of samples captured on a real phone) — never random noise. Traces live in
`www/src/core/sensors/__fixtures__/`.

## 2. What must have a test

- Any scoring or win-condition rule.
- Any threshold (bump, shake, stillness, zone radius) — with a trace that
  passes and one that must not trigger.
- The room lifecycle: join, rejoin after drop, host promotion, last-player-out.
- Any bug that reaches a phone gets a regression test in the same `fix:` commit
  series.
- Any auth rule in the admin centre, stated as the hole it closes rather than the
  happy path: a replayed link, an expired one, a rate limit used as an oracle, a
  forged or extended session, an unset secret matching everybody.

**One trap specific to the flag gate**, because it has already produced a test that
passed for the wrong reason: a room code containing `O`, `0`, `I` or `1` is not in
the code alphabet, so it sanitises down and the Worker answers `400`. That satisfies
an assertion of "the room was refused" while proving nothing about the flag. **Use
legal codes** when testing a refusal.

## 3. Manual device checklist (run before declaring a game done)

Devices: at least one **iOS Safari** and one **Android Chrome**, plus one older
mid-range phone if available.

- [ ] Hub loads over 4G in ≤ 2.5 s; illustrations readable at a glance, **and the
      grid does not shift as they arrive**.
- [ ] The hub grid appears **with JavaScript disabled**, and the same cards appear
      with it enabled. A console warning is *not* the signal here — see §1.1d for why,
      and for the observer-based check that is.
- [ ] **Share the link into a real chat app** (iMessage or WhatsApp) and check the
      preview shows the title, the sentence and the picture — not a bare URL.
- [ ] Join by link, by QR, and by typed code — all three work.
- [ ] Permission primer appears before the OS prompt; **denying** it lands on
      the declared fallback, not an error.
- [ ] Round plays correctly with 2 players, then with 4+.
- [ ] Lock the screen mid-round → unlock: state resynced, no ghost player.
- [ ] Switch app / background the tab → return: sensors resubscribed, countdown
      before resuming physical action.
- [ ] Kill wifi mid-round → reconnect: player rejoins the same seat.
- [ ] Host leaves: another player is promoted, round survives.
- [ ] "Play again" keeps the room and everyone in it.
- [ ] Screen doesn't sleep during a round (wake lock).
- [ ] No console errors; battery drop over 5 rounds is not alarming.
- [ ] Safety copy shown for motion and GPS games.

## 4. Local HTTPS

Motion, orientation, geolocation, mic and wake lock require a secure context, so
`http://<lan-ip>:5173` will **not** work on a phone. Use an HTTPS dev server
with a local certificate, or a tunnel, and document the chosen approach here
once validated.

## 5. Field testing

A party game is only proven in the field: at least one session with **real
people in one room** (and, for GPS games, outdoors) before a game leaves `beta`.
Write down what confused people — confusion is a `ui:` bug.

## 6. What an agent sandbox cannot check

The agent proxy blocks egress to our own hosts. `guigui.fr` and `*.workers.dev`
both fail at `CONNECT` with a 403. So an agent can build the site, run the
harness, and drive a local Chromium against `wrangler dev`. It cannot load the
deployed site.

**Do not test the deployed URLs, and do not retry them.** The block is the
environment's network policy, applied upstream of the container, so no permission
granted inside a session lifts it. A retry costs tokens and returns the same 403.
State it once if it is load-bearing for a claim; do not restate it.

The consequence is a rule about what may be *claimed*:

- **"It works in production" is second-hand.** It rests on the deploy workflow's
  output. Report it that way. If it matters, a human loads the URL.
- Same for anything only the live edge shows: real TLS, the CDN, the production
  `ALLOWED_ORIGINS`, cold-start latency on a real Durable Object.
- **GitHub is reachable only through the MCP tools.** `api.github.com` is *not*
  blocked at `CONNECT` — the tunnel opens and `/rate_limit` answers `200`. Every
  repo endpoint is then intercepted with a **403** carrying `"GitHub access is not
  enabled for this session"`. A raw `curl` therefore looks like it worked right up
  to the point where it matters, and a script that only checks whether the request
  *completed* reports "no runs found" instead of "not authorised". Use the MCP
  tools, and treat an empty result as unknown rather than green.

Measured 2026-08-04. `curl -sS "$HTTPS_PROXY/__agentproxy/status"` lists denials as
`connect_rejected` — the quickest way to tell a policy denial from a broken host.

**To lift it**, set the cloud environment's **Network access** to **Custom** and
list the four hosts under **Allowed domains** (tick *also include the default
package-manager list* to keep npm working). Behind the cloud icon above the message
box at claude.ai/code; applies to **new sessions**
([docs](https://code.claude.com/docs/en/cloud-environments#access-levels)):

```
fonygames.guigui.fr
fonygames-dev.guigui.fr
fonygames-worker.vguigui.workers.dev
fonygames-worker-dev.vguigui.workers.dev
```

Copied from [`shared/hosts.json`](../shared/hosts.json), which is where these live —
if the workers.dev subdomain is ever renamed again, this list is one of the things to
re-copy, and `api/tests/hosts_test.php` fails until it is.

In full rather than `*.workers.dev`: the Worker hostnames are two labels deep and
the documented wildcards cover one. It does **not** fix GitHub, whose proxy is
independent of the access level.

None of this blocks §1. It only bounds the last claim.
