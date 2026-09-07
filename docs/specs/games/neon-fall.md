# Neon Fall

> Status: **live**. Built on a plain `<canvas>` — the PixiJS question in §13
> was measured, not estimated, and the answer was no — and verified end to
> end in the browser: lobby, seat picker, tilt primer, the canvas round, both
> win paths, and the results screen. The tap-zone fallback that verification
> covered was removed on 2026-09-05 (§5).

| | |
| --- | --- |
| **Slug** | `neon-fall` |
| **Catchy sentence** | *Dodge five lanes of neon fire, or shoot down what falls* |
| **Illustration** | `www/src/games/neon-fall/art/card.svg` — a cyan diamond-shaped glider mid-fall between two magenta bolts, dark navy sky, faint upward-streaking stars |
| **Players** | 2 — exactly |
| **Round length** | ~20–45 s of falling, plus up to 3×1.5 s of bounce stalls if the glider is hit |
| **Inputs** | orientation (tilt) for the glider · touch for the protector |
| **Accent colour** | `#22D3EE` cyan for the glider — and `#F72585` magenta for the protector's bolts |
| **Status** | live — plain `<canvas>` (§13) |

## 1. Pitch

One shared, vertical playfield: a night sky at the top, a floor at the
bottom, five lanes between them nobody draws a line around. One player is a
glowing glider, tilting their phone to drift smoothly from lane to lane as
they fall. The other is planted at the bottom with five triggers, one per
lane, trying to shoot the glider down before it lands.

No score, no clock ticking down in the corner — just a fall that ends one of
two ways, and both players watching the same lanes for opposite reasons.

## 2. Core loop

1. The host assigns roles: one player is the **glider**, the other is the
   **protector** (§4 — this is a host control, not a coin flip).
2. A four-second rules panel, first round only
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4).
3. The glider starts at the top, in the centre lane, and begins falling at a
   constant rate. Tilting the phone left or right smoothly slides it toward
   the neighbouring lane (§5); left alone, it settles into whichever lane it
   is currently closest to rather than drifting wherever the last tilt left
   it (§2.4).
4. The protector has five triggers, one aligned under each lane. Tapping one
   fires a bolt that rises up that lane, visible on both screens, and takes
   `NEON_BOLT_MS` to reach the top. Each lane cools down on its own for
   `NEON_LANE_COOLDOWN_MS` after firing; up to `NEON_MAX_BOLTS` may be in
   flight at once, across all five lanes combined (§2.2).
5. **A bolt hits if the glider is still in that bolt's lane when the bolt
   arrives.** The glider can juke by changing lanes while the bolt is in
   flight — the travel time is what makes tilting a lane an actual dodge and
   not just steering.
6. A hit costs the glider **one of three lives**, and triggers a bounce
   (§2.3): a 1.5 s parabolic hop to a random lane, a little higher up than it
   was, blinking and untouchable for the duration.
7. **The glider wins** by reaching the floor with at least one life left.
   **The protector wins** by taking the glider's third life first.

**Win condition:** as above — no draw is possible; a tie on the very tick
both would occur is broken in §7.
**Scoring:** none. Win or lose, nothing else is recorded.

### 2.1 Why the lanes are invisible but not unmarked

The pitch calls the five lanes invisible, meaning there is no rule that
carves the sky into corridors — the glider's position is really a continuous
value, smoothly eased toward whichever of five lane centres the tilt points
at. But *unmarked* is a different claim, and this spec does not make it: a
player with no visual reference for where lane 3 ends and lane 4 begins
cannot judge whether they have actually cleared a bolt's lane. So each lane
gets a thin, low-opacity neon guide rail, visible but clearly secondary to
the glider and the bolts. This is a UX call, not a rules change, and it is
flagged as one in §13 in case the maintainer wants the lanes kept literally
invisible for the atmosphere instead.

### 2.2 Every lane cools down on its own

No shared ammo pool: each of the five triggers has its own
`NEON_LANE_COOLDOWN_MS` cooldown, started the instant that lane fires and
nobody else's business. A protector can therefore fire two different lanes
back to back with no penalty — the decision that matters is which lane, not
how to ration a shared burst.

The real limiter is `NEON_MAX_BOLTS`: at most that many bolts may be in
flight at once, summed across every lane. Without it, five lanes each
cooling down independently every second could keep the sky permanently
full — this is what stops a protector from just holding all five lanes
down.

### 2.3 The bounce is protection, not punishment

Immediately re-hitting a glider that just lost a life would let one lucky
volley end the round in a blink, so a hit forces:

- A random lane (any of the five, including the one it was already in —
  simplicity over a "never the same lane twice" rule that adds a case
  without adding anything a player would notice).
