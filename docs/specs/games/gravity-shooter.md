# Gravity Shooter

| | |
| --- | --- |
| **Slug** | `gravity-shooter` |
| **Catchy sentence** | *Bend your shot around a planet and blow up their ship* |
| **Illustration** | `www/src/games/gravity-shooter/art/card.svg` — a missile mid-flight, its dashed trail curving hard around a planet toward a ship at the top of frame |
| **Players** | 2 — exactly |
| **Round length** | 1–3 min |
| **Inputs** | touch (aim above the ship, release) |
| **Accent colour** | `#818CF8` |
| **Status** | 🎮 beta — gravity strength and hit radius untested on real thumbs |

## 1. Pitch

Two starships, one at the bottom of your screen, one at the top. Between
them, two planets — same for both players, always on opposite sides of the
board, placed at random when the match starts. Touch above your ship to aim
toward your finger, let go, and your missile curves under the planets' own
gravity on its way across the board — bigger planets pull harder. Land a hit
and the other ship loses a life; run them out of five and you win. No score,
no rounds — just landing the shot.

## 2. Core loop

One shared canonical board: **planet positions never change for the whole
match, only which player is aiming does.** Each phone always draws itself
at the bottom and the opponent at the top — the same board, rotated per
viewer, never two different boards.

1. Host starts the round. Two planets are placed once, at random positions
   and sizes, identical on both screens (§2.1). Ships are fixed near their
   own edge and never move.
2. Turns strictly alternate, host first. On your turn, touch above your own
   ship — the finger's own position relative to the ship sets your shot's
   angle and strength; the missile fires toward wherever your finger is,
   like a targeting reticle, not away from it like a slingshot.
3. While your finger is down, a dashed preview of the shot's own path is
   shown, fully visible only near your own ship, fading to nothing by the
   middle of the screen (§2.2) — a rough read on your own aim, never a
   look at the whole shot.
4. Release, and the missile flies, curving under both planets' gravity,
   for up to 10 seconds of flight before an unresolved shot is abandoned
   outright.
5. A hit costs the other ship one of five lives. A miss — the missile
   either drifts off the board or is swallowed by a planet — costs
   nothing, and the turn simply passes.
6. First ship to 0 lives loses.

**Win condition:** the opponent's fifth life reaches 0.
**Scoring:** none. The result panel says only **Win** or **Lose** (§4).

### 2.1 The planets: rolled once, shared by construction

Exactly 2 planets, `{ x, y, r, art }` each, rolled once by the referee at
round start with `ctx.random()` — the same "the referee rolls shared
random state once and broadcasts the resolved value" pattern Squash
Mosquitoes' own `generatePattern()` already uses
(`worker/squashMosquitoes.ts`), just independent draws for position/size/
art instead of a shuffle. `y` is constrained to a middle band so both
planets sit between the two ships; `x` keeps clear of the side edges and
**always splits the board in half — one planet rolled left of centre, one
right, which side is a fair coin flip** — so a shot is never faced with
both planets bunched on the same side and nothing to curve around on the
other. `r` is mapped from the brief's 20–100px onto the shared board's own
normalized units. `art` picks one of ~3 planet PNGs. Broadcast once, in the
round-start state, and never touched again for the rest of the match —
unlike a puck or a position, a planet here is scenery the referee decided
once, not a thing either side keeps re-agreeing on.

### 2.2 One board, drawn twice

All physics — planet positions, ship positions, the missile's own path —
live in one canonical coordinate space, `x, y ∈ [0, 1]`, the same numbers
on both phones and on the referee. The one thing that differs per viewer
is **how it is drawn**: the seat that is not "y = 1" flips every point
`(x, y) → (1-x, 1-y)` at render time only, so it always sees its own ship
at the bottom. Nothing about physics, the wire messages, or the referee
ever needs to know which seat is which — the flip lives entirely in the
canvas renderer.

### 2.3 The shot: aimed locally, resolved locally, trusted by the referee

The finger's own position relative to the ship — not a drag delta from
where the touch began — sets angle and strength: distance from the ship
maps to strength (capped at `GRAVITY_MAX_AIM_DISTANCE`), and the missile
fires toward the finger, a targeting reticle rather than a slingshot pulled
back and released opposite the drag.

