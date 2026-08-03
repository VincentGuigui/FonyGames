# Tap Duel

| | |
| --- | --- |
| **Slug** | `tap-duel` |
| **Catchy sentence** | *The fastest thumb in the room takes the round* |
| **Illustration** | `illustrations/tap-duel.svg` — a phone with a fingertip landing on it, two ripples spreading out |
| **Players** | 2–8 |
| **Round length** | ~1 min for best-of-5 |
| **Inputs** | touch |
| **Accent colour** | `#FFC93C` |
| **Status** | `pistol` live (M4) · `sprint` and `simon` still to build |

## 1. Pitch

Everyone stares at their screen. It says GET READY. Somewhere between two and
six seconds later it turns yellow and says TAP! First thumb down wins.

Twitching early loses you the duel, which is the whole game: the tension is in
not moving. It is the simplest thing we can build that still needs a referee,
which is exactly why it goes first.

## 2. Core loop

1. Host starts the duel.
2. A four-second rules panel holds every screen
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4).
3. Every screen shows **GET READY**, plus one line telling you what to do:
   *A target will appear — tap it, and nothing before it*.
4. After a random delay the server fires: an **archer's target appears somewhere
   on screen**, in the same place on every phone.
5. First valid tap **on the target** wins. Tapping anywhere before the signal is a
   **false start** and knocks you out of that duel.
6. Results show everyone's reaction time, fastest first.
7. Play again keeps the room and the scores.

**The signal is scheduled after the panel, not merely displayed after it.**
`fireAt` is `startsAt + FIRE_MIN..MAX`, both sent on `arm`. This is the one game
where a covered screen would cost you the round through no fault of your own, so
the server moves the signal rather than the client hoping the panel is gone.

**Win condition:** fastest valid reaction in the duel.
**Scoring:** 1 point per duel won; the session is first to 3.

### Timing

- Fire delay is drawn uniformly in **2.0–6.0 s** from the moment the round
  starts. Below 2 s people are still settling; above 6 s they get bored.
- The delay is redrawn every duel, so it cannot be learned.
- A duel with no valid tap within **5 s** of the signal is a **no contest** —
  nobody scores, nobody is blamed.

## 3. Modes / variations

| Mode | Blurb (shown in the lobby) | Difference from core |
| --- | --- | --- |
| `pistol` | Tap on the signal — false start loses | Baseline, as above. **This is what M4 builds.** |
| `sprint` | Most taps before the buzzer | 10 s of frantic tapping; server counts. No false starts. Later. |
| `simon` | Repeat the sequence, faster each round | Server emits a colour/position sequence to replay. Later. |

## 4. Screens

Standard flow ([../../multiplayer.md](../../multiplayer.md) §3). Specifics:

- **Lobby** — as built. `Start round` is enabled for the host once ≥ 2 players
  are connected.
- **Armed** — full-bleed dark, **GET READY** with the instruction line
  *Tap the instant this screen changes*. "WAIT" was tried first and read as an
  order to do nothing, which is the opposite of the intent. Nothing on this
  screen may leak the fire time: no countdown, no progress bar.
- **Fire** — the viewport becomes the accent colour and an **archer's target**
  appears at a random position. Only a tap on the target counts.

  This replaces an earlier design where the whole screen was the target, on the
  reasoning that "aiming is not the skill being measured". Reaction alone turned
  out to be a thin game: with a thumb already resting on the glass there is
  nothing to do but twitch. Having to *find* and *reach* the target adds a second
  skill without removing the first, and it is still the same one instant for
  everyone.

  Three properties it has to keep:

  - **The server picks the position** and sends it on `arm`, so it is identical on
    every screen. Drawn per client, the round would go to whoever got the
    luckiest placement.
  - **It appears only on the signal.** Shown while armed, players would park a
    thumb on it and nothing would have changed.
  - **It never lands under the gear or off an edge** — `TARGET_MIN/MAX_X/Y` inset
    it. A target you cannot tap without opening the menu is not a target.

  A tap that **misses** after the signal is just a miss: it is ignored, not
  punished. It already cost the time it took, which is self-limiting, and adding a
  penalty would turn one bad reach into a lost round.
- **False start** — that player's screen immediately goes red and says
  *Too early*. They watch the rest of the duel; everyone else is undisturbed.
- **Result** — ranked list, winner first, false starts at the bottom. The
  **reaction time is the dominant element** of each row, coloured on a
  green → orange → red gradient by rank. The colour is **additive only**: the
  ordering and the number already say everything, so nothing is lost to a
  colour-blind player or a bad screen
  ([../../design/ui-guidelines.md](../../design/ui-guidelines.md) §2).
  False starts and no-taps sit outside the gradient in neutral grey — a false
  start is not "slow". `Again` is the primary button, host only.

## 5. Inputs & sensors

Touch only. No permission, no sensor, no fallback needed — which is the point
of building this one first.

`pointerdown` (not `click`) so the reaction is measured at finger-down, and
`touch-action: manipulation` to stop the browser waiting for a double-tap.

## 6. Networking

