# Ghost Hunt

> Status: **built, beta**. The numbers in §2 are guesses that need a real room —
> `RADAR_FOV`, `GHOST_ROAM`, `GHOST_HOLD_MS`, and whether the Sobel filter holds its
> frame rate on a mid-range phone (§12).
>
> **The find was re-specced on 2026-08-14.** It used to be "hold your aim inside a
> 12° cone for 600 ms", with the ghost as an invisible direction. It is now a
> **visible ghost that roams**: the radar is a window, the ghost appears inside it
> when you point near it, and the hunt is keeping it on the dial for four seconds
> while it drifts. §2 records the change and the one inequality it turns on.
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
> decided. *Ghost Radar* has got stronger since the dial became the whole interface.

| | |
| --- | --- |
| **Slug** | `ghost-hunt` |
| **Catchy sentence** | *Sweep the room for ghosts only your phone can see* |
| **Illustration** | `www/src/games/ghost-hunt/art/card.svg` — a phone held up, its screen a bright radar cut out of the dark, a faint room wireframe inside it and a ghost in it. Replaced the compass needle, which belonged to the old idea |
| **Players** | 2–8 |
| **Round length** | 90 s |
| **Inputs** | orientation (device attitude) + **camera**. Touch fallback (§5.4). No GPS, no magnetometer — see §3 |
| **Accent colour** | `#34D399` — a radar green. Everything the game draws wears it: the radar's edge, the arrow on its rim, the hold, the ghost, and the traced outlines in a lighter wash (`EDGE_RGB` in vision.ts). Was `#FBBF24`; the amber belonged to the compass |
| **Status** | built, beta |

## 1. Pitch

Hold your phone up and the screen becomes a window onto your own room — except
through the radar in the middle, where the world arrives as a ghost: an outline
traced out of the live camera feed, all edges and no substance.

Somewhere in the air around you there is a ghost. Sweep the phone until it shows up
in the radar, then keep it in there while it drifts. Catch it, and the next one is
somewhere else.

Everyone gets the same ghosts in the same order, and every ghost drifts along the
same path for everyone, so it is a race. A room playing this looks completely
deranged from outside, which is the correct outcome.

## 2. Core loop

1. **Calibrate** (§3). Everyone holds their phone where they are facing and the host
   starts; that pose becomes their personal *forward*.
2. The server picks ghost 1's **home direction** on the sphere — an azimuth and an
   elevation **relative to each player's own forward**, identical for everyone.
3. You sweep the phone around, watching the room through the radar (§4). A triangle
   on the radar's rim points the way, which is the only help when it is behind you.
4. Get within `RADAR_FOV` of the ghost and **it appears in the radar**, at its own
   place on the dial. It roams from its home while it is there.
5. Keep it on the dial for `GHOST_HOLD_MS` → **caught**, and the next ghost is somewhere
   else. Let it off the dial and the hold starts again from nothing.
6. The round ends the moment **anybody reaches `HUNT_TARGET_FINDS`**.

**Win condition:** the **lowest total search time**, among players who caught the most.
**Scoring:** the score IS the time — every catch adds the seconds it took, and the
smallest number wins.

### A race to five, not a count inside ninety seconds

This replaced "most found in 90 s" on 2026-08-14, and the two are different games. A fixed
window makes the last few seconds worth nothing and ends every round at the same moment
whatever anyone did; a target means the round ends **because somebody won it**. The clock
is still there as a backstop so a room that cannot find anything does not hunt forever,
which is why the card says *to 5 ghosts* rather than a duration.

### Why the score is a time, and why time alone cannot rank

The score is the seconds spent searching, summed over a player's catches, and the lowest
wins — a hunter who found five ghosts in twenty seconds beat one who took a minute.

But **time alone is not a ranking**, and getting this wrong is the trap: a player who has
caught nothing has spent no time, so sorting on time puts whoever has barely played at the
top. So the order is **count first, then time**:

| | |
| --- | --- |
| `ranking()` | most caught, then lowest total. The winner necessarily has the most, because reaching the target is what ended the round |
| `leaderOf()` | the same rule, and `null` when nobody has caught anything or two players are level on both |
| The panel | shows the time, and is handed the leader explicitly — it ranks one value in one direction, and this is two values in opposite directions (`core/ui/Scoreboard.tsx`) |
| A player with nothing | reads **—**, not `0.0s`. A zero in a column where low is good is a lie |

`www/src/games/ghost-hunt/game.test.ts` asserts the trap directly: a player last on count
and first on time must not be first overall.

