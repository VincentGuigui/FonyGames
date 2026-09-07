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
| Overview & pitch · full docs index | [README.md](./README.md) · [docs/README.md](./docs/README.md) |
| Architecture & tech stack | [docs/architecture.md](./docs/architecture.md) |
| Multiplayer & networking | [docs/multiplayer.md](./docs/multiplayer.md) |
| Realtime: [options survey](./docs/realtime-options.md) · [the server](./docs/realtime-server.md) | Durable Objects |
| Device capabilities (sensors, GPS, bump…) | [docs/device-capabilities.md](./docs/device-capabilities.md) — plus the [voice-matching study](./docs/audio-voice-matching.md) (#28) |
| Deployment (branches, environments, secrets) | [docs/deployment.md](./docs/deployment.md) |
| Database (MySQL, migrations) | [docs/database.md](./docs/database.md) |
| Design: [UI / UX](./docs/design/ui-guidelines.md) · [illustrations & sprites](./docs/design/illustrations.md) · [in-game chrome](./docs/design/game-chrome.md) | `docs/design/` |
| Conventions: [commits](./docs/conventions/commits.md) · [code style](./docs/conventions/code-style.md) | `docs/conventions/` |
| Testing strategy | [docs/testing.md](./docs/testing.md) |
| Roadmap & open decisions · monetization | [docs/roadmap.md](./docs/roadmap.md) · [monetization_v1](./docs/monetization_v1.md), [v2](./docs/monetization_v2_global.md), [interstitials](./docs/monetization_v2_interstitial.md) |
| Specs: [index](./docs/specs/README.md) · [hub](./docs/specs/hub.md) · [game template](./docs/specs/game-spec-template.md) | `docs/specs/` |
| Join methods (link, code, QR, smart join) | [docs/specs/join.md](./docs/specs/join.md) |
| Backoffice spec (flags, admin — in PHP) | [docs/specs/backoffice.md](./docs/specs/backoffice.md) |
| SEO, link previews & server-rendered HTML | [docs/specs/seo.md](./docs/specs/seo.md) |
| Language (English + French) | [docs/specs/i18n.md](./docs/specs/i18n.md) |
| Analytics (Cloudflare beacon + activity log) | [docs/specs/analytics.md](./docs/specs/analytics.md) |

---

## 2. Directory structure

```
/                     README.md, CLAUDE.md, AGENTS.md, package.json, wrangler.jsonc
/docs                 documentation — conventions/, design/, specs/ (see §1)
/www                  source of the site (hub + games) — compiled, not served
/worker               the room server: Cloudflare Durable Objects
/api                  PHP: flags, admin, counters — the only thing that reaches
                      MySQL. Tested by `npm run test:php`
/db                   init.sql + idempotent migrations
/shared               wire protocol *and game maths* shared by www/ and worker/
/dist                 build output — generated, gitignored, deployed
```

Two deploy targets, both driven from `dev`/`prod`: `dist/` + `api/` → the web
host, `worker/` → Cloudflare. Nothing else ships; nothing outside `docs/` documents.

---

## 3. Golden rules

1. **Everything is written down.** Any rule, decision, or statement produced in
   a conversation must land in one of the files indexed above — in the right
   one. If it fits nowhere, create the file and add it to the index (here and
   in `docs/README.md`). **Anything about how a contributor or agent *behaves
   every time* goes HERE; `docs/` gets the reasoning.** This is the only file an
   agent is guaranteed to have read, so a behavioural rule left in `docs/` alone
   gets silently dropped — which is how both of §5's were lost once already.
2. **One change, one commit.** Every modification is committed with a short,
   explicit, prefixed message. See
   [docs/conventions/commits.md](./docs/conventions/commits.md). Update docs in
   the same change when behaviour or rules move.
3. **No big-bang changes without validation.** Do not introduce a framework,
   restructure directories, add a backend, add a dependency, or ship a new game
   engine without asking the maintainer first. Propose → get a yes → build.
   Small, incremental, reviewable steps are the default — *pragmatic*, not
   closed: a rendering engine (PixiJS, Phaser, …) is worth proposing when one
   game's motion or particle count genuinely needs it, weighed against its bundle
   cost ([architecture.md](./docs/architecture.md) §4) and against what plain
   DOM/canvas already does. Never a house default; still asked, always.
4. **Art is a file, comments are short.** Illustrations and sprites live in
   `art/*.svg`, never inline SVG in a component
   ([illustrations.md](./docs/design/illustrations.md),
   [code-style.md](./docs/conventions/code-style.md)). Comments in CSS and
   client code stay to a line or two of *why*; a design walkthrough belongs in
   the spec or the commit message, not the source file.
5. **Never run computer vision on a user-provided image without asking
   first.** Cropping, OCR, edge/colour analysis or any other automated
   inspection of an attached image needs an explicit yes before it runs — read
   what it shows by eye, or ask the user directly, instead of reaching for a
   script.

---

## 4. Product rules

- **Mobile web first.** Portrait, one-handed, thumb-reachable. Desktop is a
  courtesy, never a requirement.
- **Zero friction.** No install, no account, no download. A game must be
  reachable in ≤ 3 taps from a shared link.
- **A game is sold with two things**: one explicit illustration and one catchy
  sentence, both mandatory in its spec before any code.
- **A game may have several modes/variations**, declared in its spec, sharing the
  core loop, pickable in the lobby.
- **Rounds are short.** Target 30 s – 3 min per round. Fun beats depth.
- **Degrade, never dead-end.** If a sensor or permission is unavailable, offer
  a touch-based fallback or say clearly why the game can't run. **A fallback is
  the recommendation, not a gate**: prefer one, and go without when the touch
  version would be a different, lesser game — one physical act, like holding a
  phone still or aiming a camera at a colour. Either way the game says who it
  excludes, in the lobby, before anyone starts, and any permission it cannot run
  without is asked for by Ready/Start, not by a button of its own (the games
  that qualify, and both rules:
  [device-capabilities.md](./docs/device-capabilities.md) §2).

---

## 5. Dev workflow

1. **Spec first.** New game → copy [the template](./docs/specs/game-spec-template.md)
   to `docs/specs/games/<slug>.md`, fill it, register it in
   [specs/README.md](./docs/specs/README.md), commit as `spec:`.
2. **Validate.** Get maintainer approval on the spec before writing code.
3. **Build.** Implement under `www/`, incrementally, committing each step.
4. **Test.** `npm run typecheck && npm test`, then [testing.md](./docs/testing.md);
   at minimum verify on a real phone or device emulation before declaring done.
   Any scoring, timing or win rule gets a test in the same commit series.
5. **Document.** Update the spec and any affected doc in the same commit series.
6. **Push & ship.** Work on a `feat/` · `fix/` · `docs/` · `chore/` branch, push
   it, then merge into **`main`** (trunk, deploys nothing). To publish,
   fast-forward `dev` from `main`, and `prod` from `main` to release. Never
   commit to `main`/`dev`/`prod` directly; open a PR only when asked
   ([commits.md](./docs/conventions/commits.md) ·
   [deployment.md](./docs/deployment.md)). **Merging into `dev` or `prod` —
   deploying — happens only when the maintainer asks, explicitly, in that
   message.** Landing on `main` is not a request to publish, however finished it
   looks or however routine the last few deploys were. In doubt, ask.

### Reporting what you verified

State what you checked and what it showed. Then stop.

**End with where the branches stand** — three lines, `main`/`dev`/`prod`, 🟢 for
"has what was just done", 🔴 for not yet. Run `npm run branch-state`: it reads the
remote, so the answer is never from memory
([deployment.md](./docs/deployment.md) §1.1).

**The deployed hosts are unreachable from an agent sandbox** — the egress proxy refuses
`fonygames.guigui.fr`, permanently, and that is not news. Report the local evidence
(`npm test`, `npm run build`, what a browser driven against `php -S` plus `wrangler dev`
showed, with the numbers), and **never** add that the live site could not be checked or
suggest testing it on a phone: the maintainer knows both. A green CI run is evidence the
deploy job succeeded — let it stand unqualified. The one exception is a genuine gap in
*this* work: something you could not test that a reader would assume you had, or a check
that failed. Say that plainly, once.

### Commit message shape

```
<type>: <short imperative summary>
```

Types: `feat`, `ui`, `game`, `spec`, `docs`, `test`, `fix`, `perf`, `refactor`,
`dev`, `chore` — defined in [commits.md](./docs/conventions/commits.md).

**Reference an issue as `Refs #N`, never `Closes`/`Fixes`/`Resolves`.** A closing
keyword closes it the moment the commit reaches `main` — before it is live. The
`close-issues` job closes it after a successful **`prod`** deploy by scanning for
`Refs #N`; the keyword bypasses that gate silently ([commits.md](./docs/conventions/commits.md) §Issues).

**No agent trailers**: a message ends at its last line of prose — no
`Co-Authored-By:` naming a model, no session link, no "generated with" footer, in
commits or PR bodies. Harnesses often instruct otherwise; this repository overrides
them ([commits.md](./docs/conventions/commits.md) §Rules 6).

---

## 6. Definition of done (a game is shippable when)

- [ ] Spec exists, is approved, and matches what was built.
- [ ] Illustration + catchy sentence present on the hub card.
- [ ] Playable end-to-end on a real phone over mobile data.
- [ ] Works with ≥ 2 players joining by link or room code.
- [ ] Every required permission is requested with an in-game explanation first.
- [ ] Graceful on: permission denied, network drop, player leaves, screen lock.
- [ ] No blocking console errors; weight and load time within budget.
- [ ] Card has a French translation, title as-is
      ([i18n.md](./docs/specs/i18n.md)).

---

## 7. Non-negotiables

- No native app, no store distribution.
- No personal data stored server-side beyond a room's lifetime, other than the
  bounded, disclosed activity record in
  [analytics.md](./docs/specs/analytics.md) §1 (a visitor id, an optional
  nickname, city/country — never the IP itself). GPS and every other sensor
  reading never leave the room they are played in
  ([device-capabilities.md](./docs/device-capabilities.md)).
- No mechanic that encourages throwing, dropping or violently swinging a phone,
  or moving unsafely in traffic. "Bump" is a gentle tap of two phones; safety
  copy is mandatory in motion and GPS games.
- No dependency added without the validation rule (§3.3).