- A rise in fall-progress (`NEON_BOUNCE_RISE`), so a hit costs the protector
  some of their own progress toward letting the glider reach the floor —
  the glider trades a life for lost ground, not a life for nothing.
- 1.5 s (`NEON_BOUNCE_MS`) of blinking invulnerability, during which no bolt
  can resolve against it — impossible by construction (§7), the same
  guarantee Steady Hand's grace window makes for its own lives.

Tilt is still read during the bounce, so the glider is not steering blind —
the moment the bounce ends, the current tilt takes over from wherever the
scripted arc put it down, same as landing after a jump.

### 2.4 The glider is pulled toward the lane it is closest to

Tilt is a velocity, not a position — nothing before this section stops a
glider that lets go of the tilt from just sitting between two lanes,
half in each. So idle drift is not "nothing," it is a spring: whichever
lane the glider currently sits closest to pulls it toward that lane's own
centre, proportional to how far off it is, so it settles rather than
overshoots and oscillates around the centre.

That pull is dropped outright — not just outweighed — the moment the tilt
itself points toward a *different* lane past a small deadzone
(`NEON_STEER_DEADZONE`, so sensor noise near neutral cannot cancel it by
accident). A deliberate tilt away from the current lane has to actually
cross it undiminished; the lane's own magnetism only ever helps a glider
settle into a lane, never traps it in one against the player's own intent.
A guess (spec §12) for both new constants, needs a playtest.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch. Recorded, not built:

| Idea | Difference |
| --- | --- |
| `sudden-fall` | One life. No bounce — the first hit ends it |
| `blackout` | The lane guides (§2.1) are off; genuinely invisible lanes |
| `swap` | Roles swap each round in a best-of-N match, rather than staying fixed all night |

## 4. Screens

- **Lobby**: shared template, plus a host-only role picker — two seats,
  glider and protector, the host taps a player into each (mirrors
  [cat-and-mouse.md](cat-and-mouse.md) §6's host-picked drag mode: a setting
  the host owns, not a vote). Start is disabled until both seats are filled.
- **Round — shared playfield, drawn the same way on both phones**: dark navy
  sky, faint neon stars drifting upward at different speeds and depths
  (parallax, purely decorative), five faint lane guides (§2.1), the glider as
  a glowing geometric shape falling from the top, bolts as randomly-shaped
  neon shots (cosmetic variety only — no shape carries meaning) rising from
  the bottom. Same device Cat and Mouse's floor uses: one board, everyone
  sees the same thing, roles change what you do with it, not what you see of
  it. Lives (3, as pips **and** a number) sit top-corner for the glider; the
  protector's own corner instead shows how many bolts are currently in
  flight out of `NEON_MAX_BOLTS` — there is no ammo count left to show now
  that no shared pool exists (§2.2), and each trigger dims on its own the
  instant it fires, back to normal `NEON_LANE_COOLDOWN_MS` later.
- **A bolt in flight**: telegraphed the instant it is fired — both screens
  show it rising immediately, giving the glider the full `NEON_BOLT_MS` to
  react. A bolt with no warning would not be a dodge, it would be a coin
  flip.
- **A bounce**: the glider blinks and arcs to its new lane; a small
  "−1 life" beat, brief, not full-screen — this happens mid-round and the
  fall does not pause for it.
- **Results**: winner, and how — *"reached the floor"* or *"shot down, N
  lives left when it landed would have been M s"* is over-specifying; keep it
  to *"shot down"* — plus a rematch button that offers swapping roles.

## 5. Inputs & sensors

