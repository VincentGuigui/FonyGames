# UFO Hunt

> Status: **built, beta**. Ghost Hunt's aiming and permission model, a new
> shared-boss core loop. Verified end to end against a real Worker (§12): the
> permission primer, the hard block on denial, the impact formula, a kill spawning
> a tougher wave, and the health bar and score both updating live. The numbers
> themselves — `UFOHUNT_SCOPE_DEG`, the cooldown, the round cap and health step —
> are still guesses, untested against a real thumb turning a real phone.

| | |
| --- | --- |
| **Slug** | `ufo-hunt` |
| **Catchy sentence** | *One saucer, everyone's lasers. Highest score wins* |
| **Illustration** | `www/src/games/ufo-hunt/art/card.svg` — a saucer, dome and disc, ringed with lights, a crosshair and converging laser bolts; the gameplay sprite itself is `art/ufo.svg` |
| **Players** | 2–10 |
| **Round length** | up to 2 min |
| **Inputs** | orientation + camera — **both required, no fallback** |
| **Accent colour** | `#5EEAD4` |
| **Status** | beta |

## 1. Pitch

A flying saucer hangs in the sky above your own room — real camera, real
scenery, same as Ghost Hunt. Everyone aims at the **same saucer**: a fixed
crosshair sits in the middle of the screen, and turning the phone brings the
saucer toward it. Tap anywhere to fire — the more centered the saucer is
under the crosshair at that instant, the harder the hit. Chip its health bar
down with everyone else's lasers and it explodes; a tougher one takes its
place immediately. Your score is the sum of every shot's damage. Highest
score when the clock runs out wins.

## 2. Core loop

1. Host starts the round. The referee deals the first saucer: a random home
   direction, a random visual kind, health `UFOHUNT_BASE_HEALTH`.
2. The saucer drifts around its home direction — the same bounded wander
   shape Ghost Hunt's ghost uses (§2.1) — identical for everyone, but each
   player reads it against their own calibrated forward (§3, unchanged from
   Ghost Hunt).
3. **Tap anywhere on the screen to fire.** Your phone reports its current
   aim; the referee computes how far that aim was from the saucer's true
   position **at that instant** and turns the angle into damage, `10` dead
   center down to `0` at or beyond `UFOHUNT_SCOPE_DEG`, linear in between
   (§2.2). Damage comes off the shared health bar and is added to your own
   score, whoever else is also shooting at it.
4. A shot fired inside `UFOHUNT_SHOT_COOLDOWN_MS` of your last one is
   ignored — the blaster is recharging (§8).
5. **The saucer explodes at 0 health.** The next one spawns immediately: a
   fresh random direction and kind, `UFOHUNT_HEALTH_STEP` tougher than the
   one before.
6. The round ends at the safety cap. Ranking is by score; ties are
   unranked, the same convention every other timed game in this catalogue
   uses at its own cap.

**Win condition:** highest score when the round ends.
**Scoring:** the running sum of a player's own shot damage. No separate
"shots fired" or accuracy stat — not asked for, and the score already says
it.

### 2.1 Reused from Ghost Hunt: the roam, the calibration, the camera-as-scenery

The saucer's drift is Ghost Hunt's own `ghostAt` shape (`radar.ts`): a bounded
wander around a home direction, a pure function of the saucer's own age, so
every phone computes the identical position from the identical inputs —
nobody's saucer is quietly easier to hit. `UFOHUNT_ROAM_DEG`/`_MS` are this
game's own constants, independently tunable, not shared numerically with
Ghost Hunt's.

The per-player calibration — "forward" is wherever this phone faced when the
round began, no magnetometer, re-anchored each round — is Ghost Hunt's own
§3 reasoning, unchanged: a compass reads 20–40° off indoors and disagrees
between two phones standing next to each other, so nothing here trusts it.

The camera is still never an input to hit detection — the saucer's real
position is server-decided from the same deterministic roam function, never
from analyzing a video frame. What changes from Ghost Hunt is *why* the
camera is on screen at all: there, it is atmosphere the game survives losing;
here, "a saucer in the real sky above you" is the entire pitch, and losing it
loses the game (§5.3).

### 2.2 The impact formula, and why the brief's two phrasings agree