| Constant | Value | Why |
| --- | --- | --- |
| `RADAR_FOV` | 20° | The radius of sky the dial shows. Findable by sweeping, too narrow to hit by accident |
| `GHOST_HOLD_MS` | 4 000 | Long enough that following it is the skill; a sweep straight past cannot pay |
| `GHOST_ROAM` | 26° | How far it wanders from home. **Larger than `RADAR_FOV` — see below** |
| `GHOST_ROAM_MS` | 11 000 | The period of the wander. Slow: it drifts, it does not dodge |
| `TARGET_MIN_SEPARATION` | 60° | Consecutive homes are never near each other, so a catch always costs a movement. Must clear `RADAR_FOV + GHOST_ROAM` (46°) |
| `ELEVATION_RANGE` | −40°…+70° | Nothing at your feet, nothing directly behind your head |
| `MIN_FIND_MS` | `GHOST_HOLD_MS − 200` | The server's floor on a believable claim (§8) |
| `HUNT_TARGET_FINDS` | 5 | Catches that end the round. First there wins it |
| `ROUND_MS` | 90 000 | The **backstop**, not the rule: it stops a room that finds nothing from hunting forever |

### The one inequality: `GHOST_ROAM > RADAR_FOV`

This is the whole game, and it is easy to get backwards.

A ghost roams **further than the radar can see**. So a phone parked on the direction
where the ghost appeared *loses* it — the ghost drifts off the dial and the hold
resets. Following a slow wander for four seconds is the skill being asked for, and
it is a skill you can see yourself exercising, which the old version was not: an
invisible direction held inside an invisible cone gave a player nothing to watch.

Reverse the inequality and the game evaporates. A roam smaller than the radar's
radius means pointing once and standing still wins, the wander becomes decoration,
and the four seconds are a tax rather than a task. `www/src/games/ghost-hunt/game.test.ts`
asserts both halves — that a still phone catches nothing and a following one does.

### The roam looks random and is not

Every ghost's path is a pure function of its **index** and **how long it has been on
screen for that player**. Nothing is drawn from `Math.random`.

That is a fairness requirement. Everyone hunts the same ghosts in the same order, and
a race where one player's ghost happened to sit still while another's bolted is not a
race. Deriving the path from the index gives every phone the same four seconds of
work; deriving it from the ghost's own age rather than from the round clock means a
player who finds it late still gets the same path from the same start.

It costs nothing to do: two sine terms at incommensurable periods, phased by the
index (`ghostAt` in `radar.ts`). It drifts, it turns back somewhere unexpected, and it
never traces a circle anyone can learn.

### What the old version was, and why it changed

Until 2026-08-14 the find was: hold your aim inside a **12° cone** for **600 ms**. The
ghost was never drawn — it *was* the cone — so the entire experience was a number
counting down and a dial changing brightness. Two problems, both fatal to the fantasy
the card sells:

- **Nothing to see.** "Ghosts only your phone can see" and then the phone does not
  show you one. The radar was an instrument reporting an abstraction.
- **Nothing to do.** 600 ms is inside the reaction time of noticing you have arrived,
  so a find was over before it began, and the skill was aiming rather than hunting.

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

**Drift** is the remaining risk: yaw from a fused orientation estimate wanders over
minutes. It is mitigated by the **90 s round** and by nothing else.

There used to be a **Re-centre** button on the round screen. It was removed on
2026-08-14 along with the mid-round route switch, for a reason that outweighs the
drift it covered: the round screen is a phone held up in a room while its owner turns
around, and a control on it is a thing to hit by accident and a thing to look for
instead of looking at the radar. Nothing in a 90-second round should need a settings
change halfway through — and a player who genuinely wants a new forward gets one by
starting the next round, which is 90 seconds away at worst.

So forward is set exactly once per round, at the start, and the lobby says so
("Face the way you want to call forward, then start"). Whether drift is even
noticeable at this timescale is §12; if it turns out to be, the answer is a shorter
round rather than the button back.

## 4. Screens

The screen is **the live camera feed as the playground** — your own room, full bleed,
barely dimmed. Centred on it is the **radar**: a dial roughly a third of the screen
wide showing the same feed run through an edge detector, outlines on black, the room
as a wireframe. Outside the radar, your room. Inside it, the room a ghost lives in.

That split is the whole interface, and it does three jobs at once:

- **It gives the hunt somewhere to look.** Aiming at nothing is unsatisfying;
  aiming *through* something makes the phone feel like an instrument.
- **It carries the hot/cold signal in the radar itself** — the dial brightens and
  picks up the accent colour as you close in, so the thing you are staring at is the
  thing telling you the answer. No separate meter to glance at.
