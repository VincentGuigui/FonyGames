# Ball Bounce

| | |
| --- | --- |
| **Slug** | `ball-bounce` |
| **Catchy sentence** | *Bank it off two walls and through the hoop* |
| **Illustration** | `www/src/games/ball-bounce/art/card.svg` — a ball squashed flat against a wall mid-rebound, its dashed arc curving on toward a hoop |
| **Players** | 2 |
| **Round length** | 1–3 min |
| **Inputs** | touch |
| **Accent colour** | `#FF7A00` |
| **Status** | 📝 draft — awaiting approval ([#21](https://github.com/VincentGuigui/FonyGames/issues/21)) |

## 1. Pitch

A ball, a hoop, and walls worth using. Drag to aim, let go, and watch it
bounce — squashing flat on every impact and springing back round in the air.
The shot that goes straight in is worth the least; the one that comes off two
walls first is worth the most.

Everything in the catalogue that aims already rewards the launch. This one
rewards what happens **after** it lands.

## 2. Core loop

Both players shoot at the same court, alternately, and the ball stays live
until it stops moving. Best of `BOUNCE_SHOTS` (5) shots each.

1. The referee rolls one court — hoop position, wall layout — and broadcasts
   it. Identical for both players, the Gravity Shooter map-roll pattern.
2. Turns alternate, host first. On your turn, drag anywhere to set **angle and
   power**; a dashed preview shows the first part of the arc (§4).
3. Release and the ball flies: gravity, then restitution at every surface it
   meets. It **stays live until its speed falls below `BOUNCE_REST_SPEED`** or
   `BOUNCE_MAX_FLIGHT_MS` elapses — a shot that trickles round the rim and
   drops is a made shot.
4. Scoring is on the **way in** (§2.2): walls touched before the hoop multiply
   the basket.
5. The turn passes. A player who does not shoot before
   `BOUNCE_SHOT_TIMEOUT_MS` forfeits that shot, scoring nothing.
6. After both players have taken all their shots, the higher total wins.

**Win condition:** the higher total after equal shots. Level scores go to a
single sudden-death shot each, repeated until it breaks.
**Scoring:** `BOUNCE_BASKET` (2) for a made shot, **× the number of distinct
walls the ball touched first**, capped at `BOUNCE_WALL_CAP` (3). So: straight
in is 2, off one wall 4, off two 6. A miss is 0. The multiplier is the entire
design — it is what makes the rebound the game rather than the aim.

### 2.1 The physics, and what "accurate" has to mean

A bounce is a deterministic arc plus restitution at each surface, so a whole
shot is described by `(angle, power)`. Both phones re-run the identical
simulation from one small message — exactly what Gravity Shooter does today,
and the same reasoning behind Goat Siege's "a goat is a deterministic arc, so
one message describes the whole flight". No streaming, and **no new
dependency**: Sling Puck already proves hand-rolled 60 fps physics on a plain
`<canvas>`, while a PixiJS spike measured ~221 KB gzipped — over the entire
per-game budget on its own
([../../architecture.md](../../architecture.md) §4).

**"Accurate" is not the goal, and the spec says so before anyone tunes it.**
Correct restitution and friction numbers make a dull ball. What is wanted is
*readable, predictable, slightly exaggerated*: a bounce you can aim. In
practice that means **lower gravity and higher restitution than reality**.
Gravity Shooter has just been through two rounds of this exact lesson — its
`GRAVITY_G` is four times the original brief's value and its launch speed a
third — and this game should start where that one ended up rather than at
9.81 m/s².

Fixed timestep, `BOUNCE_STEP_MS` = 1000/60, integrated the same way, so the
path is bit-identical on both phones up to float rounding.

### 2.2 Deformation is a rendering trick

Squash along the impact normal, stretch along the velocity, back to round in
flight. It is **not** soft-body physics and never touches the simulation — the
collision is against a circle throughout.

Note the art constraint from
[../../design/illustrations.md](../../design/illustrations.md): canvas sprites
may only be translated, scaled and rotated, so anything whose *shape* changes
over time stays procedural. The ball is therefore a **drawn circle scaled
non-uniformly**, not an SVG sprite. The court, the hoop and the backboard are
sprites; the ball is code.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `duel` | Same court, alternate shots, best of five | baseline |
| `bank` | Only bank shots count | A basket with zero walls scores 0 — the multiplier becomes a gate |

`bank` is the mode that tests whether the rebound is really the fun part. If it
plays better than `duel`, the multiplier in §2 is too gentle.

## 4. Screens

Standard flow. The round screen is a single portrait court, shown the same way
to both players — **no per-seat flip**: unlike Gravity Shooter's two facing
ships, both players shoot at the same hoop from the same end, so the board
needs no view transform at all. Whose turn it is, is a highlight and a label,
not a rotation.

- **The hoop** near the top, with a backboard and at least one wall in reach of
  a sensible bank.
- **The ball** at the bottom on the shooting mark.
- **The dashed preview** follows Gravity Shooter's own rule: solid across the
  near third of the screen, fading through the middle, gone before the hoop.
  It shows the launch, not the landing — including the first bounce, because
  the first bounce is the part you are aiming.
- **Shot pips** for each player, filled as their shots are spent, with the
  multiplier earned marked on each.

## 5. Inputs & sensors

Touch only. Aim is a drag from anywhere on the court: direction sets the
angle, distance sets the power, capped — the same finger-space ramp Gravity
Shooter uses, including its floor band so the weakest shot is a pad the thumb
can land on rather than a hairline.

No sensors, no permissions, no fallbacks needed.

## 6. Networking

Profile A. One message per shot.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `bounce-court` | server → all | `{ roundId, hoop, walls, turn, shotsLeft }` | The court, rolled once |
| `bounce-shot` | client → server | `{ roundId, angle, power, made, walls }` | This shot, and its own claimed outcome |
| `bounce-result` | server → all | `{ roundId, shooter, angle, power, made, walls, points, scores, turn, resolvesAt }` | What was shot, what it scored, and whose turn it is now |

The referee owns the court, the turn order, the shot clock and the scores. It
**trusts the claimed outcome** — the same deliberate choice Gravity Shooter's
§8 makes and for the same reason: the physics runs on the phones, the referee
never re-derives a hit. `angle` and `power` are clamped to finite, sane ranges.

**The shot clock starts when the ball stops**, not when the shot is sent —
Gravity Shooter learned this the hard way ([#34](https://github.com/VincentGuigui/FonyGames/issues/34)):
the opponent should not spend their turn watching somebody else's ball. The
shooter reports the flight's own duration and the referee holds the next clock
back by it, clamped to `BOUNCE_MAX_FLIGHT_MS`.

## 7. Failure & edge cases

- **Player leaves mid-round**: the other player wins outright — two fixed
  seats, the same rule Grid Attack and Gravity Shooter use.
- **Host leaves**: same.
- **Too few players**: exactly 2, `solo` hotseat for testing (one phone takes
  both seats, alternating).
- **A ball that never settles** — a perfect horizontal groove — is ended by
  `BOUNCE_MAX_FLIGHT_MS` and scored as a miss.
- **A ball that leaves the court**: a miss. The simulation bounds are wider
  than the drawn court so a ball that goes high and comes back is not clipped.
- **Backgrounded tab**: the shot clock is an absolute timestamp; a phone that
  returns late has forfeited that shot.
- **Level after equal shots**: sudden death, one shot each, repeating.

## 8. Anti-cheat

The claimed outcome is trusted, so a modified client can claim a basket. That
is accepted, for the same reasons Gravity Shooter accepts it — but the cheap
protections are worth having:

- **`walls` is clamped** to `BOUNCE_WALL_CAP`, so the multiplier cannot be
  inflated past what the court allows.
- **A flight duration that exceeds `BOUNCE_MAX_FLIGHT_MS` is clamped**, so a
  claimed flight cannot buy a longer turn.
- **Scores are the referee's**, computed from `made` and `walls`, never sent by
  a client.
- **The court is the referee's**, so both players demonstrably shot the same
  thing — which is what makes the result arguable in a room.

## 9. Safety

Nothing to warn about.

## 10. Data & privacy

Two numbers and two flags per shot. Nothing stored past the room.

## 11. Accessibility

- **Reduced motion**: the squash-and-stretch is suppressed and the ball stays
  round; the flight itself remains, because it is the game. The trail is
  drawn to full length rather than animated.
- **The multiplier is text as well as colour** — "off 2 walls, ×3" — so the
  scoring is never a colour code.
- **No sound is required**; the bounce has a sound but nothing depends on it.
- **The preview is the accessibility feature**: a player who cannot judge an
  arc by eye can read it off the dashes.
- **No timing pressure inside a shot** beyond the generous shot clock.

## 12. Open questions

1. **The game mode is this spec's own invention.** The issue says the mode is
   TBD and describes only the physics core; `duel` (same court, alternate
   shots, best of five) is proposed here because it inherits Gravity Shooter's
   structure almost wholesale. Needs a yes before any code.
2. **The wall multiplier is the whole design and it is untuned.** 2/4/6 may
   make bank shots compulsory rather than tempting.
3. **Restitution, gravity and friction** — three numbers that decide whether
   the ball is aimable. Expect the Gravity Shooter experience to repeat: two
   rounds of retuning before it feels right.
4. **Does the court want moving parts?** A swinging hoop or a moving wall would
   give the rebound something to time against. Probably a second mode, not the
   baseline.
5. **One hoop or two?** Both players shooting the same hoop is simplest and
   makes scores directly comparable; facing hoops would let the ball be
   contested, which is a different and much larger game.
