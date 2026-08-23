# Tap Duel

| | |
| --- | --- |
| **Slug** | `tap-duel` |
| **Catchy sentence** | *The fastest thumb in the room takes the round* |
| **Illustration** | `www/src/games/tap-duel/art/card.svg` — a phone with a fingertip landing on it, two ripples spreading out |
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
3. An **archer's target appears at a random spot**, greyed out, in the same place
   on every phone, and starts **drifting** — the same path on every phone (§4).
   Every screen shows **GET READY**: *stay with the target, tap it the moment it
   lights up*.
4. After a random delay the server fires: the target **stops and lights up**, on
   the same pixel for everyone.
5. First valid tap **on the target** wins. Tapping anywhere before the signal —
   the target included — is a **false start** and knocks you out of that duel.
6. Results show everyone's reaction time, fastest first.
7. Play again keeps the room and the scores — until somebody reaches
   `DUEL_MATCH_TARGET`, which **takes the match** and starts the next one from nil.

**The signal is scheduled after the panel, not merely displayed after it.**
`fireAt` is `startsAt + FIRE_MIN..MAX`, both sent on `arm`. This is the one game
where a covered screen would cost you the round through no fault of your own, so
the server moves the signal rather than the client hoping the panel is gone.

**Win condition:** fastest valid reaction in the duel.
**Scoring:** 1 point per duel won. **The match is first to `DUEL_MATCH_TARGET` (10).**

### The match is to ten, and the target speeds up on the way

A duel is one tap, so a single round between two quick people is close to a coin toss.
Ten of them is a contest, and the number is on the card's rules rather than left to be
discovered.

The target **drifts slowly in the first duel of a match and faster with every point
scored** — `driftSpeed(roundsDecided)` in protocol.ts, from `DRIFT_SPEED_START` (0.55) to
a cap at `DRIFT_SPEED_MAX` (2.2). That ramp is the difficulty curve of a match: the
opening duel is nearly a still target and a fair test of reaction alone, and by the tenth
the thumb has to follow something genuinely moving.

Three things about it are deliberate:

| | |
| --- | --- |
| It scales the **clock**, not the leg length | The drift is already a pure function of elapsed time (§4), so running that clock faster covers the same path sooner and turns corners sooner. Longer strides in the same rhythm would read as teleporting |
| The speed is **sent on `arm`** | Every phone could compute it from the scores, but a phone that joined mid-match has not seen those results — and a target moving at a different speed on one screen hands that player an easier round or an impossible one |
| It counts **points, not rounds** | A no-contest decides nothing, so it does not make the next duel harder. `roundId` was rejected for the same reason from the other end: it is the room's counter, shared with every other game, so a room that played six rounds of Spill would open its first duel at top speed |

**Reaching ten clears the stored scores.** The result frame still carries the winning
tally — the screen has to be able to say 10–7 — but what the server keeps is reset, so
`Again` after a match is a new match. Without that, the target would be an announcement
rather than a rule: play would carry on past ten and the drift ramp would sit pinned at
its cap forever.

### Timing

- Fire delay is drawn uniformly in **3.0–6.0 s** from the moment the round
  starts. Below 3 s people are still settling; above 6 s they get bored.
- The delay is redrawn every duel, so it cannot be learned.
- A duel with no valid tap within **5 s** of the signal is a **no contest** —
  nobody scores, nobody is blamed.
- The opening target is 120% of the baseline size and each later duel scales it
  to 85% of its previous size; a new ten-point match resets to 120%.
- While armed, the trajectory changes direction every **1.2 s ± 0.2 s**.
  The schedule is deterministic from the round id so every phone draws the same
  path while retaining the intended random-looking timing.

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
  *Stay with the target. Tap it the moment it lights up*. "WAIT" was tried first
  and read as an order to do nothing, which is the opposite of the intent. Nothing
  on this screen may leak the fire time: no countdown, no progress bar. The line
  says *stay with* rather than *thumb over* because the target drifts (below), and
  the lobby's `rules` say the same — a lobby and a game that disagree about how to
  play means one of them is lying with no way to tell which
  ([../../design/game-chrome.md](../../design/game-chrome.md) §1).