- **It keeps your eyes up.** You are looking at the room, through the phone,
  rather than down at a dial — which matters for §9.

**No degrees readout.** There used to be an "N° off" number under the dial, and it was
removed on 2026-08-14 at the maintainer's request. It cost §11 the one channel that worked
without sight, which is recorded there rather than quietly dropped — what is left is the
arrow, the ghost on the dial and the radar's brightness, all of them visual. The status bar
carries progress towards the target (`3/5`) instead, which is the number that decides when
the round stops.

Three marks on the dial, and they answer different questions:

| Mark | Says | When |
| --- | --- | --- |
| **Triangle on the rim** | *which way to turn* | Always. It slides around the rim to the ghost's bearing, and it is the only thing that helps when the ghost is behind you |
| **The ghost** | *it is here, and it is moving* | Once it is within `RADAR_FOV`, drawn at its own place on the dial |
| **The rim filling** | *how much of the four seconds you have* | While you are holding it |

The outlines are drawn in a **lighter wash of the accent**, not white
(`EDGE_RGB` in `vision.ts`). White read as a generic night-vision filter and was the
one thing on screen ignoring the game's own colour while the radar around it wore it.

**No buttons on the round screen.** Not a shortage of ideas — see §3 on the removed
Re-centre. Also on screen, small and out of the way: degrees to the ghost, your score,
the time left, and everyone else's count.

- **Lobby**: shared template, the camera + orientation primer (§5.3), the safety
  line (§9), and one line saying what the game does with the camera — *nothing
  leaves your phone* — because "let us use your camera" is the most alarming ask
  in the catalogue and deserves an answer before it is asked.
- **Calibrate**: no screen of its own. Forward is whatever the phone is facing when
  the host starts, which is one fewer blocking screen between a tap and a game.
- **Round**: as above.
- **The catch**: the rim comes full and the radar gives one pulse. Fired by the
  **score going up** — the server agreeing — rather than by the phone's own hold
  completing, so nothing is ever celebrated that the referee then refuses.
- **Results**: each player's catches **and their total search time**, ordered by the rule
  in §2, with the fastest single catch called out.

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
to a small offscreen canvas, Sobel-filtered, painted into the radar.

**The filter runs on a deliberately small buffer.** Edge detection is per-pixel
work, and a 1080p frame at 30 fps is not something to attempt on a mid-range
phone that is also holding a WebSocket open. The pipeline is:

| Stage | Budget |
| --- | --- |
| Video → canvas downscale | **160×160**, the radar only, not the whole frame |
| Sobel + threshold | ~26 k pixels, plain JS on a `Uint8ClampedArray` |
| Paint | scaled back up into the radar, `image-rendering: pixelated` |
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

### 5.3 Permissions, and the two ways to play

The lobby asks one question — *how do you want to play* — with two answers:

| Choice | What it turns on |
| --- | --- |
| **Use your camera to find the ghost** | Orientation for the aim, and the camera as the playground. Both, from the one tap |
| **Use your finger to explore** | Nothing. The panorama route (§5.4) |

Both permissions come from the **one tap that picks the camera route**, orientation
first so it is still inside the gesture — iOS refuses that prompt outside one and
remembers a denial ([device-capabilities.md](../../device-capabilities.md) §2). The
camera is asked for second and is allowed to fail.

**This replaced a three-button version** where the camera was its own button that only
appeared after orientation was granted. That made the feature the game is built around
something a player discovered rather than something they chose, and it named the
choices after sensors ("Sweep the room" / "Drag to look around") when what a player is
picking is *what they will be doing*.

Every outcome has a landing place, and none of them is "you cannot play":

| Granted | Result |
| --- | --- |
| Orientation + camera | The full game (§4) |
| Orientation only | The same hunt, radar on a plain dark ground instead of the feed. Loses the atmosphere, keeps the game |
| Neither | The finger route, which needs nothing |

**The route cannot be changed once the round is running.** There used to be a "Sweep
instead" button on the round screen for a player who had been put on the finger route
by a host starting immediately. It is gone for the same reason as Re-centre (§3): a
round screen is a phone held up in a moving room, and swapping input method halfway
through a 90-second round is not something to do by accident. The picker is in the
lobby, and the next round is never far away.

### 5.4 The touch fallback: a photosphere

Without orientation the hunt cannot be aimed, so it is **dragged** instead: a 360°
photosphere image fills the screen and you swipe to look around it, exactly as
you would a panorama viewer. The ghost has the same home direction in that image as
it does in a room, the radar works identically, and the round is the same length.