`impact = clamp(10 * (1 - offsetDeg / UFOHUNT_SCOPE_DEG), 0, 10)`, where
`offsetDeg` is the true angle (not a flat screen approximation) between this
player's aim and the saucer's actual position at the moment of the shot.
A dead-center shot (`offsetDeg = 0`) removes exactly 10 — "every perfect
shot removes 10 units." A shot at or beyond `UFOHUNT_SCOPE_DEG` clamps to 0
— "out of scope shot is 0." Everything in between is the stated linear
interpolation. These are not three separate rules to reconcile — they are
the same formula described at its two ends and its middle.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: the live camera feed, full bleed — your own sky. A crosshair
  (`art/crosshair.svg`, raw-imported and inlined rather than loaded through
  an `img` — it needs live CSS, the room's own accent and the ring's own
  `--hot` glow, which an `img`-loaded SVG cannot see) sits fixed at the
  exact center of the screen, always. The saucer is drawn
  at its own on-screen offset from your current aim (an SVG element,
  `art/ufo.svg`, tinted per its `kind`, animated with a bob and a
  blinking-lights cycle) whenever it is within the wider viewing angle the
  live feed covers — outside that, it is simply not on screen, and turning
  the phone brings it back, the same "which way to turn" problem Ghost
  Hunt's radar solves with a bearing triangle. **This game reuses that
  triangle too** — the crosshair is where you're aiming, the triangle at the
  screen edge is which way the saucer currently is.
- **Muzzle flash**: on every shot this phone actually fires, four neon beams
  — the game's own accent colour — sweep in from the four corners of the
  screen toward the crosshair, each stopping 10px short of dead centre
  rather than covering it. The target is the reticle's own measured
  on-screen position (`UfoScreen.tsx`'s `LaserBurst`, via
  `getBoundingClientRect` on `.ufohunt__scope`), not the window's own
  centre — the status bar and health bar above push the reticle down from
  true centre, so aiming at `innerHeight / 2` would visibly miss it. Each
  beam is a short dash travelling along its own length from the corner
  toward the target (a `stroke-dasharray`/`stroke-dashoffset` animation),
  reading as a bolt of light in motion rather than a line that merely
  appears. Purely local and purely decorative: the shot was already sent by
  the time it plays, and it says nothing about whether the shot landed —
  that is what the health bar is for.
- **Health bar**: the shared saucer's current/max health, always visible,
  updates the instant anyone's shot lands — this is co-op, so watching it
  drop from someone else's shot is the point.
- **Live scoreboard**: everyone's running score, updating per shot, same
  `Scoreboard` component every other game uses, `best="high"`.
- **Results**: final ranking by score, winner called out, same shape as
  every other game's `GameOverScreen`.

## 5. Inputs & sensors

### 5.1 Orientation — unchanged from Ghost Hunt

Aim is where the back of the phone points (`core/sensors/orientation.ts`),
calibrated per player at round start, never against a compass. See Ghost
Hunt's own §5.1 for the full reasoning; it transfers verbatim.

### 5.2 Camera — real scenery, still never an input to hit detection

The live feed is shown full-bleed, unfiltered (no Sobel edge trace — that
aesthetic was Ghost Hunt's radar-as-instrument framing; this game's crosshair
is a plain reticle over a plain picture). What a player sees behind the
saucer never crosses the wire and never decides a hit — the referee computes
damage purely from the deterministic roam function and the reported aim,
exactly as Ghost Hunt's radar math already does.

### 5.3 Permissions — both required, no fallback (a deliberate departure)

**This breaks with `docs/device-capabilities.md` §2's "denied is a
supported state, not an error screen" house rule, on purpose, for both
sensors.** Orientation and camera are requested once, in sequence, from the
same tap (orientation first, straight out of the gesture — iOS refuses it
otherwise), exactly as `HuntRoom.tsx`'s `enableCameraRoute` already does. The
difference: **neither denial has a landing place.** A refusal of either
blocks Start with a plain explanation — *"UFO Hunt needs your camera to show
the saucer in the sky above you, and your phone's motion sensor to aim at
it — without both there's nothing to point at."* — rather than degrading to
a dark ground or a touch-dragged panorama.

This is the same category of exception Shake Rush and Steady Hand already
carry for motion, argued the same way: the mechanic **is** the sensor, not a
layer on top of a touch-first game. Ghost Hunt itself proves the fallback is
buildable — it is this game's own direct ancestor — so the absence here is
a choice, stated plainly rather than left implicit.

## 6. Networking

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `ufo-shoot` | client → server | `{roundId, aimAz, aimEl}` | This player's current aim, in degrees, at the moment they tapped |
| `ufo-hunt` | server → both | `{roundId, wave: {index, kind, maxHealth, health, homeAz, homeEl, spawnedAt}, scores, endsAt, phase, winner}` | The shared saucer and everyone's score — nothing here is private |

