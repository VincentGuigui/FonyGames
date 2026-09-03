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
   own edge and never move — a 20px further margin than the original brief
   (issue #16), so neither ship reads as sitting right on the border.
2. Turns strictly alternate, host first. On your turn, touch above your own
   ship — the finger's own position relative to the ship sets your shot's
   angle and strength; the missile fires toward wherever your finger is,
   like a targeting reticle, not away from it like a slingshot.
3. While your finger is down, a dashed preview of the shot's own path is
   shown: solid across the near third of the screen, fading through the
   middle third, and gone for the last third before the opponent (§2.2) — a
   real read on your own aim, but never a look at where the shot actually
   lands.
4. Release, and the missile flies, curving under both planets' gravity,
   for as long as where it currently is allows (§2.3) before an unresolved
   shot is abandoned outright.
5. A hit costs the other ship one of five lives. A miss — the missile
   either drifts off the board or is swallowed by a planet — costs
   nothing, and the turn simply passes.
6. First ship to 0 lives loses.

**Win condition:** the opponent's fifth life reaches 0.
**Scoring:** none. The result panel says only **Win** or **Lose** (§4).

**Solo test mode** is a hotseat, not a second player (Tap Fighter's own
idiom, `worker/tapFighter.ts`): the one connected phone takes both seats,
firing for whichever ship currently holds the turn, and the view flips
per turn exactly as it would between two real phones. Every per-side
field the referee tracks — `lives`, `turn`, a shot's own `shooter`,
`winner` — is keyed by **seat** rather than by player id for exactly this
reason: solo puts the same player id in both `seats`, and a player id
cannot tell the two ships apart when there is only one of it.

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
normalized units. `art` picks one of ~3 planet PNGs.

**The board moves every `GRAVITY_SHOTS_PER_MAP` (2) resolved shots** — one
apiece, so it only ever changes once BOTH players have aimed at it, never
mid-exchange where one of them would inherit a map the other already had a
free look at. A timed-out turn (§2.4) counts as that seat's shot spent, so a
silent player cannot freeze the board. The whole geometry is re-rolled, under
every placement rule below, not nudged.

Two consequences worth knowing. The referee re-rolls in the very frame that
reports the shot which triggered it, so **a client replaying `lastShot` must
simulate against the planets it was already showing**, not the ones that frame
carries — otherwise the receiving phone draws the flight through a board that
did not exist when the shot was fired (`game.ts`'s own `apply`). And the
match-winning shot deliberately does NOT move the board: both phones are still
animating that flight and its explosion against the board it was won on.

**Five shape rules, each guaranteed rather than merely likely (issue #16, plus
follow-ups on the last two):**

- **At least 30% size difference.** The two radii are never independently
  rolled and hoped apart — the referee picks the bigger one first, from
  high enough in the 20–100px range that shrinking it by 30% can never push
  the smaller one below the 20px floor, then rolls the smaller one under
  that ceiling. Two near-identical planets read as one shape drawn twice,
  not two different things to curve a shot around.
- **At least 50px between their own SURFACES**, not their centres — two big
  planets can have far-apart centres and still touch. Constructed the same
  direct way as the size rule where possible; on the rare geometry where it
  is not, the referee re-rolls just the sizes and heights (up to ten times)
  before accepting whatever the last attempt was rather than ever refusing
  to start a match over it.
- **At least 100px of vertical separation** between the two centres, so they
  never land on the same horizontal band and read as one wide obstacle.
  Constructed the same direct way: the lower one is rolled from a range that
  always leaves the required gap of room for the higher one above it, so
  this one never needs a retry at all.
- **No dead zone**: a straight shot along the board's own centre line
  (`x = 0.5`, both ships sit on it — §2.2) must always come within a
  meaningful distance of at least one planet's own gravity. The gravity
  formula (§2.3) gives acceleration `G / k²` at distance `k · planet.r` from
  ANY planet, regardless of its size — a size-invariant "still matters here"
  threshold. Requiring `|0.5 - planet.x| ≤ 2 · planet.r` for BOTH planets
  independently is a complete fix, not a partial one: each planet's own
  influence zone then reaches the centre line by construction, so the union
  of the two has no gap anywhere between them for a shot to slip through.
  Constructed the same direct way as the rules above: a planet's own `x` is
  rolled from a range bounded by its own radius, so this never needs a
  retry either — though since it now depends on radius, `x` is rolled
  together with size/height in the retry loop above, not beforehand.
- **One planet always covers the board's own centre** (`0.5, 0.5`) with its
  actual body, not merely its gravity — so the straight line between the two
  ships is never itself a shot, and every shot has to be curved around
  something. This is the stronger sibling of the dead-zone rule above: that
  one guarantees the middle of the board is always *pulled on*, this one
  guarantees the middle is *blocked*. Constructed rather than rejected: the
  covering planet's row is rolled first (bounded by its own radius, since a
  planet further from the centre row than it is wide could never reach the
  centre), then its column inside whatever the radius has left over. The
  bigger planet can always reach from a legal row and the smaller one only
  sometimes, so a coin flip decides only when both can — nothing should read
  as "the big one is the middle one" any more than as "the left one".

**A best-effort fairness pass, on top of the shape rules.** Issue #16 asked
directly: *"is it possible to simulate a winning trajectory from each
player's own position, to avoid generating an impossible map?"* — yes. Once
a candidate map satisfies the five rules above, the referee samples a
coarse fan of shots (seven angles, five strengths — widened from three
strengths in this follow-up, once a slower speed range and a stronger `G`
made the fast-and-strong end of the old fan miss far more real shots) from
EACH ship's own position, run through a small worker-local copy of the
client's own gravity model (`worker/gravityShooter.ts`'s
`seatCanReachOpponent`) purely to answer "does at least one of these
connect" — never to decide a real shot (spec §8 is unchanged: the referee
still trusts whatever `hit` a real `gravity-shot` claims). If neither ship
has a sampled shot that connects, the referee re-rolls the whole map (up to
eight times) before accepting the last attempt regardless. Deliberately a
courtesy, not a guarantee: a coarse 35-shot fan can still miss a real but
narrow window, and the last attempt is always shipped rather than ever
blocking a match from starting over it.

