# Scream Meter

| | |
| --- | --- |
| **Slug** | `scream-meter` |
| **Catchy sentence** | *Ten rounds. Loudest total wins. Mind the neighbours* |
| **Illustration** | `www/src/games/scream-meter/art/card.svg` — a wide-open mouth with a meter arcing out of it, needle buried in the red |
| **Players** | 2–8 |
| **Match length** | 2–3 min — ten rounds, each a 3 s countdown + 10 s window + 3 s reveal |
| **Inputs** | mic |
| **Accent colour** | `#FB4D3D` |
| **Status** | 🎮 beta — built; the catalogue's first mic game, and the sustain window and per-round floor are untested in a real room ([#15](https://github.com/VincentGuigui/FonyGames/issues/15)) |

## 1. Pitch

Everybody screams at once for ten seconds, ten times over, and the phone that
heard the most noise across the whole match wins. Each round the room is told
*what* to scream — a vowel, a high note, a low note — not because the phone
checks (it does not, and cannot fairly across languages and accents) but
because being told to scream "OOO" in a low voice is funnier than being told
to scream.

The loudest game in the catalogue, in short bursts. It is the party opener.

## 2. Core loop

A match is **`SCREAM_ROUNDS` (10) rounds** back to back, no lobby and no tap
between them. Each round is its own shared ten-second window — everybody
screams into their own phone at the same time, each phone measures its own
loudness and reports one number — and every round's score adds to a running
**total** that decides the match, not any single round.

1. Lobby. The mic permission is asked for by **Ready**, not by a button of its
   own ([../device-capabilities.md](../device-capabilities.md) §2).
2. The referee picks the **prompt** for the round — one of a small list of
   vowels and pitches (§3) — and broadcasts it with a countdown.
3. `SCREAM_COUNTDOWN_MS` (3 s) of "get ready", so eight people start together
   rather than trickling in. The prompt is the biggest thing on screen.
4. **Ten seconds** (`SCREAM_WINDOW_MS`). Every phone samples its own mic and
   draws its own live meter. Nothing scored goes on the wire during the
   window — only a coarse heartbeat and a purely visual level (§6).
5. The window closes on an absolute timestamp. Each phone reports its **score**
   — one number, see below — and the referee folds it into that player's total.
6. **Reveal** (`SCREAM_REVEAL_MS`, 3 s): this round's score and the new running
   total, held on screen long enough to read before the next round's countdown
   opens automatically.
7. After the tenth round's reveal, the match ends: the ranking by total, and
   the winner.

**Win condition (per round):** the highest score, added to the total.
**Win condition (match):** the highest total after all ten rounds.
**Scoring:** **the mean of the loudest `SCREAM_SUSTAIN_MS` (3 s) of the
window**, in dBFS mapped onto 0–100. Not the peak, and not the mean of the
whole window:

- **the peak** rewards one bark, or a knuckle on the mic;
- **the whole window** rewards whoever can hold a note for ten seconds, which
  is a different and much less funny game;
- **the loudest three seconds** rewards a real scream with a proper lungful
  behind it, and lets you take a breath first.

A round tie has no separate consequence — it is just two equal scores added to
two totals. The **match** tie is broken by the best peak either player ever
hit across all ten rounds, then declared a draw; "everybody at zero" is a
draw too, not an error (§7).

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Ten seconds, loudest wins | baseline |
| `relay` | One at a time, everyone else judges | Players scream in turn, 4 s each; total round length scales with the room |

**Prompts**, rolled by the referee per round and purely theatrical:

| Prompt | Copy |
| --- | --- |
| vowel | *Scream **AAA*** · *…**EEE*** · *…**OOO*** · *…**III*** |
| pitch | *As **high** as you can* · *As **low** as you can* |

