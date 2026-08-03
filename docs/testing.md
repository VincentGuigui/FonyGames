# Testing

> Status: a **logic harness runs today** (`npm test`). A general test framework
> is still an open choice — see §1.1 and [roadmap.md](roadmap.md).

Sensors, permissions and multi-device timing cannot be fully faked. So: automate
what is deterministic, and keep a short, ruthless manual pass for the rest.

## 1. Layers

| Layer | Scope | Tool |
| --- | --- | --- |
| Unit | Pure logic: bump detection on recorded sample data, scoring, timers, room-code generation, geo maths | **`npm test`** today; Vitest proposed |
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

### 1.2 End-to-end against a real Worker

The harness proves the referee. It cannot prove that `Room.ts` routes to it, that
the wire types survive `JSON.stringify`, or that a refresh really reclaims a
seat. For that, connect real `WebSocket`s (Node has one built in) to
`wrangler dev` and play a round.

Two traps that have already cost time:

- **Kill any stale `wrangler`/`workerd` by PID before starting.** A leftover on
  8787 answers `/health` happily and you will test the previous build.
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

For browser-level checks, Chromium is preinstalled but Playwright is not, and
headless Chrome **ignores `--window-size`** — it renders at 500px and crops,
which looks exactly like a CSS overflow bug. Drive it over CDP and set
`Emulation.setDeviceMetricsOverride` explicitly, and call `Page.bringToFront`
before a screenshot or a backgrounded tab never composites and the capture
hangs.

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

## 3. Manual device checklist (run before declaring a game done)

Devices: at least one **iOS Safari** and one **Android Chrome**, plus one older
mid-range phone if available.

- [ ] Hub loads over 4G in ≤ 2.5 s; illustrations readable at a glance.
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
