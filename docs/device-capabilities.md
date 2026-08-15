# Device capabilities: sensors, GPS, bump, permissions

What a phone browser gives us, what it costs, and the rules for using it.

## 1. Capability matrix

| Capability | Web API | Permission | Notes / gotchas |
| --- | --- | --- | --- |
| Touch, multi-touch, swipe | Pointer Events | none | Always available. The universal fallback. |
| Motion / shake / bump | `DeviceMotionEvent` | **iOS: explicit user gesture + `requestPermission()`** | HTTPS only. iOS Safari refuses outside a tap handler. |
| Tilt / orientation | `DeviceOrientationEvent` | same as motion | `absolute` vs relative differs per platform. Calibrate at round start. |
| Compass heading | `DeviceOrientationEvent.webkitCompassHeading` / `alpha` | same as motion | iOS and Android disagree on reference and sign. Normalise in `core/sensors`. |
| GPS position | `Geolocation.watchPosition` | prompt | Accuracy 5–50 m outdoors, terrible indoors. Battery-hungry. |
| Microphone level | `getUserMedia({audio})` + `AnalyserNode` | prompt | Only the **level** is used, never recorded audio. |
| Vibration | `navigator.vibrate` | none | Android only; silently absent on iOS. Never load-bearing. |
| Camera (QR scan) | `getUserMedia({video})` or the OS camera app | prompt | Prefer the OS camera app for joining; avoid asking for camera. |
| Wake lock | `navigator.wakeLock` | none | Request during a round so the screen doesn't lock. |
| Share | `navigator.share` | none | Best way to send a room link. Fallback: copy to clipboard. |

**HTTPS is mandatory** for motion, orientation, geolocation, mic and wake lock.
Local dev therefore needs an HTTPS dev server or a tunnel — see
[testing.md](testing.md).

## 2. Permission rules

1. **Never request a permission on the hub.** Only inside a game lobby.
2. **Always show a primer first**: one sentence saying what the game does with
   it ("Pass the Bomb needs motion to feel your phone tap another one."), plus the
   button that triggers the real prompt. iOS requires that tap anyway.
3. **Request only what the chosen mode needs.** A local mode that doesn't use
   GPS must not ask for GPS.
4. **Denied is a supported state**, not an error screen. Offer the touch
   fallback declared in the game's spec, or explain in one line why this mode
   can't run and point to a mode that can.
5. Re-asking is allowed at most once per session, and only from an explicit
   "Enable" button.

## 3. Bump detection (shared definition)

"Bump" = two phones **gently tapped together**, detected as a sharp
acceleration spike on both devices at nearly the same instant.

Reference algorithm (implemented once in `core/sensors/bump.ts`):

1. Read `devicemotion` `accelerationIncludingGravity`, ~60 Hz.
2. Compute magnitude `m = √(x²+y²+z²)`, subtract a rolling baseline (≈ 9.81 plus
   hand jitter) to get `Δ`.
3. Candidate spike when `Δ > BUMP_THRESHOLD` (start at **12 m/s²**, tune per
   device class) **on a rising edge** — the previous sample was under the line and the
   jump between the two is at least `BUMP_JERK` (7 m/s²). Sustained agitation is rejected
   separately: over the line for more than half of the last 500 ms is a phone being waved,
   and nothing it reports is a knock.

   > This step used to read "and the previous 150 ms was calm", where anything above half
   > the threshold counted as not-calm. **It was wrong, and it broke the gesture.** You
   > *swing* a phone to meet another one; the swing is 6–10 m/s² of ordinary movement, so
   > the run-up disqualified the knock at the end of it — and both phones had to pass the
   > same test within a quarter of a second, so the failure compounded. Replayed against
   > the same synthetic traces, the old rule scored **0** for a knock at the end of a swing
   > and 1 for the same knock out of dead stillness. What separates a contact from a swing
   > is not stillness beforehand, it is how fast the reading changes: a contact arrives in
   > one or two samples, a swung arm ramps over ten.
4. Send `{t:'bump', at: <clientTs>}` to the server, throttled to 1 per 300 ms.
5. **The server pairs bumps**: two players in the same room whose bump
   timestamps (clock-corrected) fall within **±250 ms** are a confirmed contact.
   A single unpaired bump is ignored.
6. Optional second signal when the mode needs certainty: both phones must also
   be within GPS/RSSI plausibility, or the pair must be "expected" by the game
   state (e.g. the bomb holder and a neighbour).

