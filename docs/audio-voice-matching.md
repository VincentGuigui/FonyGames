# Matching a voice to a spectrum — a feasibility study

> For [issue #28, Sound Match](https://github.com/VincentGuigui/FonyGames/issues/28).
> **A study, not a spec.** Nothing here is approved and nothing is built. It
> answers the two questions the maintainer asked before a spec is worth
> writing: can a target spectrum be generated that a human can actually
> reproduce, and what should that spectrum look like on screen. The game's own
> spec, if it goes ahead, follows the template in
> [specs/game-spec-template.md](specs/game-spec-template.md).

The issue's sketch: *a random sound spectrum is generated (must be in human
range), the player has 5 s to reproduce it with their own voice, sees their own
spectrum in realtime, 3 lives.*

---

## 1. A random spectrum cannot be sung. The generator has to make parameters.

The short answer to the first question is **no, not as stated** — and the fix
is small.

A voice is a **source–filter** system, and both halves are heavily constrained:

- **The source** is the glottis, which produces a near-periodic pulse train at
  a fundamental frequency **F0**. Its spectrum is a harmonic comb — energy at
  F0, 2·F0, 3·F0… and nowhere between — rolling off at roughly −12 dB per
  octave. A singer controls F0 and loudness. They do not control which
  frequencies get energy: the comb is a consequence of the vocal folds opening
  and closing periodically.
- **The filter** is the vocal tract, which imposes broad resonances —
  **formants**, F1, F2, F3… — on that comb. A singer controls the formants by
  moving jaw, tongue and lips, which is exactly what choosing a vowel *is*.

So a voiced sound's spectrum is not a free vector of magnitudes. It is
determined, to a good approximation, by about five numbers: F0, F1, F2, F3 and
a spectral tilt. **A uniformly random magnitude spectrum is, with probability
essentially one, not producible by any human**, because it will put energy
between harmonics, or ask for a formant pattern no tongue reaches, or demand a
comb spacing outside the player's range.

**The fix is to invert the generator.** Do not generate a spectrum and hope.
Generate the *parameters* — a pitch and a vowel — and **synthesise** the target
spectrum from them with the same source–filter model. The target is then
feasible by construction, and it is feasible for a stated reason rather than by
luck. It also collapses the scoring problem from "compare 1024 magnitudes" to
"compare two or three numbers", which §3 argues is the whole game.

### 1.1 What the parameters can be

**Pitch (F0).** Typical speaking ranges, which are also roughly where an
untrained singer is comfortable:

| Voice | Rough F0 range |
| --- | --- |
| Adult male | 85 – 180 Hz |
| Adult female | 165 – 255 Hz |
| Child | 250 – 400 Hz |

These overlap barely. **A target pitch drawn from one flat range is unfair by
anatomy**: a bass physically cannot produce 350 Hz in chest voice, and asking
is not a difficulty setting, it is an exclusion. Two ways out, and §5 argues
for the second:

1. **Calibrate.** A warm-up where the player slides low to high, measure their
   own range, and draw targets inside it. Honest, and costs a screen.
2. **Score pitch modulo the octave.** A target of "A" is hit by A2, A3 or A4 —
   octave equivalence is how music already works, and it makes a bass and a
   soprano equally right. Costs nothing, needs no warm-up, and is more
   forgiving of the falsetto a player will reach for anyway.

**Vowel (F1/F2).** The vowel space is the classic two-dimensional map. Rough
adult-male averages, in the shape everyone cites from Peterson & Barney (1952):

| Vowel | as in | F1 | F2 |
| --- | --- | --- | --- |
| /i/ | heed | ~270 | ~2300 |
| /ɪ/ | hid | ~400 | ~2000 |
| /ɛ/ | head | ~530 | ~1850 |
| /æ/ | had | ~660 | ~1700 |
| /ɑ/ | hod | ~730 | ~1100 |
| /ɔ/ | hawed | ~570 | ~840 |
| /ʊ/ | hood | ~440 | ~1020 |
| /u/ | who'd | ~300 | ~870 |

**These numbers are quoted from the standard literature from memory and must be
checked against a source before any of them becomes a shipped constant.** The
*shape* is what matters here and is not in doubt: F1 tracks how open the mouth
is, F2 tracks how far forward the tongue is, and the eight vowels occupy well
separated corners of that plane.

