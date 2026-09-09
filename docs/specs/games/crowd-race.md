# Crowd Race

| | |
| --- | --- |
| **Slug** | `crowd-race` |
| **Catchy sentence** | *Tilt through the crowd. First up the street wins* |
| **Illustration** | `www/src/games/crowd-race/art/card.svg` — a busy street from above, avatars weaving between pedestrians and a bicycle, trees down both sides |
| **Players** | 1–8 |
| **Round length** | ~10–45 s of walking, capped at 60 s |
| **Inputs** | orientation |
| **Accent colour** | `#3EC1A6` |
| **Status** | 🎮 beta — built; movement is an uncalibrated gravity read and the street is dealt privately per phone rather than broadcast, both corrected from this draft during the build (§2.2, §5); the whole street is a **fixed, one-screen board, not a scrolling course**, corrected after the first build (§2, §4); untested on real phones ([#25](https://github.com/VincentGuigui/FonyGames/issues/25)) |

## 1. Pitch

You are a pedestrian on a crowded street, seen from above, walking up it
whether you like it or not. Tilt the phone to weave. The street is full of
other pedestrians and bicycles coming the other way, and when you clip one you
both bounce — and so does whoever they hit next.

The whole game is in that pile-up. Everyone else is on the same street, in the
same crowd, and you can see them.

## 2. Core loop

You walk up the street automatically. Tilt to steer. Don't get bounced back.

**The whole street is one fixed screen, not a scrolling course**: the
start line sits a small margin up from the very bottom of the screen, the
finish line a small margin down from the very top, and nothing ever scrolls —
the entire course is visible, start to finish, for the whole round.

1. Every phone deals the **street** itself — every obstacle's spawn position,
   kind and direction — from the round's own id, with nothing broadcast (§6).
2. Players spawn on the start line, `CROWD_START_Y` up from the bottom edge.
3. **Forward is automatic**, at `CROWD_WALK_SPEED` (one `CROWD_SCREEN_HEIGHT`
   every 10 s), in the *phone's own* reference frame: up-screen is up-street,
   so a phone held upside down walks its owner down the street. Tilt moves you
   across and along it (§5).
4. You cannot leave the screen: the street's left and right edges are walls,
   and the very bottom edge of the fixed screen (world `y = 0`) is a wall too
   — you can be pushed back down the street, but never past it.
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
bounces *that* one too, and so on. The cascade is the reason to play — a good
clip at the right moment sends four people sprawling — so it is a core rule
and not an optimisation to skip.

**Built as one pairwise pass a step, not a depth-limited chain.** The draft
proposed a `CROWD_CASCADE_DEPTH` generation cap; building it, that turned out
to be solving a cost problem this game doesn't have. Every step already runs
one O(n²) pass over the (small, per-phone) obstacle list, checking each pair
once — cheap at any crowd size this game deals — so a pile-up spreads
naturally over however many frames it physically takes a shoved body to reach
its neighbour, with no artificial chain to bound. The constant was dropped
rather than wired to nothing.

### 2.2 The street, and where obstacles come from

**Built as one dealt course, not a streamed window.** The draft above pictured
a scrolling window — obstacles placed "three screen-heights above and three
below the current portion" as the player advances. The course has a known,
fixed finish line, so there is no "current portion" that needs a window: one
arithmetic pass deals every obstacle's spawn slot for the whole street from
the round id, the same way Asteroid Race's field is dealt from its own seed.
`CROWD_START_CLEAR` is the part of that pass left empty, not a moving window —
nothing is dealt there, so nobody is bounced before their first step.

**Every phone deals the identical spawn plan, then simulates it privately.**
The plan (positions, kinds, directions) is pure arithmetic on the round id, so
eight phones agree on it with nothing sent — but from there, each phone's own
bounces and cascades run locally and never cross the wire (§6). A bounce is
triggered by one player's own collision, which the referee cannot see and has
no reason to; the alternative — keeping every phone's *post-bounce* crowd in
sync — would need streaming every obstacle's position at 60 Hz, the exact cost
this profile exists to avoid.

- **75% of moving obstacles walk down-street**, 25% up — so the crowd mostly
  comes at you (`game.ts`'s own `y += dir * speed * dt`: down-street is `-1`,
  the opposite sign from the player's own forward).
- **Bicycles move at twice pedestrian speed** and are correspondingly rarer.
- **A small buffer above the start line is cleared** of obstacles at deal time
  (`CROWD_START_CLEAR`), so nobody is bounced before they have taken a step —
  a fixed few dozen units now that the whole course fits one screen, not the
  multiple screen-heights a scrolling street would have needed.
- **A moving obstacle wraps back into the dealt band** (`CROWD_START_CLEAR` to
  `CROWD_FINISH_Y`) once it walks out the far end, rather than walking off the
  fixed board for good — the crowd reads as a continuous flow past the player
  rather than draining away, which matters more now that the whole board is
  always on screen at once (§2, §4).

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `race` | First up the street wins | baseline |
| `rush-hour` | Twice the crowd | Higher obstacle density on the same fixed board — not yet implemented (`card.ts`'s own `modes: []`), and worth a fresh look now that the base course is already the short, fixed board this mode used to shrink toward |

## 4. Screens

Standard flow. The primer explains the inverted control (a phone upside down
walks you backwards), because it is the one thing a player will otherwise
discover by losing.

**The round screen is the whole street, fixed, portrait — it never scrolls.**
The start line sits a small margin up from the bottom edge, the finish line a
small margin down from the top, and both are visible for the entire round
alongside everything between them. The fixed `CROWD_STREET_WIDTH` ×
`CROWD_SCREEN_HEIGHT` rectangle is scaled to fit inside whatever the phone's
own canvas is ("contain", not "cover"), so it is never cropped — a phone whose
own aspect ratio does not exactly match gets a thin band of pavement at the
sides or top/bottom instead.

- **Your own avatar** moves within that fixed frame, wherever it actually is —
  there is no camera to hold it in place, since the whole board already fits.
- **Other players are their avatars**, drawn at their reported positions,
  slightly transparent so a pile-up stays readable. They are real obstacles to
  look at but **not** to collide with (§12 Q1).
- **A progress rail** down one edge: the whole street, the finish line, and
  every player's dot on it — a smaller-scale echo of the fixed board itself,
  but still worth keeping once the board is legible on its own, since it is
  the only place a player who is not looking at the canvas gets the standings
  at a glance.

## 5. Inputs & sensors

**`deviceorientation`**, via `downVector(gamma, beta)`
(`www/src/core/sensors/gravity.ts`) — **not** the calibrated two-axis steer
filter this draft originally proposed.

**Built uncalibrated, on purpose.** The issue's own wording — "upside down
phone means going down the street" — is an absolute statement about gravity,
not about however the phone happened to be held at Ready. Asteroid Race's
`steer2Filter` zeroes itself to the Ready pose, which would make "upside down"
mean something different depending on how the player was holding the phone
when they pressed Start; that contradicts the issue directly, so this game
reads gravity's own down instead, every frame, with no calibration step.

- **The walking direction *is* gravity's own down**, continuously: held
  upright, gravity's down points down the screen, which is *forward* here (§2
  walks "up the street"); turn the phone upside down and it flips, so the
  player walks backward — the issue's own example, exactly. There is no
  separate forward throttle for tilt to add to.
- **A magnitude floor** (`CROWD_MIN_TILT`), not a dead zone at the centre: a
  flat phone has no reliable in-plane reading at all, so below the floor the
  player keeps walking in whatever direction they last had, rather than
  snapping to a default or drifting on sensor noise.
- `CROWD_TILT_BOOST` does not exist — there is no separate throttle for it to
  boost.

**Fallbacks** (mandatory): none, and this is a game AGENTS.md §4 allows to have
none — the tilt *is* the game, and a touch-steered version would be a
different, lesser one. The lobby says so before anyone starts, and a denied
permission gets an explanation and the way back to the hub.

## 6. Networking

**Profile B**, but only just — and the reason is worth stating: the obstacles
are **not** on the wire.

Every phone deals the whole street from the round id alone, deterministically,
so eight phones agree about where the crowd starts out without a byte being
spent on it (§2.2) — and each phone's own bounces and cascades stay private
from there. What genuinely has to travel is **where the other players are**,
because seeing each other is a stated requirement.

**Built as two messages, not five.** The draft's `crowd-street` /
`crowd-field` / `crowd-finish` / `crowd-result` each covered a slice of state
this game turns out to need continuously and all at once — every player's
position, the round's own clock, and the winner, moment to moment — so it is
one server→all message carrying the whole `CrowdRaceState`, the same shape
Asteroid Race and Math-o-matic already broadcast their own race state in,
rather than a special-purpose message per event:

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `crowd-move` | client → server | `{ roundId, x, y, at }` | This phone's own position, 4×/s |
| `crowd` | server → all | `CrowdRaceState`: `{ roundId, startsAt, endsAt, walkers: {id: {x, y, finishedAt, away}}, winner, phase }` | Everyone's last known position and the race's own state |

There is no separate `seed` field: `roundId` **is** what `dealStreet` deals
from, so nothing else is needed to reproduce the street.

**4 Hz, not 60.** Other players are scenery here, not something you collide
with, so their positions can be stale by a quarter-second without affecting
anyone's run. Each phone interpolates between the last two `crowd` frames.
That keeps this inside the cheap profile in
[../multiplayer.md](../multiplayer.md) despite being a continuous game.

**Who is authoritative:** the referee owns the round's clock, who is marked
`away`, and the finishing order. Each phone owns its own position — it has to,
since the simulation runs there — which is the trade §8 pays for.

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
  the last report — `CROWD_WALK_SPEED × elapsed`, plus a slack
  (`CROWD_CLAIM_SLACK`). There is no tilt boost to add in (§5's build note): a
  jump past the bound is clamped, not accepted.
- **The bound is dual-clamped**: also by time since the round itself started,
  and time since the last report is itself capped at `CROWD_AWAY_MS` — so a
  phone cannot bank silence and spend it as one giant claim.
- **The finish is checked against the same bound**: a phone cannot report the
  finish line earlier than the walk allows.
- **Lateral position is clamped to the street.**
- **The street has nothing worth spoofing**: it is dealt identically by every
  phone from the public `roundId` (§2.2, §6), so there is no referee-held
  layout a modified client could claim to be missing.

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
- **Reduced motion**: the street is fixed and never scrolls to begin with; a
  bounce still displaces bodies (it is the game), but any screen-shake on
  impact is suppressed and the cascade is not embellished.
- **Obstacles differ in silhouette**, not just colour — a bicycle is a
  different shape from a pedestrian, so the "which of these stuns me" rule is
  never a colour code.
- **The progress rail is the text version of the race**: positions are
  announced as "3rd of 6" rather than only shown.
- **Sensitivity is not adjustable.** The gear-menu setting this draft assumed
  lives in `core/sensors/steer.ts`, the calibrated filter §5's build note
  explains this game does not use — `downVector` has no gain to turn down.
  Left open below (§12) rather than fixed silently.

## 12. Open questions

1. ~~**Do players collide with each other?**~~ Built as **no** — rivals are
   drawn from `crowd-move` reports but never checked against the player's own
   hitbox. Still worth a yes or no from a playtest, since it is the easiest of
   these to add later.
2. **`CROWD_BOUNCE_IMPULSE` as a single constant** — the issue says so for now.
   A bicycle bouncing you as hard as a pedestrian will probably feel wrong the
   first time it happens. Not changed in this build.
3. **Mass**: pedestrians all identical, or a range? A cascade through
   identical bodies is easier to predict and probably easier to enjoy. Not
   changed in this build.
4. ~~**How long the street is.**~~ Settled twice. First built as
   `CROWD_COURSE_LENGTH` = 4000 units on a scrolling course; rebuilt as a
   fixed, one-screen board — `CROWD_SCREEN_HEIGHT` = 600, so
   `CROWD_COURSE_LENGTH` (the gap between the start and finish margins) is 520
   — under 10 s of clean walking at `CROWD_WALK_SPEED`, before the crowd's own
   delay.
5. ~~**Whether being pushed back below the start line is possible.**~~ Built
   as: yes, a little, but never off the bottom of the fixed screen. There is
   no longer a *ratchet* floor that rises with progress — the scrolling course
   that needed one is gone — so the wall is simply world `y = 0`, the fixed
   screen's own bottom edge, a small margin below the start line itself.
6. **No sensitivity setting** (§11) — this game's uncalibrated, un-gained
   `downVector` read means the gear-menu slider that helps Asteroid Race does
   nothing here. Worth its own adjustable floor (`CROWD_MIN_TILT`) or gain if
   a playtest finds it too twitchy or too dead.
7. **Obstacles recycle by wrapping `y`, in place** (§2.2) — found necessary
   during the first build, and now central to the fixed-board redesign: since
   the whole street is always on screen, a flowing crowd depends on it. A
   pedestrian that wraps keeps its `x`, so the same lane empties and refills
   rather than reshuffling. Worth a playtest: does the repeating pattern read
   as an obviously looping street once a player is paying attention to it —
   more likely now that the wrap point can be on screen at the same time as
   the wrapped body, rather than off in an unseen part of a long course?
8. **`rush-hour`'s own numbers are stale** (§3) — written against a scrolling
   course that no longer exists, and not yet implemented. Worth a fresh design
   pass once the base game has had a real playtest.