The server is the referee ([../../multiplayer.md](../../multiplayer.md) §4).

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | client → server | `{ mode }` | Host begins a duel |
| `arm` | server → clients | `{ fireAt, roundId }` | Duel begins; `fireAt` is **server time** |
| `tap` | client → server | `{ at, roundId }` | Finger down at client-corrected server time |
| `result` | server → clients | `{ roundId, ranking[], scores }` | Duel over |

**Latency handling.** Clients render the flip using `client.now()` — server time
via the offset handshake — so everyone's screen fires at the same true instant
regardless of ping. Reaction time is `tap.at − fireAt`, computed from the
client's clock-corrected timestamp, so a player on a slow link is not punished
for their uplink latency. This is the "server-received order with a
client-timestamp correction" approach that
[../../multiplayer.md](../../multiplayer.md) §6 requires for this game.

The server still owns the outcome: it validates every timestamp (§8) and
decides the ranking. A client never says "I won".

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Everyone false-starts | No contest, nobody scores |
| Nobody taps within 5 s of the signal | No contest |
| Player joins mid-duel | Spectates, plays the next one |
| Player drops mid-duel | Their tap never arrives; the duel resolves without them |
| Host drops mid-duel | Duel continues — the server owns the timer, not the host |
| Host drops in the lobby | Role passes after `HOST_GRACE_MS`; a refresh keeps it ([../../realtime-server.md](../../realtime-server.md) §4) |
| Player refreshes mid-duel | Same seat; rejoins the duel in progress, having missed it |
| Fewer than 2 connected players | `Start round` disabled |
| Two taps within a millisecond | Earlier corrected timestamp wins; exact ties are ranked by server arrival |

## 8. Anti-cheat

The obvious exploit is a scripted tap, or lying about `at`.

**The target is not part of the defence, and `tap` deliberately carries no
position.** The client knows where the target is — it has to, in order to draw it
— so a modified client asked for coordinates would simply send the centre of it.
Accepting a field that cannot be validated would add an attack surface and buy
nothing, which is the same reasoning that keeps an angle off Goat Siege's `lob`
([goat-siege.md](goat-siege.md) §5). What is checked is the **timing**, below, and
that is what the score is made of.

- **Timestamp window.** `at` is rejected unless it falls in
  `[fireAt, serverNow + 250 ms]`. Claiming to have tapped before the signal is a
  false start by definition; claiming the future is discarded.
- **Superhuman floor.** A corrected reaction under **80 ms** is not a human
  reflex — the literature puts simple visual reaction at ~200 ms, and the world
  record is around 100 ms. Anything under the floor is treated as a false start.
- **One tap per duel** per player; later taps ignored.
- **The fire time is never sent early.** `arm` carries `fireAt`, so a modified
  client *could* schedule a tap for exactly `fireAt`. The 80 ms floor is what
  makes that useless: a perfect 0 ms reaction is rejected outright. Sending the
  signal only at fire time instead would push the network latency onto the
  player, which is worse for honest players and still forgeable.

Accepted limit: a determined cheat could hard-code an 85 ms reaction and win
most duels. Beating that needs attestation we cannot have in a browser, and for
a party game where everyone is in the same room, social enforcement is stronger
than anything we can code.

## 9. Safety

None required — no motion, no movement, no GPS. The one physical caution is not
to hammer the screen; the copy says *tap*, never *smash*.

## 10. Data & privacy

Leaves the phone: tap timestamps, player id, chosen name and avatar. Nothing
else. All of it lives in the Durable Object for the room's lifetime and dies
with it ([../../database.md](../../database.md) §1).

Kept **on** the phone: the chosen name and avatar, in `localStorage`, so they
persist between visits. The server never reads it. Because something is now
stored locally, the hub's privacy line says so explicitly rather than claiming
nothing is stored at all.

## 11. Accessibility

- **Reaching a target does need aiming**, which the full-screen version did not.
  The target is deliberately large — `min(42vw, 42vh, 15rem)`, far above the 44 px
  minimum — and it is one element with one focus stop, so a keyboard or switch
  user activates it the same way. It is a real cost to anyone who cannot reach
  across a screen quickly, and it buys the game its second skill; `sprint` and
  `simon` (§3) do not use a target, so the mode list still offers a duel without
  one.
- The target reads by **shape** (concentric rings) as well as colour, so it does
  not depend on distinguishing red from gold.
- The signal is **colour + text + a layout change**, never colour alone.
- The fire flip is a single state change, not a flash or strobe — safe under
  `prefers-reduced-motion` and nowhere near the 3 Hz limit.
- Reaction speed is inherently ableist as a mechanic. `sprint` and `simon` are
  gentler on that axis, which is a reason to build them, and a reason Tap Duel
  should not be the only game on the hub.

## 12. Open questions

- Is best-of-5 right, or does it drag? Field test.
- Should a false start end the whole duel for everyone (more tension) rather
  than only knocking out the offender (fairer)? Currently the latter.
- Should reaction times be shown to everyone, or only your own? Public is
  funnier; private is kinder.