Formants scale with vocal tract length, so a woman's are roughly 15–20% higher
than a man's and a child's higher again. Same problem as pitch, same two
answers: calibrate, or **normalise** — compare the *ratio* F2/F1 and the
position within the player's own vowel triangle rather than absolute hertz.

### 1.2 Which leaves a real question the issue does not settle

**Is the target played, or only drawn?**

- **Played and drawn**: the player imitates by ear and uses the picture to
  correct. Easy, immediately fun, and the spectrum is a helper rather than the
  game.
- **Drawn only**: the player has to *read* a spectrum and produce it. Much
  harder, genuinely novel, and much more likely to end a round with three lives
  gone and nobody having scored.

This is the single biggest fork in the design and it is not a detail — it
decides whether the game is a party game or a puzzle. A plausible answer is
both, as the difficulty modes: play it on easy, hide it on hard.

---

## 2. What the microphone can actually measure

Everything below is `getUserMedia({ audio: true })` into an `AudioContext` and
an `AnalyserNode`, which is already in every mobile browser and adds no
dependency.

**FFT resolution is a real constraint, and it cuts the wrong way for pitch.**
At 48 kHz:

| `fftSize` | Bin width | Frame length | Frames in a 5 s round |
| --- | --- | --- | --- |
| 2048 | 23.4 Hz | 42.7 ms | 117 |
| 4096 | 11.7 Hz | 85.3 ms | 59 |
| 8192 | 5.9 Hz | 170.7 ms | 29 |

An 85 Hz male fundamental puts its harmonics 85 Hz apart — **3.6 bins** at
`fftSize` 2048, 7.3 at 4096. That is barely a comb, and estimating F0 by
looking for the lowest peak in it is unreliable exactly for the voices that
need it most. Going to 8192 buys resolution and spends it on a 171 ms frame,
which is a fifth of a second of lag on a live display.

**So do not get pitch from the FFT.** Estimate F0 in the time domain —
autocorrelation, or YIN, over `getFloatTimeDomainData` — which is the standard
answer, is accurate well below one bin, and runs happily on a phone at 20–30 Hz
update. Use the FFT for the *envelope* (the formants), where its resolution is
ample, and the time domain for the *pitch*, where it is not.

---

## 3. The representation: a raw FFT is the wrong thing to draw

The instinct is `getByteFrequencyData` straight into 1024 bars. Three reasons
that is the wrong picture, the first of which is decisive:

**A linear frequency axis spends the screen on silence.** At 48 kHz an
`AnalyserNode` covers 0–24 kHz. Everything the voice does below 1 kHz — the
fundamental, F1, most of the energy — gets **4.2% of the display width**.
Everything below 4 kHz gets **16.7%**. The remaining 83% of the bars are
near-empty air the player cannot influence. That ratio does not improve with
`fftSize`; it is just 1000/24000.

**A harmonic comb is visually unstable.** A sung note is a picket fence of
narrow spikes that jitter frame to frame with vibrato and mic noise. Two takes
of "the same" note look different, which makes the picture read as unreliable
at the exact moment it is being used as feedback.

**And it asks the player to match their own timbre.** A full-spectrum
comparison scores things nobody can change — vocal tract length, mic response,
how far the phone is from the mouth. That is anatomy and hardware, not skill.

### 3.1 The candidates

| Representation | What it shows | Verdict |
| --- | --- | --- |
| Linear FFT magnitude | Raw bins, 0–24 kHz | **No.** 4.2% of the width does the work; jittery; scores anatomy |
| Log-frequency FFT | Same bins, log axis | Better axis, still a jittering comb |
| Third-octave / constant-Q bands | Energy per perceptual band | **Yes, for the display.** Smooths the comb into an envelope; ~17 bands over 80 Hz–4 kHz is a readable bar chart on a phone |
| Spectrogram (time × frequency) | The whole 5 s at once | Beautiful, and the classic voice picture. But comparing two of them is a 2-D problem and hard to score in a way a player can argue with |
| Pitch + vowel point (F0, F1/F2) | The two things a singer controls | **Yes, for the scoring.** Two numbers, both directly actionable: "sing higher", "open your mouth wider" |

