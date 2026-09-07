# Crowd Race

| | |
| --- | --- |
| **Slug** | `crowd-race` |
| **Catchy sentence** | *Tilt through the crowd. First up the street wins* |
| **Illustration** | `www/src/games/crowd-race/art/card.svg` — a busy street from above, avatars weaving between pedestrians and a bicycle, trees down both sides |
| **Players** | 1–8 |
| **Round length** | 1–2 min |
| **Inputs** | orientation |
| **Accent colour** | `#3EC1A6` |
| **Status** | 📝 draft — awaiting approval ([#25](https://github.com/VincentGuigui/FonyGames/issues/25)) |

## 1. Pitch

You are a pedestrian on a crowded street, seen from above, walking up it
whether you like it or not. Tilt the phone to weave. The street is full of
other pedestrians and bicycles coming the other way, and when you clip one you
both bounce — and so does whoever they hit next.

The whole game is in that pile-up. Everyone else is on the same street, in the
same crowd, and you can see them.

## 2. Core loop

You walk up the street automatically. Tilt to steer. Don't get bounced back.

1. The referee rolls the **street** — every obstacle's spawn position, kind and
   direction — once, at start, and broadcasts the seed and the layout (§6).
2. Players spawn distributed along the start line at the bottom.
3. **Forward is automatic**, at `CROWD_WALK_SPEED`, in the *phone's own*
   reference frame: up-screen is up-street, so a phone held upside down walks
   its owner down the street. Tilt moves you across and along it (§5).
4. You cannot leave the screen: the street's left and right edges are walls,
   and the bottom of the viewport is a wall too — you can be pushed back down
   the street, but never off the bottom of it.
5. **Collisions bounce** (§2.1): pedestrians bounce, bicycles stop dead for
   `CROWD_BIKE_STUN_MS` (2 s), trees do not move at all.
6. First player to cross the finish line at the top wins. Everyone else keeps
   walking until `CROWD_RUN_CAP_MS`, so a whole room gets a placing.

**Win condition:** first across the finish line.
**Scoring:** finishing order, and distance up the street for anyone who did
not finish.

### 2.1 Collisions, bounces and cascades

**Everything has an ellipsoidal hitbox** — people are taller than they are
wide from above, and an ellipse is the cheapest shape that says so.

On contact, the bounce direction comes from the **collision point between the
two ellipses**: the impulse runs along the line joining the contact point to
each body's centre, so clipping someone's shoulder shoves you sideways while
walking into their back shoves you straight back. Intensity is a constant,
`CROWD_BOUNCE_IMPULSE`, for now — the issue says so explicitly, and a
mass-based version is §12 Q3.

| What you hit | What happens to it | What happens to you |
| --- | --- | --- |
| **Tree** (fixed) | nothing, ever | you bounce off it |
| **Pedestrian** | bounces | you bounce |
| **Bicycle** | stops for 2 s | you bounce |

**Bounces cascade.** A bounced pedestrian that lands on another pedestrian
bounces *that* one too, and so on, resolved in the same step. The cascade is
the reason to play — a good clip at the right moment sends four people
sprawling — so it is a core rule and not an optimisation to skip.

Cascade resolution is bounded: at most `CROWD_CASCADE_DEPTH` (4) generations
per step, so one unlucky pile-up cannot cost a frame.

### 2.2 The street, and where obstacles come from

Obstacles are **placed at game start for the whole street**, including the
parts nobody can see yet: three screen-heights above and three below the
current portion. That makes the street deterministic from the seed, which is
what lets every phone simulate it without anybody streaming positions (§6).

- **75% of moving obstacles walk down-street**, 25% up — so the crowd mostly
  comes at you.
- **Bicycles move at twice pedestrian speed** and are correspondingly rarer.
- **The three screen-heights above the start line are cleared** of obstacles at
  roll time, so nobody is bounced before they have taken a step.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `race` | First up the street wins | baseline |
| `rush-hour` | Twice the crowd, half the street | Shorter course, higher obstacle density — a 45 s version |

## 4. Screens

Standard flow. The primer explains the inverted control (a phone upside down
walks you backwards), because it is the one thing a player will otherwise
discover by losing.

The round screen is the street, scrolling under you, portrait:

- **Your own avatar** is the reference point, held around the lower third of
  the viewport so there is room to see what is coming.
- **Other players are their avatars**, drawn at their reported positions,
  slightly transparent so a pile-up stays readable. They are real obstacles to
  look at but **not** to collide with (§12 Q1).
- **A progress rail** down one edge: the whole street, the finish line, and
  every player's dot on it — the only place the field's shape is legible at a
  glance.

## 5. Inputs & sensors

**`deviceorientation`**, via the shared steering filter in
`www/src/core/sensors/steer.ts` — the same two-axis filter Asteroid Race uses,
with the same calibration-at-Ready and the same dead zone
([../device-capabilities.md](../device-capabilities.md)).

- **Two axes**: `gamma` steers across the street, `beta` along it. The
  reference frame is the phone's own, calibrated at Ready, which is what makes
  "upside down means downhill" true rather than a bug.
- **A dead zone** (`STEER_DEAD_ZONE`, 10%) so a hand at rest does not drift.
- **Tilt adds to the automatic walk** rather than replacing it: full forward
  tilt is `CROWD_TILT_BOOST` faster, full back tilt walks you backwards.

**Fallbacks** (mandatory): none, and this is a game AGENTS.md §4 allows to have
none — the tilt *is* the game, and a touch-steered version would be a
different, lesser one. The lobby says so before anyone starts, and a denied
permission gets an explanation and the way back to the hub.

## 6. Networking

**Profile B**, but only just — and the reason is worth stating: the obstacles
are **not** on the wire.

Every phone simulates the whole street from the referee's own seed and layout,
deterministically, so eight phones agree about where the crowd is without a
byte being spent on it. What genuinely has to travel is **where the other
players are**, because seeing each other is a stated requirement.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `crowd-street` | server → all | `{ roundId, seed, obstacles: [{x, y, kind, dir}], finishY, startsAt }` | The whole street, once |
| `crowd-move` | client → server | `{ roundId, x, y, at }` | This phone's own position, 4×/s |
| `crowd-field` | server → all | `{ roundId, at, players: {id: {x, y}} }` | Everyone's last known position, 4×/s |
| `crowd-finish` | client → server | `{ roundId, at }` | Crossed the line |
| `crowd-result` | server → all | `{ roundId, order: [id], distances: {id: y} }` | Placings |

**4 Hz, not 60.** Other players are scenery here, not something you collide
with, so their positions can be stale by a quarter-second without affecting
anyone's run. Each phone interpolates between the last two `crowd-field`
frames. That keeps this inside the cheap profile in
[../multiplayer.md](../multiplayer.md) despite being a continuous game.

**Who is authoritative:** the referee owns the street, the clock and the
finishing order. Each phone owns its own position — it has to, since the
simulation runs there — which is the trade §8 pays for.

## 7. Failure & edge cases

- **Player leaves mid-round**: their avatar disappears; they keep their
  distance-so-far in the placings, marked as left.
- **Host leaves**: the run continues; the street and clock are the referee's.
- **Solo (1 player)**: supported — a time trial against the crowd.
- **Permission denied**: cannot play (§5); stays as a spectator on the rail.
- **Backgrounded tab**: the phone stops simulating and stops reporting. On
  return it resumes from the referee's clock — which means it lost the time,
  which is correct. Its avatar is drawn dimmed while it is silent.
- **Nobody finishes** before `CROWD_RUN_CAP_MS`: placings are by distance.
- **Two players finish in the same frame**: the referee's arrival order decides,
  and a genuine tie (same millisecond) is a shared placing.

## 8. Anti-cheat

Each phone reports its own position, so a modified client can claim to be
anywhere. The mitigations are the same shape as Asteroid Race's own
`reachableBy` check:

- **A reported position is bounded by what the walk could have covered** since
  the last report — `CROWD_WALK_SPEED × elapsed`, plus the tilt boost, plus a
  slack. A jump past that is clamped, not accepted.
- **The finish is checked against the same bound**: a phone cannot report the
  finish line earlier than the walk allows.
- **Lateral position is clamped to the street.**
- **The street is the referee's**, so nobody can play a course with no crowd
  on it.

## 9. Safety

Mandatory, and it is the real risk here: this is a game about tilting a phone
while looking at it, and the theme is a busy street.

> **Sit down, or stand still.** This one is played with your feet planted —
> you tilt the phone, not yourself. Don't play it while actually walking down a
> street, and give the person next to you some room.

Enforced: the round is capped at `CROWD_RUN_CAP_MS`, there is no mechanic that
rewards moving your body, and no mechanic that rewards shaking or swinging the
phone.

## 10. Data & privacy

Two coordinates per player, four times a second, relayed within the room and
never stored. No sensor reading leaves the phone — the tilt is turned into a
position locally, and only the position travels
([../device-capabilities.md](../device-capabilities.md)).

## 11. Accessibility

- **Tilt-only is an exclusion**, and it is disclosed in the lobby before anyone
  starts (§5).
- **Reduced motion**: the street still scrolls (it is the game), but the
  screen-shake on a bounce is suppressed and the cascade is not embellished.
- **Obstacles differ in silhouette**, not just colour — a bicycle is a
  different shape from a pedestrian, so the "which of these stuns me" rule is
  never a colour code.
- **The progress rail is the text version of the race**: positions are
  announced as "3rd of 6" rather than only shown.
- **Sensitivity is adjustable** in the gear menu, as Asteroid Race's is, which
  is what makes this playable for someone with limited wrist movement.

## 12. Open questions

1. **Do players collide with each other?** The issue says they can see each
   other but does not say. This spec assumes **no** — player-to-player
   collisions would need positions at 60 Hz and authoritative arbitration, which
   is a different cost profile entirely. Worth a yes or no before code.
2. **`CROWD_BOUNCE_IMPULSE` as a single constant** — the issue says so for now.
   A bicycle bouncing you as hard as a pedestrian will probably feel wrong the
   first time it happens.
3. **Mass**: pedestrians all identical, or a range? A cascade through
   identical bodies is easier to predict and probably easier to enjoy.
4. **How long the street is.** "First to the top" needs a length; 60–90 s of
   clean walking is the target, which the crowd will roughly double.
5. **Whether being pushed back below the start line is possible.** §2 says the
   viewport bottom is a wall; if the street can push you back that far, a
   player can be pinned there by traffic.
