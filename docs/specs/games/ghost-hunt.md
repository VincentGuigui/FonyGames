# Ghost Hunt

> Status: **draft**, awaiting validation. No code yet.
>
> **Replaces "Compass Hunt"**, a GPS treasure hunt where everyone followed one
> arrow to a place. Nothing survives but the idea of hunting: no GPS, no walking,
> played standing in one spot. It is **not called Compass Hunt any more because it
> never reads a compass** (§3) — a name promising a sensor the game deliberately
> avoids is a lie told on the card.
>
> **Name collision to resolve:** the catalogue already has **Ghost Tag** (a GPS
> hide-and-seek idea). Two "Ghost" games is one too many — either this becomes
> *Ghost Radar* / *Spectre* / *Cold Spot*, or Ghost Tag is renamed. Flagged, not
> decided.

| | |
| --- | --- |
| **Slug** | `ghost-hunt` |
| **Catchy sentence** | *Sweep the room for ghosts only your phone can see* |
| **Illustration** | `www/src/games/ghost-hunt/art/card.svg` — **to redraw**: a phone held up, its screen a bright ring cut out of the dark with an edge-traced shape inside it. The current compass needle belongs to the old idea |
| **Players** | 2–8 |
| **Round length** | 90 s |
| **Inputs** | orientation (device attitude) + **camera**. Touch fallback (§5.4). No GPS, no magnetometer — see §3 |
| **Accent colour** | `#FBBF24` |
| **Status** | draft |

## 1. Pitch

Hold your phone up and the screen becomes a window onto your own room — except
through the ring in the middle, where the world arrives as a ghost: an outline
traced out of the live camera feed, all edges and no substance.

Somewhere in the air around you there is a ghost. Sweep the phone until the ring
finds it. Lock on, and the next one is somewhere else.

Everyone gets the same ghosts in the same order, so it is a race. A room playing
this looks completely deranged from outside, which is the correct outcome.

## 2. Core loop

1. **Calibrate** (§3). Everyone holds their phone straight ahead and taps. That
   pose becomes their personal *forward*.
2. The server picks target 1 as a direction on the sphere — an azimuth and an
   elevation **relative to each player's own forward**, identical for everyone.
3. You sweep the phone around, watching the room through the ring (§4).
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

The screen is **the live camera feed**, full bleed, dimmed. Centred on it is the
**detector ring** — a circle roughly a third of the screen wide showing the same
feed run through an edge detector: white outlines on black, the room as a
wireframe. Outside the ring, your room. Inside it, the room a ghost lives in.

That split is the whole interface, and it does three jobs at once:

- **It gives the hunt somewhere to look.** Aiming at nothing is unsatisfying;
  aiming *through* something makes the phone feel like an instrument.
- **It carries the hot/cold signal in the ring itself** — the ring tightens,
  brightens and picks up the accent colour as you close in, so the thing you are
  staring at is the thing telling you the answer. No separate meter to glance at.
- **It keeps your eyes up.** You are looking at the room, through the phone,
  rather than down at a dial — which matters for §9.

Also on screen, small and out of the way: degrees to target, your score, the time
left, and everyone else's count.

- **Lobby**: shared template, the camera + orientation primer (§5.3), the safety
  line (§9), and one line saying what the game does with the camera — *nothing
  leaves your phone* — because "let us use your camera" is the most alarming ask
  in the catalogue and deserves an answer before it is asked.
- **Calibrate**: full screen, one instruction, one button. Blocking.
- **Round**: as above.
- **Lock-on**: the ring snaps shut, a hold-timer fills its rim, and the ghost
  resolves for half a second as a bright edge-traced shape before it goes.
- **Results**: found counts, fastest single find called out.

## 5. Inputs & sensors

### 5.1 Orientation

`DeviceOrientationEvent` (alpha/beta/gamma), fused by the platform, through a new
`core/sensors/orientation.ts` — the fourth interpreter beside `bump.ts`,
`shake.ts` and `steady.ts`, and like them the only place that reads raw events.

