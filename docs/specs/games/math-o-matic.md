# Math-o-matic

| | |
| --- | --- |
| **Slug** | `math-o-matic` |
| **Catchy sentence** | *Four answers, one is right, three lives* |
| **Illustration** | `www/src/games/math-o-matic/art/card.svg` — a chalk-style sum mid-air with four answer tiles below it, one of them lit |
| **Players** | 2–8 |
| **Round length** | 1–2 min |
| **Inputs** | touch |
| **Accent colour** | `#2DD4BF` |
| **Status** | 🎮 beta — built; the answer window and the distractor mix untested on real thumbs ([#5](https://github.com/VincentGuigui/FonyGames/issues/5)) |

## 1. Pitch

A sum appears. Four answers appear under it. One is right. Everybody in the
room is looking at the same sum at the same time, and the three players who
tap wrong lose a life each while you don't. Last one still holding a life
wins; how many you got right is the number you brag about afterwards.

It is the only game in the catalogue that is purely a **knowledge** race
rather than a reflex or a sensor one, which is exactly why it is worth having:
it is the one a parent can win against a teenager.

## 2. Core loop

Everyone sees the same question and the same four answer buttons. Tap the one
you believe. A wrong tap costs a life; three lives each, and the last player
still standing takes the round.

1. Host picks the calculus options in the lobby (§3) — all on by default — and
   starts.
2. The **referee** rolls a question and four answers, one correct, and
   broadcasts them to everyone including the host (§6, §8).
3. Every player taps an answer, or doesn't. A player who has already answered
   waits, seeing only that they have answered — never whether they were right.
4. The question closes on the shorter of *everyone has answered* or
   `MATH_ANSWER_MS`. Then the referee reveals: the correct answer, who tapped
   what, and the new life counts.
5. A wrong tap, **or no tap at all**, costs one life. A correct tap costs
   nothing and adds one to that player's score.
6. Next question, immediately. No lobby in between, the same shape Color
   Match's own ladder uses.

**Win condition:** the last player with a life left. If the last lives in the
room go on the same question, the highest score among them wins; still tied,
the round is a draw and says so.
**Scoring:** the number of correct answers. It decides nothing except the
tie-break above and the line on the results screen — lives decide the round.

## 3. Modes / variations

The lobby toggles are **not** modes — they are one mode's options, and they
travel in the `start` payload rather than in the mode slug.

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Four answers, one is right | baseline |
| `sudden-death` | One life each. Blink and you are out | `MATH_LIVES` = 1 |

**Host options**, all enabled by default, and **all three are sets** — the same
control three times over:

| Option | Values | Default |
| --- | --- | --- |
| Operations | any subset of `+ − × ÷` | all four |
| Operand length | any subset of 1, 2, 3, 4, 5 digits | all five |
| Operators per question | any subset of 1, 2, 3 | all three |

The last two were a two-ended range first, and that was wrong twice over. It
made one panel hold two kinds of control — two nudged from the ends, one ticked
— and it could not express "two or four digits, never three", which is a
perfectly reasonable room. Tapping a stop toggles it, the last one on refuses
to go, and `normaliseOptions` intersects whatever arrives with what the game
offers rather than clamping it onto a neighbour.

It also sharpens the one relaxation the generator is allowed (§12 Q6): a room
that ticks 1 and 3 operators and cannot manage three drops to one, which is a
count it *asked for*, where a 1–3 range only ever meant "somewhere in here".

Rules the generator owes the options, so a legal setting can never produce an
illegal question:

- **Division is exact.** `÷` only ever appears where it divides evenly — the
  generator picks the divisor and the quotient and multiplies to get the
  dividend, rather than rolling a dividend and hoping.
- **No negative answers** at 1–2 digits; subtraction is ordered so the larger
  operand comes first. (Whether bigger settings should allow negatives is
  §12 Q2.)
- **Standard precedence**, and it is shown: `2 + 3 × 4` renders with the `×`
  tighter than the `+`. Multi-operator questions are the setting most likely
  to need brackets instead — §12 Q3.
- **Turning every operation off is not a legal state**; the last one cannot be
  unticked, the same way the lobby will not let you start alone.

## 4. Screens

Standard flow (lobby → countdown → round → results), with one addition: the
lobby carries the **options panel**, host-only, and every other player sees it
read-only so nobody is surprised by five-digit division.

The round screen, portrait, top to bottom:

- **Lives**, as pips, one row per player with their avatar — the same
  `Scoreboard` component the rest of the catalogue uses, in its wide form.
- **The question**, big, centred, the one thing on screen worth looking at.
  It carries the timer as a draining bar under it rather than a number.
- **Four answer buttons**, a 2×2 grid in the thumb's half of the screen. Big
  enough to hit without aiming; equal size, because a bigger button is a hint.
- After the close: each button carries what it was — the correct one in the
  accent colour, a wrong tap in `--text-dim` with the avatars of whoever fell
  for it. **Who tapped what is public**, which is most of the fun and costs
  nothing to send.

## 5. Inputs & sensors

Touch only. No sensors, no permissions, no fallbacks needed — the one game in
the catalogue with nothing to deny.

## 6. Networking

Profile A ([../multiplayer.md](../multiplayer.md)): one message down per
question, one up per player. Nothing at frame rate.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | client → server | `{ mode, solo, options }` | Host starts; carries the lobby's own option toggles |
| `math-question` | server → all | `{ roundId, index, text, answers: [number × 4], closesAt, lives, scores }` | The question, its four answers in the order to draw them, and the deadline |
| `math-answer` | client → server | `{ roundId, index, choice }` | Which of the four this phone tapped — an **index**, never a value |
| `math-reveal` | server → all | `{ roundId, index, correct, taps: {id: choice}, lives, scores, out: [id] }` | What it was, who tapped what, and the damage |

**The referee is authoritative for everything**: the question, the answer, the
deadline, lives and scores. It holds the correct index and never sends it until
the question closes.

**Latency:** the deadline is an absolute server timestamp, and a tap is
accepted up to `MATH_TAP_GRACE_MS` past it — the same grace Color Match gives a
pick, for the same reason: a phone 300 ms away should lose its own lag, not its
life.

### A correction to the issue

The issue has **the host's phone generate the question** and hand it to the
worker. This spec puts it in the referee instead, for three reasons, and it is
the one place the spec knowingly departs from the brief (§12 Q1):

1. **The host would know the answer first.** Even without malice their phone
   has the correct index before anyone has seen the question. Every other game
   here rolls shared randomness in the referee for exactly this reason —
   Squash Mosquitoes' pattern, Gravity Shooter's board.
2. **The host would be able to choose.** A modified host client can roll until
   it gets a question it likes.
3. **It is no cheaper.** The generator is arithmetic on five numbers; the
   referee already owns a `random()` and already broadcasts a frame per
   question.

## 7. Failure & edge cases

- **Player leaves mid-round**: their lives and score stay on the board, they
  simply stop being able to answer — Color Match's own rule. If the leaver was
  the last player with a life, the round ends and the results say they left.
- **Host leaves**: the round continues; the referee owns the questions, and the
  options were fixed at start. Host-only controls move to the next player by
  join order, as elsewhere.
- **Too few players**: 2 minimum, `solo` for testing (one phone, no winner).
- **Nobody answers a question**: everyone loses a life. If that empties the
  room, the round ends with the highest score winning, or a draw.
- **Backgrounded tab**: the deadline is absolute, so a phone that comes back
  after the close sees the reveal and has lost a life. Nothing is retried.
- **Everyone taps correctly, forever**: the round is bounded by
  `MATH_QUESTION_CAP` (40) as a backstop; past it the highest score wins.

## 8. Anti-cheat

The threat here is a modified client, and there is exactly one thing worth
protecting: **the correct answer must not be on the wire before the question
closes.** It is not. `math-question` carries four numbers in a shuffled order
and nothing that marks one of them.

- **A guessed index is a 1-in-4 guess**, which is the game.
- **`math-answer` carries an index, not a value**, so a client cannot answer a
  question it was not shown.
- **A second answer to the same question is ignored**, not replaced — unlike
  Color Match, where the last pick wins. Here the first tap is the answer;
  allowing changes would let a fast phone spam all four.
- **Scores and lives are the referee's**, never a payload's.

## 9. Safety

Nothing to warn about. No motion, no sound, no walking about.

## 10. Data & privacy

One integer per player per question leaves the phone. Nothing is stored past
the room's own lifetime. No text the player types, because there is none.

## 11. Accessibility

- **The numbers are the game**, so they get the largest type on the screen and
  `font-variant-numeric: tabular-nums`.
- **Colour is never the only signal**: the correct button is marked with a tick
  as well as the accent colour, and a wrong one with a cross.
- **No timing pressure below the reading speed it takes to parse the sum** —
  `MATH_ANSWER_MS` is generous by design (§12 Q4 asks how generous), and the
  draining bar has an accessible text equivalent for screen readers.
- **Reduced motion**: the bar drains without easing; nothing else animates.

## 12. Open questions

Five were open when this spec was written. The build settled four of them; what
it settled, and what is left, is below.

1. ~~**Referee-generated questions instead of host-generated** (§6).~~
   **Settled: the referee rolls them**, for the three reasons in §6. The host's
   toggles travel in the `start` payload and are sanitised by
   `normaliseOptions` rather than trusted.
2. ~~**Negative answers** at 3+ digit settings.~~ **Settled: never.** Nothing
   goes negative at any point in the left-to-right evaluation, not just at the
   end — `shared/mathQuestion.test.ts` checks every additive prefix across all
   300 option combinations. Allowing negatives would make better bait, but it
   would also make `4 − 9` a legal question at a setting a parent picked for a
   seven-year-old.
3. ~~**Brackets** on 2–3 operator questions.~~ **Settled: precedence, no
   brackets** — and the left-to-right misreading is deliberately offered as one
   of the three wrong answers (Q5), which is what makes a multi-operator
   question worth asking.
4. ~~**`MATH_ANSWER_MS`.**~~ **Settled as a formula rather than a number**:
   `MATH_ANSWER_BASE_MS` (8 s) plus `MATH_ANSWER_PER_OPERATOR_MS` (4 s) for each
   operator past the first, so a three-operator sum gets 16 s. Still a guess,
   and still the first thing to playtest — but it scales with the reading, which
   is the part that was actually wrong about a single number.
5. ~~**How the three wrong answers are generated.**~~ **Settled as a ranked
   list**, best first: the precedence trap, off-by-one either way, transposed
   last two digits, one digit nudged, then off-by-ten and off-by-the-last-operand.
   A random number in the right magnitude is the last resort, not the design.
   The test pins that every wrong answer is within an order of magnitude of the
   right one, and that the trap is on the buttons every time it exists.

Still open, and now with the build's own answers to argue with:

6. **The operator count is a ceiling, not a promise.** Some settings cannot
   express what they ask: three exact divisions at three digits needs a
   first operand divisible by three three-digit numbers *and* three digits
   wide, and `a − b − c − d ≥ 0` needs `a` to beat three same-width operands.
   The generator gives up the **count** in those cases and never the ticked
   operations. Ten of the 300 combinations relax; the test names them
   exactly, so a new one appearing is a regression rather than a surprise.
   Whether the lobby should instead *grey out* those combinations is the open
   part.
7. **Five digits × three operators is arithmetic homework**, not a party game.
   It is legal because the issue asked for those widths, and the default is all
   of them. A narrower default — say 1, 2 and 3 digits ticked — is probably the
   friendlier first experience, and is now one entry in a list rather than a
   range's ceiling.
8. **`sudden-death` is declared and not built.** One life each, `MATH_LIVES`
   = 1, and nothing else changes; it is a one-line mode whose only real
   question is whether a room of eight enjoys being three-quarters eliminated
   after two questions.