### 2.2 One board, drawn twice

All physics — planet positions, ship positions, the missile's own path —
live in one canonical coordinate space, `x, y ∈ [0, 1]`, the same numbers
on both phones and on the referee. The one thing that differs per viewer
is **how it is drawn**: the seat that is not "y = 1" flips every point
`(x, y) → (1-x, 1-y)` at render time only, so it always sees its own ship
at the bottom. Nothing about physics, the wire messages, or the referee
ever needs to know which seat is which — the flip lives entirely in the
canvas renderer.

**The aim preview's own fade is a screen distance, not a fraction of the
path.** It is solid across the near third of the shooter's own screen, fades
out through the middle third, and is gone for the last third before the
opponent. Measured from where each segment actually sits on screen rather
than from how far along the path it is, so a slow or hard-curving shot fades
in the same place a fast straight one does — and a shot that loops back into
the visible band is drawn again rather than cut off at its first faded
segment.

### 2.3 The shot: aimed locally, resolved locally, trusted by the referee

The finger's own position relative to the ship — not a drag delta from
where the touch began — sets angle and strength: distance from the ship
maps to strength (capped at `GRAVITY_MAX_AIM_DISTANCE`), and the missile
fires toward the finger, a targeting reticle rather than a slingshot pulled
back and released opposite the drag.

Launch speed is no longer a single ceiling scaled by strength — two follow-ups
after issue #16 reshaped it:

- **A speed FLOOR, not zero** (`GRAVITY_MIN_LAUNCH_SPEED`). Speed scales
  linearly between this floor (strength 0, the barest drag) and
  `GRAVITY_MAX_LAUNCH_SPEED` (strength 1, a drag of the full
  `GRAVITY_MAX_AIM_DISTANCE`), rather than from zero — so even the weakest
  possible pull still reads as a real, if slow, missile in flight. The floor
  has since been halved again, putting the range at 4:1: a gentlest-possible
  shot would take about 12 seconds to cross an empty board, and in practice is
  usually captured by a planet long before that, which is the point of a floor
  that low.
- **Both ends derived from a target DURATION, not hand-picked speeds.** A
  straight, gravity-free flight across the board should take about 6 seconds
  at the floor and about 3 seconds at the ceiling — a *display* choice (this
  follow-up's own framing), not a gravitational one: the speed range is
  shaped for how long a shot should feel like it's in the air, independently
  of how much gravity then bends it. Both constants divide the ship-to-ship
  world distance by the relevant duration, so retuning either duration
  retunes the matching speed automatically.

Together with `GRAVITY_MAX_LAUNCH_SPEED` already sitting at roughly a third
of the original brief's value (this halved once, for issue #16's own
follow-up, then roughly thirded again for this one), a full-strength shot is
far slower than the original brief — spending much more of its flight
exposed to a planet's own pull.