- **Fire** — the viewport becomes the accent colour and the target **lights up**
  at the exact position reached by its armed movement. Only a tap on the target counts.

  This replaces the original design where the whole screen was the target, on the
  reasoning that "aiming is not the skill being measured". Reaction alone turned
  out to be a thin game: with a thumb flat on the glass there is nothing to do but
  twitch. A target makes the round **speed plus a little accuracy**.

  Five properties it has to keep:

  - **The server picks the position** and sends it on `arm`, so it is identical on
    every screen. Drawn per client, the round would go to whoever got the
    luckiest placement.
  - **It is on screen for the whole round**, greyed while armed and lit on the
    signal, and it **does not jump** when it lights up — wherever the drift below
    left it is where the tap has to land. An intermediate version
    revealed it only on the signal; that made *finding* it most of the reaction
    time, which is a hunt rather than a duel — the player should be aiming at
    something they can see, not guessing. The reversal is the maintainer's call and
    it is the right one: it keeps the reflex intact and adds accuracy, instead of
    replacing the reflex with search.
  - **It drifts while armed and freezes on the signal.** A target that is visible
    *and* still can simply be covered by a thumb before the signal, which gives the
    accuracy back for free. So through GET READY it wanders: a straight leg of about
    150 px, then a new direction, bouncing off the `TARGET_*` box
    (`www/src/games/tap-duel/drift.ts`).

    It is **arithmetic, not `Math.random()`**, and that is the whole design. The
    walk is a pure function of `(target, roundId, server time)`, all three of which
    every phone already has, so every phone draws it in the same place at the same
    instant — and the position it **freezes at is `fireAt`, never `now()`**. Both
    halves are load-bearing: a per-client walk, or a freeze at each phone's own
    clock, would hand the round to whoever's target happened to be nearest their
    thumb, which is precisely what the server choosing the position prevents.

    Consequences worth stating, because each was a bug first:

    - Legs are a fraction of the **width**, with the vertical divided by a
      *reference* aspect ratio rather than the real one. A real aspect makes the
      path depend on the phone — the cross-phone agreement traded for a cosmetic
      gain.
    - A hidden tab is served **no animation frames**, so its target does not
      wander; it is placed once when the round arms and again when the signal
      fires. The frozen position still matches every other phone exactly, and a tab
      brought back mid-window jumps to where the drift *is now* rather than
      resuming from where it stopped — measured at one frame.
    - The fire render uses the same `fireAt` sample as the armed walk, before the
      animation effect runs, so there is no one-frame snap back to the origin.
    - `prefers-reduced-motion` does **not** switch it off, for the reason
      [sling-puck.md](sling-puck.md) §13 gives: motion that *is* the game stays,
      decoration goes. A still target is an easier game, and it would also put that
      player's target where nobody else's is.
  - **It takes no taps until the signal.** While armed it is inert, so a tap on it
    falls through to the backdrop and is scored as the false start it is. Making it
    a live button early would have created a hole in the one rule the mode has.
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
| `arm` | server → clients | `{ roundId, startsAt, fireAt, target }` | Duel begins. All times are **server time**: `startsAt` is when the rules panel clears, `fireAt` the signal. `target` and `roundId` are also the drift's inputs (§4), so it needs no message of its own |
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
  Three things keep the cost small: the target is **large** (`min(28vw, 28vh,
  10rem)`, above the 44 px minimum), it is **visible from the start** so there
  is no time pressure on finding it, and it is one element with one focus stop, so
  a keyboard or switch user activates it the same way. It is still a real cost to
  anyone who cannot move a thumb across a screen quickly; `sprint` and `simon`
  (§3) use no target, so the mode list keeps a duel without one.
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
