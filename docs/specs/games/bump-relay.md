# Bump Relay

> Status: **draft**, awaiting validation. This is also the reference example of
> a filled-in [game spec](../game-spec-template.md).

| | |
| --- | --- |
| **Slug** | `bump-relay` |
| **Catchy sentence** | *Smash phones together to pass the bomb before it blows* |
| **Illustration** | `illustrations/bump-relay.svg` — two phones tapping corner to corner, a cartoon bomb with a lit fuse jumping between them |
| **Players** | 3–8 |
| **Round length** | 1–2 min |
| **Inputs** | motion (bump), touch (fallback) |
| **Accent colour** | `#FF5A36` |
| **Status** | draft |

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
- **Elimination**: full-screen explosion, vibration, the player's screen turns
  to spectator with the remaining players list.
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

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `bump` | client → server | `{at: clientTs}` | I felt a bump |
| `pass-request` | client → server | `{to: playerId}` | Fallback pass (tap mode) |
| `pass-confirm` | client → server | `{from: playerId}` | Fallback receive |
| `bomb` | server → clients | `{holder, bombId, seq}` | The bomb is now here |
| `boom` | server → clients | `{victim, remaining[]}` | Fuse expired |
| `round-end` | server → clients | `{winner, scores}` | Round over |

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

## 12. Open questions

- Is `8–25 s` the right first fuse for a circle of 6? Needs a field test.
- Should the previous holder be blocked from receiving the bomb straight back
  (a "no take-backs" cooldown of ~2 s)? Proposal: yes in `classic`, off in
  `hot-hands`.
- Should eliminated players get something to do (heckle button, vote for who
  they think holds it)?
