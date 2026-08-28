# Abduct-Moo

> Status: **live**.

| | |
| --- | --- |
| **Slug** | `abduct-moo` |
| **Catchy sentence** | *Pick a barn. Dodge the beam* |
| **Illustration** | `www/src/games/abduct-moo/art/card.svg` — a UFO's light cone over a barn, a cow mid-abduction |
| **Players** | 2–8 |
| **Round length** | Three rounds, each 8 s (3 s to choose, 5 s to watch the UFO hover, fly in and abduct) — about 24 s a match, plus reading the result each round |
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

1. **Choosing (`ABDUCT_CHOOSE_MS`, 3 s).** The instant this phase opens, the
   referee has already drawn the round's real target — uniformly at random,
   from whichever barns are still standing (§2.1) — but tells nobody yet
   (spec §8). All five (or fewer, once one is destroyed) open barns invite a
   tap; tap one to send your cow toward it, tap a different one and it turns
   around instead — there is no limit on how many times a player changes
   their mind before the clock runs out. Every player's current pick is
   public the instant it is sent (spec §6) — the whole point is watching the
   crowd move, and moving with or against it. Anyone who has not tapped a
   barn by the deadline is assigned one at random too (§7) — hiding nowhere
   is not the same as being safe.
2. **Revealing (`ABDUCT_REVEAL_MS`, 5 s).** The choosing deadline is when
   the already-drawn target first reaches the wire (spec §8) — nothing new
   is decided here, only shown. The client plays it in three beats: the UFO
   keeps sweeping the whole row, faster than it drifted during choosing, for
   about 2 s; then flies to the target and drops to a low altitude just
   above it, over about 0.7 s; then sits there, cone open, pulling up every
   cow caught underneath it one at a time for whatever is left of the
   window (§4). A phone that missed the broadcast for any reason still ends
   up with the same final numbers when it reconnects (spec §6) — nothing
   about the outcome depends on how long the animation is watched.
3. **Scoring.** Every cow not abducted this round earns one point. A target
   barn nobody ended up at is destroyed instead (§2.1) — nobody was there to
   take, so nothing is scored either way.
4. **Repeat** for `ABDUCT_ROUNDS` (3) rounds total, then the match ends:
   highest total points across all three rounds wins, a tie is unranked
   (spec §7).

**Win condition:** most points after three rounds. **Scoring:** +1 per
round a player's cow is not abducted, summed across the match.

### 2.1 A barn nobody chose, hit anyway

"If there are cows at this barn, they get abducted; if there are no cows,
the barn is destroyed and cannot be used" — read literally, and for keeps:
a destroyed barn stays destroyed for the **rest of the match**, not just the
round that emptied it. The referee's own draw for every later round only
ever picks among the barns still standing (§2, §8), and a destroyed barn
refuses a tap even if a client tries to send one (§8) — the button is also
disabled client-side, but the referee does not trust that alone. With
`ABDUCT_BARN_COUNT` at 5 and `ABDUCT_ROUNDS` at 3, at most one barn is lost
per round, so a match can never run out of barns to draw from.

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
  fields below — with up to five barns evenly spaced across the middle of
  the screen (fewer once one is destroyed, §2.1) and every connected
  player's cow lined up along the bottom edge when unplaced. **Your own cow
  is drawn at full brightness; everyone else's is dimmed** — never the only
  signal, since a cow also gets a small ring around it while it is *yours*,
  so brightness alone (which some displays and some eyes flatten) is not
  what tells you which one you are (spec §11). During **choosing**, a
  countdown banner sits between the UFO and the barns — *"N seconds before
  abduction, hide your cow!"*, wrapping rather than overflowing on a narrow
  phone — and every cow, yours and everyone else's, moves to sit **just
  below** whichever barn its owner has most recently tapped, or stays at
  the start line if they have not tapped yet. Two or more cows sharing one
  barn arrange themselves in a small grid directly under it — one column
  stacked for up to three cows, two columns beyond that, with a lone odd
  cow out centred under both columns rather than pinned to one side (worked
  through for every count from 1 to 8, `game.ts`'s `cowGridSlot`). The UFO
  drifts slowly and unpredictably above the barns the whole time — pure
  decoration (§8) — never a hint at the real pick, which is already drawn
  internally but has not reached the wire yet.
- **Reveal**: three beats, all presentational (§2). First the UFO's own
  drift speeds up, sweeping the whole row for about 2 s. Then it flies to
  the real target and drops to a low altitude just above it over about
  0.7 s — the UFO and its light cone (white-yellow, 50% opacity) share
  exactly the target barn's own horizontal position, never a pixel off it.
  Once parked, every cow standing there rises into the cone and vanishes
  one at a time, a short stagger between each rather than all at once, for
  however long is left of the reveal window; a barn that turns out empty
  cracks and darkens instead — and stays that way for the rest of the
  match (§2.1). The status bar's score ticks up for every surviving cow the
  instant the reveal frame lands, not staggered to the animation — the
  animation is only ever telling you what already happened.
- **Between rounds**: no separate screen. The moment a round's reveal
  window ends, the next round's barns (destroyed ones still destroyed) and
  the choosing countdown start again, live on the same board — round 1 to
  round 2 to round 3 is one continuous scene, the running score and any
  wrecked barns the only things that visibly carry over.
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
entry per barn, carrying only whether it is destroyed — **for the rest of
the match**, not just this round (§2.1). `target` is already drawn
internally the instant choosing opens, but the wire itself still says
`null` until that round's own reveal (§8) — the only field in this game
where the internal and the public state deliberately disagree, and only
for as long as it takes to keep the draw honest. `abducted` is `[]` until
reveal, then holds that round's answer until the next round resets it.
`scores` is cumulative across the whole match. `winner` is set only once
`phase` is `'done'`, after round 3's reveal.

A reconnecting phone gets the current state resent whole, the same as
UFO Hunt's own fully-public frame (`tap-tap-music.md`-style private resend
has nothing to do here) — there is nothing this player is owed that anyone
else was not already sent.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player never taps during choosing | Assigned a random still-standing barn at the deadline — not safe by default; hiding nowhere is a real risk, the same as anyone else's pick |
| That random assignment happens to be the target | Abducted, exactly as if they had chosen it themselves |
| Two or more players end up at the same barn, and it is hit | All of them are abducted together |
| Every connected player ends up at the same barn, and it is hit | Nobody scores that round; the match still continues to the next round |
| A player joins mid-match | Starts at 0 points; plays whichever round is currently choosing when they arrive, same as anyone else already there |
| A player leaves mid-match | Their last pick and score stand; the match is not tied to the roster it started with (unlike Pass the Bomb — nothing here needs "the same people" to keep meaning) |
| Round 3 ends in a tied top score | Unranked — the shared `GameOverScreen` shows no winner, same convention as every safety-cap tie elsewhere in this catalogue |
| Fewer than 2 players | Start disabled |

