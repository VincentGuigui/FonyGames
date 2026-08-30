# Tiles Surfer

> Status: **built, beta**. Verified end to end against a real Worker: the shared
> lane sequence, the score/miss/speed formulas, own-lives elimination, the
> genuinely-solo "no winner" edge case, and the round-over panel with its
> longest-streak note. The spawn cadence, safety cap and difficulty curve
> numbers are stated defaults (§12), untested against a real thumb.

| | |
| --- | --- |
| **Slug** | `tiles-surfer` |
| **Catchy sentence** | *Tap the tile the instant it hits the line* |
| **Illustration** | `www/src/games/tiles-surfer/art/card.svg` — a dark pavement of five lanes, one glowing tile mid-fall toward a bright line near the bottom |
| **Players** | 1–8 |
| **Round length** | Up to 5 min (§7); most runs end sooner, on elimination |
| **Inputs** | touch |
| **Accent colour** | `#F0ABFC` |
| **Status** | beta |

## 1. Pitch

Five lanes, tiles falling straight down each of them. Tap a tile the
instant its edge reaches the line near the bottom — dead on time is worth
the most, early or late is nothing. Every player runs their own board, at
their own pace, against the same shared five lives: land your taps and
the board gets faster; miss one and you both lose a life and get a little
breathing room back. Last one still standing wins.

## 2. Core loop

Every player plays their own board — this is not one shared lane like
Squash Mosquitoes' single board, it's a private run each player has to
survive on their own, the same relationship Steady Hand's players have to
each other.

1. Host starts the round. Every board begins identical: empty, five
   lanes, tiles about to start falling.
2. Tiles fall down a random lane, one every `TILES_SPAWN_INTERVAL_MS`
   (600 ms), taking `TILES_INITIAL_FALL_MS` (2 s) to cross the board at
   the start. **Which lane each tile falls down is the same sequence for
   every player** (§2.1) — nobody's board is quietly easier.
3. **Tap the lane the instant the tile's own leading edge reaches the
   line, 50px above the bottom of the screen.** Dead on time is worth 10
   points; tap late and the value falls in a straight line to 0 by the
   moment the tile has fully passed the line — at which point it is a
   miss, the same as tapping too early (§2.2).
4. **A miss costs one of five lives**, and softens the board: the fall
   speed drops back by 20%, though never below where the round started
   (§2.3). **A landed tap does the opposite** — the board speeds up 2%,
   tile over tile, so the run only ever gets harder while it's going
   well.
5. Run out of lives and you are out — your board stops, everyone else's
   keeps going.
6. The round ends the moment only one player is still going. That player
   wins.

**Win condition:** last player with lives remaining.
**Scoring:** the running sum of tap values (§2.2) — used for the live
leaderboard and to break a tie at the safety cap (§7), never for the win
itself.

### 2.1 A shared lane sequence, without ever sending one

