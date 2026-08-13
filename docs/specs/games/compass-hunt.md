# Compass Hunt

> Status: **draft**, awaiting validation. No code yet.
>
> **This replaces an earlier idea of the same name** — a GPS treasure hunt where
> everyone followed one arrow to a place. The mechanic below keeps the name and
> nothing else: no GPS, no walking, and it is played standing in one spot. The
> card's inputs, pitch, duration and art all change with it (§13).

| | |
| --- | --- |
| **Slug** | `compass-hunt` |
| **Catchy sentence** | *Point your phone at things nobody else can see* |
| **Illustration** | `www/src/games/compass-hunt/art/card.svg` — **to redraw**: a phone aiming into a scatter of points on an invisible sphere, one lit up. The current compass needle belongs to the old idea |
| **Players** | 2–8 |
| **Round length** | 90 s |
| **Inputs** | orientation (device attitude). **No GPS, no magnetometer** — see §5.2 |
| **Accent colour** | `#FBBF24` |
| **Status** | draft |

## 1. Pitch

There is a target floating in the air around you. You cannot see it, and neither
can anyone else — you find it by aiming your phone like a torch and reading the
hot-or-cold on the screen. Lock on, and the next one appears somewhere else on
the sphere.

Everyone gets the same targets in the same order. Most found in ninety seconds
wins. A room playing this looks completely deranged from outside, which is the
correct outcome.

## 2. Core loop

1. **Calibrate** (§3). Everyone holds their phone straight ahead and taps. That
   pose becomes their personal *forward*.
2. The server picks target 1 as a direction on the sphere — an azimuth and an
   elevation **relative to each player's own forward**, identical for everyone.
3. You sweep the phone around. The screen shows how close your aim is (§4).
4. Hold your aim inside `LOCK_CONE` for `LOCK_DWELL_MS` → **found**, +1, and the
   next target appears.
5. After 90 s, most found wins. Ties broken by total time-to-find.

**Win condition:** most targets found in the round.
**Scoring:** 1 point per target found; the round winner takes the round.

| Constant | Value | Why |
| --- | --- | --- |
| `LOCK_CONE` | 12° | Findable by sweeping, too tight to hit by accident. At arm's length that is about a dinner plate at 2 m |
| `LOCK_DWELL_MS` | 600 | Long enough that a sweep straight through does not count |
| `TARGET_MIN_SEPARATION` | 50° | Consecutive targets are never near each other, so you always have to move |
| `ELEVATION_RANGE` | −40°…+70° | Nothing at your feet, nothing directly behind your head |
| `ROUND_MS` | 90 000 | Long enough for ~8–15 finds |

## 3. Calibration, and why the game is anchored to you

**The sphere is anchored to each player's own forward, not to north.** At round
start everyone points their phone where they are facing and taps; that becomes
azimuth 0 for them. Elevation stays gravity-referenced, which needs no
calibration at all.

This is the single most important decision in the spec, and it exists because
the obvious version does not work:

**The obvious version** puts targets at true compass bearings, so "target at
045°" means the same physical direction for everyone. It is elegant, it makes the
name literal, and **indoors it is broken.** A phone's magnetometer near
reinforced concrete, wiring, a radiator or a laptop reads 20–40° off, varies
between phones standing next to each other, and swings as you turn. Two players a
metre apart would be sent to visibly different parts of the room and both would be
told they were wrong. There is no tuning that fixes a sensor that disagrees with
itself.

**Anchoring to the player** removes the magnetometer from the game entirely:

- Only *relative* rotation matters, which fused device orientation gives
  accurately without trusting absolute heading.
- Fairness survives, because everyone gets the same offsets from their own
  forward. "Up and to your left" is the same puzzle for everyone.
- It works indoors, in a basement, on a train.

The cost is that the targets are not in the *same place in the room* for two
players — you cannot point at a friend's target. For a game where nobody can see
the targets anyway, that costs nothing a player can perceive.

**Drift** is the remaining risk: yaw from a fused orientation estimate wanders
over minutes. Mitigated by a 90 s round, and by a **re-anchor** offered any time
from the round screen (one tap, no penalty) for anyone who feels the sphere has
slipped. Whether drift is even noticeable at this timescale is §12.

## 4. Screens

- **Lobby**: shared template, the orientation permission primer, the safety line
  (§9), and a "what you are about to do" line — because *aim your phone at an
  invisible point* needs one sentence of warning before the round starts.
- **Calibrate**: full screen, one instruction, one button. Blocking: the round
  cannot start until everyone has anchored.
- **Round**: dominated by a **hot/cold indicator**, not a map. A map would let
  you solve it with your eyes instead of your arm, which is the whole game.
  - A ring that closes in as you get warmer, plus a number in degrees.
  - Colour *and* ring size *and* the number — never colour alone.
  - Vibration pulses faster as you close in (where supported).
  - At lock-on: the ring snaps shut, a hold-timer fills, then a hit.
  - Small: your score, targets found, time left, and everyone else's count so
    you know you are losing.
- **Between targets**: a half-second "found" beat, then the next target. No
  interstitial screen — momentum is the point.
- **Results**: found counts, fastest single find called out.

## 5. Inputs & sensors

### 5.1 What is read

`DeviceOrientationEvent` (alpha/beta/gamma), fused by the platform, through a
new `core/sensors/orientation.ts` — the fourth interpreter beside `bump.ts`,
`shake.ts` and `steady.ts`, and like them the only place that reads raw events.