No per-player private message: unlike Tap Tap Music or Squash Mosquitoes,
there is nothing to hide — the whole point is a shared target and public
scores.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Removed from the standings; the saucer's health is untouched — it belongs to the room, not to any one player |
| The safety cap hits | Ranked by score; a tie is unranked |
| A shot arrives inside the cooldown window | Ignored — no health change, no score change |
| Two shots land on the same tick, killing the saucer | Both are scored in full against the health that was left when each was processed (server-sequential, not simultaneous) — the next wave spawns once health reaches 0, however many shots overshot it |
| Fewer than 2 players | Start disabled |
| A player refreshes mid-round | Same seat, same score; resent the current wave and every score on reconnect |
| Camera or orientation denied | Start is blocked with the explanation in §5.3 — there is no way into the round without both |

## 8. Anti-cheat

- **The saucer's true position is server-computed**, from the same
  deterministic roam function the client renders with — a modified client
  cannot claim the saucer was somewhere it wasn't.
- **The damage formula lives on the server**, not the client: a shot reports
  only a raw aim, and the referee applies `UFOHUNT_SCOPE_DEG` and the linear
  interpolation itself.
- **Honest limit, stated plainly rather than glossed over**: the referee
  cannot verify that the *reported aim* reflects the phone's real sensor
  reading — the same fundamental gap Ghost Hunt avoids entirely by never
  scoring on aim at all (spec §8 there). A continuous accuracy score is this
  game's whole premise, so that option isn't available here. The mitigation
  is `UFOHUNT_SHOT_COOLDOWN_MS`, a per-shot cooldown that bounds the worst
  case — a client claiming a perfect shot every time — to a known rate, not
  a claim that it is prevented.

## 9. Safety

Same physical-hazard framing as Ghost Hunt (§9 there, transferred as-is):
look up, feet planted, know what's around you before you turn. Holding the
phone up and turning to track something is the same motion in both games.

## 10. Data & privacy

Same as Ghost Hunt (§10 there, transferred as-is): no pixel of the camera
feed ever leaves the phone. What does: aim readings per shot, player id,
name, avatar. Room memory only, for the life of the round.

## 11. Accessibility

**Inherited and unmitigated, stated honestly**: Ghost Hunt's whole
accessibility answer is its touch-dragged photosphere alternative, which
this game's brief explicitly removes. UFO Hunt is not playable without
sight, without the ability to turn and hold up a phone, or by a player whose
camera or motion sensor is denied — there is no fallback channel left to
offer any of them, unlike every other game in this catalogue. This is a
known, accepted limitation of this specific game, not a gap to paper over —
recorded here so it is visible rather than discovered.

What is still true: the health bar and scores are numbers, never a bar
alone; the saucer's lights blink rather than strobe; the muzzle flash is a
single 260ms fade, once per own shot, not a repeated flicker, and it does
not render at all under `prefers-reduced-motion` rather than showing a
static line with nothing to make it read as a flash.

## 12. Open questions

- **`UFOHUNT_SCOPE_DEG = 20`** (Ghost Hunt's own `RADAR_FOV_DEG` value) is a
  starting point, not a measurement — untested against real thumbs turning a
  real phone.
- **Is `UFOHUNT_SHOT_COOLDOWN_MS` the right anti-spam number?** Too short and
  it's not felt as a "recharge"; too long and a good shot has to wait out a
  worse one's cooldown before firing again.
- **Round length and health-step tuning** (`UFOHUNT_ROUND_CAP_MS = 120_000`,
  `+50` health per wave) — untested for how many waves a 2-minute round
  actually gets through.
- **Is the accessibility gap in §11 acceptable for this game specifically**,
  given every other game in the catalogue offers some landing place? Flagged
  for explicit maintainer sign-off, not assumed.

**What was actually verified**, against a real Worker (`wrangler dev`) and a
real Chromium (a fake camera device, synthetic `deviceorientation` events —
camera/orientation cannot be faked the way 100 Taps' pure-touch round could):
solo mode start, the permission primer's copy before and after granting, the
round starting only once both are granted, the live camera feed rendering as
the backdrop, the crosshair and off-screen bearing arrow, repeated dead-centre
shots dropping the shared health bar and crediting score at the rate `ufoImpact`
predicts, a kill spawning the next wave at `+UFOHUNT_HEALTH_STEP` health with a
fresh random `kind`, and the health bar resetting to full for it. One real bug
was caught and fixed this way that no unit test could have: the camera's
`<video>` element was never receiving its stream, because the effect wiring it
up depended only on the permission being granted — which happens in the lobby,
before `<video>` exists — and never re-ran once the round actually mounted it.
