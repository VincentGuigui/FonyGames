# Testing

> Status: strategy agreed, tooling **not yet installed** (needs validation —
> see [roadmap.md](roadmap.md)).

Sensors, permissions and multi-device timing cannot be fully faked. So: automate
what is deterministic, and keep a short, ruthless manual pass for the rest.

## 1. Layers

| Layer | Scope | Tool (proposed) |
| --- | --- | --- |
| Unit | Pure logic: bump detection on recorded sample data, scoring, timers, room-code generation, geo maths | Vitest |
| Contract | Client/server message schemas, round state machine | Vitest against an in-process server |
| End-to-end | Two simulated players joining a room, playing a round, results | Playwright (Chromium, mobile emulation), synthetic sensor events |
| Manual | Real phones, real permissions, real network | The checklist in §3 |

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
