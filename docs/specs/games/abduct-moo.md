# Abduct-Moo

> Status: **live**.

| | |
| --- | --- |
| **Slug** | `abduct-moo` |
| **Catchy sentence** | *Pick a barn. Dodge the beam* |
| **Illustration** | `www/src/games/abduct-moo/art/card.svg` — a UFO's light cone over a barn, a cow mid-abduction |
| **Players** | 2–8 |
| **Round length** | Three rounds, each 6 s (3 s to choose, 3 s to watch) — under 20 s a match, plus reading the result each round |
| **Inputs** | touch |
| **Accent colour** | `#FACC15` |
| **Status** | live |

## 1. Pitch

Five barns, one UFO. Every player is a cow, herded at the bottom of the
screen. Tap a barn and your cow runs to it — you can change your mind as
often as you like, and everyone sees everyone else's pick live, the whole
time. When the clock runs out, the UFO swoops over one barn at random and
beams up every cow standing in it. Anyone else is safe, and safe is worth a
point. Three rounds, most points wins.

## 2. Core loop

The whole match is one continuous session — a host presses Start once, not
once per round. Two phases repeat three times, driven entirely by the
server's own clock; nobody has to click anything between rounds.

1. **Choosing (`ABDUCT_CHOOSE_MS`, 3 s).** All five barns are open, every
   cow starts unplaced. Tap any barn to send your cow toward it; tap a
   different one and it turns around instead — there is no limit on how
   many times a player changes their mind before the clock runs out.
   Every player's current pick is public the instant it is sent (spec §6) —
   the whole point is watching the crowd move, and moving with or against
   it.
2. **Revealing (`ABDUCT_REVEAL_MS`, 3 s).** The referee already knows the
   answer the instant the choosing clock hits zero — it draws one of the
   five barns uniformly at random, independent of anything any player
   picked (spec §8) — and broadcasts the result immediately: which barn,
   who is abducted, who is safe, updated scores. The reveal window is
   entirely presentational: the client spends it flying the UFO to the
   target, opening its light cone, and lifting the abducted cows away
   before the next round's choosing phase begins. A phone that missed the
   broadcast for any reason still ends up with the same final numbers when
   it reconnects (spec §6) — nothing about the outcome depends on how long
   the animation is watched.
3. **Scoring.** Every cow not abducted this round — including one that
   never picked a barn at all, and a cow whose barn simply was not the one
   picked — earns one point. A barn nobody chose that the UFO happens to
   pick is destroyed instead (§2.1) — nobody was there to take, so nothing
   is scored either way.
4. **Repeat**, fresh barns, for `ABDUCT_ROUNDS` (3) rounds total, then the
   match ends: highest total points across all three rounds wins, a tie is
   unranked (spec §7).

**Win condition:** most points after three rounds. **Scoring:** +1 per
round a player's cow is not abducted, summed across the match.

### 2.1 A barn nobody chose, hit anyway

"If there are cows at this barn, they get abducted; if there are no cows,
the barn is destroyed and cannot be used for this round" is read literally:
destruction is scoped to the round already ending — every barn is intact
again the moment the next round's choosing phase opens. It is decoration,
not a second chance for the current round: nothing in this design gives the
UFO a second pick before the round moves on, so a destroyed barn only ever
shows up as a wrecked barn in that round's own reveal, never as a barn a
player has to route around mid-round. See §12 for the alternative reading
this spec did not take.

### 2.2 No elimination, ever

Getting abducted costs a round's point, nothing more. Every cow is back on
the ground, unplaced, the moment the next choosing phase opens — there is
no "out for the match" here, unlike Pass the Bomb or Steady Hand. A player
who is abducted in round 1 has exactly the same chance at rounds 2 and 3 as
anyone else. This is a deliberate simplification: the brief describes
scoring, not elimination, and a party game about a silly space cow abduction
does not need one more way to sit out a round doing nothing.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: full-bleed night countryside — a dark blue star field above,
  fields below — with five barns evenly spaced across the middle of the
  screen and every connected player's cow lined up along the bottom edge.
  **Your own cow is drawn at full brightness; everyone else's is dimmed** —
  never the only signal, since a cow also gets a small ring around it while
  it is *yours*, so brightness alone (which some displays and some eyes
  flatten) is not what tells you which one you are (spec §11). During
  **choosing**, a countdown ring shows the 3 s window closing and every
  cow — yours and everyone else's — sits at whichever barn its owner has
  most recently tapped, or still at the start line if they have not tapped
  yet. The UFO drifts slowly and unpredictably above the barns the whole
  time — pure decoration (§8) — never a hint at the real pick, which the
  referee has not even made yet.
- **Reveal**: the UFO stops drifting, flies to the picked barn, and opens a
  light cone (white-yellow, 50% opacity) under itself. Any cow standing in
  that barn rises into the cone and vanishes; a barn that was empty cracks
  and darkens instead. The status bar's score ticks up for every surviving
  cow the instant the reveal frame lands, not staggered to the animation —
  the animation is only ever telling you what already happened.
- **Between rounds**: no separate screen. The moment a round's reveal
  window ends, the next round's barns reset and the choosing countdown
  starts again, live on the same board — round 1 to round 2 to round 3 is
  one continuous scene, the running score the only thing that visibly
  carries over.
- **Results**: after round 3's reveal, the shared `GameOverScreen` (highest
  total wins, a tie unranked — spec §7), same shape as every other game's.

## 5. Inputs & sensors

Touch only — a tap on a barn. No sensors, no permissions, no fallback
needed because there is nothing to fall back from.

## 6. Networking

