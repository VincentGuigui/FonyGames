# Aliens love cows

> Status: **live**.

| | |
| --- | --- |
| **Slug** | `aliens-love-cows` |
| **Catchy sentence** | *Pick a barn. Dodge the beam* |
| **Illustration** | `www/src/games/aliens-love-cows/art/card.svg` — a UFO's light cone over a barn, a cow mid-abduction, the barn and cow the maintainer's own art (spec §12) |
| **Players** | 2–8 |
| **Round length** | No fixed count — each round is up to 5 s to pick a barn (ends early once everyone has), a 3 s "3, 2, 1," then 5 s to watch the UFO hover, fly in and abduct; rounds repeat until one cow is left standing, or until only one barn is left standing and the UFO gives up (a 2 s farewell) |
| **Inputs** | touch |
| **Accent colour** | `#FACC15` |
| **Status** | live |

## 1. Pitch

Five barns, one UFO. Every player is a cow, herded at the bottom of the
screen. Tap a barn and your cow runs to it — you can change your mind as
often as you like, and everyone sees everyone else's pick live, the whole
time. Once every cow has picked, the countdown hits zero and the UFO swoops
over one barn and beams up every cow standing in it — beamed up, you are
out for the rest of the match. Dodge it and you score a point. Rounds
repeat until one cow is left standing — or, once only one barn is left
standing to draw from, the UFO gives up and leaves rather than force
everyone onto it.

## 2. Core loop

The whole match is one continuous session — a host presses Start once, not
once per round. Five phases, driven entirely by the server's own clock;
nobody has to click anything between rounds, and the match itself decides
when it is over, not a round count.

1. **Waiting (`ABDUCT_WAIT_MS`, 5 s max).** The instant this phase opens,
   the referee has already drawn the round's real target — uniformly at
   random, from whichever barns are still standing (§2.1) — but tells
   nobody yet (spec §8). Every barn still standing invites a tap; tap one to
   send your cow toward it, tap a different one and it turns around instead
   — there is no limit on how many times a player changes their mind. Every
   player's current pick is public the instant it is sent (spec §6). The
   phase does not wait out its own clock once every still-in, connected
   player has a barn — it ends the moment the last of them picks. Anyone
   still without a barn when the 5 s deadline does hit is assigned one at
   random instead (§7) — hiding nowhere is not the same as being safe.
2. **Countdown (`ABDUCT_COUNTDOWN_MS`, 3 s).** Now that everyone has a barn,
   the banner switches from a sentence to a number — "3, 2, 1." Picks are
   still open and still public during this phase (a change of mind
   right up to zero is allowed), but nothing about the target changes.
3. **Revealing (`ABDUCT_REVEAL_MS`, 5 s).** The countdown's own deadline is
   when the already-drawn target first reaches the wire (spec §8) — nothing
   new is decided here, only shown. The client plays it in three beats: the
   UFO keeps sweeping the whole row, faster than it drifted before, for
   about 2 s; then flies to the target and drops to a low altitude just
   above it, over about 0.7 s; then sits there, cone open, pulling up every
   cow caught underneath it one at a time for whatever is left of the
   window (§4). A phone that missed the broadcast for any reason still ends
   up with the same final numbers when it reconnects (spec §6) — nothing
   about the outcome depends on how long the animation is watched.
4. **Scoring & elimination.** The target barn is destroyed, cows caught
   there or not (§2.1). Every cow caught underneath it is out for the rest
   of the match (§2.2); every other still-in cow earns one point.
5. **Repeat**, drawing a fresh target from whatever barns are still
   standing, until only one cow is left in — that cow wins. If the round
   that resolves takes the last two (or, in solo testing, the last one) at
   once, the match still ends, with no winner (spec §7). If, instead, only
   one barn is left standing to draw the next round's target from,
   **fleeing (`ABDUCT_FLEE_MS`, 2 s)** replaces that round: the UFO gives
   up and leaves rather than force everyone onto the one barn left to
   dodge to, and the match ends with no winner the moment it is gone
   (§2.1, §4).

**Win condition:** last cow standing. **Scoring:** +1 per round a
still-in player's cow is not abducted — a running tally shown alongside the
result, but it is elimination or the UFO fleeing, never points, that ends
the match.

### 2.1 A barn nobody chose, hit anyway

The UFO's target is destroyed the instant its round resolves — whether or
not any cow was caught there (spec §2 above) — and it stays destroyed for
the **rest of the match**, not just the round that hit it. The referee's
own draw for every later round only ever picks among the barns still
standing (§2, §8), and a destroyed barn refuses a tap even if a client
tries to send one (§8) — the button is also disabled client-side, but the
referee does not trust that alone.