The shot is simulated with a fixed-timestep (1/60s) gravity integration:
each planet pulls the missile toward it with acceleration
`G · planet.r² / max(dist², planet.r²)` — mass proportional to the
planet's own area, so a bigger planet pulls harder at any given distance,
not just asymptotically far away from it (the planet's own radius still
doubles as both the softening distance near its center and its own
absorption radius — a missile that gets within a planet's radius is
swallowed there, ending as a plain miss) — summed over both planets. `G`
itself is now **four times** the original brief's value: doubled once when
the launch speed dropped (a slower missile alone doesn't feel meaningfully
pulled unless the pull itself is also stronger), then doubled again
alongside the centre-blocking rule in §2.1, since a shot that now has to go
*around* a planet needs enough pull to actually come back. The
simulation stops early the moment the missile is within
`GRAVITY_HIT_RADIUS` of the opponent's ship (a hit) — **half the ship
sprite's own drawn width, so the whole ship image is the target** rather than
a dot at its centre, and derived from the same `GRAVITY_SHIP_WIDTH` the canvas
draws with so the two cannot drift apart — gets swallowed by a
planet (a miss), leaves a generous simulation area well outside the visible
board (a miss) — that simulation boundary is deliberately **wider than the
screen itself** (§7), so a shot that loops off-screen and curves back in is
never clipped mid-flight — or outstays its own welcome (issue #16), a miss:

| Where the missile currently is | How long it is kept alive there |
| --- | --- |
| Inside the visible `[0,1]x[0,1]` board | 20s |
| Outside the visible board, but has not yet flown past the opponent's own ship | 7s |
| Past the opponent's own ship, without having hit it | 1s |

Each budget is measured from the moment the missile most recently entered
that zone, not accumulated across the whole flight — a shot that leaves the
screen, curves back in, and leaves again gets a fresh 7s each time, same as
the first. "Past the opponent" always outranks "outside the board": a shot
that has already flown beyond its own target's row without hitting has
clearly missed regardless of whether that happens to still read as inside
`[0,1]` — the opponent's ship sits close to that edge, so the two are
almost the same place. Nothing here shortens a shot that is still headed
somewhere plausible; it only ends the ones that have obviously missed, or
drifted, sooner than the old flat 10-second cap did.

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
  round-win pips use for the identical reason.

  **The match-ending sequence is played out in full before the results screen
  appears**, rather than being cut short by the referee's `phase: 'done'`
  arriving mid-flight. In order: the missile's flight, then
  `impact_missile.gif` where it landed, then — only once that has actually
  finished — `explosion.gif` centred on the **destroyed ship**, which fades out
  underneath it. The two hold times are the GIFs' own measured durations
  (`GRAVITY_IMPACT_GIF_MS` 540ms, `GRAVITY_EXPLOSION_GIF_MS` 960ms — 6 frames
  at 90ms and 16 at 60ms, read off the files, not estimated), so the whole
  sequence is 1.5s and the results panel waits out every millisecond of it.
  Re-measure both if either file is replaced.
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
  seats: [PlayerId, PlayerId],   // both entries the same id in solo (§2)
  planets: [{ x, y, r, art }, { x, y, r, art }],
  lives: [number, number],       // indexed by seat, not by seats[]'s player id
  turn: 0 | 1,
  resolvesAt: number,
  lastShot: { shooter: 0 | 1, angle: number, strength: number, hit: boolean } | null,
  winner: 0 | 1 | null,
  phase: 'running' | 'done',
  solo: boolean,
} }
```

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `gravity-shot` | client → server | `{roundId, angle, strength, hit}` | This turn's shot, and its own claimed outcome — trusted as reported (§8) |
| `gravity` | server → both | see above | The planets (sent once, then echoed unchanged), lives, whose turn it is, and the last shot's numbers for the receiver's own cosmetic replay (§2.3) |

`gravity-shot` is only accepted from whoever `seats[turn]` actually is, and
only before `resolvesAt` — a plain seat/deadline check, not anti-cheat. In
solo that is always the one connected player, on either seat, so a hotseat
shot needs nothing extra to say which ship it is for. `angle`/`strength`
are clamped to finite, sane ranges before the referee's own re-broadcast,
so a malformed payload cannot produce `NaN`/`Infinity` in the receiver's
replay.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-match | The match ends immediately in the other player's favor — two fixed seats, the same rule Grid Attack/Neon Fall use, not Steady Hand's "continue without them" (which only applies at 3+ players) |
| A shooter goes silent mid-turn | Resolved as a miss at `resolvesAt`, turn passes (§2.4) |
| A shot that would exit the visible screen but could still curve back | Not clipped — the simulation's own termination bounds are deliberately wider than the render viewport (§2.3); leaving the visible board costs it its 20s onscreen budget for a shorter 7s one, not the flight itself |
| A missile enters a planet | Absorbed there — a plain miss, no special effect |
| A shot rolled with no sampled winning trajectory from either ship | Ships anyway, after the referee's own retries are exhausted (§2.1) — the fairness pass is a courtesy, never a block on starting the match |
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

- **`G` (gravity strength) and `GRAVITY_HIT_RADIUS`** — `G` is now four
  times the original brief's value across two follow-ups (§2.3), and the hit
  radius is no longer a tuned number at all: it is half the ship sprite's
  own width by definition. Both still untuned against a real thumb. A first
  playtest decides whether shots now curve enough to feel skillful without
  becoming unpredictable, or too much to feel controllable — and whether a
  ship-sized hitbox makes landing a hit too easy now that it is roughly twice
  the old radius.
- **The planet-radius-as-both-softening-and-absorption-radius choice**
  means the strongest pull on a missile happens right before it would be
  swallowed, with no gradual "graze and get flung" zone. Worth revisiting
  after a playtest if planets feel like binary walls rather than curves to
  aim around.
- **Accent colour** (`#818CF8`) is a first pass — worth revisiting once the
  real art exists.
