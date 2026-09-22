# Rhino Spin

| | |
| --- | --- |
| **Slug** | `rhino-spin` |
| **Catchy sentence** | Throw your phone. Count the spins. Mind the ceiling |
| **Illustration** | `www/src/games/rhino-spin/art/card.svg` — a rhino mid-tumble, eyes rolling |
| **Players** | 1–8 |
| **Round length** | ~30 s |
| **Inputs** | motion (gravity direction) |
| **Accent colour** | `#A78BFA` |
| **Status** | building |

## 1. Pitch

Throw your phone in the air so it spins, catch it, and the rhino on the screen
gets as dizzy as the number of rotations you managed. Whoever spun most wins;
everyone else's rhino just looks unwell.

## 2. Core loop

1. The lights go green and a fixed window opens (`RHINO_ROUND_MS`).
2. Each player throws their phone so it spins, and catches it. Throw as many
   times as the window allows.
3. A spin is counted every time the phone's own down-direction completes a full
   turn (§2.1). The rhino's pupils track that direction live, so the screen is
   a readout of the sensor rather than a decoration.
4. When the window closes the rhino keeps spinning its eyes — the dizziness
   carries the momentum of the last spin and decays.
5. Once the eyes settle (`RHINO_SETTLE_RATE`), the winner's rhino is sick and
   closes its eyes; everybody else's gets crosses. That scene holds for
   `RHINO_SCENE_MS`, then the scoreboard.

**Win condition:** most spins. Ties share the place.
**Scoring:** one point per completed rotation. Nothing else scores.

### 2.1 Counting a spin

The phone reports `deviceorientation`; `downVector` (core/sensors/gravity.ts)
turns that into where gravity points in screen coordinates. In free fall the
vector is unreliable in magnitude but its **angle** still sweeps as the phone
rotates, and that angle is all this game reads.

Unwrapped angle: each sample's shortest signed step from the last is
accumulated, so a turn past ±π keeps counting instead of snapping. A spin is
`2π` of accumulated sweep in **either** direction — `|total| / 2π`, floored.

A sample whose step exceeds `RHINO_MAX_STEP` is dropped as a sensor glitch
rather than counted as
most of a turn.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | Most spins in thirty seconds | baseline |

## 4. Screens

Lobby → primer (safety, §9) → countdown → round → dizzy scene → scoreboard.

The round screen is one rhino, centred, facing the player, filling most of the
board. Its two eyes are the live part: each pupil sits on the rim of its eye,
at the angle gravity currently points, so a spinning phone makes them circle.

The pupils carry **inertia**: they do not snap to the gravity angle, they chase
it with a spring, and they keep rolling after the phone stops. That is what
makes a rhino look dizzy rather than merely responsive.

Above the rhino: the spin count, big. Below: the seconds left.

## 5. Inputs & sensors

`deviceorientation` at whatever rate the device gives, same permission flow as
every other motion game — asked for by Ready/Start, never a button of its own
([device-capabilities.md](../../device-capabilities.md) §2).

**Fallback:** none, and this is one of the cases §2 of device-capabilities
allows to go without: the entire game is one physical act. A phone that refuses
motion says so in the lobby and spectates.

## 6. Networking

Each phone counts its own spins and reports the running total at
`RHINO_REPORT_MS`. The referee keeps the best figure it has seen per player,
never lowers it, and ends the round on its own clock.

Spin counts are cheap to inflate and there is no way to prove one from the
outside, so the referee applies the same shape of bound the other games use: no
more than `RHINO_MAX_RATE` spins per second of elapsed round.

## 7. Failure & edge cases

- **Permission denied**: spectates (§5).
- **Dropped phone**: the round is unaffected — the count is whatever the sensor
  saw. A cracked screen is the player's own risk and the lobby says so.
- **Phone laid flat**: gravity's screen angle is undefined, so no spin is
  counted. Resting the phone on a table scores nothing.
- **Backgrounded tab**: stops counting; the referee keeps the best seen.
- **Nobody spins**: everyone scores zero, no winner, scoreboard as usual.

## 8. Anti-cheat

The rate bound in §6. Shaking a phone in a circle does score — it is a spin by
the only definition a sensor has — and that is accepted rather than fought.

## 9. Safety

⚠️ **This game asks players to throw a phone in the air, and that can break the
phone.** It is the one throwing mechanic in the repo, allowed by explicit
maintainer decision, and AGENTS.md §7 records it as an exception rather than a
precedent.

The primer, before anyone plays, says: throw low, indoors, over a soft surface,
away from other people, and mind the ceiling and the lights. The lobby carries
the same line so a player choosing the game sees it before they join.

## 10. Data & privacy

Motion readings never leave the phone. The wire carries a spin count and
nothing else.

## 11. Accessibility

The whole game is one gross motor act and there is no alternative input, so it
excludes anyone who cannot throw and catch. The lobby says so plainly rather
than letting someone join and discover it.

The count is announced as text for screen readers; the rhino is decoration.

## 12. Open questions

1. **Is a full rotation the right unit?** A phone thrown flat may tumble about
   an axis the screen-plane angle barely sees, scoring nothing while looking
   like a great throw. Counting tumbles properly needs the accelerometer as
   well, which is a bigger sensor surface for a party game.
2. **How long should the dizzy scene run?** `RHINO_SCENE_MS` is two seconds per
   the issue; whether that is too long to sit through after every round is a
   playtest question.
