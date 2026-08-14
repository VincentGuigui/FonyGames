# Pass the Bomb

> Status: **`classic` playable end to end**, beta until a play test. This is also the reference
> example of a filled-in [game spec](../game-spec-template.md).

| | |
| --- | --- |
| **Slug** | `pass-the-bomb` |
| **Catchy sentence** | *Smash phones together to pass the bomb before it blows* |
| **Illustration** | `www/src/games/pass-the-bomb/art/card.svg` — two phones tapping corner to corner, a cartoon bomb with a lit fuse jumping between them |
| **Players** | 3–8 |
| **Round length** | 1–2 min |
| **Inputs** | motion (bump), touch (fallback) |
| **Accent colour** | `#FF5A36` |
| **Status** | `classic` **playable end to end** — referee, phone UI, bump sensor and tap fallback all built and covered by `npm test`. The other three modes are specified, not built |

## 1. Pitch

A ticking bomb lives on one phone. To get rid of it you must physically tap your
phone against someone else's — gently, corner to corner. The fuse is hidden and
random, so every second you hold it is a gamble. When it blows, the holder is
out, the circle shrinks, and the next fuse is shorter.

Everyone is standing in a circle, arms out, shrieking. That's the game.

## 2. Core loop

1. The server picks a random holder and starts a **hidden fuse** (see §2.1).
2. The holder's phone vibrates, turns red, and shows the bomb. Everyone else
   sees who has it.
3. The holder bumps their phone against another player's phone. The server pairs
   the two bump events (§5) and transfers the bomb.
4. Repeat until the fuse expires. The current holder is **out** and becomes a
   spectator for the round.
5. A new fuse starts with the remaining players, shorter each time.
6. Last player standing wins the round.

**Win condition:** be the last player not eliminated.
**Scoring:** 1 point per player eliminated after you; a session is best of 3
rounds (mode-dependent).

### 2.1 Fuse

- Fuse duration is drawn uniformly in `[FUSE_MIN, FUSE_MAX]`, defaults **8–25 s**
  for the first fuse, both bounds multiplied by `0.85` after each elimination,
  floor at 5–12 s.
- The remaining time is **never** shown. Tension cues instead: heartbeat sound,
  vibration pulses and screen flash accelerating over the last third — but the
  acceleration curve is normalised to the drawn duration so it leaks no exact
  timing.
- A transfer does **not** reset the fuse. That is the whole game.

## 3. Modes / variations

| Mode | Blurb (lobby) | Difference from core |
| --- | --- | --- |
| `classic` | One bomb, one loser at a time | Baseline as described above |
| `double` | Two bombs, half the mercy | Two independent bombs and fuses; holding both = double vibration; a player out if either blows on them. Min 5 players |
| `hot-hands` | Hold it too long and it speeds up | The fuse accelerates while a single player keeps it; passing fast is rewarded, camping punished |
| `teams` | Two colours, one bomb, zero trust | Players split in two teams; you may only pass to the *other* team; team loses a life when one of theirs explodes |

All modes share the bomb, the bump transfer and the hidden fuse.

## 4. Screens

Standard flow (see [../../multiplayer.md](../../multiplayer.md) §3). Specifics:

- **Lobby**: mode picker, player circle with avatars, big room code + QR, and
  the safety line (§9) shown *before* the permission primer.
- **Round — holder view**: full-bleed accent-red screen, bomb illustration,
  "PASS IT" in huge type, list of nearby players is *not* shown (you look at
  real people, not the screen).
- **Round — non-holder view**: calm dark screen, avatar of the current holder,
  "who's got it" — and a subtle "get ready" if you were the previous holder.