The shot is simulated with a fixed-timestep (1/60s) gravity integration:
each planet pulls the missile toward it with acceleration
`G · planet.r² / max(dist², planet.r²)` — mass proportional to the
planet's own area, so a bigger planet pulls harder at any given distance,
not just asymptotically far away from it (the planet's own radius still
doubles as both the softening distance near its center and its own
absorption radius — a missile that gets within a planet's radius is
swallowed there, ending as a plain miss) — summed over both planets. The
simulation runs up to 600 steps (10 seconds of flight) before an
unresolved shot is abandoned outright, or stops early the moment the
missile is within `GRAVITY_HIT_RADIUS` of the opponent's ship (a hit) or
leaves a generous simulation area well outside the visible board (a miss)
— that simulation boundary is deliberately **wider than the screen
itself** (§7), so a shot that loops off-screen and curves back in is
never clipped mid-flight.

The shooter's own phone runs this simulation the instant the finger is
released and sends the referee `{ roundId, angle, strength, hit }` — the
referee stores `hit` as reported, rather than re-deriving it (§8). The
non-shooting phone receives the same `angle`/`strength` in the next
broadcast and independently re-runs the identical deterministic
simulation purely to draw its own copy of the missile's flight — never to
decide the outcome, which has already arrived as `hit`/the new lives
count. Any tiny floating-point difference between two phones' replays is
therefore only ever cosmetic.

### 2.4 Turns don't stall on a silent phone