The phone's **aim** is the direction its back points, i.e. the −Z axis of the
device frame rotated into the world frame. That is the "torch" gesture people
reach for without being told; the alternative, the top edge, makes you hold the
phone like a wand and nobody does that unprompted.

Angular error is `arccos(aim · target)`, both unit vectors. One number, which is
all the screen needs.

### 5.2 The magnetometer is deliberately unused

Despite the name, this game never reads a compass heading. See §3. The name
survives because *Compass Hunt* describes what it feels like — sweeping for a
bearing — and the alternative names for "aim at an invisible point" are all
worse.

If that inconsistency grates, the honest rename is **Ghost Radar** or
**Skypoint**. §12.

### 5.3 Permission

`DeviceOrientationEvent.requestPermission()` on iOS, same rules as motion: from a
tap, never on load, a denial is remembered
([device-capabilities.md](../../device-capabilities.md) §2). The lobby primer is
the Pass the Bomb pattern.

**Fallbacks: none, and the card says so.** Like Steady Hand, the mechanic *is*
the sensor — a touch version would be dragging a reticle on a sphere map, which
is a different game. No orientation, no play: you spectate, and the scoreboard is
worth watching.

## 6. Networking

Server is authoritative for the target sequence, the clock and the score. It
cannot verify an aim, so it verifies *timing* instead (§8).

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `anchor` | client → server | `{roundId}` | I have calibrated and I am ready |
| `found` | client → server | `{roundId, index, ms}` | I locked target `index`, `ms` after it appeared |
| `hunt` | server → clients | `{roundId, index, azimuth, elevation, endsAt, scores}` | The current target and the state of the room |
| `hunt-end` | server → clients | `{roundId, scores, best}` | Round over |

**The aim never crosses the wire.** The phone streams nothing during the round —
it evaluates its own angle locally at sensor rate and sends one small message per
find. That is ~10 messages per player per round, which is the cheapest game in
the catalogue by an order of magnitude, and it means a 200 ms hiccup costs
nothing.

Every player gets the same `azimuth`/`elevation` per index, so the sequence is
shared even though each player's frame is their own (§3).

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player has not calibrated when the host starts | Start is blocked, and the lobby names who is not ready |
| A player re-anchors mid-round | Allowed, free, and their current target stays the same one |
| Orientation events stop (tab backgrounded) | Round continues; you simply find nothing. On return, the current target is still live |
| `found` arrives for a target that has moved on | Ignored — a late lock on a stale index is not a point |
| Two players find the same target | Both score. This is a race for count, not a claim on the target |
| Fewer than 2 players | Start disabled |
| A phone reports no orientation at all after the permission is granted | Treated as unsupported; the player becomes a spectator with an explanation rather than a dead screen |

## 8. Anti-cheat

The server cannot see where a phone is pointing, so a patched client can claim
every target instantly. What is checkable is **time**:

- **A floor on time-to-find.** `found` with `ms < MIN_FIND_MS` (**700**, since
  `LOCK_DWELL_MS` alone is 600) is rejected. Instant finds are impossible.
- **A ceiling on rate**: at most one find per target index, and the index must be
  the current one.
- **Implausible consistency** — a run of finds all within a few ms of each other —
  is flagged for the results screen, not auto-rejected.
- And, as ever: everyone is in the same room watching each other wave phones
  around. A player standing still and winning is conspicuous.

## 9. Safety

The most physical game in the catalogue after Pass the Bomb, and the hazard is
different: eyes on the screen, arms extended, turning on the spot.

> **Look up before you start. Feet planted, turn slowly, and keep an arm's length
> from furniture and from each other. If you need to move your feet to reach a
> target, the target can wait.**

Enforced: `ELEVATION_RANGE` excludes anything that would have people staring
straight up while turning, which is how someone walks into a table.

## 10. Data & privacy

Leaves the phone: a find message with an index and a duration, player id, name,
avatar. **No orientation stream, no heading, no location** — the calibration
offset never leaves the device either, because the sphere is evaluated locally.
Room memory only.

Worth noting explicitly: the earlier GPS version of this game would have
transmitted location, and [join.md](../join.md) §2.1's coarse-geohash rule was
written partly for it. This version has no location to protect.

## 11. Accessibility

- Needs a free arm and the ability to turn on the spot; there is no seated or
  one-handed equivalent, and no fallback (§5.3). Said on the card.
- Everything the hot/cold conveys is carried three ways — ring size, a number in
  degrees, and colour — so colour vision is never required, and the number alone
  is enough to play.
- Vibration is an addition, never the only channel.
- `LOCK_CONE` and `LOCK_DWELL_MS` are the difficulty knobs; a future `wide` mode
  at 20°/400 ms would make the game reachable for less precise aim without
  changing anything structural.
- No flashing. The found beat is a fade under `prefers-reduced-motion`.

## 12. Open questions

- **Does yaw drift over 90 s in practice?** The whole anchoring design (§3)
  assumes it is small. Needs a real phone in a real room; if it is worse than
  ~10° the re-anchor button stops being a comfort and becomes a chore.
- **Is 12° the right cone?** Untested. Too tight and the game is frustrating on a
  phone with a lazy orientation filter; too loose and you win by waving.
- **Does the name survive the mechanic?** The game no longer uses a compass
  (§5.2). *Ghost Radar* and *Skypoint* both describe it better.
- Should targets be **visible once found** — a scatter of dots filling in as the
  round goes on — or does that turn it into a map game (§4)?
- Is standing still and pointing enough for 90 s, or does it need a reason to
  move your feet?
