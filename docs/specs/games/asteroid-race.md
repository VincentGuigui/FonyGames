# Asteroid Race

> Status: **draft — awaiting approval** ([issue #24](https://github.com/VincentGuigui/FonyGames/issues/24)).
> Nothing is built. Every number below is a stated guess (§12), and two design
> calls the issue did not settle — the win condition (§2) and why the missile
> exists at all (§2.3) — are proposals, flagged as such.

| | |
| --- | --- |
| **Slug** | `asteroid-race` |
| **Catchy sentence** | *Dodge the rocks, blast the rest, get there first* |
| **Illustration** | `www/src/games/asteroid-race/art/card.svg` — a starship seen from behind and slightly above, threading a corridor of grey asteroids that fade into black, lime engine flare |
| **Players** | 1–8 |
| **Round length** | ~50–60 s of flying, hard cap 120 s (§7) |
| **Inputs** | orientation (tilt) to fly · touch for the two buttons |
| **Accent colour** | `#A3E635` |
| **Status** | draft — awaiting approval |

## 1. Pitch

The camera sits behind your ship and a little above it, so the middle of the
screen — the part you are flying into — is never blocked by your own hull.
Ahead, a field of grey rocks resolving out of the black, one at a time,
getting bigger. Tilt the phone to fly around them. Everyone in the room flies
**the same field**, so the only thing between you and first place is how well
you read it.

You have a booster for when the lane is clear and a missile for when it
isn't. Five lives, and every rock you clip costs you one of them plus a
second of standing still while your friends fly past.

## 2. Core loop

1. The host starts a round. Every player gets the same asteroid field, dealt
   by arithmetic rather than by the referee (§2.1), and the same finish line
   `ASTEROID_TRACK_LENGTH` units away.
2. A four-second rules panel, first round only
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4). It doubles
   as the calibration moment — "hold your phone how you like" (§5).
3. Your ship flies forward on its own at `ASTEROID_CRUISE_SPEED` and never
   stops for anything but a collision. **Tilt steers, it does not throttle**:
   left/right tilt slides you across the corridor, forward/back tilt lifts and
   drops you in it.
4. **Boost** (`ASTEROID_BOOST_MS` at `ASTEROID_BOOST_MULTIPLIER`, then
   `ASTEROID_BOOST_COOLDOWN_MS` to recharge) is distance bought with reaction
   time — the field arrives faster and the fog gives you no more warning than
   it did before (§2.4).
5. **Missile** (`ASTEROID_MISSILE_COOLDOWN_MS` to recharge) fires straight
   ahead into the reticle at the middle of the screen. A small rock is gone in
   one shot; a large one splits into two small ones that drift apart, which is
   what opens a gate (§2.3).
6. **Clip a rock and it explodes, and so does your run for a moment**:
   `impact_missile.gif` plays on your hull, you lose one of five lives, and
   you sit still and blinking for `ASTEROID_STUN_MS` (1 s) before flying on.
7. **First ship over the finish line wins**, and the round ends for everyone.
   Out of lives before you get there, your run ends where it stopped.

**Win condition:** first across `ASTEROID_TRACK_LENGTH`. If the 120 s cap
arrives with nobody home, the furthest wins — the same answer
[shake-rush.md](shake-rush.md) §2 gives its own race. In a solo room there is
nobody to beat, so it is a time trial: `winner: null`, your own finish time.
**Scoring:** none beyond placing. Distance is the ranking, hits are shown but
never scored — a clean run is its own reward and the results screen says who
had one (§4).

> **The win condition is a proposal.** The issue says "race" and "5 lives" and
> does not say what ends it. A fixed-length track with lives as the failure
> budget is the reading that makes both of those load-bearing; the alternative
> — an endless field where five hits ends your run and the furthest wins — is
> recorded as a mode in §3 rather than chosen here.

### 2.1 One field, dealt by arithmetic

**Nothing about the field goes on the wire.** `asteroidAt(roundId, index)` is
a pure function in `game.ts` returning one rock's `{ x, y, z, r, size }`, and
`roundId` — already broadcast, already unique per round — is its only input.
Every phone therefore generates the identical field from nothing, the same
device [tiles-surfer.md](tiles-surfer.md) §2.1 uses for its lane sequence and
[ufo-hunt.md](ufo-hunt.md) uses for its saucer's position.

This is deliberately **not** Gravity Shooter's model, and the reason is size
rather than taste. That game's referee rolls two planets and echoes them in
every frame ([gravity-shooter.md](gravity-shooter.md) §2.1), which is fine for
two objects; a field is ~70 formations of 1–5 rocks, and putting it in a state
frame would blow [../../architecture.md](../../architecture.md) §4's 1 KB
typical message size for no gain — the arithmetic is smaller than its own
result.

**The field diverges the moment somebody shoots**, and that is correct: your
missiles clear *your* rocks, and nobody else's run is affected because there
are no collisions between players (§2.2). What every player is guaranteed is
the field as *dealt* — identical rocks in identical places, so a race between
two phones is a race between two players and never between two boards.

### 2.2 Nobody can see your ship

There is one field, but there are no other ships in it. No player-vs-player
collision, no ramming, nobody in your way — the issue is explicit about this,
and it is what makes the whole game cheap to run: **a game nobody else can see
is simulated on the phone, not in the room server**
([../../roadmap.md](../../roadmap.md)'s own 2026-08-03 decision, made for
Sling Puck). Your flight, your missiles, your collisions and your two
cooldowns all live and die on your own phone. The only thing the room needs to
know is how far along you are and how many lives you have left (§6).

What the other players *are* is the ladder: a slim strip of avatars by
progress along the top edge (§4), which is the whole social payload — Shake
Rush's lanes, compressed to make room for the corridor.

### 2.3 Why the missile exists: gates

Steering is free. Forward speed does not depend on how hard you are turning,
so a rock you can swerve around costs you nothing, and a game of only
swervable rocks would make the missile button decoration.

So the field deals **gates**: a formation with no gap wide enough for a ship,
one large rock in the middle. A gate is not a wall — shoot the middle rock and
its two halves drift apart in opposite directions, opening the lane you then
fly through. That is the issue's own sentence ("each part drifts in opposite
directions (random) to clear the middle") read as the reason the mechanic is
there rather than as a visual detail.

**The shards stay live.** They are two small rocks now, moving, and they can
still take a life — otherwise shooting a gate would be free and the decision
would collapse the other way. Blast it early and you fly through the middle of
a widening gap; blast it late and you fly through two rocks still leaving.

Gates are dealt roughly every `ASTEROID_GATE_EVERY` formations, which at the
numbers in §5b is one about every 6 s against a 3 s missile cooldown — so a
gate is always answerable, and a missile spent on a rock you could have dodged
is a missile you might miss at the next one.

### 2.4 The fog may never hide a rock you still have to dodge

Far asteroids fade to black so the view is not cluttered — the issue asks for
it, and at 600 units of draw distance a corridor without it is grey noise. But
a fade is also a rule about fairness, so it gets stated as one:

**A rock is fully lit by `ASTEROID_CLEAR_Z`, and that distance must always be
at least `ASTEROID_REACTION_MS` of flying at full boost.** At the numbers in
§5b that is 150 units against 86, so a boosting player still gets 2.1 s of
clearly-visible warning and a cruising one 3.75 s. If either constant is ever
retuned, this inequality is what has to keep holding; a field that hides a
rock until it is unavoidable is not difficult, it is broken.

Between `ASTEROID_CLEAR_Z` and `ASTEROID_DRAW_Z` a rock is drawn but dim, and
beyond `ASTEROID_DRAW_Z` it is not drawn at all.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` if this is approved. Recorded, not built:

| Idea | Difference |
| --- | --- |
| `endless` | No finish line. Five hits ends your run; furthest wins — the win condition §2 did not choose |
| `sudden-death` | One life. A single rock ends your race |
| `dogfight` | Two players, both visible in one corridor, missiles that can hit a ship. A different game and a different cost profile (§6) — recorded so it is not confused with this one |

## 4. Screens

- **Lobby**: shared template, plus the tilt primer (§5) and its fallback
  route. `readyBlocked` until the primer resolves, per
  [../../design/game-chrome.md](../../design/game-chrome.md) §1.
- **Round — the corridor**, drawn identically on every phone (each showing its
  own run):
  - The ship low-centre, drawn from behind and below the camera, banking a
    little with your steer. Above and around it, the field.
  - **The middle of the screen is clear** — the camera sits behind and above
    the hull for exactly this reason (the issue's own framing), because the
    middle of the screen is both where you are going and where the reticle is.
  - Large rocks dark grey `#4B5563`, small rocks grey `#9CA3AF`, both fading
    toward the `#05070D` background with distance (§2.4). **Size, not shade,
    is what says "this one splits"** — a large rock is genuinely bigger on
    screen, which is the cue that survives
    [../../design/ui-guidelines.md](../../design/ui-guidelines.md) §2's rule
    against colour-only state.
  - **A red halo around the ship** when the nearest rock in your own corridor
    is inside `ASTEROID_WARN_Z`, thickening and pulsing as it closes. The
    pulse is not decoration: it is what keeps the warning from being a colour
    on its own (§11).
  - A reticle at the middle of the screen, showing what the missile would take
    and dimming while it recharges.
  - **HUD**: five life pips *and* the number, your place in the ladder
    ("2nd of 4"), and distance to go as a thin bar. The ladder strip along the
    top edge carries every player's avatar by progress.
  - **Boost bottom-left, missile bottom-right**, ≥ 56 px, in the thumb zone
    (ui-guidelines §1), each filling back up as it recharges. Two buttons and
    a tilted phone is a two-thumb grip, which is what this game asks for and
    what the card should say.
- **A collision**: `impact_missile.gif` on the hull — the same file Gravity
  Shooter uses, copied into this game's own `art/`, the way that game copied
  it from UFO Hunt — the rock explodes and is gone, the ship blinks for its
  stunned second, and one pip goes out. The corridor keeps drawing; only the
  ship is stopped.
- **Out of lives**: your corridor stops, the ladder does not. You watch the
  rest of the race from where you died, which is a better seat than a modal.
- **Results**: the shared `GameOverScreen` — finish time for anyone who
  crossed, distance for anyone who did not. Its `note` slot carries the
  cleanest run (fewest hits), the same slot Tiles Surfer uses for its longest
  streak.

## 5. Inputs & sensors

**Tilt, two axes.** The issue says "gsensor/accelerometer"; the API that
actually reports how a phone is being held is `DeviceOrientationEvent`
([../../device-capabilities.md](../../device-capabilities.md) §1), read — as
always — only inside `core/sensors`, never in the game. `steer.ts` already
does exactly this job for one axis (`gamma`, Neon Fall's lane steer, filtered
and explicitly calibrated); this game needs the same math on `beta` as well,
so `steer.ts` gains a two-axis variant rather than this game reading a raw
event.

Following [../../device-capabilities.md](../../device-capabilities.md) §4
exactly: calibrated at round start against however the player is holding the
phone, low-pass filtered, sampled at device rate, acted on at ≤ 60 Hz.
**Transmitted at 0 Hz** — §4's transmit throttle does not apply because the
steer never leaves the phone at all (§2.2). Permission is requested from a tap
in the lobby, never on arrival (§2 of the same doc).

**Fallback (mandatory, [AGENTS.md](../../../AGENTS.md) §4 — degrade, never
dead-end):** a **virtual stick** — hold anywhere on the corridor and the ship
follows your thumb's offset from where you touched down, released back to
centre when you let go. Two axes rule out Neon Fall's two held zones, and
drag-to-steer is the documented default fallback for orientation
(device-capabilities §7). The two buttons stay where they are, so the fallback
grip is stick-left, buttons-right.

| Missing | Behaviour |
| --- | --- |
| Orientation denied / unavailable | The virtual stick, in the same round with the same field — nothing structural is lost |
| Touch | Impossible; the buttons and the fallback both need it |

### 5b. The numbers, and what each one is for

Distances are in **ship lengths**. All of these are guesses (§12).

| Constant | Value | Why |
| --- | --- | --- |
| `ASTEROID_TRACK_LENGTH` | 2400 | 60 s of clean cruising — inside AGENTS.md §4's 30 s–3 min |
| `ASTEROID_CRUISE_SPEED` | 40 /s | Fast enough to feel like flying, slow enough to read a gate |
| `ASTEROID_BOOST_MULTIPLIER` | 1.8 | A perfect boosting run saves ~10 s over a cruising one |
| `ASTEROID_BOOST_MS` | 2000 | Long enough to clear a straight, short enough to regret |
| `ASTEROID_BOOST_COOLDOWN_MS` | 9000 | ~6 boosts in a 60 s race |
| `ASTEROID_MISSILE_COOLDOWN_MS` | 3000 | Half a gate's spacing (§2.3) |
| `ASTEROID_LIVES` | 5 | The issue's own number |
| `ASTEROID_STUN_MS` | 1000 | The issue's own number — ~40 units, about what a boost buys |
| `ASTEROID_R_SMALL` / `ASTEROID_R_LARGE` | 1.2 / 3.0 | A large rock is ~2.5× a small one on screen, which is the size cue (§4) |
| `ASTEROID_SPLIT_DRIFT` | 12 /s | Two shards clear a ship's width in ~0.2 s |
| `ASTEROID_SPACING` | 35 | A formation about every 0.9 s at cruise |
| `ASTEROID_GATE_EVERY` | 7 | A gate about every 6 s |
| `ASTEROID_WARN_Z` | 60 | The red halo: 1.5 s at cruise, 0.8 s boosting |
| `ASTEROID_CLEAR_Z` | 150 | Fully lit — and ≥ `ASTEROID_REACTION_MS` at boost (§2.4) |
| `ASTEROID_DRAW_Z` | 600 | Beyond this, nothing is drawn |
| `ASTEROID_REACTION_MS` | 1200 | The reaction time §2.4's inequality is written against |
| `ASTEROID_ROUND_CAP_MS` | 120000 | Nobody wants a race that never ends |
| `ASTEROID_REPORT_MS` | 1000 | The ladder's own cadence (§6) |
| `ASTEROID_AWAY_MS` | 3000 | How long a phone may go quiet before it freezes (§7, §8) |

## 6. Networking

**Profile A, and that is the design** ([../../realtime-options.md](../../realtime-options.md)
§1). Because nobody else can see your ship (§2.2) there is no position, no
steer, no missile and no boost on the wire — a 20 Hz stream of any of those
would put this game in Profile B, which is ~16× the cost and is reserved for
Cat and Mouse. What crosses is one small report a second.

The referee owns `roundId` (and therefore the field), the round clock, the
finish line, everyone's last-reported numbers, the placings and the winner.
The phone owns its own flight.

```ts
// client -> server, on a 1 s tick, plus immediately on a life change or a finish
{ t: 'asteroid-report', d: { roundId, distance, lives, hits } }

// server -> everyone, on its own 1 s tick
{ t: 'asteroid', d: {
  roundId, startsAt, endsAt,
  runs: Record<PlayerId, { distance, lives, hits, finishedAt: number | null, away: boolean }>,
  winner: PlayerId | null,
  phase: 'running' | 'done',
} }
```

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `asteroid-report` | client → server | `{roundId, distance, lives, hits}` | How far I have got, what it has cost me — clamped on arrival (§8), never taken as read |
| `asteroid` | server → everyone | see above | Everyone's last-reported run, plus the race's own phase and winner. Nothing here is private |

**Latency tolerance.** Nothing in the loop is frame-perfect between players —
you are racing a clock and a field, not reacting to another phone
([../../multiplayer.md](../../multiplayer.md) §6). 300 ms of lag moves your
avatar on somebody else's ladder strip and changes nothing about your run.

**The finish is scored on server-received order, corrected by client
timestamp** — multiplayer.md §6 requires a real race to say which it does, and
this is it: two reports claiming the line in the same tick are ordered by the
client timestamp inside them, and only if those tie does arrival order break
it. The margin this protects is real (a report can sit 100–300 ms in flight),
and the correction is bounded by the same claim window as everything else
(§8).

**Empty reports are never sent, and the last one is flushed.** A phone with
its `requestAnimationFrame` stopped has nothing new to say, and saying it
anyway would keep an away player from ever being marked away — Steady Hand and
Shake Rush both learnt this. Crossing the line, running out of lives, or the
round ending all send one final report immediately rather than waiting for a
tick that may not come (the `tiles-report` closing-frame lesson,
[tiles-surfer.md](tiles-surfer.md) §6).

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player disconnects mid-race | Their run freezes at its last report and is marked `away`; the race continues. They rejoin to the same distance and the same lives — the field is a pure function of `roundId`, so it is still there for them |
| A player refreshes mid-race | Same seat, same distance, same lives. The ship resumes where the last report left it, not where the phone had got to — the difference is at most `ASTEROID_REPORT_MS` |
| Tab backgrounded | `requestAnimationFrame` stops, so the run genuinely stops (sling-puck.md §9 documents the same). No progress is banked: a report may only ever claim `ASTEROID_AWAY_MS` of flying (§8), so a phone that was away for a minute cannot arrive at the line on its return |
| Orientation denied | The virtual stick (§5), same race, same field |
| Everyone runs out of lives before the line | The furthest wins, on the distance they died at. Nobody finishing is a legitimate result, not a void round |
| The 120 s cap arrives | The furthest wins. A tie at the top is an unranked tie, the convention every other game's cap already uses |
| Two players cross in the same tick | §6's rule: client timestamp first, arrival order only as a fallback |
| Solo room | A time trial. `winner: null`, and the results screen shows the finish time rather than a placing (tiles-surfer.md §7's own solo answer) |
| Fewer than 1 connected player | Start disabled |
| A report for a stale `roundId` | Ignored |

## 8. Anti-cheat

Stated plainly rather than implied, because the honest version is short: the
phone simulates the whole run, so **the phone can lie about it**, and the
referee cannot see an accelerometer or an asteroid. What follows makes the easy
lies pointless.

- **No client-reported placings, ever.** The phone reports its own distance
  and lives; the referee owns the ranking, the finish and the winner. A client
  can claim a distance, never a victory.
- **The trajectory cap.** Distance is a function of *time*, not of effort, so
  the referee can compute the fastest run physically available and clamp to
  it: `reachableBy(elapsed, hits)` = cruise speed × elapsed, plus the boost
  time that `ASTEROID_BOOST_COOLDOWN_MS` actually allows in that elapsed, minus
  `ASTEROID_STUN_MS` for every hit reported. A report over the bound is
  **clipped, not rejected** — the same call Shake Rush makes, so a phone whose
  clock drifts a little is slowed rather than kicked.
- **The claim window.** One report may only claim `ASTEROID_AWAY_MS` of
  flying, whatever the elapsed round time says. Without it a silent phone
  could bank a minute and spend it in one frame, satisfying the cap above and
  arriving from a standing start — precisely the hole Shake Rush's own
  `RUSH_AWAY_MS` closes.
- **Lives and hits are clamped** to `0..ASTEROID_LIVES` and to non-negative
  finite integers, and lives may only ever go *down* within a round.
- **What is left, and is not solved**: a client that simply never reports a
  collision flies a clean run it did not fly. The cap bounds the payoff to the
  difference between that player's real run and a perfect one — which an
  honest expert can also reach — and no server-side check can do better
  without simulating every phone's field, which is the Profile B design this
  spec exists to avoid (§6). This is the same posture Gravity Shooter's own §8
  takes with a trusted hit, and Tiles Surfer's with a trusted score: it is a
  party game among people in one room.

## 9. Safety

Low risk, and no separate panel: the phone is **held and tilted**, never
swung, shaken or thrown, and the whole game is played seated. Nothing here
asks a player to move their body, so
[../../device-capabilities.md](../../device-capabilities.md) §3's bump copy
and §5's GPS copy do not apply — the same call Neon Fall §9 makes for its own
tilt.

The one line worth putting in the lobby, because tilting invites it: *"Tilt,
don't wave. Two hands, phone close."*

## 10. Data & privacy

Leaves the phone: a distance, a life count, a hit count, once a second, plus
player id, name and avatar. **Never an orientation stream and never a steer
value** — those do not cross the wire at all in this game (§2.2, §5). Room
memory only, for the life of the round; nothing is stored.

## 11. Accessibility

- **The stick fallback is a real one** (§5): the same race, the same field,
  two axes of control. A player who cannot tilt a phone loses the feel and
  nothing else.
- **Lives are pips and a number**, and the ladder names positions in text
  ("2nd of 4") — never a colour or a bar alone.
- **The danger halo pulses as well as reddens**, and thickens as the rock
  closes, so proximity is legible without seeing red (ui-guidelines §2).
- **Large and small rocks differ in size first** (§4). The two greys are
  texture; the silhouette is the information.
- `prefers-reduced-motion` drops the starfield parallax and the ship's bank,
  and replaces the stunned blink with a steady dimmed hull. The corridor
  itself cannot stop moving — that is the game — but nothing decorative moves.
- No strobing: the collision beat is one GIF and one dimmed second.
- The fog rule in §2.4 is an accessibility floor as much as a fairness one —
  a rock has to be *visible*, with contrast, before it has to be dodged.

## 12. Open questions

1. **The win condition** (§2) — fixed track and lives as the budget, as
   specced, or `endless` with five hits ending the run? The issue says neither.
2. **Two axes or one.** Tilting up and down as well as left and right is the
   reading a perspective corridor invites, and it is what makes a gate a hole
   rather than a doorway. One axis is easier to control on a real phone and
   halves the fallback's job. Needs a playtest, and it changes the field
   generator.
3. **Every number in §5b is a guess** — `ASTEROID_CRUISE_SPEED`,
   `ASTEROID_SPACING`, `ASTEROID_GATE_EVERY` and `ASTEROID_CLEAR_Z` are the
   four that decide whether the game is playable at all, and none of them has
   been in front of a thumb.
4. **Do the shards stay live** (§2.3)? Specced yes, because a free gate is not
   a decision. If that reads as punishing in play, harmless shards are the
   dial.
5. **Should a boost be usable while stunned**, buying back some of the second
   it costs? Specced no — a stun you can pay your way out of is not a
   punishment — but it is the kind of thing that makes a race feel generous.
6. **1–8 players, confirmed?** The field is deterministic, so a solo time
   trial is genuinely playable and worth having on the hub; 2–8 would keep the
   catalogue's usual shape instead.
7. **A ladder strip, or full lanes?** Shake Rush gives the whole screen to
   everyone's positions; this game gives it to the corridor and squeezes them
   into a strip (§4). If the strip reads as an afterthought, the corridor may
   have to give up some height.

## 13. Rendering: plain `<canvas>`, and where the maths lives

**Plain `<canvas>` with `requestAnimationFrame`**, no library proposed. Neon
Fall §13 measured the alternative on this exact project — a minimal PixiJS
import came out at ~221 KB gzipped against a ≤ 150 KB per-game budget
([../../architecture.md](../../architecture.md) §4) — and Tiles Surfer §4
reuses that rejection rather than re-litigating it. This spec does the same,
and adds no dependency (AGENTS.md §3.3).

The perspective is arithmetic, not a 3D engine: one focal length, `scale =
FOCAL / (z + cameraBack)`, and a camera offset above and behind the hull.
Everything that decides an outcome is a pure function in
`www/src/games/asteroid-race/game.ts` — `asteroidAt`, the projection, the
collision test, the split, the reticle pick, the fog ramp — so it can be
tested without a canvas, the same split Sling Puck's `physics.ts` and Gravity
Shooter's `game.ts` already use.

**Asteroids are drawn, not sprited**, and this is the one exception to
[../../design/illustrations.md](../../design/illustrations.md) §4 worth
arguing for: a rock's silhouette is generated from its own index (so every
phone draws the same rock), it is scaled continuously by distance, it is
tinted toward the background by the fog, and it splits into two smaller
shapes. A sprite may only be translated, scaled and rotated — the tint and the
split are neither, the same reason Gravity Shooter's star is procedural. The
**ship** is a sprite, because it never changes shape.

Tests, per [../../testing.md](../../testing.md) §2 — every scoring and win
rule, and every threshold with a trace that must trigger and one that must
not:

- `worker/asteroidRace.test.ts` — the referee: `reachableBy`'s clamp and its
  claim window, lives only going down, the finish going to the first crosser,
  the cap handing it to the furthest, a stale `roundId`, the solo `winner:
  null`, and an away run freezing. Registered as `npm run test:asteroid`.
- `www/src/games/asteroid-race/game.test.ts` — the flight: two phones deriving
  the identical field from one `roundId`, the projection, a collision that must
  register and a near-miss that must not, a gate being genuinely impassable
  until it is shot, the split clearing the middle, the reticle picking the
  nearest rock and not the biggest, and §2.4's fog inequality asserted against
  the shipped constants. Registered as `npm run test:asteroid-ui`.
