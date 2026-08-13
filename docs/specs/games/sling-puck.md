# Sling Puck

| | |
| --- | --- |
| **Slug** | `sling-puck` |
| **Catchy sentence** | *Sling every puck onto their side before they sling them back* |
| **Illustration** | `www/src/games/sling-puck/art/card.svg` — the shot already taken: your half large in front with the band snapped forward, the far half smaller and set back, and the puck across the gap on an **off-centre** line. The lean is deliberate — puck, gap and trail on one centred vertical axis read as a wiring diagram rather than a game, and banking off the walls is how it is actually played |
| **Players** | 2 — exactly |
| **Round length** | 30 s – 2 min |
| **Inputs** | touch (drag back and release) |
| **Accent colour** | `#FB7185` |
| **Status** | 🎮 beta — `classic` playable; puck count and gap width untested |

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
rotation. In the board units defined just below:

| Leaving A | Arriving at B |
| --- | --- |
| `x` | `1 - x` |
| `vx` | `-vx` |
| `vy` (negative, upward) | `-vy` (positive, downward) |

Three sign flips and nothing else — no trigonometry, and no dependence on how big
either screen is, which matters because the two phones are not the same size and
the board has to be the same board on both.

### Units, and why the board has a fixed shape

One unit is **one board width**, in *both* axes. So `x` runs 0..1 across the
board and `y` runs 0..`BOARD_H`, where `BOARD_H = 1 / BOARD_ASPECT`. Velocity is
in board widths per second.

That is the reason the board is a fixed `BOARD_ASPECT` rectangle **letterboxed**
into the screen rather than being the shape of whatever phone it is on.
Normalising `x` by the width and `y` by the height is tidier to write and visibly
wrong to play: one radius would mean two different distances, so a puck would
stop short of the top wall while touching the side ones, and a bounce off a side
wall would change the shot's apparent angle. A fixed aspect costs a margin at the
top and bottom of a tall screen — which the puck count, the gear and the hint
occupy anyway.

## 5. Networking

| Message | Direction | Payload |
| --- | --- | --- |
| `cross` | client → server | `{ roundId, x, vx, vy }` — a puck left my half, in my frame |
| `sling` | server → clients | Whole round: `{ roundId, startsAt, players, pucks, phase }` |
| `puck` | server → clients | `{ from, to, x, vx, vy, at, pucks }` — already rotated into the receiver's frame |
| `sling-over` | server → clients | `{ roundId, winnerId, pucks }` |

The server rotates the coordinates, so neither client has to know which way
round it is sitting — and a client that lies about the rotation cannot make a
puck arrive somewhere impossible. Server-side constants for that:

| Constant | Value | What it does |
| --- | --- | --- |
| `SLING_PLAYERS` | 2 | Exactly two. Not a range — the board *is* the join between the phones |
| `SLING_START_PUCKS` | 5 | Mirrors `SLING_PUCKS` in the client physics |
| `SLING_MIN_GAP_MS` | 250 | Sustained floor on crossings from one player (§10) |
| `SLING_CROSS_BURST` | 3 | Crossings accepted back to back before that floor bites |
| `SLING_SPEED_MAX` | 2.5 | Plausible arrival speed; a forged crossing is clamped to it |
| `SLING_ROUND_CAP_MS` | 3 min | Then fewest pucks wins |

`pucks` rides on every frame that can change it, as in Spill: the count is the
score, and a separate message for it would only be a chance to disagree.

## 6. Internal settings

Everything below is a **tuning constant, not a player-facing option**. They live
together at the top of `physics.ts` so a play test can move them in one place.

Distances are in **board widths** and speeds in board widths per second, per the
unit note in §4.