With `ABDUCT_BARN_COUNT` at 5 and exactly one barn destroyed per round, the
round that would take the fifth and last barn would force every still-in
player onto that one remaining target — nobody left to dodge to, an outcome
decided before it is even played. Rather than run that round for show, the
match never draws it: the moment only one barn is left standing, the UFO
gives up and flees instead (§2, §4) — "So Long, and Thanks for All the
Fish." The match always ends this way or by elimination (§2.2) at or before
that point, so all five barns are never destroyed at once; a defensive
fallback in the referee's own draw function still replenishes every barn if
it is ever asked for one with none standing, but ordinary play cannot reach
it.

### 2.2 Elimination is permanent

Getting abducted takes you out for the rest of the match — no round-2
comeback, unlike the scoring-only design this game shipped with at first.
An out player keeps watching (their screen stays on the board, their own
past cow simply gone) but can no longer tap a barn, is never assigned one
by the waiting-phase deadline, and does not count toward "has everyone
picked yet" (§2, §7). The match itself now ends by elimination, not by a
fixed round count: it keeps drawing fresh rounds until `lastStanding`
— the same last-one-standing helper Pass the Bomb, Steady Hand, Goat Siege
and Spill already use — says one cow (or, in solo testing, zero) is left.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: full-bleed night countryside — a dark blue star field above,
  fields below — with up to five barns evenly spaced across the middle of
  the screen (fewer once one is destroyed, §2.1) and every still-in,
  connected player's cow lined up along the bottom edge when unplaced. A
  cow taken out in an earlier round is never drawn again (§2.2). **Your own
  cow is drawn at full opacity; everyone else's sits at 70%** — the cow and
  barn art are the maintainer's own pixel-art files (`art/cow.png`,
  `art/barn.png`), used as given rather than redrawn (spec §12). During
  **waiting**, a banner sits between the UFO and the barns reading *"Hide
  your cow behind a barn!"*, wrapping rather than overflowing on a narrow
  phone; once every still-in player has a barn, the same banner switches to
  a single large digit counting down "3, 2, 1" (**countdown**). A player who
  is themselves out sees a short explanatory line instead of either banner,
  so a phone that has been eliminated is never left staring at instructions
  meant for players still choosing. Every cow, yours and everyone else's,
  moves to sit **just below** whichever barn its owner has most recently
  tapped, or stays at the start line if they have not tapped yet. Two or
  more cows sharing one barn arrange themselves in a small grid directly
  under it — one column stacked for up to three cows, two columns beyond
  that, with a lone odd cow out centred under both columns rather than
  pinned to one side (worked through for every count from 1 to 8, `game.ts`'s
  `cowGridSlot`). The UFO drifts slowly and unpredictably above the barns
  the whole time — pure decoration (§8) — never a hint at the real pick,
  which is already drawn internally but has not reached the wire yet.
- **Reveal**: three beats, all presentational (§2). First the UFO's own
  drift speeds up, sweeping the whole row for about 2 s. Then it flies to
  the real target and drops to a low altitude just above it over about
  0.7 s — the UFO and its light cone (white-yellow, 50% opacity) share
  exactly the target barn's own horizontal position, and the cone's own
  top sits just below the UFO's own hull, not overlapping it: its locked
  altitude plus the UFO's real rendered height, measured from the DOM at
  the moment it locks rather than assumed (`AbductScreen.tsx`). Once
  parked, every cow standing there rises to meet the UFO — stopping at its
  own altitude rather than sailing past it — and vanishes one at a time, a
  short stagger between each rather than all at once, for however long is
  left of the reveal window. The target barn itself keeps showing intact
  right up until the cone appears — only then does it swap to the cracked,
  darkened `art/barn_destroyed.png` file, cows caught there or not (§2.1)
  — and it stays that way for the rest of the match. A barn destroyed in
  an earlier round shows that cracked art immediately, with no delay, the
  whole time it is on screen. The status bar's score and elimination both
  land the instant the reveal frame lands, not staggered to the animation
  — the animation is only ever telling you what already happened.
- **Fleeing**: only one barn left standing (§2.1) — the UFO flies off the
  top of the screen over the full 2 s window, fading out as it goes, from
  wherever the reveal last left it. A banner in the same spot the waiting
  and countdown text uses instead reads *"So Long, and Thanks for All the
  Fish"* — Douglas Adams' own line, quoted rather than paraphrased; the
  French is that book's own published title, not a fresh translation of
  the English one. No barn can be tapped, nothing else on the board moves.
- **Between rounds**: no separate screen. The moment a round's reveal
  window ends, either the match is over or fleeing (§2), or the next
  round's barns (destroyed ones still destroyed, out players still out)
  and the waiting banner start again, live on the same board — the running
  score, the eliminated roster and any wrecked barns are the only things
  that visibly carry over.