**The prompt is never scored** (issue #15, explicitly): a vowel is pronounced
differently in every language and accent in the room, and pitch detection would
punish anyone whose voice sits where it sits. Verifying it would make the game
unfair in exactly the way a party game must not be. It is a costume, and the
spec says so out loud so nobody later "improves" it into a check.

## 4. Screens

Standard flow, with the primer carrying the mic explanation (§5).

The round screen's centrepiece is **your own meter**, a vertical bar with a
**peak-hold line** that stays where your best moment was — a bar with no
memory gives you nothing to beat. Above it, the **prompt** is set in a serif
face rather than the UI's own sans: it is a placard being read out loud, not a
control, and the one place in the catalogue that earns reading like something
printed rather than chrome.

**Everyone else in the room is live too, narrow and dimmed.** A thin band
either side of the main meter — one per other connected player, stretched to
the same height as your own meter, at half opacity — fills from a `0..1`
level each phone samples and broadcasts every `SCREAM_LEVEL_MS` (250 ms) while
the window is open. This is purely ambient presence, never a second
scoreboard: no number is attached, it never scores anything, and it goes
blank the moment the window closes (§6, §10) — it exists so a room screaming
together *feels* like a room screaming together, not eight people staring at
their own phone in silence. A row of avatars along the bottom still lights up
as each phone reports in, which is the one thing that is presence rather than
performance.

**Reveal (`SCREAM_REVEAL_MS`, 3 s), between every round.** The readout below
the meter swaps to this round's score and the running total, held on screen
long enough to read before the next round's countdown opens on its own — no
lobby, no tap to continue. The status bar names the round out of ten and
which of the three phases is showing (get ready / scream / result). The final
reveal, after round ten, is what leads into the match's own results screen —
ranked by total, not by any single round.

## 5. Inputs & sensors

**Microphone**, via `getUserMedia({ audio: true })` and a `WebAudio`
`AnalyserNode` — the same shape [../device-capabilities.md](../device-capabilities.md)
already defines, and the same one the Sound Match study
([../audio-voice-matching.md](../audio-voice-matching.md)) measured.

- **RMS at ~30 Hz** off `getByteTimeDomainData`, converted to dBFS. Frequency
  data is not needed at all, because nothing is analysed for pitch.
- **Gain control off**: `echoCancellation`, `noiseSuppression` and
  `autoGainControl` all `false` in the constraints. Automatic gain is the one
  thing that would flatten the very differences being measured.
- **A calibration second.** The first `SCREAM_FLOOR_MS` (1 s) of the countdown
  measures the room's own noise floor, and each phone's score is reported
  relative to it. Two phones in one room are never the same microphone; this is
  the cheapest thing that makes them comparable, and it is per-round so a noisy
  room does not advantage the phone that joined late.

**Fallbacks** (mandatory): there is none, and this is one of the games AGENTS.md
§4 names as allowed to have none — a touch version of a screaming game is a
different, lesser game. The lobby **says so before anyone starts**: *"needs the
microphone — nothing else can play this one"*, and a player who denies the
permission gets a clear explanation and the way back to the hub, not a dead
screen.

## 6. Networking

Profile A, ten rounds deep: each window still produces one score, but the
referee now broadcasts a single state frame (`ScreamState`, the same shape
Color Match's ladder uses) rather than separate round/result messages, so
`round`, the reveal phase and the running `totals` are always in sync on the
wire.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `scream` | server → all | `ScreamState { roundId, round, rounds, prompt, phase, startsAt, endsAt, reported, levels, scores, totals, winner, draw }` | The whole round/match state, sent on every phase change and every live level |
| `scream-alive` | client → server | `{ roundId, round, at }` | A heartbeat, twice a second — "still here, still sampling" |
| `scream-score` | client → server | `{ roundId, round, score, peak, floor, partial }` | This phone's own result for the round in flight, sent once at the close |
| `scream-level` | client → server | `{ roundId, round, level }` | This phone's live 0..1 loudness, every `SCREAM_LEVEL_MS` (250 ms) while the window is open — purely visual, for the other players' side meters (§4), never scored |

**Who is authoritative:** the referee owns the clock, the prompt, the round
count and the ranking. It does **not** own the loudness — it cannot, the
audio never leaves the phone (§10). That is a deliberate trade, and §8 is
where it is paid for.

**`round` guards every message.** `scream-alive`, `scream-score` and
`scream-level` all carry the round they belong to, and the referee drops
anything whose `round` does not match the round in flight — a straggler from
the round that just closed cannot count toward the next one's heartbeats,
score or total.

**Latency:** the window is defined by absolute timestamps, so 300 ms of lag
costs a phone 300 ms of its own ten seconds and nothing else. A `scream-score`
is accepted up to `SCREAM_REPORT_GRACE_MS` (2 s) after the close; a phone that
misses that deadline scores 0 for the round and the reveal says "no answer"
rather than pretending, and the total simply does not move.

## 7. Failure & edge cases

- **Player leaves mid-window**: no score for that round, listed as left. The
  round does not wait for them, and their total simply stops moving.
  **Everybody leaving ends the match outright**, not just the round in
  flight — no point idling through the rest of the ten rounds with nobody
  there to play them.
- **Host leaves**: the round runs to its own timestamps; the referee owns them.
- **Permission denied**: that phone cannot play (§5). It stays in the room as a
  spectator and sees the results.
- **Backgrounded tab**: iOS suspends the audio context, so the sampling stops
  dead. A phone that was backgrounded during the window reports what it managed
  and flags `partial`; the results mark it rather than ranking it as a loss.
  §12 Q3 asks whether a partial should score at all.
- **Everyone silent**: all totals stay at zero, the match still runs its full
  ten rounds, and it ends a draw with nobody winning. A draw is a legitimate
  outcome, not an error.
- **A phone with no working mic** (some desktops): treated as denied.

## 8. Anti-cheat

**The phone reports its own loudness, so the phone can lie.** There is no way
around that without sending audio, which §10 forbids. What is worth doing is
making the cheap cheats not work:

- **Blowing on the mic, or tapping it**, is the real-world exploit and it is
  loud. The floor calibration does not help. Mitigation: score the loudest
  *sustained* three seconds rather than the peak, which a tap cannot fake and a
  blow struggles to hold. This is the main reason for that scoring choice.
- **A claimed score is clamped** to the range a real microphone can report, and
  a score that arrives without heartbeats through the window is not counted.
- **`floor` and `peak` are reported alongside `score`** so an implausible
  combination — a huge score with a silent floor and no peak — is visible in the
  activity log and to the admin view.
- **Beyond that, this is a party game played in one room.** Everybody can hear
  everybody. The social check is stronger than any server check, which is worth
  writing down rather than pretending otherwise.

## 9. Safety

Mandatory copy, shown in the primer and again in the lobby, not buried:

> **Mind your ears and your neighbours.** Hold the phone away from your face,
> don't scream into anyone else's ear, and skip this one if there is a baby
> asleep. Ten seconds is the whole game — there is no advantage in going
> longer.

Enforced limits: the window is capped at ten seconds and cannot be extended;
there is no "hold to keep scoring"; and there is no in-game encouragement to
beat someone else's volume once the window has closed. The game never plays
audio back through the speaker, so no feedback loop can build.

## 10. Data & privacy

**No audio ever leaves the phone.** No recording is kept, no buffer is
retained past the analyser's own window, and nothing is written to storage.
What crosses the wire is three numbers per player per round — score, peak,
floor — and they live as long as the room does.

The primer says this in plain words, because "this game needs your microphone"
sounds much worse than what it actually does.

## 11. Accessibility

- **A player who cannot shout cannot win this one**, and the lobby says so
  before anyone starts rather than after. That is the honest version.
- **`relay` mode is the accessible one** in a different sense: one at a time
  means a player can pass their turn and still be part of the round.
- **The meter is not the only feedback**: the numeric dBFS value is shown as
  text and announced, and the peak-hold line has a text equivalent.
- **Reduced motion**: the meter still moves (it is the game) but the results
  screen's celebration does not.
- **No sound is required to play** — the game listens, it does not speak. A
  deaf player can play it fully, which is worth noting because the input being
  audio suggests otherwise.

## 12. Open questions

Five were open when this spec was written. Building it settled two and left
three genuinely open — which is honest for a game whose central number can
only be judged in a room full of people.

1. **`SCREAM_SUSTAIN_MS` = 3 s of the 10 s window.** Still the central number
   and still a guess. What the build *can* show is that it does the job it was
   chosen for: `shared/scream.test.ts` fires a full-scale single-frame bark and
   three seconds of a quieter real scream at it, and the bark loses
   (−54 dB against −12) even though it has the higher peak. That is the
   anti-cheat working; whether three seconds is the *fun* length is a room
   question.
2. **Is the per-round noise floor enough** to make two different phones
   comparable? Still open, and now with a measurement to argue about:
   `screamScore` divides by `SCREAM_DB_SPAN` (45 dB), so the same margin over
   the floor scores the same in a quiet and a noisy room — the test pins that.
   What it cannot pin is whether a cheap microphone's 45 dB is the same 45 dB
   as a good one's. If it is not, this becomes a per-*device* handicap measured
   in the lobby.
3. ~~**What a `partial` window scores.**~~ **Settled: the mean of what it got,
   flagged as partial.** Zero would be simpler and is the wrong answer for iOS,
   which suspends the audio context in a backgrounded tab through no fault of
   the player. `loudestWindow` averages a short run rather than padding it, the
   phone sets `partial` when it collected under 80% of the samples it should
   have, and the results screen marks it rather than hiding it.
4. ~~**Whether `relay` earns its place.**~~ **Not built**, and on reflection it
   is a different game rather than a mode: one at a time doubles the round
   length and needs its own turn machinery, and the whole appeal of `classic`
   is eight people screaming at once. Declared in §3 and left there.
5. **Prompt list**: four vowels and two pitches are built and dealt by the
   referee. Whether it wants silly ones ("scream like a seagull") is a content
   question nobody has answered.

Two the build raised:

6. **`SCREAM_DB_SPAN` is doing more work than it looks.** It is the single
   number that turns dB over the floor into 0–100, so it decides whether a
   normal shout scores 40 or 90 — and 45 dB was picked from what a phone
   microphone plausibly spans, not from anybody screaming into one. It is the
   first thing to adjust if scores bunch at either end.
7. **The heartbeat bar is deliberately low** (`SCREAM_MIN_ALIVE` = 3). It only
   catches a client that did not even pretend to sample, because this is a
   party game in one room where everybody can hear everybody and the social
   check is the real one. Raising it would start punishing a phone with a bad
   connection instead.

One the maintainer reversed outright, on purpose:

8. **Ten rounds, and live side meters, replacing the original one-round shape.**
   The original build (§4, as written) was one ten-second window and a
   deliberate choice **not** to show other players live: "eight live meters
   would be unreadable at this size and would put eight streams on the wire
   for a ten-second round; the reveal is the payoff instead." The maintainer
   asked for the opposite — `SCREAM_ROUNDS` (10) rounds per match, and a live,
   narrow, dimmed band per other player either side of the main meter, sampled
   and broadcast every `SCREAM_LEVEL_MS` (250 ms). The original reasoning was
   not wrong about a *single* ten-second round; it just weighed the ambient
   feeling of a room screaming together, over ten rounds, as worth eight small
   streams that never carry a score. Whether that holds up at the full 2–8
   players this game allows, not just the two or three it has been tried with,
   is the open half of this reversal — the levels are visual-only and never
   scored, so the worst case is a wire that is busier than it needs to be, not
   a broken game.
