# 100 Taps

> Status: **live**.
>
> **A window of ten was added on 2026-08-25.** The board still shows every
> number all the time — that has not changed — but a tap only lands inside
> the next ten cells due (§2.3); everything else is a real disabled button.
> The original design deliberately shipped with no window at all (§2.1's
> reasoning still explains why the board hides nothing); this narrows what a
> tap can *reach*, not what a player can *see*.

| | |
| --- | --- |
| **Slug** | `hundred-taps` |
| **Catchy sentence** | *Find them in order. Fastest fingers win* |
| **Illustration** | `www/src/games/hundred-taps/art/card.svg` — a small grid of circles coloured in a gradient from pink to violet, three bearing digits |
| **Players** | 2–8 |
| **Round length** | 30 s – 2 min for a clean run; a rough one runs longer, capped at 3 min (§7) |
| **Inputs** | touch |
| **Accent colour** | `#7C3AED` |
| **Status** | live |

## 1. Pitch

A hundred numbered circles, 1 to 100, shuffled onto a 10×10 grid — **every
one of them visible from the start.** No lighting, no reveal: the board is
the puzzle. Tap 1, then 2, then 3, scanning the grid each time to find the
next one, wherever it landed. Only the next ten due are ever tappable at once (§2.3) — cleared cells and
everything further ahead are visible but locked, so a search stays bounded
even though the whole board is on screen. Tap the wrong one of those ten —
due later, but not yet — and you fall back to your last checkpoint of ten
(§2.2), the same forgiving rule Tap Tap Music built for its own version of
this mistake.

Each correct tap rings a note a little higher than the last, starting low
and hollow. There is no score, just a clock — and whoever clears all 100
first.

## 2. Core loop

1. Host starts the round. The referee shuffles the 100 grid cells once —
   the same shared, server-dealt `order` Tap Tap Music and Squash Mosquitoes
   both use (spec references below) — and assigns cell `order[k]` the number
   `k + 1`. Every player sees the identical layout.
2. All 100 numbers are printed on their cells and visible immediately.
   Nothing is hidden and nothing needs to light up: the player already knows
   what number comes next (their own cleared count, plus one) — the task is
   finding *where* it is.
3. **Only the next ten numbers due are tappable at once** (§2.3) — the rest
   of the board is printed and visible but locked. Tap the cell showing the
   next number in order. It goes **gone** (hollowed out), your cleared count
   advances by one, the window slides forward by one to keep ten enabled,
   and a note plays a little higher than the last (§5b).
4. **Tap any other cell inside that window of ten — one still ahead, but not
   yet due — and you fall back to your last checkpoint of ten (§2.2).**
   Exactly Tap Tap Music's rule, reused rather than reinvented. A cell
   outside the window cannot be tapped at all — it does nothing, not even a
   miss — until progress reaches it and it enters the window itself. Nobody
   else's board is touched.
5. Clear all 100 and the clock stops. First to finish wins.

**Win condition:** first player to clear all 100 cells, in order.
**Scoring:** none — see §12 for why a "no score" game still shows a live
scoreboard, and what it shows instead.

### 2.1 Why this is simpler than Tap Tap Music, not a reduced copy of it

Tap Tap Music lights five cells at once because its board hides the order —
nothing on screen says which cell is next, so the game has to show a live
window of valid targets or a player would have no way to find one. 100
Taps' board hides nothing: every number is printed and visible everywhere,
gone or not, so the player already knows exactly what to look for — the
*window* here (§2.3) limits which cells a tap can land on, not what a player
can see. **Only the single cell showing `cleared + 1` is ever a correct
tap** — everything else in the window, cleared or not, is a miss, and
everything outside it cannot be tapped at all. The shared, server-dealt
`order` array is reused unchanged from Tap Tap Music (`shared/protocol.ts`,
`taptap`/`tap-tap-music.md` §2.1) — only its *meaning* changes, from "the
hidden sequence to reveal" to "which grid cell holds which printed number."

### 2.2 A miss costs the streak back to the last checkpoint of ten

Identical rule to Tap Tap Music's own (`tap-tap-music.md` §2.2), reused
rather than redesigned: a wrong tap rewinds a player's own cleared count to
`Math.floor(clearedCount / 10) * 10` — the last multiple of ten crossed,
never further back. A miss is a real cost — up to nine correct taps undone —
but never a full reset. See that spec's §2.2 for the fuller reasoning; it
carries over here unchanged.