**The finger holds the world, not the camera.** Drag right and the room comes with
you, so the aim goes left. It shipped the other way round on both axes — the "turn the
camera" reading — and every drag went the wrong way.

**The window is specified vertically** (`V_FOV_DEG`, 60°), not horizontally. The
vertical is the axis that runs out: the image ends at the zenith, so a window much
taller than 40° cannot be centred on a ghost at the top of the band (+70°) without
asking for rows above the top row. Specifying the horizontal instead — which is what
it did — makes a portrait phone derive a **151°** vertical window whose crop is taller
than the whole image, so the vertical crop clamped at every elevation and dragging up
and down did nothing at all. It read as "vertical drag is not implemented"; it was the
projection.

Where the window does overrun the top, the missing rows are **not drawn** rather than
clamped back into the image. Clamping keeps the picture full at the cost of the one
property this projection has to have — that the centre of the screen is exactly the
aim — and the radar is drawn from the aim, so a ghost dead centre on the dial would
appear off-centre in the room behind it. Past the ceiling there is nothing to see, and
a band of dark at the top of the screen is the truth.

This is a **real** alternative rather than a consolation, and it is the reason
Ghost Hunt is *not* on the no-fallback list with Steady Hand and Shake Rush:

- Dragging a sphere is genuinely the same puzzle — a hidden direction, found by
  searching — where "hold a phone still" has no touch equivalent at all.
- It is seated, one-handed and quiet, so it is the accessible way to play, not a
  worse one. Any player may choose it from the lobby.
- It is also the only way this game is testable in a browser on a laptop, which
  is worth something on its own.

Cost: one panorama asset shipped with the game, which is heavier than anything
else in `art/`. Budget: **< 300 KB**, one image, lazily loaded only when the
fallback is chosen, and a place rather than a room — a recognisable interior
invites "why is my room not this room".

Shipping as `art/photosphere.jpg`: an illustrated interior — floorboards, a fireplace,
a ladder, doors onto a night sky — 2048×1024, **360 KB**, inside the budget. It
replaced a 36 KB placeholder colonnade on 2026-08-14. A raster and not an SVG on
purpose, because `outlines.mjs` walks every `art/` directory and would generate a
hollow variant of a vector one.

Swapping it is a file copy plus the one import in `HuntRoom.tsx`. Whatever replaces it
must keep the projection honest: equirectangular means x is 0…360° of azimuth and y is
+90°…−90° of elevation, so **the horizon has to be the exact vertical midpoint**, and
detail near the top and bottom edges smears across a whole pole.

## 6. Networking

Server is authoritative for the target sequence, the clock and the score. It
cannot verify an aim, so it verifies *timing* instead (§8).

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `found` | client → server | `{roundId, index, ms}` | I caught ghost `index`, `ms` after it appeared |
| `hunt` | server → clients | `{roundId, targets[], index: {playerId: n}, endsAt, scores}` | The shared sequence, and how far down it everyone is |
| `hunt-end` | server → clients | `{roundId, scores, best}` | Round over |

**The aim never crosses the wire.** The phone streams nothing during the round —
it evaluates its own angle locally at sensor rate and sends one small message per
catch. There **was** an `anchor` message — "I have calibrated" — carrying nothing the
server could use; it was a no-op in `Room.ts` from the day it was written, and it was
deleted with the Re-centre button that sent it (§3). That is ~10 messages per player per round, which is the cheapest game in
the catalogue by an order of magnitude, and it means a 200 ms hiccup costs
nothing.

Every player gets the same `azimuth`/`elevation` per index, so the sequence is
shared even though each player's frame is their own (§3).

**Progress is per player over a shared sequence.** The first implementation had a
single live target that advanced on the first find, and it was wrong twice over:
it yanked the ghost off everyone else's screen mid-sweep, and it meant the second
finder of a ghost scored nothing — which §7 says should score. So the frame carries
the whole sequence and each player's place in it. The sequence is ~15 pairs of small
numbers at the end of a 90 second round, which is cheap enough that a phone which
missed a frame or joined late needs no resync path at all.

