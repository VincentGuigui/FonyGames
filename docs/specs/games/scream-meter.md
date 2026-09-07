# Scream Meter

| | |
| --- | --- |
| **Slug** | `scream-meter` |
| **Catchy sentence** | *Ten seconds. Loudest wins. Mind the neighbours* |
| **Illustration** | `www/src/games/scream-meter/art/card.svg` — a wide-open mouth with a meter arcing out of it, needle buried in the red |
| **Players** | 2–8 |
| **Round length** | 30 s |
| **Inputs** | mic |
| **Accent colour** | `#FB4D3D` |
| **Status** | 📝 draft — awaiting approval ([#15](https://github.com/VincentGuigui/FonyGames/issues/15)) |

## 1. Pitch

Everybody screams at once for ten seconds, and the phone that heard the most
noise wins. The room tells you *what* to scream — a vowel, a high note, a low
note — not because the phone checks (it does not, and cannot fairly across
languages and accents) but because being told to scream "OOO" in a low voice is
funnier than being told to scream.

The shortest game in the catalogue and the loudest. It is the party opener.

## 2. Core loop

One shared ten-second window. Everybody screams into their own phone at the
same time; each phone measures its own loudness and reports one number.

1. Lobby. The mic permission is asked for by **Ready**, not by a button of its
   own ([../device-capabilities.md](../device-capabilities.md) §2).
2. The referee picks the **prompt** for the round — one of a small list of
   vowels and pitches (§3) — and broadcasts it with a countdown.
3. `SCREAM_COUNTDOWN_MS` (3 s) of "get ready", so eight people start together
   rather than trickling in. The prompt is the biggest thing on screen.
4. **Ten seconds** (`SCREAM_WINDOW_MS`). Every phone samples its own mic and
   draws its own live meter. Nothing goes on the wire during the window except
   a coarse heartbeat (§6).
5. The window closes on an absolute timestamp. Each phone reports its **score**
   — one number, see below — and the referee ranks them.
6. Results: the ranking, each player's own meter trace, and the winner.

**Win condition:** the highest score.
**Scoring:** **the mean of the loudest `SCREAM_SUSTAIN_MS` (3 s) of the
window**, in dBFS mapped onto 0–100. Not the peak, and not the mean of the
whole window:

- **the peak** rewards one bark, or a knuckle on the mic;
- **the whole window** rewards whoever can hold a note for ten seconds, which
  is a different and much less funny game;
- **the loudest three seconds** rewards a real scream with a proper lungful
  behind it, and lets you take a breath first.

Ties are broken by peak loudness, then declared a draw.

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

The round screen is one object: **your own meter**, filling most of the
portrait viewport, with the prompt above it and the clock below. The meter is a
vertical bar with a **peak-hold line** that stays where your best moment was,
because a bar with no memory gives you nothing to beat.

Other players are **not** live on screen during the window. Eight live meters
would be unreadable at this size and would put eight streams on the wire for a
ten-second round; the reveal is the payoff instead. What is shown is a row of
avatars, each lighting up as that phone reports in.

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

Profile A. Ten seconds of sampling produce **one number**.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `scream-round` | server → all | `{ roundId, prompt, startsAt, endsAt }` | The prompt and the two absolute timestamps |
| `scream-alive` | client → server | `{ roundId, at }` | A heartbeat, twice a second — "still here, still sampling" |
| `scream-score` | client → server | `{ roundId, score, peak, floor }` | This phone's own result, sent once at the close |
| `scream-result` | server → all | `{ roundId, scores: {id: {score, peak}}, winner }` | The ranking |

**Who is authoritative:** the referee owns the clock, the prompt and the
ranking. It does **not** own the loudness — it cannot, the audio never leaves
the phone (§10). That is a deliberate trade, and §8 is where it is paid for.

**Latency:** the window is defined by absolute timestamps, so 300 ms of lag
costs a phone 300 ms of its own ten seconds and nothing else. A `scream-score`
is accepted up to `SCREAM_REPORT_GRACE_MS` (2 s) after the close; a phone that
misses that deadline scores 0 and the results say "no answer" rather than
pretending.

## 7. Failure & edge cases

- **Player leaves mid-window**: no score, listed as left. The round does not
  wait for them.
- **Host leaves**: the round runs to its own timestamps; the referee owns them.
- **Permission denied**: that phone cannot play (§5). It stays in the room as a
  spectator and sees the results.
- **Backgrounded tab**: iOS suspends the audio context, so the sampling stops
  dead. A phone that was backgrounded during the window reports what it managed
  and flags `partial`; the results mark it rather than ranking it as a loss.
  §12 Q3 asks whether a partial should score at all.
- **Everyone silent**: all zeros, and the round is a draw with nobody winning.
  A draw is a legitimate outcome, not an error.
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

1. **`SCREAM_SUSTAIN_MS` = 3 s of the 10 s window** is the central number and
   it is a guess. Too short and a bark wins; too long and it becomes a
   breath-holding contest.
2. **Is the per-round noise floor enough** to make two different phones
   comparable in one room? A cheap phone with a bad mic may be unwinnable, in
   which case this becomes a per-*device* handicap measured in the lobby.
3. **What a `partial` window scores** — zero, or the mean of what it got? Zero
   is simpler; scaling is fairer to iOS.
4. **Whether `relay` earns its place.** It doubles the round length and needs
   its own turn machinery. It may be better as a second game, or not at all.
5. **Prompt list**: are four vowels and two pitches enough variety for a game
   this short, or does it want silly ones ("scream like a seagull")?
