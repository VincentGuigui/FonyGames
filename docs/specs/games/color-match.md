# Color Match

> Status: **built, beta** ([issue #26](https://github.com/VincentGuigui/FonyGames/issues/26)).
> Approved as written on 2026-09-06, which settled §12 Q1: the miss threshold,
> the wheel's geometry and the multiplicative luminance model are the shipped
> design. The ladder is transcribed from the issue and turned into a table a
> machine can read; every number in §2.4 and §5b is still a proposal rather
> than a measurement, and Q2–Q6 are still open.

| | |
| --- | --- |
| **Slug** | `color-match` |
| **Catchy sentence** | *Match the colour. Three seconds. No second guesses* |
| **Illustration** | `www/src/games/color-match/art/card.svg` — a quartered colour wheel with a cursor sitting just off a bright magenta target swatch, a luminance slider down one side, and a pie timer nearly run out |
| **Players** | 1–8 |
| **Round length** | 9–19 s per level, by difficulty (§2.2) — a run ends when the ladder outruns the room |
| **Inputs** | touch |
| **Accent colour** | `#F472B6` |
| **Status** | built, beta — every number in §5b is still a guess |

## 1. Pitch

A colour appears. You have three seconds to find it on a wheel with your thumb,
and a luminance slider once the ladder gets serious. Then everyone's cursor
slides to where the answer actually was, and you find out how close you were.

It is the one game here that gets *harder every single level* rather than
faster: the palette starts at four colours a toddler could name and ends
somewhere no one can hold in their head. The run stops when the room stops
scoring, so a good room plays longer than a bad one — the ladder itself is the
opponent.

## 2. Core loop

The referee picks a colour, everyone tries to point at it, everyone finds out
how close they got. Then a harder one.

1. The referee picks a target colour for level *n* from that level's own
   palette (§2.3) and sends it to the room.
2. The target is displayed, big. A pie circle beside it drains over that
   level's own window — 3 seconds, or 10 once the brightness slider is live
   (§2.2). Answering early is worth more (§2.4).
3. Each player drags a cursor on the colour wheel — and, from rung 7 (level
   27), a second cursor on the brightness slider. The pick is whatever the cursors read
   when the pie empties. Not tapping is a pick of wherever the cursor already
   sat.
4. When the timer expires, the referee scores every pick against the target
   (§2.4) and reveals: the score won holds for `COLOR_SCORE_HOLD_MS`, then every
   cursor animates to the correct solution over `COLOR_SOLVE_MS`, then it holds
   for `COLOR_REVEAL_HOLD_MS`.
5. Level *n+1* starts automatically. No lobby, no tap to continue.

**Win condition:** highest total score when the run ends. A run ends when
**nobody in the room has scored a single point for three consecutive levels**
(`COLOR_BARREN_LEVELS`) — the ladder has left the room behind — or when
`COLOR_RUN_CAP_MS` is hit, whichever comes first.

**Scoring:** 0–100 per level, by distance from the target (§2.4). Solo (1
player) is a personal-best run against the ladder rather than a race.

### 2.1 Why the run ends on a barren streak rather than a level count

The ladder is unbounded by design (§2.3's last rung doubles forever), so
something has to stop it. Ending on "nobody scored three times running" makes
the stopping point a property of *the room* rather than a number in the
protocol: a room of people who can pick a colour plays deeper than one that
cannot, and everybody's run ends on the same level, which keeps the scoreboard
comparable. One player still scoring keeps the whole room in — that is
deliberate, and it is the only way the last two rungs of the ladder are ever
seen.

`COLOR_RUN_CAP_MS` exists for the case that is not fun: a room where one person
keeps scraping a single point forever. It is a safety cap, the same role
`TILES_ROUND_CAP_MS` plays in Tiles Surfer, not a design element.

### 2.2 A level's length follows its difficulty

The action window is tiered — `colorActionMs` — and the steps are where the
*task* gains something rather than at round numbers:

| Levels | Window | Why there |
| --- | --- | --- |
| 1–26 | **3 s** | Rungs 1–6: the answer is one tap on the wheel |
| 27+ | **10 s** | Rung 7 adds the brightness slider — a second control to work |

Three seconds is short on purpose (issue #38). Every level up to the slider is
a single tap, and the old 5 s / 10 s / 15 s left the pie draining with nothing
left to do; the reaction bonus in §2.4 is what makes a short window worth
*beating* rather than merely surviving. Ten seconds from rung 7 because two
controls have to be set, not one.

The boundary is **the level before the first rung with a slider**, not the number
in that first column: it is computed from the ladder, so a rung changing length
moves the tier with it. `colorActionMs` lives in `shared/color.ts` beside the
ladder for the same reason.

Plus a fixed 4 s tail on every level: `COLOR_SCORE_HOLD_MS` (2 s) +
`COLOR_SOLVE_MS` (1 s) + `COLOR_REVEAL_HOLD_MS` (1 s). So a level is 9 s at the
bottom of the ladder and 19 s at the top.

Every phase boundary is a server timestamp sent with the level, not a local
timer, so a phone that stutters catches up rather than drifting a level behind
the room (the pattern Tap Duel's `fireAt` and Tiles Surfer's spawn schedule
both use). The pie reads `colorActionMs` too, so the bar on screen cannot
disagree with the deadline being enforced.

### 2.3 The difficulty ladder

A rung is **three counts, one per axis of a colour**: how many hues around the
wheel, how many saturation rings, how many notches on the brightness slider.
Nothing else. Every count is a count of *steps*, so `sats: 1` is the outer ring
alone and `values: 1` is full brightness alone.

That shape is the fix for a real bug, and the reason it is stated first: the
rung used to be an RGB component grid (`components`/`splits`/`restSplits`),
which could produce a colour the wheel had no way to show. The disc is drawn at
full value, so `hsv(hue, sat, 1)` is everything a thumb can reach — and at
level 17 the randomiser dealt a dark green. **A rung now describes the wheel,
and the randomiser draws from the rung**, so the two cannot disagree.

Read as the min and max a component may take, which is how an eye reads it:

- `max(r, g, b) = 255 × value` — **value is how dark it may get.** One notch
  means max is always 255: no dark colours.
- `min(r, g, b) = 255 × value × (1 − sat)` — **saturation is how pale it may
  get.** One ring means min is always 0: no light colours.

Each rung declares **how many levels it lasts** rather than all being a flat
five, because two of them cannot be (§2.3c):

| Rung | Levels | Hues | Rings (sat) | Notches (value) | Slider |
| --- | --- | --- | --- | --- | --- |
| 1 | 1–3 | 3 | 1 | 1 | — |
| 2 | 4–6 | 6 | 1 | 1 | — |
| 3 | 7–11 | 12 | 1 | 1 | — |
| 4 | 12–16 | 24 | 1 | 1 | — |
| 5 | 17–21 | 36 | 1 | 1 | — |
| 6 | 22–26 | 36 | **2** | 1 | — |
| 7 | 27–31 | 36 | 2 | **2** | **yes** |
| 8 | 32–36 | 48 | 3 | 3 | yes |
| 9 | 37–41 | 60 | 4 | 4 | yes |

**One axis at a time, and in that order.** Up to level 21 the wheel is the
outer ring and nothing else: every target is a pure, fully saturated hue, and
getting better means telling 10° of hue apart. Rung 6 adds a pale ring inside
it — the first light colours. Rung 7 adds the slider, and only then can a
target be dark. Doubling the hue count keeps every hue of the rung before it,
so the ladder never takes a colour away.

The two floors are what keep the grid honest against §2.3d: `COLOR_SAT_MIN`
(0.25) is the palest ring, because `min` at value 1 crosses
`COLOR_WHITE_FLOOR` at s = 0.216; `COLOR_LUM_MIN` (0.4) is the dimmest notch,
because 255 × 0.25 is 64 and the value floor is 72. **No colour on any rung's
grid is extreme**, so `palette()` filters nothing and `paletteSize()` is
exactly `hues × sats`.

`RUNG_ENDS` is derived from those spans rather than written down, so a rung's
length and its boundary cannot disagree — and §2.2's timing tiers read it, so
shortening a rung moves them with it.

**Past the table the ladder is a formula, not a row**: every five levels
doubles the hues and adds one step to each of the other two.

```ts
const tier = Math.floor((level - COLOR_LADDER_END - 1) / 5) + 1;
const hues = Math.min(360, 60 * 2 ** tier);   // 120, 240, 360, 360…
const sats = Math.min(16, 4 + tier);
const values = Math.min(16, 4 + tier);
```

One hue per degree is where the circle runs out; sixteen steps on the other two
is where a thumb does. A run that gets there has already gone far beyond
anything §12 expects a person to score on.

### 2.3b A session never asks twice

**No colour comes up twice in one session**, with no exception — which took a
change to the ladder rather than to the rule. The referee keeps every target it
has dealt and `dealTarget` picks an unused one; §2.3c is the two rungs that had
to be shortened to make that always possible.

### 2.3c A rung may not outlast the colours it adds

The no-repeat rule and a flat five-level rung are incompatible at the top of
the ladder, and the arithmetic is worth writing down because the second case is
easy to miss:

- **Rung 1** is three hues: red, green, blue. Three colours, so five levels of
  it had to repeat twice.
- **Rung 2** doubles to six, adding yellow, cyan and magenta. Its *palette* is
  six, but three of those are rung 1's and already spent, so it too brings only
  three new ones. Counting palettes rather than what a rung newly offers hides
  this completely — it was caught by a test, after the first rung had already
  been fixed.
- **Rung 3** doubles again to twelve: six new over five levels. Every rung
  after it has more room still.

So rungs 1 and 2 last **three levels each** and the rest keep their five, which
makes the table 41 levels rather than 45.

`color.test.ts` asserts the *rule* — a rung's span is at most the number of
colours it adds that earlier rungs did not offer — rather than these figures,
so a rung later widened or shortened cannot quietly bring a repeat back. The
check counts what a rung can **deal**, not what its base palette holds: rung 7
keeps rung 6's palette and adds only a second brightness notch, so counting
bases alone would call it broken when it doubles the reachable colours.

`dealTarget` keeps its `repeat` flag for a caller that asks a rung for more
levels than it can serve. Nothing in the shipped ladder does.

### 2.3d Black and white are never targets

They are not colours to find on a wheel
— a black wedge is a hole in the middle of a rainbow — and they break the
scoring, being the two ends of the redmean axis: a near-black target makes
every dark colour a near miss and the level stops discriminating.

The test is **not** a distance to black, which cannot do the job: redmean puts
a dark red (64, 0, 0) and a very dark grey (32, 32, 32) at 0.122 and 0.125
normalised, so one threshold either keeps both or bans both. What separates
them is what a player sees, so `isExtreme` reads two things instead —
**value** (`max`, below `COLOR_VALUE_FLOOR` it reads as black at any
saturation) and **paleness** (`min`, above `COLOR_WHITE_FLOOR` there is not
enough colour left to tell from white). A mid grey, a dark navy and a proper
dark red all survive; black, white, (32, 32, 32) and a washed-out (224, 224,
224) do not.

It is judged on the colour **after** its luminance, not on the base: dimming is
what pushes a mid colour under the floor. `COLOR_LUM_MIN` moved from 0.25 to
0.4 for the same reason — 255 × 0.25 is 64, which the floor bans, and a slider
whose bottom notch is unpickable is worse than a shorter slider.

**Brightness** is a separate multiplier, not a fourth component: the target is
`base × lum`, where `base` is one of `palette(rung)` — a disc colour, at full
value — and `lum` is 1.0 until rung 7 and one of `valueSteps(rung.values)`
after it. Scaling all three channels moves HSV's value and leaves hue and
saturation alone, which is exactly what lets the disc own two axes and the
slider own the third — the pair a thumb can actually separate.

**The wheel shows exactly what the rung can produce, and nothing else.** At
level 1 that is three big sectors; at level 41 it is 60 hues on 4 rings and a
sector grid is meaningless. So the wheel has two presentations and switches
between them on a count, not on a level — see §4.2, and §12 Q2 for the part of
this that is genuinely unresolved. Either way `wheel.ts` reads the same two
grids the randomiser does, so **every target is reachable by construction**;
`wheel.test.ts` is where that is asserted, being the only test with both halves
in scope.

### 2.4 Distance, and what it is worth

Colour distance is **redmean**, the cheap weighted-RGB approximation — good
enough to rank near-misses the way an eye does, and no dependency (AGENTS.md
§3.3), which a real CIEDE2000 would be hard to justify for a party game:

```
r̄  = (r₁ + r₂) / 2
d  = √( (2 + r̄/256)·Δr² + 4·Δg² + (2 + (255−r̄)/256)·Δb² )
```

`d` maxes out at ≈ 765 (black against white), so the normalised distance is
`d / COLOR_D_MAX`. Score:

```
score = round(100 × max(0, 1 − dNorm / COLOR_MISS))
```

100 for an exact match, 0 at or beyond `COLOR_MISS`, linear between. **This is
the *accuracy*, not the score** (issue #38) — see the reaction bonus below. The
**threshold is flat rather than scaled to the rung**, which means the early
levels are all-or-nothing — the four starting colours are nowhere near each
other, so a wrong sector scores zero and a right one scores 100 — and the late
levels are where partial credit lives. That is the simpler rule and probably the
right one, but see §12 Q3.

### The reaction bonus: accuracy is not the score

**Points = accuracy × how fast that answer was settled** (issue #38). The
action window is cut into **five equal slices** and the slice the player's own
final answer landed in scales their accuracy:

| Slice of the window | Multiplier |
| --- | --- |
| first fifth | **+50%** |
| second fifth | **+20%** |
| middle fifth | **±0** |
| fourth fifth | **−25%** |
| last fifth | **−50%** |

Multiplicative rather than additive, so **a fast wrong answer still scores
nothing** and precision stays the thing being rewarded. Rounded once, at the
end, so the number on screen is the number added to the total.

Two consequences worth stating rather than discovering:

- **Speed can outweigh a large accuracy gap.** The spread is 1.5 against 0.5,
  so the crossover is a third: anything above **34 accuracy** taken in the
  first fifth beats a **bullseye** taken in the last. `shared/color.test.ts`
  pins that number, so moving the multipliers moves a test rather than
  quietly changing who wins.
- **Reaction time is the referee's own measurement**, from the level opening to
  the arrival of the answer it scored — never the `at` the payload carries. A
  payload cannot be trusted with the clock any more than with the score (§8),
  and lag is already forgiven by `COLOR_PICK_GRACE_MS`. A player who keeps
  adjusting is timed from their **last** answer, because that is the answer.

The phone shows **all three numbers**: the points, the accuracy they came from,
and the reaction time with the multiplier it earned. Without the breakdown a
slow bullseye and a fast near-miss look identical, which makes the bonus
invisible and the score arbitrary.

Both the distance and the ladder live in **`shared/color.ts`**, because the
referee scores and the phone previews, and a second copy of either is a second
thing to get wrong. Color Hunt (§[color-hunt.md](color-hunt.md)) uses the same
file for the same reason.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Everyone climbs the same ladder until the room runs out | baseline |

One mode. The ladder is the variation, and it is not a choice — a mode that
started at level 20 would be a different game with the same wheel, and §12 Q5
asks whether that is worth having later.

## 4. Screens

Lobby → round → results, with **no primer and no countdown**: there is no
sensor and no permission, so there is nothing to explain before the first
colour and nothing to wait for. The standard flow in
[../../multiplayer.md](../../multiplayer.md) otherwise applies.

### 4.1 The round screen

Top third, the **target**: a large filled rectangle in the target colour, with
the level number and the pie timer beside it. The pie is a drained arc rather
than a number, so it reads without being looked at.

Middle, the **wheel**: a disc filling the board's width, thumb-reachable at the
bottom of its own reach (AGENTS.md §4). The player's cursor is a ring, not a
dot — a dot in the colour you picked is invisible against the colour you picked.

Right edge, the **brightness slider**, hidden entirely until rung 7 (level 27)
rather than shown disabled: a control that does nothing for 26 levels teaches
the player to ignore it exactly when it starts to matter. It has one notch per
`rung.values`, so it can never offer a brightness the randomiser will not use.

Bottom, the **scores**: everyone's running total in the shared
`WideScoreboard`, full width, four players to a line. Not the corner panel the
rest of the catalogue uses — this board's bottom third is empty, and the scores
are worth the width rather than being furniture to tuck into a corner.

**The score shown is always this level's**, and there is nothing there before
it exists: a panel still reading 100 while a new colour is on screen is the
previous level's news pretending to be this one's. On reveal, every player's
cursor animates to the solution at once — including the other players', drawn
faintly. Seeing that four people all missed the same
way is most of this game's table talk, and it costs one extra field on the wire.

### 4.2 The wheel's two presentations

**One geometry, two ways of drawing it.** Hue runs around the disc and
saturation outward, always: ring `i` is `saturationSteps(rung.sats)[i]`, wedge
`j` is `hueSteps(rung.hues)[j]`, and each hue is *centred* on its own angle, so
red sits at twelve o'clock rather than starting there. Both presentations read
those two grids, which is what makes a dealt target reachable by construction
rather than by luck.

- **Sectors**, while `paletteSize(rung)` is at most `COLOR_SECTOR_MAX`: one
  wedge per colour, laid out ring by ring. Tapping a wedge picks that colour
  exactly, so an early level cannot be lost to a shaky thumb. On the shipped
  ladder this covers levels 1–21 — every pure-hue rung.
- **Continuous**, past that: the same disc drawn as a smooth hue sweep with one
  white band per saturation step over it (white at opacity `1 − s` over a pure
  hue *is* `hsv(h, s, 1)`, so a band paints exactly the saturation the hit test
  returns there). The cursor moves freely; what comes back is already on the
  grid, so what is shown is what is submitted.

A rung with a single saturation step gets no bands at all — which is the outer
ring and nothing else, and is why levels 1–21 can show neither a light colour
nor a dark one.

§12 Q2 is whether the switch reads as one control or as two.

## 5. Inputs & sensors

Touch only. One drag on the wheel, one on the slider, both plain pointer events
— no sensor, no permission, nothing from
[../../device-capabilities.md](../../device-capabilities.md) to request.

**Fallbacks:** not applicable, and that is worth stating rather than omitting.
This game asks for nothing, so it cannot be refused anything, and it is not a
candidate for the no-fallback branch of AGENTS.md §4.

### 5b Constants

Every one of these is a proposal. ⚖ marks the ones §12 expects to move.

| Constant | Value | Why |
| --- | --- | --- |
| `COLOR_ACTION_TIERS` | 3000 / 10000 | ⚖ The action window, by rung (§2.2). Was 5/10/15 until issue #38 |
| `COLOR_REACTION_MULTIPLIERS` | 1.5 / 1.2 / 1 / 0.75 / 0.5 | ⚖ One per fifth of the window (§2.4, issue #38) |
| `COLOR_SCORE_HOLD_MS` | 2000 | The issue's own two seconds of score |
| `COLOR_SOLVE_MS` | 1000 | The issue's own one-second cursor animation |
| `COLOR_REVEAL_HOLD_MS` | 1000 | The issue's own one-second hold |
| `COLOR_BARREN_LEVELS` | 3 | The issue's own rule: three scoreless levels ends the run |
| `COLOR_MISS` | 0.35 | ⚖ Normalised distance beyond which a pick is worth nothing. A complete guess |
| `COLOR_D_MAX` | 765 | Redmean's own maximum (§2.4). Not tunable — it is arithmetic |
| `COLOR_LUM_MIN` | 0.4 | The dimmest notch. Was 0.25, which put a single-channel colour under the black floor (§2.3d) |
| `COLOR_SAT_MIN` | 0.25 | The palest ring. `min(r,g,b)` at value 1 crosses the white floor at 0.216 (§2.3) |
| `COLOR_MAX_HUES` | 360 | One hue per degree — where the circle runs out, not a ceiling |
| `COLOR_MAX_STEPS` | 16 | ⚖ The cap on rings and notches, which is where a thumb runs out |
| `COLOR_VALUE_FLOOR` | 72 | ⚖ Below this `max(r,g,b)`, a colour reads as black and is never a target |
| `COLOR_WHITE_FLOOR` | 200 | ⚖ Above this `min(r,g,b)`, it reads as white and is never a target |
| `COLOR_SECTOR_MAX` | 64 | ⚖ Above this many reachable colours the wheel goes continuous (§4.2) |
| `COLOR_RUN_CAP_MS` | 600000 | Ten minutes. A safety cap, not a design element (§2.1) |
| `COLOR_MIN_PLAYERS` / `_MAX` | 1 / 8 | From `PLAYERS['color-match']` in `shared/players.ts` |

## 6. Networking

**The referee owns the level, the target and the scores.** The phone owns
nothing but its own cursor. This is the cheapest profile in
[../../multiplayer.md](../../multiplayer.md): one message down per level, one up
per player per level, and no per-frame traffic at all.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `color-level` | server → all | `{ roundId, level, target: [r,g,b], lum, palette, phase, picksDueAt, revealAt, endsAt }` | A new level, and every phase boundary as a server timestamp |
| `color-pick` | client → server | `{ roundId, level, rgb: [r,g,b], lum, at }` | This phone's pick. Last one before `picksDueAt` wins; later ones are dropped |
| `color-scores` | server → all | `{ roundId, level, solution, picks: {id: {rgb, lum, accuracy, reactionMs, score}}, totals, barren }` | What everybody picked, how close and how fast it was, what it was worth, and the running totals |

**Latency:** the phase boundaries are absolute server times rendered through
`client.now()`, so 100–300 ms of lag costs a player a sliver of their three
seconds and nothing else. A pick that arrives up to `COLOR_PICK_GRACE_MS` late
is still counted — the referee waits that long before scoring, the same grace
Tiles Surfer's own report window allows — so a slow phone loses points to its
own lag only when it is genuinely slow, not when it is merely far away.

## 7. Failure & edge cases

- **Player leaves mid-level**: their pick for the level in flight still counts
  if it arrived; they stop appearing on the ladder afterwards. Their total stays
  on the results screen, marked as gone, like every other game here.
- **Host leaves**: the referee reassigns the host and the ladder keeps
  climbing. Nothing about a level depends on who the host is.
- **Too few players**: one is enough — this is a 1-player-capable game. The
  lobby's start gate is `enoughToStart` with `[1, 8]`.
- **No pick at all**: scored as wherever the cursor sat. A player who never
  touches the screen scores whatever the default centre is worth, which is
  usually nothing, and that counts toward the barren streak like any other zero.
- **Backgrounded tab**: the phone misses the pick window and scores its last
  cursor position; on return it re-syncs to the current level from the next
  `color-level`, rather than replaying the ones it slept through.
- **Ties**: shared rank, unbroken. There is no tiebreak worth inventing for a
  score out of 100 per level over dozens of levels.
- **Everyone scores zero on one level**: normal, and the whole point of the
  barren counter. Only three *in a row* ends the run.

## 8. Anti-cheat

**The answer is on the screen, so a console can win this game.** That is a
property of the design, not an oversight: the target has to be displayed for
the game to exist, so a scripted pick is always perfect. The honest position is
the one Tap Duel's spec already takes about a macro'd tap — the stake is a
party score, and the defence is who you are playing with.

What the referee *does* enforce, because it is free:

- A pick is only accepted for the level currently in flight, with a matching
  `roundId`. A stale or guessed-ahead pick is dropped.
- One scored pick per player per level. Later ones replace earlier ones up to
  `picksDueAt`; nothing after `picksDueAt + COLOR_PICK_GRACE_MS` is read.
- Scores are computed **on the referee** from the payload's colour, never taken
  from the client. A phone claiming a score is ignored — it can only claim a
  colour.

## 9. Safety

Not applicable. No motion, no GPS, no walking around. This section stays in the
file rather than being deleted so that its absence is a statement.

**One accessibility-adjacent warning does belong on the card**, though, and it
is in §11 rather than here: this game cannot be played by a colour-blind player
on equal terms, and it says so before anybody joins.

## 10. Data & privacy

Three integers and a float per player per level — a colour and a luminance —
relayed within the room and dropped when the room ends. Nothing is stored. No
sensor is read at all, so [../../device-capabilities.md](../../device-capabilities.md)'s
"sensor readings never leave the room" rule has nothing to bite on here.

Totals reach the activity record only as the same bounded row every game
writes ([../analytics.md](../analytics.md) §1) — a visitor id, an optional
nickname, city/country. No colour ever appears in it.

## 11. Accessibility

- **Reduced motion**: the one-second cursor animation becomes a cut. The pie
  timer keeps draining — it is information, not decoration — but stops
  pulsing.
- **Low vision**: the target swatch is the largest element on the board by
  design, and the score is a number, not a colour. The cursor is a
  high-contrast ring with a white inner and a black outer stroke so it is
  visible against any colour underneath it, which is the same two-tone trick
  the reticle in Asteroid Race uses.
- **Colour blindness**: this is the hard one, and it cannot be adapted away —
  the mechanic *is* colour discrimination, so there is no accessible mode
  hiding inside it. The honest answer is the one AGENTS.md §4 asks for: say so
  plainly in the lobby, before anyone commits to a run, in the same voice the
  tilt-only games use to say who they exclude. Proposed copy:
  *"This one is pure colour matching — if you are colour-blind, it will not be
  a fair race."*
- **No sound**: nothing depends on sound. There is no audio in this game at all.

## 12. Open questions

Everything here needs a maintainer answer, and Q1 blocks the build.

1. ~~**Is the whole shape right?**~~ **Answered on 2026-09-06**: approved as
   written, so the flat threshold, the two-presentation wheel and the
   multiplicative luminance are the design rather than a proposal. Q2–Q6 below
   are untouched by that and still want a real thumb.
2. **Does the wheel's sector→continuous switch read as one control?** Levels
   1–30 are tap-a-wedge and 31+ are drag-and-snap. That may be a graceful
   ramp or it may feel like the game swapped its input out from under you at
   the exact moment it got hard. The alternative is continuous from level 1,
   which makes the four-colour rungs feel silly. Untestable on paper.
3. **Flat `COLOR_MISS`, or one scaled to the rung?** Flat means early levels
   are all-or-nothing and late levels are all partial credit. Scaled — a
   threshold of, say, one and a half quantisation steps — would make "one step
   off" worth the same everywhere and keep the score's meaning stable down the
   whole ladder. Flat is simpler; scaled is probably fairer.
4. **Are the three tiers right at the top of the ladder?** The window steps
   twice, but the search space grows by orders of magnitude. Either that is
   the difficulty working as intended, or the last rungs are unplayable for
   everyone at once and the barren rule ends every run at the same level
   regardless of the room, which would make §2.1's whole argument false.
5. **A mode that starts partway up?** Once a room knows it reliably dies at
   level 30, starting at 20 is a shorter game. Deliberately not specced as a
   mode yet (§3).
6. **1–8 or 2–8?** Specced as 1–8 because the ladder is a perfectly good solo
   score attack and costs nothing to allow, but the issue said "1 to 8" about a
   game whose fun is arguing about a colour with other people.

## 13. What was built, and what the tests pin

`shared/color.ts` holds the distance, the ladder and the palettes, because the
referee scores and the phone previews the same pick. Color Hunt reads the same
file (its §2.2).

- **`shared/color.test.ts`** (`npm run test:color`). The three axes, read both
  ways: one saturation step *is* `min(r,g,b) = 0`, one value step *is*
  `max(r,g,b) = 255`, so a rung with one of each can be neither light nor dark.
  The order light and dark arrive in, which is the report's own request. That
  every dealt target is a palette colour under one of the rung's own brightness
  notches — the rule the rewrite exists for. The past-41 formula and its two
  caps. That no grid colour is extreme, dimmed or not, so `palette()` needs no
  filter. And that a degenerate random source still deals rather than spinning:
  every draw is a clamped index, never a retry. It also holds the rung-span
  rule of §2.3c — asserted as a rule rather than as the numbers it currently
  produces, which is what caught rung 2 after rung 1 had already been fixed.
- **`worker/colorMatch.test.ts`, 69 checks** (`npm run test:color-match`).
  Everybody is scored at the same instant, so being early buys nothing; a later
  pick replaces an earlier one; the grace window admits a late pick and the
  millisecond past it does not; levels chain themselves with no lobby; the
  barren streak ends the run and one player scoring resets it for the room; and
  **no pick for the level in flight is ever in a broadcast**, which is the one
  thing standing between this game and a player reading the wire.
- **`www/src/games/color-match/wheel.test.ts`** (`npm run test:color-wheel`).
  Every colour a rung offers has a wedge, no two overlap, each ring closes the
  circle exactly, tapping a wedge picks the colour drawn there, and the
  continuous disc submits the colour it is showing. It is also the only test
  with the randomiser and the wheel both in scope, so **the reachability rule
  lives here**: for a spread of levels across both presentations, deal a
  target, ask `positionOf` where its base sits, and check that the hit test at
  that spot returns the same colour — and that the brightness it carries is a
  notch the slider has. A target the wheel cannot show is a level nobody can
  win, which is what a dark green at level 17 was.

The disc found a real bug before a player could: it was first drawn
with a linear gradient, which does not put a hue where the angle says it is, so
the colour under the thumb was not the colour that would have been picked. It
is 48 wedges of the same geometry `continuousAt` reads.

One rendering note worth keeping, since it cost an hour: the pie timer is
rotated with SVG's own `transform` attribute rather than CSS. Under
`transform-box: view-box` a CSS `transform-origin: center` resolves to (12, 12)
in user space rather than to this viewBox's centre at (0, 0), which swings the
arc clean off the circle — it renders, with the right dash and the right
stroke, somewhere nobody can see.