## 8. Anti-cheat

- **The target barn is the referee's own draw**, made from nothing a client
  ever sent — a modified client cannot predict or influence it. It is drawn
  the instant a round's choosing phase opens rather than at its deadline,
  but that timing choice changes nothing observable: the wire's own
  `target` field is forced back to `null` for as long as `phase ===
  'choosing'` (`toState` in `worker/abductMoo.ts`), so no client, honest or
  not, ever sees it early.
- **A pick is only ever recorded from `abduct-pick` while `phase ===
  'choosing'`**, for a barn that is not already destroyed — a message that
  arrives after the deadline, for a stale `roundId`/`round`, or naming a
  wrecked barn is ignored, exactly like every other game's stale-input
  guard. The client also disables tapping a destroyed barn, but the
  referee does not depend on that alone.
- **The UFO's on-screen drift and its faster reveal-time hover are both
  purely client animation.** Neither is derived from, or leaks, the real
  target — even though it already exists internally by then, nothing about
  either path is a function of it. Two phones' paths do not even need to
  agree pixel-for-pixel — unlike UFO Hunt's own roam function, nothing here
  is scored against where the UFO visually was.
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
- The choosing countdown is read text (*"N seconds before abduction, hide
  your cow!"*), not an icon or a ring alone — a screen reader gets the same
  warning a sighted player does, and the number updates in place rather
  than being announced as a wall of separate live-region updates.
- No strobing, no flashing. The light cone is a soft fade in and out,
  respecting `prefers-reduced-motion` the same way every other game's
  decorative motion does.

## 12. Open questions

- ~~One pick per round, not several~~ — **resolved.** A follow-up message
  ("let's clarify the timing") confirmed persistent, whole-match barn
  destruction (§2.1) over a shrinking-barn elimination loop inside each
  round: the UFO draws once per round, from whichever barns still stand.
- **Flat, equal scoring.** Every surviving cow gets exactly the same one
  point, so with up to five barns and a UFO picking only one, most players
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
- **Exact timing** (`ABDUCT_CHOOSE_MS = 3000`, `ABDUCT_REVEAL_MS = 5000`,
  and the reveal's own internal split — a 2 s fast hover, a 0.7 s transit,
  the rest for a staggered abduction) — the choosing window is the brief's
  own number; the hover and transit durations are the "clarify the timing"
  message's own numbers; the total reveal window and the stagger between
  each abducted cow are this session's best guess at "long enough for an
  8-cow pileup to read clearly," untested on a real phone. A very crowded
  single barn (up to 8 cows, one per player at the maximum room size) may
  still have its rise animation cut short by the round advancing — the
  outcome itself is never in doubt by then (§2), only how much of the
  flourish is seen.
- **Art**: cow and barn are hand-drawn SVG, not PNG. The brief allowed
  either; this session cannot produce polished raster art (the same call
  UFO Hunt's own saucer made), and SVG keeps them crisp at any size for
  free. The UFO itself is not redrawn — it is `ufo-hunt/art/ufo.svg`,
  copied in rather than shared by reference, so the two games can drift
  apart visually later without one edit breaking the other.