- **Results**: once the match ends, the shared `GameOverScreen` (the
  referee's own last-one-standing winner, out players shown struck through
  — spec §7), same shape as every other game's.

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
| `abduct` | server → both | `{roundId, round, phase, deadlineAt, barns, picks, target, abducted, out, scores, winner}` | The whole game, every field public |

`picks` is `Record<PlayerId, number \| null>` — every connected, still-in
player's current barn, or `null` before their first tap this round.
`barns` is one entry per barn, carrying only whether it is destroyed —
**for the rest of the match**, not just this round (§2.1). `target` is
already drawn internally the instant `phase` becomes `'waiting'`, but the
wire itself still says `null` while `phase` is `'waiting'` or `'countdown'`
(§8) — the only field in this game where the internal and the public state
deliberately disagree, and only for as long as it takes to keep the draw
honest. `abducted` is `[]` until reveal, then holds that round's answer
until the next round resets it. `out` is every player ever abducted across
the whole match, in the order it happened — it only ever grows (§2.2).
`scores` is cumulative across the whole match. `phase` includes `'fleeing'`
— only one barn left standing (§2.1, §4) — between `'revealing'` and
`'done'`; nothing in the payload changes shape for it, the client just
reads the phase to show the UFO leaving instead of opening the next round.
`winner` is set only once `phase` is `'done'`: the sole player left in, or
`null` if the last two (or, solo, the last one) went together, or the UFO
fled instead.

A reconnecting phone gets the current state resent whole, the same as
UFO Hunt's own fully-public frame (`tap-tap-music.md`-style private resend
has nothing to do here) — there is nothing this player is owed that anyone
else was not already sent.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A still-in player never taps during waiting | Assigned a random still-standing barn at the 5 s deadline — not safe by default; hiding nowhere is a real risk, the same as anyone else's pick |
| That random assignment happens to be the target | Abducted, exactly as if they had chosen it themselves |
| Two or more players end up at the same barn, and it is hit | All of them are abducted together |
| Every still-in player ends up at the same barn, and it is hit | Everyone still in is eliminated at once — the match ends that round with no winner (§2.2) |
| Only one cow is left in after a round resolves | The match ends immediately; that cow is the winner |
| An abducted player tries to pick again | Ignored — an out player can no longer send a pick, and does not block the next waiting phase from advancing early (§2.2) |
| A player joins mid-match | Starts at 0 points, not yet out; plays whichever round is currently in progress when they arrive, same as anyone else already there |
| A player leaves mid-match | Their last pick, score and in/out status stand; the match is not tied to the roster it started with (unlike Pass the Bomb — nothing here needs "the same people" to keep meaning) |
| The round that would eliminate the last two (or, solo, the last) cow(s) at once | Match ends with no winner — the shared `GameOverScreen` shows no winner, same convention as every safety-cap tie elsewhere in this catalogue |
| Only one barn is left standing when a new round would open | No round opens — `phase` goes to `'fleeing'` instead (§2.1, §4), and the match ends with no winner two seconds later |
| Fewer than 2 players (not solo) | Start disabled |

## 8. Anti-cheat

- **The target barn is the referee's own draw**, made from nothing a client
  ever sent — a modified client cannot predict or influence it. It is drawn
  the instant a round's waiting phase opens rather than at its deadline,
  but that timing choice changes nothing observable: the wire's own
  `target` field is forced back to `null` for as long as `phase ===
  'waiting'` or `'countdown'` (`toState` in `worker/abductMoo.ts`), so no
  client, honest or not, ever sees it early.
- **A pick is only ever recorded from `abduct-pick` while `phase ===
  'waiting'` or `'countdown'`**, for a barn that is not already destroyed,
  from a player not already `out` — a message that arrives after the
  reveal, for a stale `roundId`/`round`, naming a wrecked barn, or sent by
  an eliminated player is ignored, exactly like every other game's
  stale-input guard. The client also disables tapping a destroyed barn and
  hides its own pick controls once out, but the referee does not depend on
  either.
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

- Own-cow versus everyone-else is opacity alone (100% vs. 70%) — a deliberate
  simplification the maintainer asked for directly, dropping this spec's
  earlier second cue (a ring around your own cow). Worth revisiting if a
  display or a viewer that flattens the opacity difference turns out to
  need one back.
- The reveal's outcome (abducted vs. safe) is read from the score ticking
  up and the cow visibly leaving the board, not from colour — a cow that is
  gone is gone, on any screen.
