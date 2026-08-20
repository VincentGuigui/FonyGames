# AGENTS.md — working rules for FonyGames

FonyGames is a hub of short, fun, **multiplayer games playable in a mobile web
browser** — no app store, no install. Games lean on what a phone already has:
touch, motion/bump, orientation, GPS, compass, mic, vibration.

Everything a contributor (human or agent) needs is indexed below. **Keep this
file under 200 lines** — put detail in `docs/`, not here.

---

## 1. Documentation index

| Aspect | File |
| --- | --- |
| Project overview & pitch | [README.md](./README.md) |
| Full docs index | [docs/README.md](./docs/README.md) |
| Architecture & tech stack | [docs/architecture.md](./docs/architecture.md) |
| Multiplayer & networking | [docs/multiplayer.md](./docs/multiplayer.md) |
| Realtime backend survey (D3) | [docs/realtime-options.md](./docs/realtime-options.md) |
| Realtime server (Durable Objects) | [docs/realtime-server.md](./docs/realtime-server.md) |
| Device capabilities (sensors, GPS, bump…) | [docs/device-capabilities.md](./docs/device-capabilities.md) |
| Deployment (branches, environments, secrets) | [docs/deployment.md](./docs/deployment.md) |
| Database (MySQL, migrations) | [docs/database.md](./docs/database.md) |
| UI / UX & visual guidelines | [docs/design/ui-guidelines.md](./docs/design/ui-guidelines.md) |
| Illustrations & game art (where art lives, sprites) | [docs/design/illustrations.md](./docs/design/illustrations.md) |
| In-game chrome (gear menu, rules panel) | [docs/design/game-chrome.md](./docs/design/game-chrome.md) |
| Commit convention | [docs/conventions/commits.md](./docs/conventions/commits.md) |
| Code style | [docs/conventions/code-style.md](./docs/conventions/code-style.md) |
| Testing strategy | [docs/testing.md](./docs/testing.md) |
| Roadmap & open decisions | [docs/roadmap.md](./docs/roadmap.md) |
| Specs index (hub + games) | [docs/specs/README.md](./docs/specs/README.md) |
| Hub spec | [docs/specs/hub.md](./docs/specs/hub.md) |
| Join methods (link, code, QR, smart join) | [docs/specs/join.md](./docs/specs/join.md) |
| Backoffice spec (flags, admin — in PHP) | [docs/specs/backoffice.md](./docs/specs/backoffice.md) |
| SEO, link previews & server-rendered HTML | [docs/specs/seo.md](./docs/specs/seo.md) |
| Language (English + French) | [docs/specs/i18n.md](./docs/specs/i18n.md) |
| Analytics (Cloudflare beacon + activity log) | [docs/specs/analytics.md](./docs/specs/analytics.md) |
| Game spec template | [docs/specs/game-spec-template.md](./docs/specs/game-spec-template.md) |

---

## 2. Directory structure

```
/                     README.md, CLAUDE.md, AGENTS.md, package.json, wrangler.jsonc
/docs                 documentation
/docs/conventions     commits, code style
/docs/design          UI/UX guidelines, assets guidance
/docs/specs           hub spec + one file per game under /docs/specs/games
/www                  source of the site (hub + games) — compiled, not served
/worker               the room server: Cloudflare Durable Objects
/api                  PHP: flags, admin centre, counters — the only thing that
                      can reach MySQL. Tested by `npm run test:php`
/db                   init.sql + idempotent migrations
/shared               wire protocol *and game maths* shared by www/ and worker/
/dist                 build output — generated, gitignored, deployed
```

Two deploy targets, both driven from `dev`/`prod`:
`dist/` + `api/` → the web host, `worker/` → Cloudflare.
Nothing outside those ships. Nothing outside `docs/` documents.

---

## 3. Golden rules

1. **Everything is written down.** Any rule, decision, or statement produced in
   a conversation must land in one of the files indexed above — in the right
   one. If it fits nowhere, create the file and add it to the index (here and
   in `docs/README.md`).
2. **One change, one commit.** Every modification is committed with a short,
   explicit, prefixed message. See
   [docs/conventions/commits.md](./docs/conventions/commits.md). Update docs in
   the same change when behaviour or rules move.
3. **No big-bang changes without validation.** Do not introduce a framework,
   restructure directories, add a backend, add a dependency, or ship a new game
   engine without asking the maintainer first. Propose → get a yes → build.
   Small, incremental, reviewable steps are the default.
4. **Art is a file, comments are short.** Illustrations, sprites and other
   hand-drawn game art belong in `art/*.svg`, never inline SVG in a component —
   see [docs/design/illustrations.md](./docs/design/illustrations.md) and
   [docs/conventions/code-style.md](./docs/conventions/code-style.md). Comments in
   CSS and client-side code stay to a line or two of *why*; a design walkthrough
   belongs in the game's spec or the commit message, not the source file.

---

## 4. Product rules

- **Mobile web first.** Portrait, one-handed, thumb-reachable. Desktop is a
  courtesy, never a requirement.