### 3.2 The recommendation: draw bands, score parameters

They are not in competition — they answer different questions.

- **Draw** a **log-spaced band bar chart**, roughly 17 third-octave bands from
  80 Hz to 4 kHz, target as an outline and the live voice filled underneath.
  It looks like a spectrum, which is what the issue promises and what makes the
  screen worth looking at; it is stable frame to frame; and every bar is inside
  the range the voice actually occupies.
- **Score** on **pitch class + vowel**, from the time-domain F0 and the band
  envelope's own peaks. Two numbers the player can act on, both robust to mic
  and anatomy once normalised (§1.1).

One caution on the band layout, from the arithmetic: at `fftSize` 4096 the
lowest third-octave band (80–101 Hz) contains **1.8 bins**, and at 2048 it
contains **0.9** — less than one. The bottom two or three bands are an energy
estimate rather than a measurement at any frame length short enough to feel
live. Either widen the bottom bands, start the display at ~120 Hz, or accept
that the lowest bars are coarse. Worth deciding deliberately rather than
discovering on a phone.

---

## 4. The risks that would decide whether this gets built

These are not implementation details. Two of them could sink the game.

1. **Crosstalk, and it is the serious one.** This is a party game: four people
   in one room, four phones, everyone singing at once. Phone microphones are
   effectively omnidirectional, so **every phone hears every voice**. A scorer
   that locks onto the loudest harmonic series will happily score your
   neighbour. There is no clean signal-processing answer at this scale. The
   design answers are: take turns (one sings, the others watch — which is
   arguably the better party game anyway), or accept the noise and make the
   round about who gets closest despite it.
2. **A noisy room has a floor.** A gate is needed, and below it the honest
   response is "we cannot hear you" rather than a score of zero, which reads as
   the game being broken.
3. **No fallback, and that is now allowed.** There is no touch version of
   singing a vowel. Under AGENTS.md §4 as it now stands a fallback is a
   recommendation rather than a gate, so this is fine — but it owes the two
   things every such game owes: it says who it excludes in the lobby before
   anyone starts, and the microphone is asked for by Ready/Start rather than by
   a button of its own ([device-capabilities.md](device-capabilities.md) §2).
4. **Privacy is the same rule Color Hunt follows.** Audio is sampled, analysed
   and discarded on the phone; what may go on the wire is a score and at most a
   handful of numbers. No audio, no buffer, no recording — and the lobby should
   say so plainly, because "we want your microphone" is the single biggest
   reason a player says no.
5. **iOS needs a gesture.** An `AudioContext` starts suspended and must be
   resumed inside a user gesture. It is the same shape as every other
   permission here, and Ready/Start is already that gesture.
6. **Who this excludes** is broader than the sensor. A player who cannot
   vocalise cannot play at all, and a self-conscious player in a quiet room
   will not. That is a real audience cost and belongs in the lobby copy.

---

## 5. What I would propose, if it goes ahead

Enough to write a spec against, and nothing decided:

- Generate **(pitch class, vowel)**, not a spectrum. Synthesise the target
  spectrum from a source–filter model for display.
- Score **pitch modulo the octave** so anatomy cannot exclude anyone, and the
  **vowel** from normalised F1/F2 — no calibration screen.
- Draw **~17 third-octave bands, 80 Hz–4 kHz**, target outline over live fill.
- **F0 from the time domain** (autocorrelation/YIN), **formants from the FFT**.
- Play the target on easy, hide it on hard — §1.2's fork, as the mode axis.
- **Take turns**, unless a playtest shows a room of four singing at once
  actually works.
- Three lives, as the issue says; a life goes on a round nobody's voice got
  close enough on.

## 6. What this study did not settle

- **The formant table in §1.1 is from memory** and must be checked against a
  source before shipping.
- **Whether reading a spectrum is fun** is unknowable on paper. It is the fork
  in §1.2 and only a phone answers it.
- **Whether crosstalk is survivable** in a real room with four phones. §4.1 is
  reasoning, not a measurement.
- **How accurate YIN is on a phone mic in a noisy room** — the literature is
  about clean recordings.
- **No prototype was built.** Everything above is analysis plus the FFT
  arithmetic in §2 and §3, which is exact.