| Constant | Start value | What it does |
| --- | --- | --- |
| `SLING_PUCKS` | 5 | Pucks per player |
| `BOARD_ASPECT` | 0.62 | The board's shape: width ÷ height, for one player's half |
| `BOARD_H` | `1 / BOARD_ASPECT` ≈ 1.61 | Board height, in board widths |
| `PUCK_RADIUS` | 0.055 | Puck radius — the same distance in both axes |
| `ELASTIC_K` | 8 | Launch speed per unit of band *elongation* |
| `MAX_SPEED` | 2.6 | Hard cap on launch speed |
| `MAX_PULL` | `0.24 × BOARD_H` | How far back from the band a pull may go |
| `BAND_REST_FRACTION` | 0.72 | Where the band sits when relaxed, down the board |
| `BAND_SNAP` | 14 | How fast the band whips back once released (visual only) |
| `FRICTION` | 0.6 | Constant deceleration — a puck sliding on wood, not in treacle |
| `RESTITUTION` | 0.72 | Energy kept in a wall bounce |
| `PUCK_RESTITUTION` | 0.86 | Energy kept in a puck-on-puck hit |
| `GAP_FRACTION` | 0.34 | Width of the gap as a fraction of the board width |
| `REST_SPEED` | 0.03 | Below this a puck is treated as stopped |
| `SUB_STEPS` | 4 | Physics sub-steps per rendered frame |

Four choices in there are deliberate rather than arbitrary:

- **Friction is a constant deceleration, not linear damping.** `v *= 0.98` never
  quite stops and feels like syrup; subtracting a fixed amount of speed per
  second is what a disc sliding on a board actually does, and it *does* stop.
- **`SUB_STEPS` exists so fast pucks cannot tunnel.** At `MAX_SPEED` one 60 fps
  frame moves a puck most of a radius and could skip straight through a wall;
  four sub-steps take that to about a fifth of a radius, leaving room to tune the
  constants upwards without pucks escaping.
- **`ELASTIC_K` is large because the elongation it multiplies is small.** The band
  spans nearly the whole width, so pulling it back by a third of a width only
  lengthens the V by about a quarter. That is the real geometry of the toy, not a
  fudge; the constant absorbs it. It is also why a gentle pull does almost
  nothing — the stretch grows quadratically at first, exactly as it does in the
  hand.
- **`MAX_SPEED` is a separate cap, not `MAX_PULL` doing double duty.** How far
  back you may drag and how fast the puck may end up are different questions, and
  tying them together meant one could not be tuned without the other. It sits
  *above* what a full pull produces, so in normal play it never bites: it is a
  guard against a bugged or forged pull, not part of the feel.

`BAND_REST_FRACTION` and `MAX_PULL` are a pair: the band has to sit high enough
to leave a full pull of board behind it. At `0.72 + 0.24` a full pull ends at
`0.96` of the height, just inside the bottom wall — any lower a band and there is
nowhere to pull to.

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
times `ELASTIC_K`, capped at `MAX_SPEED`. How far back a drag may go is a
separate limit, `MAX_PULL`.

Because the band is nearly as wide as the board, a short pull barely lengthens
the V at all, and the speed therefore ramps up slowly at first and steeply near
full stretch. That is not a curve anyone chose — it is what the geometry does,
and it is why a half-hearted pull in the real game goes nowhere.

Only arithmetic and `sqrt` — no trigonometry anywhere in the physics.

### Taking hold of a puck

Two rules, both of them corrections to the first build:

- **A puck is carried, never teleported.** Touching a puck records the offset
  between your finger and its centre and keeps it, so the puck stays exactly where
  it lay and only *moving* your finger moves it. Before this, a grab snapped the
  puck into the band's pull zone from wherever it was, which made loading feel like
  a menu selection instead of a hand on a puck.
- **Any puck can be grabbed, moving or not.** A puck rattling back down your half
  is the one you most want to reload, and refusing it just meant waiting for the
  board to settle. Catching one stops it dead: it is in a hand now.

A carried puck may go anywhere on the board, not only into the pull zone. It is
released two different ways depending on where it is:

| Released | Result |
| --- | --- |
| in the band's zone (`y ≥ BAND_REST_Y`) | fires, per the model above |
| above the band | put down, velocity zero |

So bringing a puck down to the sling is a deliberate move, and the band is only
drawn stretched — and the aim only shown — once a puck has actually reached it.

Carrying a puck to the gap is **not** a way to score. A crossing only ever comes
out of the simulation step, so a puck put down by hand has no velocity and sits
where it was left.

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
| The count and the board disagree | Self-healing. See below |