**Glider**: `DeviceOrientationEvent`, through `core/sensors`, following
[device-capabilities.md](../../device-capabilities.md) §4 exactly: calibrated
at round start (the four-second rules panel doubles as the "hold your phone
how you like" moment), low-pass filtered, sampled at device rate but acted on
at ≤ 60 Hz and transmitted at ≤ 20 Hz. The phone never reports a position —
only a steer intention (§6) — so §4's throttling is a bandwidth saving, not a
trust boundary; the trust boundary is that the server never uses the raw
value as a position in the first place.

**Protector**: touch — five real buttons, one per lane, styled like Squash
Mosquitoes' always-mounted cells rather than one canvas hit-testing five
zones by hand, for the same free accessibility win (native tap targets,
`aria-label` per lane, no hand-rolled hit-testing).

**There is no fallback, and that is a decision rather than an omission.** This
game shipped with two large held zones for the glider — left and right half of
their own screen, driving the same continuous −1..1 intent — and they have been
removed. The maintainer's call, on 2026-09-05: the *feel* of tilting is the
game, and a held zone kept the lane-to-lane mechanic while losing it. Neon Fall
joins Steady Hand, Shake Rush, UFO Hunt and Asteroid Race as a game that names
who it excludes instead of shipping a fallback it does not believe in — the
exception [AGENTS.md](../../../AGENTS.md) §4 now records by name.

**Tilt is asked for by Ready, or by Start for the host**
([device-capabilities.md](../../device-capabilities.md) §2 rule 3,
[issue #29](https://github.com/VincentGuigui/FonyGames/issues/29)), never on
arrival — and a refusal **blocks**, for both seats. Both, not just the glider's,
and that is the awkward part worth stating: the protector never tilts, so in
principle a phone with no orientation could hold that seat perfectly well. But
the host can swap the seats (§4), so a player who refused as protector would be
handed the glider with nothing to fly it with. Blocking both is the honest
version of a game where either player might end up needing it.

| Missing | Behaviour |
| --- | --- |
| Orientation denied / unavailable | Ready and Start block for that phone, either seat, with the reason in the lobby panel and a Try again |

## 6. Networking

The server is authoritative for the glider's actual lane, fall progress,
lives, and every hit — the same posture Steady Hand takes with wobble and
Cat and Mouse's `capped` mode takes with position: a phone reports *intent*,
never the outcome.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `neon-steer` | glider → server | `{roundId, steer}` (−1..1) | Calibrated, filtered tilt intent, sent every tick regardless of change |
| `neon-shoot` | protector → server | `{roundId, lane}` (0–4) | A trigger tap; the server checks that lane's own cooldown and the shared `NEON_MAX_BOLTS` cap itself |
| `neon` | server → both | `{roundId, startsAt, endsAt, gliderId, protectorId, lane, y, lives, bounceUntil, laneReadyAt, bolts, winner, phase}` | The whole round, every tick — same call as `GridState`/`SquashState`: small enough to send whole, so there is nothing to diff. `laneReadyAt` is five server times, one per lane, replacing the old shared `ammo`/`cooldownUntil` pair |

As built, this collapsed to three messages rather than the six first sketched
here: `bounceUntil` (an absolute server time, like every other deadline on
this wire) is enough for a client to blink while bouncing, and `bolts`
already carries what a `neon-bolt` event would have — there was nothing left
for a separate `neon-hit`/`neon-end` to say that `lives`, `winner` and
`phase` inside the one state frame did not already cover.

The server steps the glider's lane position each tick toward `steer` at
`NEON_LANE_SPEED`, and its fall progress at `NEON_FALL_SPEED` — the smooth
interpolation the pitch asks for is a server-side simulation the client only
ever renders, never a client-reported position the server takes on faith.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Protector disconnects | No one left to shoot; the glider falls unopposed and wins when it lands — there is no game without a protector |
| Glider disconnects | The protector wins by default — there is no game without a glider |
| Tab backgrounded, glider | Tilt events stop → the server just holds the last reported steer. A near-zero steer lets the magnet (§2.4) settle it into whichever lane it was closest to; a held, opposing steer keeps carrying it same as it would have moving. Either way an easy target, the honest outcome, same call Cat and Mouse makes for a mouse that stops |
| Tab backgrounded, protector | Triggers simply cannot be tapped; the fall continues regardless |
| A hit lands during the bounce's invulnerability | Impossible by construction — the server ignores any bolt whose `resolvesAt` falls inside a glider's own `bounceUntil` window |
| The glider reaches the floor on the same tick a bolt resolves against it | The bolt resolves first. It was fired, and in flight, before the glider actually crossed the line — causally it arrives in time to stop the landing, so the protector wins the tie |
| Fewer than 2 players, or a seat unfilled in §4's role picker | Start disabled |
| A player refreshes mid-round | Same seat, same state; the server did not stop simulating while they were gone |

## 8. Anti-cheat

Same posture as Steady Hand's wobble and Cat and Mouse's `capped` mode,
stated plainly rather than implied:

- **The glider's phone never reports a position, only a steer intention** —
  the server integrates that into an actual lane position at a server-owned
  speed (`NEON_LANE_SPEED`). A modified client cannot claim to be in a safe
  lane; it can only ask to move toward one, at the one speed everyone moves
  at.
- **Every hit is resolved server-side**, against the server's own tracked
  lane and invulnerability state — never against whatever the protector's or
  the glider's client claims. Neither client can award or refuse its own
  hit.
- **Every lane's own cooldown, and the shared in-flight cap, are tracked
  server-side.** A protector client claiming a shot before that lane's own
  `NEON_LANE_COOLDOWN_MS` has elapsed, or once `NEON_MAX_BOLTS` are already
  up, is simply not given one; the server owns both counts, not the
  client's UI state.

## 9. Safety

Low risk: the phone is held and tilted gently, nothing is thrown, swung, or
requires standing up. Both players can play seated, side by side or across a
table.

## 10. Data & privacy

Leaves the phone: a steer value (−1..1) at ≤ 20 Hz, discrete trigger taps
with a lane index, player id, name, avatar. Never a raw orientation stream,
never a position. Room memory only, for the life of the round.

## 11. Accessibility

- **There is no tilt fallback, and the lobby says so before anyone starts**
  (§5). This is the accessibility cost of the 2026-09-05 decision, stated
  rather than hidden: a player who cannot tilt their phone cannot take either
  seat in this game. The protector's own controls are five real buttons with
  per-lane labels, so the seat itself is reachable — it is the seat swap that
  makes tilt a requirement for both.
- Lives are **numbers as well as pips** — never colour or count alone; the
  protector's own in-flight count (§4) is likewise plain text.
- The glider and the bolts differ in **shape as well as colour** (a
  consistent glider silhouette against randomly-shaped bolts), so the two
  roles read apart for a colourblind player without relying on cyan vs
  magenta.
- The bounce's blink and parabolic arc fade to a simple, non-flashing cross-
  fade under `prefers-reduced-motion` — the lane change and life loss still
  read clearly, just without the motion.
- No strobing anywhere; a hit is a beat, not a flash.

## 12. Open questions

- **Every numeric constant here is a guess** — `NEON_LANE_SPEED`,
  `NEON_LANE_MAGNET_GAIN`, `NEON_STEER_DEADZONE`, `NEON_FALL_SPEED`,
  `NEON_LANE_COOLDOWN_MS`, `NEON_MAX_BOLTS`, `NEON_BOLT_MS`, and
  `NEON_BOUNCE_RISE` all need a playtest, the same honest flag Steady Hand's
  §2.1 raises for its own numbers. In particular `NEON_BOLT_MS` is a real
  balance lever: too short and dodging is unfair to the glider, too long and
  the protector cannot land a shot on anyone paying attention.
- **Is a 1.5 s bounce too long or too short** to feel fair rather than
  tedious over three hits in one round?
- **Should the lane guides (§2.1) be a toggle**, so a room that wants the
  atmosphere of genuinely invisible lanes can turn them off — this is what
  `blackout` in §3 sketches, but it is not decided whether that is a mode or
  a display setting.
- **Is 2 players the whole game, or does it want a spectator queue** for a
  room bigger than two, the way Steady Hand's eliminated players become
  spectators? Nothing here currently gives a third player anything to do.

## 13. Rendering: the PixiJS question, measured and closed

This was flagged as a separate approval from the design, specifically so it
would not get bundled into a single yes by accident, with a concrete next
step: build the smallest possible throwaway import and measure it against
the real budget before writing any game code against it. That measurement
happened, and it settles the question.

**The spike:** a throwaway Vite entry importing only
`{ Application, Container, Graphics }` from `pixi.js` — the exact minimal
surface this game would use — built through the project's real pipeline and
measured the same way [architecture.md](../../architecture.md) §4 measures
everything else: gzipped, on disk, after minification.

**The result:** **~221 KB gzipped**, not the ~120 KB the full package's own
reported size suggested before anything was actually built. `pixi.js`'s
top-level entry point does not tree-shake the way importing three named
exports implies — `Application`'s default init path pulls in the WebGL
renderer, the WebGPU renderer, the canvas fallback renderer, browser
capability detection, and web-worker support, all at once, because it does
not know ahead of time which one the device will pick. Rollup chunks it
into a dozen pieces (`WebGLRenderer`, `WebGPURenderer`, `CanvasRenderer`,
`RenderTargetSystem`, `browserAll`, `webworkerAll`, and more), but none of
that is dead code by the bundler's own analysis — it is all reachable from
the three names that were imported.

**That alone is roughly 1.5× this game's entire ≤ 150 KB gzipped budget**,
before a single line of Neon Fall's own game code, its art, or the shared
chrome (`RoomGate`, `RulesPanel`, `GameOver`) it still needs. Reaching past
the documented public API into PixiJS's individual renderer-only submodule
paths might shrink this, but that is not how the library is meant to be
consumed, is fragile across its own version bumps, and would itself be a
second, bigger thing to propose and validate — not a tuning knob to reach for
quietly to make a number fit.

**Decision: plain `<canvas>` with `requestAnimationFrame`**, the same
approach Grid Attack and Spill already use. It delivers every visual beat
this spec describes — the drifting stars, the glowing glider, telegraphed
bolts, the parabolic bounce — with more hand-rolled drawing code and no
scene graph, for a fraction of the payload. The pragmatic case-by-case
policy this spike was testing worked exactly as intended: it said yes to
measuring, and the measurement said no.