The phone's **aim** is the direction its back points, i.e. the −Z axis of the
device frame rotated into the world frame. That is both the natural "hold it up
and look through it" gesture and, conveniently, exactly where the rear camera
points — so the aim and the picture agree by construction.

Angular error is `arccos(aim · target)`, both unit vectors.

### 5.2 The camera, and the edge detector

`getUserMedia({ video: { facingMode: 'environment' } })` into a `<video>`, drawn
to a small offscreen canvas, Sobel-filtered, painted into the ring.

**The filter runs on a deliberately small buffer.** Edge detection is per-pixel
work, and a 1080p frame at 30 fps is not something to attempt on a mid-range
phone that is also holding a WebSocket open. The pipeline is:

| Stage | Budget |
| --- | --- |
| Video → canvas downscale | **160×160**, the ring only, not the whole frame |
| Sobel + threshold | ~26 k pixels, plain JS on a `Uint8ClampedArray` |
| Paint | scaled back up into the ring, `image-rendering: pixelated` |
| Rate | **15 fps**, independent of the orientation sample rate |

Chunky and low-fi is the *aesthetic*, not a compromise — a crisp edge trace looks
like a filter, while a coarse one looks like equipment. If 15 fps at 160² still
costs too much on a real phone, the next lever is 12 fps before it is resolution,
because a laggy trace reads as broken while a coarse one reads as deliberate.
WebGL is explicitly **not** the first move: a shader is faster and much more code,
and this needs to be cheap to maintain.

The camera is **never** the input to the game. The ghost's position comes from the
server and the aim from the orientation sensor; the feed is scenery. Nothing is
tracked, recognised or analysed for gameplay. That keeps §10 short and honest.

### 5.3 Permissions

Two asks, and **they are separate**: orientation, then camera. Both from a tap,
never on load, both remembered when denied
([device-capabilities.md](../../device-capabilities.md) §2).

They are requested in that order, and the game is playable after either one:

| Granted | Result |
| --- | --- |
| Orientation + camera | The full game (§4) |
| Orientation only | The same hunt, ring on a plain dark ground instead of the feed. Loses the atmosphere, keeps the game |
| Camera only | The touch fallback (§5.4), with the feed unused |
| Neither | The touch fallback |

Asking for the camera second matters: a player who has already granted
orientation has seen the game work once, which is a much better moment to ask for
the alarming permission than the lobby of a game they have never played.

### 5.4 The touch fallback: a photosphere

Without orientation the hunt cannot be aimed, so it is **dragged** instead: a 360°
photosphere image fills the screen and you swipe to look around it, exactly as
you would a panorama viewer. The ghost sits at a fixed azimuth and elevation in
that image, the ring works identically, and the round is the same length.

This is a **real** alternative rather than a consolation, and it is the reason
Ghost Hunt is *not* on the no-fallback list with Steady Hand and Shake Rush:

- Dragging a sphere is genuinely the same puzzle — a hidden direction, found by
  searching — where "hold a phone still" has no touch equivalent at all.
- It is seated, one-handed and quiet, so it is the accessible way to play, not a
  worse one. Any player may choose it from the lobby.
- It is also the only way this game is testable in a browser on a laptop, which
  is worth something on its own.

Cost: one panorama asset shipped with the game, which is heavier than anything
else in `art/`. It needs a budget (target **< 300 KB**, one image, lazily loaded
only when the fallback is chosen) and it must be a place, not a room — a
recognisable interior invites "why is my room not this room".

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
| A phone reports no orientation at all after the permission is granted | Falls through to the photosphere fallback (§5.4), with the reason said plainly |
| The camera stream ends mid-round (another app grabs it, or the OS revokes it) | The ring switches to the plain dark ground and the round continues. Losing the scenery must never lose the game |
| The tab is backgrounded | The camera track is stopped and released, not merely paused — an unreleased camera keeps a phone's indicator light on, which reads as spying |

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