### 2.3 The window: only the next ten are tappable

Every number is visible for the whole round, but a tap only lands on one of
the next `TAPS100_WINDOW_SIZE = 10` cells due, in shuffle order — the ten
cells `order[progress .. progress + 9]`, where `progress` is this player's
own cleared count. Everything before that (already gone) and everything
after it (not due for a while) is a real disabled control: a stray tap there
does nothing at all, not even a checkpoint-costing miss.

This is a **client-side interaction limit, not a new correctness rule** —
the referee still only ever accepts `order[cleared.length]` exactly as it
always did (§8); the window only narrows what a phone lets a finger *reach*.
It turns the task from "scan the whole grid for one number" into "scan a
grid that mostly shows locked circles, with one right answer somewhere among
ten live ones" — bounding the search without hiding anything, which is the
one thing this game's whole pitch (§1) says it will never do. The window
slides forward exactly one cell per correct tap, and a checkpoint rewind
(§2.2) slides it back with the cleared count it is computed from — nothing
extra to keep in sync.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `classic` | The loop above — a miss rewinds to the last checkpoint of ten | baseline |

Only `classic` at launch.

## 4. Screens

- **Lobby**: shared template. No host setting beyond `mode`.
- **Round**: a timeline strip above a 10×10 grid of numbered circles,
  portrait, same layout shape as Tap Tap Music's board
  (`tap-tap-music.md` §4). Each cell's fill is computed from its grid
  position along the diagonal from pink (top-right corner) to violet
  (bottom-left corner) — decoration, not a state signal (§11) — and every
  cell always shows its own printed number. Three visual states, never
  colour alone: **live** (full opacity, number visible, gradient fill,
  tappable — one of the next ten due, §2.3), **locked** (dimmer, number
  still legible, a real disabled control — everything outside that window),
  and **gone** (hollow, faded, number still legible, also disabled — spec
  §7). The status bar shows cells remaining and the running clock in
  `SS.CC`.
- **The timeline**: the same hundred-mark strip Tap Tap Music draws
  (`tap-tap-music.md` §4) — one mark per grid cell in shuffle order, every
  tenth a little larger for the checkpoint, a reached mark turning green and
  pulsing once, a checkpoint rewind reverting every mark past the landing
  point at once. Reused unchanged.
- **Results**: winner, and everyone's finish time in `SS.CC`, or their
  remaining count for whoever the safety cap caught mid-board.

## 5. Inputs & sensors

Touch only — a tap on a cell. No sensors, no permissions, no fallback
needed because there is nothing to fall back from.

### 5b. One note per tap, rising in pitch — no music track

Unlike Tap Tap Music, there is no fixed melody to reuse or write: **pitch is
a formula, not a lookup.** The note for tap index `i` (0-based, `i =
clearedCount` at the moment of a correct tap) is computed as a low base
frequency raised by a small, constant number of semitones per tap, so the
run climbs smoothly from a low, hollow opening note toward a noticeably
higher one by the 100th. Instrument voicing aims for "hollow crystal" —
short attack, quick decay, low sustain, a bell-like partial mix — tuned by
ear during implementation rather than fixed here (see §12).

Because pitch is computed straight from `clearedCount` rather than advanced
by an independent counter, a checkpoint rewind (§2.2) naturally drops the
next note back down with it — no special-casing needed, the same "index by
position, not by a running count" principle Tap Tap Music's own `melody.ts`
already documents.

No scrubbing or catch-up machinery is needed either: unlike Tap Tap Music
(whose melody can be longer than the board and needs a `finish()` tail), a
tap here plays exactly one note at the moment it happens. A short fixed
victory flourish, above the final pitch, plays once on finishing.

## 6. Networking

Same message shapes as Tap Tap Music (`tap-tap-music.md` §6), renamed:

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `taps100-tap` | client → server | `{roundId, cell}` | A finger landed on grid cell `cell` |
| `taps100` | server → both | `{roundId, order, remaining: Record<PlayerId, number>, finishedAt: Record<PlayerId, number \| null>, winner, phase}` | The shared, public half — `order` doubles as the number-to-cell layout everyone already sees on screen |
| `taps100-progress` | server → **one player only** | `{roundId, cleared: number[]}` | This player's own cleared cells, in the order they actually tapped them |