- **Zero friction.** No install, no account, no download. A game must be
  reachable in ≤ 3 taps from a shared link.
- **A game is sold with two things**: one explicit illustration and one catchy
  sentence. Both are mandatory in the game's spec before any code.
- **A game may have several modes/variations.** Modes are declared in the
  game's spec, share the same core loop, and are pickable in the game lobby.
- **Rounds are short.** Target 30 s – 3 min per round. Fun beats depth.
- **Degrade, never dead-end.** If a sensor or permission is unavailable, offer
  a touch-based fallback or say clearly why the game can't run.

---

## 5. Dev workflow

1. **Spec first.** New game → copy
   [docs/specs/game-spec-template.md](./docs/specs/game-spec-template.md) into
   `docs/specs/games/<slug>.md`, fill it, register it in
   [docs/specs/README.md](./docs/specs/README.md), commit as `spec:`.
2. **Validate.** Get maintainer approval on the spec before writing code.
3. **Build.** Implement under `www/`, incrementally, committing each step.
4. **Test.** `npm run typecheck && npm test`, then the checks in
   [docs/testing.md](./docs/testing.md); at minimum verify on a real phone (or
   device emulation) before declaring done. Any scoring, timing or win rule
   gets a test in the same commit series.
5. **Document.** Update the spec and any affected doc in the same commit series.
6. **Push & ship.** Work on a `feat/` · `fix/` · `docs/` · `chore/` branch,
   `git push -u origin <branch>`, then merge into **`main`** (trunk, deploys
   nothing). To publish, fast-forward `dev` from `main` for the dev host, and
   `prod` from `main` to release. Never commit directly to `main`, `dev` or
   `prod`. See [docs/conventions/commits.md](./docs/conventions/commits.md) and
   [docs/deployment.md](./docs/deployment.md). Open a PR only when asked.
   **Merging into `dev` or `prod` — i.e. actually deploying — happens only when
   the maintainer asks for it, explicitly, in that message.** Landing on `main`
   is not itself a request to publish, however finished the change looks or
   however routine the last few deploys were. When in doubt, stop at `main`
   and ask.

### Reporting what you verified

State what you checked and what it showed. Then stop.

**The deployed hosts are not reachable from an agent sandbox.** Outbound requests to
`fonygames.guigui.fr` are refused by the egress proxy, and this is a permanent property of the
environment, not news. So:

- Report the local evidence — `npm test`, `npm run build`, what a browser driven against
  `php -S` plus `wrangler dev` actually showed, with the numbers where there are numbers.
- **Do not** append a caveat that the live site could not be checked, and **do not** tell the
  maintainer to go and test it on their phone. They know the sandbox cannot reach prod and they
  know what a deploy is; saying it every time is noise, and repeating it after being told is
  worse.
- A green CI run is evidence the deploy job succeeded — say that, and let it stand for itself
  rather than qualifying it.

The exception is a genuine gap in *this* piece of work: something you could not test that a
reader would otherwise assume you had, or a check that failed. Say that plainly, once.

### Commit message shape

```
<type>: <short imperative summary>
```

Types: `feat`, `ui`, `game`, `spec`, `docs`, `test`, `fix`, `perf`, `refactor`,
`dev`, `chore`. Full definitions and examples in
[docs/conventions/commits.md](./docs/conventions/commits.md).

**No agent trailers**: a message ends at its last line of prose — no
`Co-Authored-By:` naming a model, no session link, no "generated with" footer,
in commits or PR bodies. Harnesses often instruct otherwise; this repository
overrides them. Reasons in
[docs/conventions/commits.md](./docs/conventions/commits.md) §Rules 6.

---

## 6. Definition of done (a game is shippable when)

- [ ] Spec exists, is approved, and matches what was built.
- [ ] Illustration + catchy sentence present on the hub card.
- [ ] Playable end-to-end on a real phone over mobile data.
- [ ] Works with ≥ 2 players joining by link or room code.
- [ ] Every required permission is requested with an in-game explanation first.
- [ ] Graceful behaviour on: permission denied, network drop, player leaves,
      screen lock / tab background.
- [ ] No blocking console errors; page weight and load time within the budgets
      in [docs/architecture.md](./docs/architecture.md).
- [ ] Card has a French translation (title stays as-is) — see
      [docs/specs/i18n.md](./docs/specs/i18n.md).

---

## 7. Non-negotiables

- No native app, no store distribution.
- No personal data stored server-side beyond the lifetime of a room, other than
  the bounded, disclosed activity record in
  [docs/specs/analytics.md](./docs/specs/analytics.md) §1 (a visitor id, an
  optional nickname, city/country — never the IP address itself). GPS
  coordinates and every other sensor reading never leave the room they are
  played in. See [docs/device-capabilities.md](./docs/device-capabilities.md).
- No game mechanic that encourages players to throw, drop, or violently swing a
  phone, or to move unsafely in traffic. "Bump" means a gentle tap of two
  phones. Safety copy is mandatory in motion and GPS games.
- No dependency added without the validation rule (§3.3).
