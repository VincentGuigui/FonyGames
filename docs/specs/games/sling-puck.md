# Sling Puck

| | |
| --- | --- |
| **Slug** | `sling-puck` |
| **Catchy sentence** | *Sling every puck onto their side before they sling them back* |
| **Illustration** | `illustrations/sling-puck.svg` — two phones nose to nose, a stretched elastic on the near one, a puck streaking through the gap between them |
| **Players** | 2 — exactly |
| **Round length** | 30 s – 2 min |
| **Inputs** | touch (drag back and release) |
| **Accent colour** | `#FB7185` |
| **Status** | 📝 spec |

## 1. Pitch

The French bar game *passe-trappe*, on two phones laid nose to nose.

Your half of the board is on your screen. An elastic band is stretched across
the bottom, your pucks resting behind it. Pull one back, let go, and it fires up
the board, off the walls, and — if you aimed well — through the gap at the top
onto your opponent's screen. They are doing the same thing back at you, at the
same time, with no turns and no mercy.

First one to clear their side wins.

## 2. Core loop

1. Two phones flat on the table, **top edge to top edge**, one player at each
   outer end. The join between them is the gap.
2. A four-second rules panel, as everywhere
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4).
3. Each player starts with **5 pucks** resting against their elastic.
4. Drag a puck back, release. The band launches it.
5. It bounces off the left, right and bottom walls, and off the top wall
   *except* at the gap.
6. Through the gap, it lands on the other player's screen, still moving.
7. Both players are doing this continuously. No turns.

**Win condition:** first player with **no pucks on their side**.
**Scoring:** none beyond the win. Rounds are short; "again?" is the scoring.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | Five pucks each, first side clear wins | baseline |
| `sudden` | One puck each, one gap, pure nerve | later — `SLING_PUCKS = 1` |
| `narrow` | Half the gap, twice the swearing | later — smaller `GAP_FRACTION` |

Only `classic` is built.

## 4. The architecture that makes this cheap

This is the first game in the catalogue with **continuous interactive physics**:
pucks accelerate, decelerate, bounce and hit each other. Naively that is a
disaster on the cost model — streaming positions at 20 Hz is Profile B in
[../../realtime-options.md](../../realtime-options.md), about thirty times the
traffic of an event game — and running the simulation in the Durable Object
means waking it 20+ times a second for the whole round.

Neither is necessary, because of one fact about passe-trappe:

> **You can only see your own half of the board.**

A puck is on exactly one side at a time, and only that side's player can see it.
So there is no shared simulation at all:

- **Each phone simulates its own half**, fully, locally, at 60 fps.
- The **only** thing that crosses the wire is a puck crossing the gap.
- The server owns the **count** on each side, and nothing else.

That makes the game Profile **A** — a frantic round is a couple of hundred
messages — and it makes desynchronisation *impossible* rather than merely
unlikely, because there is no second copy of any puck to drift from.

It is also why the physics lives in `www/src/games/sling-puck/physics.ts` and
**not** in `shared/`: unlike Spill's seat geometry or Goat Siege's split lanes,
nothing on the server needs to agree with it.

### The handoff

Phones nose to nose are rotated 180° from each other, so the crossing is a
rotation. In normalised coordinates (x across the board 0..1, y down 0..1,
velocity in board-heights per second):

| Leaving A | Arriving at B |
| --- | --- |
| `x` | `1 - x` |
| `vx` | `-vx` |
| `vy` (negative, upward) | `-vy` (positive, downward) |

Normalised on purpose: the two phones are not the same size, and the board must
be the same board on both.

## 5. Networking

| Message | Direction | Payload |
| --- | --- | --- |
| `cross` | client → server | `{ roundId, x, vx, vy }` — a puck left my half, in my frame |
| `sling` | server → clients | Whole round: `{ roundId, startsAt, players, pucks, phase }` |
| `puck` | server → clients | `{ from, to, x, vx, vy, at, pucks }` — already rotated into the receiver's frame |
| `sling-over` | server → clients | `{ roundId, winnerId, pucks }` |

The server rotates the coordinates, so neither client has to know which way
round it is sitting — and a client that lies about the rotation cannot make a
puck arrive somewhere impossible.

`pucks` rides on every frame that can change it, as in Spill: the count is the
score, and a separate message for it would only be a chance to disagree.

## 6. Internal settings

Everything below is a **tuning constant, not a player-facing option**. They live
together at the top of `physics.ts` so a play test can move them in one place.

| Constant | Start value | What it does |
| --- | --- | --- |
| `SLING_PUCKS` | 5 | Pucks per player |
| `PUCK_RADIUS` | 0.055 | Fraction of board width |
| `ELASTIC_K` | 5.2 | Launch speed per unit of stretch |
| `MAX_PULL` | 0.28 | Longest useful pull, as a fraction of board height |
| `BAND_REST_Y` | 0.82 | Where the band sits when relaxed |
| `BAND_SNAP` | 14 | How fast the band whips back once released (visual only) |
| `FRICTION` | 0.55 | Constant deceleration — a puck sliding on wood, not in treacle |
| `RESTITUTION` | 0.72 | Energy kept in a wall bounce |
| `PUCK_RESTITUTION` | 0.86 | Energy kept in a puck-on-puck hit |
| `GAP_FRACTION` | 0.34 | Width of the gap as a fraction of the board |
| `REST_SPEED` | 0.02 | Below this a puck is treated as stopped |
| `SUB_STEPS` | 4 | Physics sub-steps per rendered frame |

Two choices in there are deliberate rather than arbitrary:

- **Friction is a constant deceleration, not linear damping.** `v *= 0.98` never
  quite stops and feels like syrup; subtracting a fixed amount of speed per
  second is what a disc sliding on a board actually does, and it *does* stop.
- **`SUB_STEPS` exists so fast pucks cannot tunnel.** A puck crossing half the
  board in one frame would skip straight through a wall; four sub-steps at 60 fps
  keeps the per-step movement well under a puck radius at the top speed
  `ELASTIC_K × MAX_PULL` allows.

## 7. The sling

"Realistic" means the band is modelled, not faked.

The band is a straight line between two posts at the bottom corners. Loading a
puck and pulling it to point **P** bends it into a V: `post₁ → P → post₂`. Each
segment pulls toward its own post, so the launch direction is

```
launch ∝ unit(post₁ − P) + unit(post₂ − P)
```

Pull straight back from the middle and it fires straight up the board. Pull back
and to the **left** and the V is lopsided — the right-hand segment is longer and
wins — so it fires up and to the **right**. That is how the real thing behaves,
it falls out of the model rather than being special-cased, and it is what makes
aiming a skill rather than a slider.

Speed comes from the stretch: how much longer the V is than the resting band,
times `ELASTIC_K`, capped at `MAX_PULL`.

Only arithmetic and `sqrt` — no trigonometry anywhere in the physics.

## 8. Screens

- **Lobby** — the shared template ([../../design/game-chrome.md](../../design/game-chrome.md) §1),
  plus a diagram of the two phones nose to nose.
- **Board** — your half, seen from your end: gap at the top, band across the
  bottom, your pucks behind it. Puck count top-left, gear top-right.
- **Result** — who cleared their side.

The gap is drawn as a break in the top wall, and the wall either side of it is
drawn solid, because "which part of the top edge is open" is the single most
important thing to read at a glance.

## 9. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A puck stops in the gap | Cannot happen: a crossing is decided the instant the centre passes the line while inside the gap span |
| A puck crosses back immediately | A new crossing from the other side. Nothing special |
| Both sides reach zero | Cannot happen: a crossing empties one side and fills the other, one message at a time |
| A player refreshes | Same seat, same **count**; their pucks are replaced at rest. In-flight motion on their own half is lost — nobody else could see it, so nobody else is affected |
| A player leaves | The round ends. Two players is the whole game |
| Tab backgrounded | `requestAnimationFrame` stops, so their half freezes. On return the simulation resumes from where it was — it is theirs alone, so a frozen half only hurts them |
| Round cap | 3 min, then fewest pucks wins; a draw if level |

## 10. Anti-cheat — and its honest limit

What the server does enforce:

- **Conservation.** Pucks are neither created nor destroyed; a crossing moves
  exactly one. You cannot invent a puck to throw.
- **You cannot pass what you do not have.** A crossing from an empty side is
  rejected.
- **A floor on throughput.** `SLING_MIN_GAP_MS` between crossings from the same
  player, on top of the room's per-connection rate limit.
- **Arrival is clamped.** `x` into 0..1 and the speed into a plausible range, so
  a forged crossing cannot spawn a puck outside the board or moving at an
  impossible speed.

What it **cannot** enforce: the physics is client-side, by the design in §4. A
modified client can report crossings it did not earn and clear its side in about
`5 × SLING_MIN_GAP_MS` instead of the ten-odd seconds a good human needs.

That is a real hole and it is stated here rather than hidden. It is acceptable
for this game because it is played by two people sitting opposite each other
looking at each other's hands — the social check is stronger than the technical
one — and because closing it properly means moving the simulation server-side,
which costs Profile B and buys nothing else. If Sling Puck ever gets a
leaderboard, this decision has to be revisited first.

## 11. Safety

Nothing is swung or thrown. Phones lie on a table and are touched, not moved.
The only caution: **two phones nose to nose get nudged**, so it is worth saying
once that people should keep them away from the table edge.

## 12. Data & privacy

Crossings and puck counts, for the life of the round. Player id, name, avatar.
Nothing else, and none of it outlives the room
([../../database.md](../../database.md) §1).

## 13. Accessibility

- **Drag-and-release is the whole input**, and a hard drag is exactly what some
  players cannot do. A **tap-to-launch** fallback is required in the first
  iteration, not later: tap a puck and it fires at a fixed medium strength,
  straight up the board. Slower and less accurate, fully playable.
- Puck count is always a **number**, never only a row of icons.
- The gap must read by **shape** — a break in a drawn wall — not by colour.
- No strobing. A wall bounce is not a flash.
- `prefers-reduced-motion` cannot slow the pucks without changing the game, so
  it instead drops the band's snap-back animation and the bounce sparks, and
  keeps the motion that *is* the game.

## 14. Open questions

- **Is 5 pucks right?** A round that ends in four seconds is not a round.
- **Is the gap too kind at 0.34?** Wide enough and there is no skill; narrow
  enough and nothing ever crosses. Only a play test settles it.
- Should pucks knocking each other through the gap count? Currently **yes**, and
  it is the best thing in the physical game — a lucky pile-up clears three at
  once. Watch that it does not dominate.
- Should the band recoil be able to *hit* a puck resting against it? Real bands
  do. Currently no; it would be a nice second-order detail.
- Does Sling Puck make Spill redundant, or the reverse? They share a shape —
  clear your side, simultaneous, no turns. The difference is that Spill aims
  around a table of up to four and Sling Puck is a two-player physics duel. If a
  field test shows players only ever want one of them, cut the other rather than
  keeping both out of politeness.