Anti-cheat: shaking wildly produces many spikes — the 300 ms throttle plus the
pairing requirement plus a per-round bump quota make spamming useless.

> ⚠️ **`BUMP_THRESHOLD` has never been validated on a real phone.** 12 m/s² is
> an educated guess. The detector in `www/src/core/sensors/bump.ts` is covered
> by **synthetic** traces (knock, double-knock, sustained shaking, stillness,
> walking) — useful for the logic, worthless for the constant. Recording real
> traces from an actual handset and re-tuning is a prerequisite for calling any
> bump game done ([testing.md](testing.md) §1).

**Safety copy is mandatory** in any bump game: *"Tap phones gently, corner to
corner. Cases on."*

## 4. Motion & tilt rules

- Calibrate at round start (3·2·1 countdown = "hold your phone how you like").
  Store the reference orientation and work in deltas.
- Throttle: sample at device rate, **act** at ≤ 60 Hz, **transmit** at ≤ 20 Hz.
- Always remove the listener when the round ends or the tab is hidden
  (`visibilitychange`) — motion listeners drain battery fast.
- Low-pass filter before using values for steering; raw values are jittery.

## 5. GPS rules

- `watchPosition` with `enableHighAccuracy: true` only during an active round.
- Ignore fixes with `accuracy > 50 m` for scoring; show the player a "weak GPS"
  indicator instead of penalising them.
- **Round positions to ~5 m** before transmitting. Never transmit raw traces.
- Games must define a **play area** and refuse to start if players are outside
  it or too far apart.
- **Safety**: GPS games display, before every round, *"Watch where you're going.
  Don't play near traffic. Never run."* Rounds have a hard time cap.

## 5b. The screen: awake, and upright

Both are handled once, in `lobby/RoomGate.tsx` — the one component every game page passes
through — by `useHeldPhone()` in `core/screen.ts`. Not per game: that would be nine copies
of two lines and a tenth game that forgot.

### Awake

`navigator.wakeLock.request('screen')` for as long as a game page is open, lobby included:
a lobby is exactly where a phone sits untouched on a table while friends join, and every
game is played with the thumbs doing something an idle timer does not count as activity —
turning on the spot, holding still, watching a bomb in somebody else's hands.

> **Re-acquiring is the whole job.** The browser releases the lock every time the page
> stops being visible — a tab switch, a notification shade, a glance at another app — and
> does **not** restore it on the way back. A one-shot `request()` keeps the screen alive
> until the first interruption and then silently stops, which looks identical to a working
> one in a screenshot and shows up a week later as "my phone keeps going dark". So there is
> a `visibilitychange` listener, and it is what `screen.test.ts` spends most of its
> assertions on.

Silent everywhere it is unavailable — Safari before 16.4, any page over plain HTTP, a
refused request. A round must never fail to start over a wake lock.

### Upright

Two halves, because neither is enough:

| Half | Where it works | Where it does nothing |
| --- | --- | --- |
| `screen.orientation.lock('portrait')` | Android Chrome, installed or fullscreen | **iOS Safari has no such API**, and Chrome rejects it outside fullscreen |
| The `.upright` notice — "turn your phone upright" | Everywhere, it is CSS | Nowhere, but it asks rather than enforces |

The API is asked for first and is the better answer when it is honoured; on most phones the
notice IS the feature. Its media query is deliberately narrow — `(orientation: landscape)
and (max-height: 500px)` — so a phone on its side gets it and a wide desktop window does
not, which is a distinction `orientation: landscape` alone does not make.

The notice **covers, it does not pause**: the round is still running underneath and the
socket is still open. Nothing is lost by the two seconds it takes to turn the phone back.

## 6. Privacy

- Coordinates, motion samples and mic levels are **relayed, never stored**. They
  live in server memory for the duration of the room only.
- No third-party analytics on sensor data. No tracking pixels.
- The mic is used as a **level meter only**; no audio buffer is ever sent or
  kept.
- Every game's spec must list the data it emits in its "Data & privacy" section.

## 7. Fallbacks (default map)

| Missing | Fallback |
| --- | --- |
| Motion / bump | Tap the screen with two fingers, or a "virtual bump" button paired by proximity in the room |
| Orientation | On-screen joystick / drag-to-steer |
| Compass | Show a map arrow based on successive GPS fixes |
| GPS | Offer the same game in a "same-room" mode with codes instead of places |
| Mic | Tap-speed meter |
| Vibration | Flash the screen + sound |