- **The three lifetime budgets (20s/7s/1s, §2.3)** are issue #16's own stated
  numbers, untested against a real thumb — a 20-second on-screen shot in
  particular is a real wait if it happens often; worth revisiting after a
  playtest if it reads as dead air rather than a shot still worth watching.
  Worth noting how the speed changes moved these around. A straight,
  gravity-free crossing now takes about 2.6s at full strength and about 10.2s
  at the floor, so the 20s ONSCREEN budget still only ever governs a shot
  gravity has bent into looping or lingering. The 7s OFFSCREEN budget,
  however, went from unreachable back to load-bearing when the minimum
  impulse was halved: at the old floor a sideways shot crossed the margin to
  the outer wall in about 4s and the wall always ended it first, where now it
  cannot get there inside 7s and the budget does the ending — which is what
  the budget is for.
- **The "no dead zone" influence factor of `2` (§2.1)** is this follow-up's
  own untested pick, same status as the numbers above — a first playtest
  decides whether `2` radii of "still matters" reads as generous or barely
  there.
- **The launch-speed retune and the doubled `G` (§2.3)** are a second
  follow-up's own untested picks, on top of the first's: a full-strength
  shot is now roughly a third of the original brief's speed (having already
  been halved once for the first follow-up), a barely-dragged shot has a
  speed floor for the first time, and `G` is double the original brief's
  value. A first playtest decides whether this reads as "gravity finally
  matters" or "every shot feels sluggish." The fairness pass's own fan
  (§2.1) had to widen alongside it — the old three-strength fan's own miss
  rate jumped from roughly 1.8% to roughly 33% of freshly-rolled maps
  (measured across 5000 seeded rolls) once speed dropped and `G` doubled,
  since a winning shot was now far more likely to sit at a gentler strength
  the old fan never sampled; widening it to five strengths (§2.1) brought
  that back down to roughly 3.8% — still higher than before this follow-up,
  still rare and fail-soft, but worth watching, and worth widening further
  or adding retry attempts if it climbs in play.
- **The centre-blocking rule and the second doubling of `G` (§2.1, §2.3)**
  are a third follow-up's own picks, and the two pull in opposite
  directions on purpose: a planet in the middle makes every shot harder,
  while four times the brief's gravity makes curving around it easier. Two
  measurements across 5000 seeded rolls, worth re-checking if any of these
  constants move again:
  - The fairness pass's own miss rate fell from roughly 3.8% to **zero** —
    with this much pull, the sampled fan finds a way around the blocker on
    every map it was given. That is the pre-check reporting success, not a
    guarantee about the real client physics.
  - Pinning one planet to the middle while the other still owes it 100px of
    vertical separation is genuinely tight geometry, and the surface-gap
    retry budget had to rise from 10 to 60 attempts to keep the two planets
    from overlapping (4.2% of maps overlapped at 10, 0.02% at 30, none at
    60). The mean radius barely moved (0.0886 → 0.0878), so the retries are
    not quietly selecting for small planets — but if the y band or the
    separation rule is ever retightened, this is the budget that will feel
    it first.