- The waiting, countdown and fleeing banners are all read text (*"Hide your
  cow behind a barn!"*, then the "3, 2, 1" digit, then *"So Long, and
  Thanks for All the Fish"*), not an icon or a ring alone — a screen
  reader gets the same warning, or the same news that the match is over,
  a sighted player does, and the number updates in place rather than being
  announced as a wall of separate live-region updates. A player who is out
  gets their own explanatory sentence in the same spot during waiting and
  countdown, so nobody eliminated is left listening to instructions that
  no longer apply to them.
- No strobing, no flashing. The light cone is a soft fade in and out,
  respecting `prefers-reduced-motion` the same way every other game's
  decorative motion does.

## 12. Open questions

- ~~One pick per round, not several~~ — **resolved.** A follow-up message
  ("let's clarify the timing") confirmed persistent, whole-match barn
  destruction (§2.1) over a shrinking-barn elimination loop inside each
  round: the UFO draws once per round, from whichever barns still stand.
- ~~Flat, equal scoring, no elimination~~ — **resolved, reversed.** A later
  message asked for permanent elimination: getting abducted is now out for
  the rest of the match (§2.2), and the match itself ends by last cow
  standing rather than by a fixed round count. The +1-per-survived-round
  score still exists and is shown, but it no longer decides the winner.
- ~~The forced final round~~ — **resolved.** With destruction unconditional
  and no fixed round cap, the round that would take the fifth and last barn
  would have forced everyone still in onto it — a decided outcome played
  out for nothing. A later message asked for the UFO to give up instead:
  `phase: 'fleeing'` (§2, §2.1, §4) replaces that round, so the match now
  always ends by elimination or by the UFO leaving, never by a barn count
  hitting zero.
- **A single winner, not the brief's original plural "winners."** The
  original brief said "winners of the round are the ones with most points"
  — plural, allowing co-winners; that framing no longer applies now that
  the match ends by elimination. The shared `GameOverScreen`
  (`core/ui/GameOver.tsx`) only ever shows one winner or none, by
  deliberate house design ("one shape now"), which lines up naturally with
  last-one-standing: `null` only when the last two (or, solo, the last one)
  go together in the same round.
- **Exact timing** (`ABDUCT_WAIT_MS = 5000`, `ABDUCT_COUNTDOWN_MS = 3000`,
  `ABDUCT_REVEAL_MS = 5000`, and the reveal's own internal split — a 2 s
  fast hover, a 0.7 s transit, the rest for a staggered abduction) — the
  waiting window's 5 s cap and the "3, 2, 1" countdown are this round's own
  numbers; the hover and transit durations are the "clarify the timing"
  message's own numbers; the total reveal window and the stagger between
  each abducted cow are this session's best guess at "long enough for an
  8-cow pileup to read clearly," untested on a real phone. A very crowded
  single barn (up to 8 cows, one per player at the maximum room size) may
  still have its rise animation cut short by the round advancing — the
  outcome itself is never in doubt by then (§2), only how much of the
  flourish is seen.
- ~~Cow and barn art~~ — **resolved.** Originally hand-drawn SVG, since this
  session cannot produce polished raster art on its own; the maintainer then
  supplied the real pixel-art PNGs (`art/cow.png`, `art/barn.png`) directly,
  used exactly as given — loaded through an `<img>` like any other gameplay
  sprite, sized by CSS `width` percentages, nothing redrawn or regenerated.
  The UFO alone is still the SVG copy of `ufo-hunt/art/ufo.svg`.
- ~~Game name~~ — **resolved.** Renamed from Abduct-Moo to Aliens love cows,
  per direct instruction: the title, slug (`abduct-moo` → `aliens-love-cows`),
  this spec's own file name, the client folder and page, and the worker
  referee module's file name all moved to match. Left as-is, deliberately,
  same reasoning as the Tap Tap Music rename before it: the `AbductState`/
  `Abduct` type names, the `ABDUCT_*` constants, the `abduct`/`abduct-pick`
  wire message types, and the `.abduct__*` CSS class prefix — internal
  identifiers nobody outside this codebase ever sees, and renaming them would
  touch a dozen more call sites for no user-facing benefit.
- ~~Hub card art~~ — **resolved.** The hub card's illustration (§4's header
  table) now embeds base64 crops of the real `art/barn.png` and `art/cow.png`
  directly into `art/card.svg`, in place of the hand-drawn barn and cow paths
  it shipped with — the UFO, its cone, the stars and the ground are still
  fresh vector paths. Per direct instruction ("hub's card should reuse actual
  art") and the same reasoning Tap Fighter's own card exception already
  established (docs/design/illustrations.md): a hand-drawn approximation of
  authored pixel art reads worse than the real thing at hub-card size.