Every turn opens with `resolvesAt = now + GRAVITY_SHOT_TIMEOUT_MS` and a
referee alarm at that deadline. If a `gravity-shot` never arrives — a
backgrounded tab, a dropped connection — the referee's own `tick()`
resolves the turn as a miss and passes it to the other player, the same
shape as Tap Fighter's own no-lock-in default
(`worker/tapFighter.ts`). `GRAVITY_SHOT_TIMEOUT_MS` is generous (well past
the 3-second flight itself) since it only has to cover "did the message
ever arrive," not the flight time.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: a `<canvas>` board — two planets, two ships, a turn indicator,
  a row of five life-pips per ship (same idiom Pass the Bomb/Steady Hand
  already use). Touching above your own ship on your turn shows the fading
  dashed aim preview (§2.2); releasing plays the missile's flight,
  followed by `impact_missile.gif` on a hit and, on the life-ending hit,
  `explosion.gif` straight after (both reused from UFO Hunt's own art,
  copied into this game's own `art/` folder). Rendered on `<canvas>`, the
  same reasoning as every other continuously-animated board in this
  catalogue (Neon Fall §13, Tiles Surfer §4) — not a DOM-diffing job.
  **The life pips never spoil a shot still in flight.** The referee decides
  a hit and broadcasts the new life count the instant a `gravity-shot`
  arrives — seconds before either phone's own missile animation finishes —
  so each client holds the previous life count on screen until its own
  flight animation ends, the same `displayed<value>` pattern Tap Fighter's
  round-win pips use for the identical reason. A match-ending shot's own
  flight and impact GIF are likewise played out in full before the results
  screen appears, rather than being cut short by the referee's `phase:
  'done'` arriving mid-flight.
- **Results**: the shared `GameOverScreen`, `rows[].value` a plain win/lose
  word per player — no numeric score anywhere, the same non-numeric
  `OverRow` shape Tic-Tac-Tic-Tac-Toe's own `symbol(id)` already uses.
- No rules panel beyond the lobby's own one or two sentences.

## 5. Inputs & sensors

Touch only — touch above your own ship to aim toward your finger, release
to fire. No sensors, no permissions, nothing to fall back from.

## 6. Networking

```ts
// client -> server, once per turn, on release
{ t: 'gravity-shot', d: { roundId, angle, strength, hit } }

// server -> both, on every resolved turn (including a timeout-miss)
{ t: 'gravity', d: {
  roundId, startsAt,
  planets: [{ x, y, r, art }, { x, y, r, art }],
  lives: Record<PlayerId, number>,
  turn: PlayerId,
  resolvesAt: number,
  lastShot: { shooter: PlayerId, angle: number, strength: number, hit: boolean } | null,
  winner: PlayerId | null,
  phase: 'running' | 'done',
} }
```

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `gravity-shot` | client → server | `{roundId, angle, strength, hit}` | This turn's shot, and its own claimed outcome — trusted as reported (§8) |
| `gravity` | server → both | see above | The planets (sent once, then echoed unchanged), lives, whose turn it is, and the last shot's numbers for the receiver's own cosmetic replay (§2.3) |

`gravity-shot` is only accepted from `state.turn`'s own player, and only
before `resolvesAt` — a plain seat/deadline check, not anti-cheat.
`angle`/`strength` are clamped to finite, sane ranges before the referee's
own re-broadcast, so a malformed payload cannot produce `NaN`/`Infinity`
in the receiver's replay.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-match | The match ends immediately in the other player's favor — two fixed seats, the same rule Grid Attack/Neon Fall use, not Steady Hand's "continue without them" (which only applies at 3+ players) |
| A shooter goes silent mid-turn | Resolved as a miss at `resolvesAt`, turn passes (§2.4) |
| A shot that would exit the visible screen but could still curve back | Not clipped — the simulation's own termination bounds are deliberately wider than the render viewport (§2.3), only the 600-step/10s cap and the generous off-board bounds end a shot early |
| A missile enters a planet | Absorbed there — a plain miss, no special effect |
| Both ships would reach 0 lives on the same turn | Cannot happen — a shot only ever affects the one player who is not currently shooting |
| A player refreshes mid-match | Same seat, same lives/turn — the match state lives on the referee, not the phone |
| A shot from the wrong seat, or after `resolvesAt` | Rejected |

## 8. Anti-cheat

**By direct instruction, there isn't one for the hit decision — and this
design is a known, cheap exploit, stated plainly rather than glossed
over.** The brief: "No anti cheat, computation is done on the player
phone and sent to the other." The referee stores whatever `hit` a
`gravity-shot` claims.

This is a step further than Tiles Surfer's own client-trust (§8 there):
Tiles Surfer trusts telemetry because the referee genuinely has nothing of
its own to check it against. Here the referee already holds everything a
verification would need — the planets it rolled itself, plus the shooter's
own claimed `angle`/`strength` — so a modified client reporting `hit: true`
on every turn cannot be told apart from a real one. Closing that would
mean the referee re-running the same deterministic simulation itself and
deciding `hit` server-side, a cheap change if this is ever revisited — but
it is not what was asked for here.

- **What the referee does do**: reject a shot from the wrong seat or after
  its own deadline, and clamp `angle`/`strength` to finite, sane ranges —
  cheap validity checks against a malformed payload, not verification of
  the claimed outcome.
- **What this costs**: a modified client can claim a hit on every turn and
  win in two shots. Nothing here can tell the difference.
- **Why anyway**: asked for directly, the same reasoning as Tiles Surfer's
  own §8 — and, same as there, a two-player game where each side can see
  the other's screen carries a real social check the technical one does
  not need to duplicate.

## 9. Safety

Seated, one-handed, nothing thrown or swung. Lowest-risk category in the
catalogue, same as Tiles Surfer and Tic-Tac-Tic-Tac-Toe.

## 10. Data & privacy

Only each shot's own angle, strength, and claimed hit leave the phone —
never a raw trajectory sample or a timestamp beyond the round's own
deadlines. Room memory only, for the life of the match.

## 11. Accessibility

Ships and planets read by shape and position, not colour alone; each
player's own accent colour tints their own ship and aim preview, but the
turn indicator and life pips are plain shapes/text, readable regardless.
Reduced motion shortens the missile's own trail flourish and the impact
GIFs' hold time, not the flight itself — the curving flight is the whole
mechanic, the same honest limit Tiles Surfer's own falling tiles state
about themselves. Life pips and the turn indicator are plain text/shape,
readable by a screen reader like any other status bar in this catalogue.

## 12. Open questions

- **`G` (gravity strength) and `GRAVITY_HIT_RADIUS`** are stated defaults,
  untuned against a real thumb — a first playtest decides whether shots
  curve enough to feel skillful without becoming unpredictable.
- **The planet-radius-as-both-softening-and-absorption-radius choice**
  means the strongest pull on a missile happens right before it would be
  swallowed, with no gradual "graze and get flung" zone. Worth revisiting
  after a playtest if planets feel like binary walls rather than curves to
  aim around.
- **Accent colour** (`#818CF8`) is a first pass — worth revisiting once the
  real art exists.