**The broadcast deadline is a stored moment**, not "now plus a tick": Room's one
alarm slot decides which game woke it by comparing the clock against that number,
and a deadline computed from the caller's own clock is never due (steady-hand.md §6).

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player never chose a route before the host started | They get the finger route, which needs no permission, and stay on it for the round — the picker is in the lobby and the next round is 90 s away (§5.3) |
| Orientation events stop (tab backgrounded) | Round continues; you simply catch nothing. On return, the current ghost is still live and still roaming |
| `found` arrives for a ghost that has moved on | Ignored — a late claim on a stale index is not a point |
| Two players catch the same ghost | Both score. This is a race for count, not a claim on the ghost |
| The ghost roams while a phone sits still | It leaves the dial and the hold resets. This is the game, not a fault (§2) |
| Fewer than 2 players | Start disabled |
| A phone reports no orientation at all after the permission is granted | Falls through to the photosphere fallback (§5.4), with the reason said plainly |
| The camera stream ends mid-round (another app grabs it, or the OS revokes it) | The radar switches to the plain dark ground and the round continues. Losing the scenery must never lose the game |
| The tab is backgrounded | The camera track is stopped and released, not merely paused — an unreleased camera keeps a phone's indicator light on, which reads as spying |

## 8. Anti-cheat

The server cannot see where a phone is pointing, so a patched client can claim
every ghost instantly. What is checkable is **time**:

- **A floor on time-to-catch.** `found` with `ms < MIN_FIND_MS` is rejected, and so is
  one where the *server's* own elapsed is under the floor — the stricter of the two
  clocks wins, so lying low about `ms` still means waiting in real time. Instant
  catches are impossible.
- **The floor sits just under `GHOST_HOLD_MS`, not over it.** A ghost can roam onto the
  dial the moment it appears — the separation rule keeps its *home* far away, but the
  ghost moves — so the fastest honest catch is the hold itself, and a floor above it
  would reject the luckiest real player in the room.
- **A ceiling on rate**: at most one catch per ghost index, and the index must be
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
game.** The feed goes video element → small canvas → edge filter → the radar, all
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
- The signal is carried **three ways**: the arrow's direction, the ghost's presence on the
  dial, and the radar's brightness and colour. All three are visual.

  There was a fourth — a number in degrees under the dial — and it was the only one that
  worked without sight. It was removed on 2026-08-14 at the maintainer's request, and this
  game is now **not playable without sight**: aiming a phone at a direction you cannot see
  reported to you has no non-visual channel left. Recorded here rather than dropped
  silently; the fix, if it is wanted back, is a screen-reader-only reading rather than the
  visible number, since that is what §11 needed from it.
- Vibration is an addition, never the only channel.
- `RADAR_FOV`, `GHOST_ROAM` and `GHOST_HOLD_MS` are the difficulty knobs, and they
  move independently: a gentler mode would widen the dial and slow the roam rather
  than shorten the hold, since the hold is what makes the catch legible.
- The traced outlines are high-contrast on black by nature. They are a light wash of
  the accent rather than white, which keeps the contrast and stops the one thing
  inside the radar from being the one thing ignoring the game's colour.
- No flashing. The catch beat is a fade under `prefers-reduced-motion`, and the
  radar's brightening is capped well under 3 Hz.

The camera feed is **decoration with a purpose** — it makes the phone feel like
equipment — and every player who cannot or will not grant it still gets the whole
game (§5.3).

## 12. Open questions

- **Does the Sobel filter hold 15 fps at 160² on a real mid-range phone**, next to
  an open WebSocket and an orientation listener? The whole aesthetic depends on it
  being cheap. Fallback ladder in §5.2, and it needs a real device to settle.
- **Is the panorama good enough to keep?** It is an illustration, not a photograph,
  and a photograph would sell the "somewhere else" better (§5.4). Settled enough to
  ship: the interior that replaced the placeholder on 2026-08-14 reads as a room a
  ghost could be in, which the colonnade did not.
- **Does yaw drift over 90 s in practice?** The anchoring design (§3) assumes it is
  small, and there is no longer a re-anchor button to paper over it. If it is worse
  than ~10°, the answer is a shorter round rather than the button back.
- **Are 20°, 26° and four seconds the right three numbers?** They are picked to make
  `GHOST_ROAM > RADAR_FOV` true with room to spare, which is the part that matters
  (§2). Whether following the drift for four seconds is *fun* or *fiddly* is the
  question a play test settles, and the lever is `GHOST_ROAM_MS` — a slower wander is
  easier to follow without making the dial bigger or the hold shorter.
- **Does the dial need to show the whole 40° it covers, or should the ghost be drawn
  larger as it nears the middle?** Right now it is flat: a ghost at the rim and one in
  the centre are the same size, which is honest and possibly dull.
- **The name.** *Ghost Hunt* collides with *Ghost Tag* already in the catalogue.
  One of the two has to move.
- **Which photosphere?** It must be a place rather than a room, and it is the
  heaviest asset in the project (§5.4).
- Should a found ghost stay visible as a mark on the sphere, filling in over the
  round — or does that turn a hunt into a map game (§4)?