One state, fully public — there is no hidden information in this game at
all, which is unusual for this catalogue: every player's own barn pick is
something every other player is explicitly meant to see live (§2), so
there is no private half to keep off the wire the way most games need.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `abduct-pick` | client → server | `{roundId, round, barn}` | This phone's cow now wants barn `barn` (0–4) |
| `abduct` | server → both | `{roundId, round, rounds, phase, deadlineAt, barns, picks, target, abducted, scores, winner}` | The whole game, every field public |

`picks` is `Record<PlayerId, number \| null>` — every connected player's
current barn, or `null` before their first tap this round. `barns` is one
entry per barn, carrying only whether it is destroyed this round. `target`
and `abducted` are `null`/`[]` until a round's reveal, then hold that
round's answer until the next round resets them. `scores` is cumulative
across the whole match. `winner` is set only once `phase` is `'done'`,
after round 3's reveal.

A reconnecting phone gets the current state resent whole, the same as
UFO Hunt's own fully-public frame (`tap-tap-music.md`-style private resend
has nothing to do here) — there is nothing this player is owed that anyone
else was not already sent.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player never taps during choosing | Their cow stays unplaced — safe by default, scores the round like anyone else not on the target barn |
| Two or more players pick the same barn, and it is hit | All of them are abducted together |
| Every connected player picks the same barn, and it is hit | Nobody scores that round; the match still continues to the next round |
| A player joins mid-match | Starts at 0 points; plays whichever round is currently choosing when they arrive, same as anyone else already there |
| A player leaves mid-match | Their last pick and score stand; the match is not tied to the roster it started with (unlike Pass the Bomb — nothing here needs "the same people" to keep meaning) |
| Round 3 ends in a tied top score | Unranked — the shared `GameOverScreen` shows no winner, same convention as every safety-cap tie elsewhere in this catalogue |
| Fewer than 2 players | Start disabled |

## 8. Anti-cheat

- **The target barn is the referee's own draw**, made the instant the
  choosing deadline passes, from nothing a client ever sent — a modified
  client cannot predict or influence it.
- **A pick is only ever recorded from `abduct-pick` while `phase ===
  'choosing'`** — a message that arrives after the deadline (or for a
  stale `roundId`/`round`) is ignored, exactly like every other game's
  stale-input guard.
- **The UFO's on-screen drift during choosing is purely a client
  animation.** It is not derived from, and does not leak, the real target —
  the referee has not drawn it yet at that point in the phase. Two
  phones' drift paths do not even need to agree pixel-for-pixel — unlike
  UFO Hunt's own roam function, nothing here is scored against where the
  UFO visually was.
- There is nothing to bluff: every pick is already public the moment it is
  sent, so a modified client gains nothing by hiding or lying about its
  own pick that an honest one does not already show everyone.

## 9. Safety

Lowest-risk category in the catalogue: seated, one thumb, nothing thrown or
swung. No safety copy beyond the shared baseline.

## 10. Data & privacy

Leaves the phone: which barn is currently picked, on every change; player
id, name, avatar. Room memory only, for the life of the match. Nothing here
is more sensitive than what every other player's screen already shows them
live.

## 11. Accessibility

- Own-cow versus everyone-else is never brightness alone: your own cow also
  carries a small ring the others do not, so a display or a viewer that
  flattens the brightness difference still has a second, independent way to
  find yourself.
- The reveal's outcome (abducted vs. safe) is read from the score ticking
  up and the cow visibly leaving the board, not from colour — a cow that is
  gone is gone, on any screen.
- The countdown ring during choosing is a numeric-adjacent shape, not the
  only cue that time is short — the barns' own light cone animation at
  reveal is unmistakable regardless of the countdown being watched closely.
- No strobing, no flashing. The light cone is a soft fade in and out,
  respecting `prefers-reduced-motion` the same way every other game's
  decorative motion does.

## 12. Open questions

- **One pick per round, not several.** The brief's "barn destroyed, can't
  be used for this round" reads two ways: a round-ending flourish (what
  this spec built, §2.1), or a signal that the UFO keeps picking among the
  barns still standing until every barn is gone or every cow is caught,
  all within one "round." The second reading is a materially bigger game
  (a shrinking-barn elimination loop inside each of the three rounds) and
  was not built here — worth confirming against the maintainer's own
  mental picture before calling this final.
- **Flat, equal scoring.** Every surviving cow gets exactly the same one
  point, so with five barns and a UFO picking only one, most players
  survive most rounds and ties for the game's own top score are common by
  design, not a rare edge case. If the intent was closer to "reward the
  bold," this is the piece to revisit.
- **A single winner, not the brief's plural "winners."** The brief says
  "winners of the round are the ones with most points" — plural, allowing
  co-winners. The shared `GameOverScreen` (`core/ui/GameOver.tsx`) only
  ever shows one winner or none, by deliberate house design ("one shape
  now" — every other game already resolves a tie the same way), so a tied
  top score here shows as unranked rather than crowning several players at
  once. Building a one-off multi-winner display was judged not worth
  reintroducing the "nine games, nine endings" problem that component was
  built to end.
- **Exact timing** (`ABDUCT_CHOOSE_MS = 3000`, `ABDUCT_REVEAL_MS = 3000`) —
  the choosing window is the brief's own number; the reveal window is a
  starting guess for "long enough to watch the UFO fly over, beam down, and
  read the result," untested on a real phone.
- **Art**: cow and barn are hand-drawn SVG, not PNG. The brief allowed
  either; this session cannot produce polished raster art (the same call
  UFO Hunt's own saucer made), and SVG keeps them crisp at any size for
  free. The UFO itself is not redrawn — it is `ufo-hunt/art/ufo.svg`,
  copied in rather than shared by reference, so the two games can drift
  apart visually later without one edit breaking the other.