Sending the full `order` publicly is not a new exposure here the way it
might look: Tap Tap Music already sends it in the clear (its board just
never draws it as numbers), and in 100 Taps the numbers are printed on
screen for everyone anyway — there is nothing left to keep off the wire that
isn't already visible to the human playing.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Removed from the standings; everyone else's board is untouched |
| Everyone still in when the 3-minute safety cap hits | Ranked by cells remaining, fewest first; a tie in remaining is unranked between those players |
| A tap lands on a cell inside the window of ten that is not the exact next one | A miss — rewinds to the last checkpoint (§2.2) |
| A tap lands on a cell outside the window (already gone, or not due for a while) | Nothing — that cell is a disabled control, not reachable by a tap at all (§2.3) |
| Two players finish in the same tick | The referee's own clock breaks the tie |
| Fewer than 2 players | Start disabled |
| A player refreshes mid-round | Same seat, same cleared history — a refresh does not reset the board |

## 8. Anti-cheat

Same posture as Tap Tap Music (`tap-tap-music.md` §8):

- **The order is dealt server-side**, from the referee's own random source.
- **Every tap is checked against the referee's own stored cleared count for
  that player** (`cell === order[cleared.length]`) — a modified client
  cannot claim to be further along or to have survived a miss it did not.
- **Finish time is the server's clock.**
- The board being fully visible removes any "hidden information" concern
  Tap Tap Music's window mechanic has to manage — there is nothing here a
  client could infer that it doesn't already see drawn on screen.
- **The window of ten (§2.3) is enforced by the disabled attribute on an
  honest client, and nowhere else.** The referee's own rule is still just
  `cell === order[cleared.length]`; it does not check window membership at
  all, so a modified client sending `taps100-tap` for a locked cell is
  scored exactly the same as one for a cell inside the window — a miss,
  rewound to the last checkpoint. There is nothing to cheat by bypassing the
  window: every cell a bypass could reach was already a legal (if usually
  wrong) target before this rule existed.

## 9. Safety

Lowest-risk category in the catalogue, same as Tap Tap Music: seated, both
thumbs, nothing thrown or swung. No safety copy beyond the shared baseline.

## 10. Data & privacy

Leaves the phone: which cell was tapped, per tap; player id, name, avatar.
Never a cleared history — that is the referee's to send back. Room memory
only, for the life of the round.

## 11. Accessibility

- Cells never rely on colour alone for their state: live, locked and gone
  differ by opacity and outline style, and — unlike Tap Tap Music — every
  cell always shows its own printed number regardless of state, so the
  pink-to-violet gradient is pure decoration a player never has to read to
  play correctly.
- A locked cell (§2.3) is a real `disabled` button, not a styled-only look —
  it is unreachable by keyboard focus and announced as disabled, the same
  as a gone one; screen-reader and switch-access users get the narrowed
  search for free rather than having to infer it from opacity.
- No strobing, no flashing. The timeline's pulse-once animation respects
  `prefers-reduced-motion`.
- Same fine-motor-precision caveat Tap Tap Music's own §11 names honestly,
  and the same mitigation: the checkpoint rule caps a miss's cost at nine
  cells, never the whole board. The window (§2.3) narrows it further still —
  a stray tap has at most nine wrong targets within reach, not ninety-nine.
- The clock and remaining-count are both numbers, never a bar or ring alone.

## 12. Open questions

- **Exact pitch curve and instrument voicing** — base frequency, semitone
  step per tap, and the FM/oscillator settings for "hollow crystal" are a
  by-ear tuning pass during implementation, not fixed by this spec.
- **Exact gradient hex endpoints** — `#FF6FCF` (pink) → `#7C3AED` (violet)
  are a starting proposal, chosen to be distinct from every other game's
  accent colour; adjustable by eye once the grid renders.
- **Is `TAPS100_WINDOW_SIZE = 10` the right width?** A first version shipped
  with every cell tappable and no window at all (§2.1's original reasoning);
  ten is a starting number for how large a "scan and find" search should be
  bounded to, chosen because it lines up with the checkpoint size (§2.2), not
  measured against real thumbs. Untested whether ten reads as generous or
  stingy at speed.
- **Should the grid position itself be independent of the gradient's visual
  reading?** A player scanning for "pink" vs "violet" numbers might develop
  a spatial shortcut the shuffle doesn't intend to teach — worth watching
  in a real playtest.