Every player's tiles fall down the identical sequence of lanes, tile for
tile — but each player's own speed diverges the moment they land or miss
a tap, so nobody is looking at a literally synchronized shared board
(unlike Squash Mosquitoes' one board everyone shares). What has to stay
identical is just "which lane does tile #`n` fall down," and that turns
out not to need a shared board OR a transmitted seed at all: `roundId`
— already broadcast, already unique per round — is the only input a pure
function needs. `trackForTile(roundId, tileIndex)` (`game.ts`, client
only — the referee never needs to know a lane, §8) is a small
deterministic integer hash returning `0..4`; every client computes the
same lane for the same tile index, the same way UFO Hunt's `ufoPositionAt`
lets two phones agree on where the saucer is from nothing but a shared
index and math, never a value sent frame by frame.

### 2.2 The score formula, and what counts as a miss

Let `windowMs` be how long the tile takes to cross its own height — tile
height is fixed at 2× a lane's own width (§4), so `windowMs = tileHeightPx
/ speedPxPerMs` at that tile's own fall speed. `offsetMs` is how long
after the tile's leading (bottom) edge reached the line the tap landed.

```
score = clamp(10 * (1 - offsetMs / windowMs), 0, 10)
```

A tap before the leading edge arrives, or after `offsetMs` exceeds
`windowMs` (the tile's trailing edge has now passed the line too) is a
**miss** — 0 points, one life gone, same consequence whether the tap was
early or simply too late. A **perfect** tap is one that rounds to the
full 10 (`Math.round(score) === 10`) — not a separate tolerance constant,
the same "the score already says it" reasoning Tap Tap Music uses for not
tracking a redundant accuracy stat next to its own clock.

### 2.3 The difficulty curve is a speed multiplier, not the fall time itself

`speedMul` starts at `1` and is the one number that actually evolves:

- A landed tap (any score `> 0`): `speedMul *= 1.02`.
- A miss: `speedMul = Math.max(1, speedMul * 0.8)` — cut by a fifth, but
  never below the round's own starting speed. Misses give ground back;
  they cannot make the round easier than it began.

A tile's own fall duration (`TILES_INITIAL_FALL_MS / speedMul`) is fixed
the instant it spawns — it does not speed up or slow down again mid-fall,
so a tile already on screen never visibly jumps.

### 2.4 Each player's own stats

Tracked locally, all-time for that player's run, and carried in every
`tiles-report` (§6): the count of perfect taps, the longest unbroken run
of them, and the mean `offsetMs` across every non-miss tap
(`avgReactionMs`) — a genuine reaction-time number, not merely how many
were correct.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: a `<canvas>` board, five lanes top to bottom, a bright line
  50px above the bottom edge. Tiles are 1 lane-width wide, 2 lane-widths
  tall, falling straight down, glowing on the game's own accent as they
  near the line. A tap targets **the lane**, not the tile's own moving
  pixels — one of five fixed tap zones spanning the board, resolved
  against whichever tile is currently nearest the line in that lane, the
  same "tap the lane, not the exact pixel" idiom Neon Fall's protector
  triggers already use. This board is rendered on `<canvas>`, the same
  reasoning — and the same measured rejection of PixiJS — Neon Fall's own
  §13 already recorded: many continuously falling, continuously animated
  tiles is not a DOM-diffing job.
- **Own lives**: a row of five pips, same idiom Pass the Bomb and Steady
  Hand already use, always visible.
- **Live leaderboard**: the shared `Scoreboard` component, `best="high"`,
  fed from `scores` (§6) — live only at whatever cadence a `tiles-report`
  actually arrives (§6, §8), not truly real-time.
- **Results**: the shared `GameOverScreen` — "You won" / "Someone won" /
  "Nobody won" from `strings.ts`, no extra copy needed for that. Its own
  `note` slot (the same one Ghost Hunt's fastest-find line already uses)
  carries the longest perfect streak across every player.
- No rules panel beyond the lobby's own one or two sentences — the whole
  mechanic is "tap it on the line," and that is the entire explanation a
  player needs before playing.

## 5. Inputs & sensors

Touch only — a tap on a lane. No sensors, no permissions, nothing to fall
back from.

## 6. Networking

```ts
// client -> server, on a 100-point checkpoint OR the moment lives hit 0 — never per tap
{ t: 'tiles-report', d: { roundId, score, lives, perfects, longestStreak, avgReactionMs } }

// server -> both
{ t: 'tiles', d: {
  roundId, startsAt, endsAt,
  scores: Record<PlayerId, { score, lives, perfects, longestStreak, avgReactionMs }>,
  winner: PlayerId | null,
  phase: 'running' | 'done',
} }
```

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `tiles-report` | client → server | `{roundId, score, lives, perfects, longestStreak, avgReactionMs}` | This player's own current numbers — sent at a 100-point checkpoint or the instant their own lives reach 0, nothing in between |
| `tiles` | server → both | see above | Everyone's last-reported numbers and the match's own phase/winner — nothing here is private |

**Every tap itself stays entirely local** — this is a deliberate departure
from how every other game in this catalogue reports, spelled out plainly
in §8. The referee never sees a tap, a lane, or a tile; it only ever sees
the periodic and terminal numbers above.

The winning player is never the one whose own report ends the match — by
definition they are still playing when the second-to-last player's own
`lives: 0` report arrives. The referee's own broadcast of `phase: 'done'`
is their cue to send one closing `tiles-report` immediately, so the
results panel shows their real final numbers rather than whatever their
last 100-point checkpoint happened to be.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Treated exactly like reaching 0 lives — out, and the remaining count is rechecked for a winner |
| The 5-minute safety cap hits with more than one player still going | Ranked by each one's last-reported score; a tie at the top is unranked, the same convention every other game's own cap uses |
| A genuinely solo room (1 real player) | There is nobody to outlast — the run ends at that player's own elimination, `winner: null`, a personal run rather than a forced win |
| Fewer than 1 player | Start disabled (the room is always at least 1) |
| A player refreshes mid-round | Same seat, same last-reported numbers — a refresh does not reset a board, since the board itself lives entirely on that player's own phone |
| Two players' closing reports land in the same tick | Server-sequential, not simultaneous — whichever the Durable Object actually processes second sees the other already out |

## 8. Anti-cheat

**As built, and stated plainly rather than glossed over: there isn't
one.** Every other game in this catalogue validates the action itself —
Steady Hand judges the wobble every tick, Shake Rush trusts a shake count
but pins it under three separate mathematical ceilings, UFO Hunt
recomputes the saucer's true position server-side before scoring a shot.
This game does none of that, by direct instruction: taps stay local, and
the referee stores whatever a `tiles-report` claims.

- **What the referee does do**: cheap range clamps on arrival, not
  validation — every field (`score`, `lives`, `perfects`, `longestStreak`,
  `avgReactionMs`) must be finite and non-negative or that one field is
  simply not updated this report, and `lives` is additionally capped at
  `TILES_LIVES`. This stops a malformed message from corrupting the shared
  state; it does not stop a player from simply lying about their own
  numbers.
- **What this costs**: a modified client can report any score, any streak,
  claim to be alive indefinitely, or claim a life loss it never suffered.
  Nothing here can tell the difference. The leaderboard and the eventual
  winner are both exactly as trustworthy as every player in the room.
- **Why anyway**: asked for directly — "the effort does not worth it" —
  weighed against a mechanic (tap timing against a moving tile) that would
  otherwise need every single tap round-tripped through the referee to
  validate at all, on a game whose whole feel depends on a tap resolving
  the instant a finger lifts.

## 9. Safety

Seated, one-handed, nothing thrown or swung. Lowest-risk category in the
catalogue, same as Tap Tap Music and Tic-Tac-Tic-Tac-Toe — no safety copy
needed beyond the baseline every screen already carries.

## 10. Data & privacy

Only each player's own periodic score/lives/stat numbers leave the phone
(§6) — never a tap, a timestamp, or a lane. Room memory only, for the
life of the round.

## 11. Accessibility

The line and every tile read by position and glow, never colour alone —
a player with colour-blindness reads "how close to the line," not "which
colour it turned." Reduced motion shortens the tile's own fall-in/land
flourish, not the fall itself (the fall IS the mechanic — there is no
version of this game without motion on screen, the same honest limit
Neon Fall's own glider states about itself). Own lives and the live
leaderboard are both plain text, readable by a screen reader like any
other status bar in this catalogue.

## 12. Open questions

- **Spawn cadence** (`TILES_SPAWN_INTERVAL_MS = 600`) and the **safety
  cap** (`TILES_ROUND_CAP_MS = 5 min`) are both stated defaults, not
  numbers the brief itself gave — untested on real thumbs, tunable after
  a first playtest.
- **Accent colour** (`#F0ABFC`) is a first pass at the "illuminescent
  pavement tile" brief — worth revisiting once the real art exists.