- **Elimination**: the bomb **comes apart**, vibration, then the player's screen turns to
  spectator with the remaining players list.

  **The round holds for the explosion before it ends.** The room used to render the round
  screen only while the phase was `running`, so the boom that *ended* a round was never
  drawn at all: the phase flipped and the standings appeared in the same frame the bomb
  went off. In a multi-player round that hid the last explosion; in a solo round it hid
  the only one, since with one player the first boom is also the last. `BOOM_MS` (2 200,
  in `shockwave.ts`) is longer than the animation so the pieces are gone before the screen
  changes, and it is held there rather than in either screen because both need the same
  number.

  The explosion is a canvas, not an emoji and not a CSS transform. The bomb is drawn
  once, sampled into a particle per 3×3 block, given one impulse outwards from its middle
  and then left to fly under gravity and drag. A transform can throw the whole bomb
  somewhere; it cannot take it apart, and coming apart is the thing being animated — the
  piece that was the fuse and the piece that was the shell have to go different ways.

  Three numbers decide whether it reads as an explosion, and all three were wrong on the
  first attempt:

  | | |
  | --- | --- |
  | **The canvas is much bigger than the bomb** (the bomb is 46% of it) | A particle that leaves the canvas is clipped and gone. Drawn edge to edge, the pieces had nowhere to fly and the whole thing was over in a quarter of a second, most of it off-canvas |
  | **The blast radius overshoots the half-diagonal** by 60% | At exactly half the diagonal the corners sit on the rim, where the falloff is zero — the bomb blows its middle out and leaves four corners standing |
  | **The force is 6 px/frame, not 26** | At 26 the nearest pieces crossed the square in a dozen frames. The bang has to last long enough to be read as one |

  Physics in `www/src/games/pass-the-bomb/shockwave.ts` — no DOM, so all of it is tested
  without a canvas — and the canvas and frame loop in `Blast.tsx`. Under
  `prefers-reduced-motion` the bomb is drawn and **not** blown up: two thousand pieces
  flying apart is exactly what that setting is asking not to see (§11).
- **Results**: podium, "Play again" primary.

## 5. Inputs & sensors

- Bump detection uses the shared algorithm and thresholds in
  [../../device-capabilities.md](../../device-capabilities.md) §3
  (`BUMP_THRESHOLD` 12 m/s², 300 ms throttle, ±250 ms server pairing window).
- Only the **holder's** bump is authoritative for transfer direction; the
  receiver's bump is the confirmation. A transfer needs both.
- Motion listeners are active only during a round and are removed on
  `visibilitychange`.

**Fallbacks:**

| Missing | Behaviour |
| --- | --- |
| Motion denied / unavailable on one player | That player gets a "TAP TO PASS" button; they choose a target from the player list and the target confirms with a tap. Slower on purpose, but playable. The lobby marks them with a 👆 icon so nobody thinks they're cheating |
| Motion denied by *everyone* | Offer `tap-only` variant of the round (same rules, target-and-confirm passing) |
| No vibration (iOS) | Screen flash + sound carry all the tension cues |

## 6. Networking

Server is authoritative for: who holds the bomb, the fuse, eliminations, score.

**As built** (this table was aspirational in two places; the shipped protocol is the one below):

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `bump` | client → server | `{at, roundId}` | I felt a bump. `at` is **server** time — the phone converts from `performance.now()` before sending, or it could never pair |
| `pass` | client → server | `{to, roundId}` | Tap fallback, **one step**: only the holder may send it and the target does not confirm |
| `bomb` | server → clients | `{roundId, holder, alive[]}` | The bomb is now here |
| `boom` | server → clients | `{roundId, victim, alive[]}` | Fuse expired |
| `calm-down` | server → **one** client | `{untilServerTime}` | Your bumps are muted for spamming (§8) |

Two deliberate differences from the original sketch:

- **One-step pass, not request-and-confirm.** A receiver confirmation adds a round trip and a way
  to strand the bomb if the target never taps. The holder chooses and it moves.
- **No `round-end` frame.** The round is over when a `boom` leaves one player or none, and the
  phone derives it (`www/src/games/pass-the-bomb/game.ts`). A client waiting for an explicit end
  frame would wait forever — which is worth stating plainly, because the sketch promised one.