### When the count and the board disagree

A crossing leaves the local board the instant it happens and only *then* goes on
the wire, so the two are briefly and legitimately out of step by one puck. If that
crossing never lands — the server refuses it, or the socket happened to be
reconnecting when it was sent — the puck is gone from the board and still on the
count. That was a real bug, seen as **"1 yours" over an empty table**, and it
lasted the rest of the round because the board was only ever reconciled on a full
resync.

Three things fix it, and all three are needed:

- The client reconciles after **every** message carrying `pucks`, and on every
  frame — not only on a resync.
- It tracks crossings it has sent but not seen echoed back. While one is
  outstanding the difference is not real yet, so nothing is invented; the puck
  would otherwise be duplicated the moment the echo arrived.
- A crossing unacknowledged after `CROSS_ACK_MS` (1.5 s) is presumed lost, and
  from then on the server's count wins.

A puck can never be lost the other way — off the table. `walls()` decides a
crossing on the puck's centre inside the gap span and bounces every other contact,
so the only way off the board is through the gap, and that always produces a
crossing.

## 10. Anti-cheat — and its honest limit

What the server does enforce:

- **Conservation.** Pucks are neither created nor destroyed; a crossing moves
  exactly one. You cannot invent a puck to throw.
- **You cannot pass what you do not have.** A crossing from an empty side is
  rejected.
- **A floor on throughput.** A sustained one crossing per `SLING_MIN_GAP_MS` from
  the same player, on top of the room's per-connection rate limit — but with a
  burst allowance of `SLING_CROSS_BURST`, because a single shot can knock a second
  puck through a few frames behind it and knocking pucks through is the point.
  A hard one-per-250 ms gate refused those, and it refused them *silently*: the
  sender's board had already dropped the puck, so it ran a puck short of its own
  count for the rest of the round. **A refused crossing is now answered with the
  current state**, so the sender's board puts the puck back.
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

- **Drag-and-release is the whole input, and there is no tap fallback.** That is a
  reversal, dated 2026-08-04, and the reason is that the fallback broke the game it
  was meant to open up.

  A tap-to-launch did ship: tap a puck and it fired at the middle of the gap at a
  fixed modest speed. It aimed rather than imitating a pull, because pulling a puck
  straight back only fires it straight up if the puck is in the middle — three of
  the five pucks in the opening rack could not otherwise reach the gap at all. As a
  fallback it worked.

  As a *game* it did not. §14 asked whether the tap was "too good"; play answered
  yes, and worse than expected. It never misses the plain shot, so **spam-tapping
  the rack was the fastest and most reliable way to play** — no aim, no carry, no
  timing. A game about aiming cannot have a strictly better option that involves no
  aiming. Rack pucks also rest inside the band's zone, so even a bare
  grab-and-release counted as a stretch and threw the puck; both are now closed by
  the same rule, that **a release fires only if the puck was pulled** (§7).

  Say plainly who that excludes: **anyone who cannot drag**. They cannot play this
  game. Per [../../design/ui-guidelines.md](../../design/ui-guidelines.md) §7 a
  mechanic *should* declare a fallback, and a game that deliberately does not must
  name who it leaves out — this is that naming. What is *not* ruled out is a future
  fallback that cannot be spammed: a long-press to load and a second tap to fire,
  or a power slider. Any replacement has to be slower and less accurate than a
  drag, or it becomes the optimal play again.
- Puck count is always a **number**, never only a row of icons.
- The gap must read by **shape** — a break in a drawn wall — not by colour.
- No strobing. A wall bounce is not a flash.
- `prefers-reduced-motion` cannot slow the pucks without changing the game, so
  it instead drops the band's snap-back animation and the bounce sparks, and
  keeps the motion that *is* the game.

## 14. Open questions

- **Is 5 pucks right?** A round that ends in four seconds is not a round.
- **Does the game need *some* fallback?** The tap one was removed for being the
  optimal play (§13), which leaves players who cannot drag with nothing. A
  load-then-fire two-tap gesture is the candidate: it cannot be spammed and it is
  slower than a drag. Unbuilt, and the honest gap in this game.
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