The most physically active game in the catalogue after Pass the Bomb, and now the
one where players are looking *through* a screen at a room they are turning around
in. A camera feed is reassuring and slightly misleading: it shows the room, but
dimmed, cropped to one lens, and a third of it replaced by a wireframe.

> **Look up before you start. Feet planted, turn slowly, and keep an arm's length
> from furniture and from each other. The screen is not a window — you cannot see
> the floor in it.**

Enforced: `ELEVATION_RANGE` excludes anything that would have people staring
straight up while turning, which is how someone walks into a table.

Also worth saying in the lobby, because it is a real social hazard and not a
technical one: **you are pointing a camera around a room with other people in it.**
The game records nothing (§10), but a phone held up like that reads as filming.
One line telling players to say what they are doing costs nothing.

## 10. Data & privacy

**No pixel from the camera leaves the phone, is stored, or is looked at by the
game.** The feed goes video element → small canvas → edge filter → the ring, all
in the page, and is thrown away frame by frame. There is no recording, no upload,
no recognition of anything, and the game logic never reads it — the ghost's
position comes from the server and the aim from the orientation sensor (§5.2).

That is worth stating this bluntly in three places — here, on the card, and in the
lobby before the permission is requested — because "this game wants your camera"
is the most alarming sentence in the catalogue and the honest answer is short.

What actually crosses the wire: a find message with an index and a duration,
player id, name, avatar. **No orientation stream, no heading, no location, no
video.** The calibration offset never leaves the device either, because the sphere
is evaluated locally.

The camera track is stopped when the round ends, when the tab is hidden, and when
the page unloads — see §7. A camera left open with its indicator lit long after a
game has finished is a betrayal of exactly the trust this section is asking for.

Worth noting for the record: the earlier GPS version of this game would have
transmitted location, and [join.md](../join.md) §2.1's coarse-geohash rule was
written partly for it. This version has no location to protect.

## 11. Accessibility

Unlike Steady Hand and Shake Rush, **this game has a real fallback**, and it is
the accessible way to play rather than a lesser one (§5.4):

- The **photosphere** is seated, one-handed, quiet, needs no permission at all,
  and is available to anyone from the lobby — not only after a denial.
- The hot/cold signal is carried by the ring's **size, brightness and colour**
  plus a number in degrees, so no single channel is required. The number alone is
  enough to play.
- Vibration is an addition, never the only channel.
- `LOCK_CONE` and `LOCK_DWELL_MS` are the difficulty knobs; a `wide` mode at
  20°/400 ms would suit less precise aim without changing anything structural.
- The edge-traced ring is high-contrast white-on-black by nature, which happens to
  be the most legible thing on the screen.
- No flashing. The lock-on beat is a fade under `prefers-reduced-motion`, and the
  ring's brightening is capped well under 3 Hz.

The camera feed is **decoration with a purpose** — it makes the phone feel like
equipment — and every player who cannot or will not grant it still gets the whole
game (§5.3).

## 12. Open questions

- **Does the Sobel filter hold 15 fps at 160² on a real mid-range phone**, next to
  an open WebSocket and an orientation listener? The whole aesthetic depends on it
  being cheap. Fallback ladder in §5.2, and it needs a real device to settle.
- **Does yaw drift over 90 s in practice?** The anchoring design (§3) assumes it is
  small. If it is worse than ~10°, the re-anchor button stops being a comfort and
  becomes a chore.
- **Is 12° the right cone?** Untested, and it interacts with the ring: a ring a
  third of the screen wide subtends far more than 12°, so the ghost is "in the
  ring" well before it is a lock. That may be exactly the right tension or may
  feel broken — a play test decides.
- **The name.** *Ghost Hunt* collides with *Ghost Tag* already in the catalogue.
  One of the two has to move.
- **Which photosphere?** It must be a place rather than a room, and it is the
  heaviest asset in the project (§5.4).
- Should a found ghost stay visible as a mark on the sphere, filling in over the
  round — or does that turn a hunt into a map game (§4)?