**Latency tolerance:** transfers are decided server-side within the ±250 ms
pairing window, so a 150 ms link never loses a pass. The bomb never renders on
two phones at once: the old holder is released only when the server confirms the
new one (`seq` increments; late `bomb` messages with a lower `seq` are dropped).

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Holder leaves / disconnects | Bomb reassigned to a random remaining player after 3 s, with a 3·2·1 warning to everyone |
| Fuse expires while a transfer is in flight | The holder at the moment the server's fuse timer fires is the victim; in-flight pairing is discarded |
| Two players bump the holder at once | Earliest clock-corrected timestamp wins; the other bump is consumed and ignored |
| A player bumps someone who already holds a bomb (`double` mode) | Allowed; that's the joke |
| Fewer than 3 players at start | Start button disabled with "Need one more player" |
| Down to 2 players | Final duel: fuse floor applies, no shrink |
| Tab backgrounded | Player marked `away`; if they hold the bomb, treated as disconnect after 3 s |

## 8. Anti-cheat

- Shaking constantly: the 300 ms throttle plus a **6 bumps / 10 s** per-player
  quota; exceeding it mutes that player's bumps for 3 s with a "calm down" card.
- A bump only counts when it **pairs** with another player's bump in the same
  room within ±250 ms, and at least one of the two is the current holder.
- Self-bumps (same player id) impossible by construction.
- Client-reported magnitudes are not trusted for anything but the local
  threshold; the server only sees "a bump happened at T".

## 9. Safety

Shown in the lobby, before the permission primer, and re-shown in the countdown:

> **Tap phones gently, corner to corner. Keep your cases on. Stand still — no
> running, no throwing.**

Enforced limits: a round is hard-capped at 5 minutes; the game refuses to start
if fewer than 3 players are connected.

## 10. Data & privacy

Leaves the phone: bump timestamps, player id, chosen avatar/name. Nothing else —
no accelerometer traces, no location. All of it lives in server memory for the
room's lifetime and is discarded when the room dies.

## 11. Accessibility

- The mechanic is physical by nature; the **tap fallback (§5) is the accessible
  mode** and is always available, not only when a permission is denied — any
  player can enable it from the lobby.
- All tension cues exist in three channels (sound, vibration, visual); any one
  of them alone is enough to play.
- Explosion flash respects `prefers-reduced-motion` (fade instead of strobe) and
  never exceeds 3 Hz.

## 11b. What the phone UI actually does

Screens are in `www/src/games/pass-the-bomb/`: `BombRoom.tsx` (lobby, permission, sensor wiring),
`BombScreen.tsx` (the four in-round states), `game.ts` (the reducer, with its own test).

- **Nothing is asked for on arrival.** The permission primer is a button in the lobby, and
  `requestMotion()` is the first thing its handler does — iOS refuses the prompt outside a user
  gesture and refuses it silently after an `await`. Asking on load would spend the permission
  before the player knows what the game is, and a denial is remembered.
- **The safety line (§9) is its own always-visible panel**, not a note inside How to play: that
  panel collapses, and a safety instruction behind a tap is not shown.
- **The motion listener runs only while this phone is in a live round**, and `onMotion` drops it
  while the tab is hidden.
- **Tap-to-pass is present for everyone, every round**, folded behind a summary so the holder is
  not staring at a list — §4 wants them looking at people.
- The explosion flashes a layer *behind* the text rather than the page background, so the victim's
  name stays readable while it strobes, and it is one fade under `prefers-reduced-motion` (§11).

## 12. Open questions

- Is `8–25 s` the right first fuse for a circle of 6? Needs a field test.
- Should the previous holder be blocked from receiving the bomb straight back
  (a "no take-backs" cooldown of ~2 s)? Proposal: yes in `classic`, off in
  `hot-hands`.
- Should eliminated players get something to do (heckle button, vote for who
  they think holds it)?
