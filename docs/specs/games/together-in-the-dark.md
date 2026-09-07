# Together in the Dark

| | |
| --- | --- |
| **Slug** | `together-in-the-dark` |
| **Catchy sentence** | *One match at a time, guide him out of the woods* |
| **Illustration** | `www/src/games/together-in-the-dark/art/card.svg` — a single match-lit circle in a black forest, one small figure inside it, shapes half-suggested at its edge |
| **Players** | 1–8, co-op |
| **Round length** | 2–3 min |
| **Inputs** | touch |
| **Accent colour** | `#F6B93B` |
| **Status** | 🎮 beta — built; the turn timer and the terrain-memory rule untested in a real room ([#20](https://github.com/VincentGuigui/FonyGames/issues/20)) |

## 1. Pitch

A forest at night, seen from above. One lost character, and a circle of light
barely wider than he is. On your turn you get **one** action: take a step, or
throw a light one cell to see what is there. Steps make progress and light
buys knowledge, and you can never have both — and it is the *team's* turn you
are spending, which is what makes the people not acting the loudest people in
the room.

The only co-op game in the catalogue, and the only one where waiting is the
good part.

## 2. Core loop

The character stands on a grid you cannot see. Players take turns. On your
turn you either walk him one cell, or throw a light one cell — a match, a
torch, a spell — which shows you that cell for this turn only and then goes
out. Get him to the escape before the forest gets him.

1. The referee rolls a map and **proves it finishable** before anyone sees it
   (§2.1). The character starts on it, the escape is somewhere within
   `DARK_PATH_STEPS` steps.
2. Turn order is join order. The current player's phone shows their two
   buttons; everyone else's shows whose turn it is and the same map.
3. **One action per turn**: `walk` N/E/S/W, or `light` N/E/S/W. Both reach
   exactly one cell.
4. A lit cell is revealed **for that turn**, and what it holds is announced to
   the whole room — this is a game about arguing, so information is shared the
   instant it exists.
5. **Lighting a monster wakes it.** From then on it walks toward the place it
   was lit (§2.2), one cell every `DARK_MONSTER_TURNS` (3) turns.
6. **Walking onto an unlit trap** springs it: the character is shoved back the
   way he came and the team loses that turn (§2.2).
7. The turn passes. A player who does nothing before `DARK_TURN_MS` has their
   turn spent on a **light in the direction of travel** rather than skipped —
   friendlier, and it never wastes the team's turn.
8. Reach the escape and everybody wins. Lose all `DARK_LIVES` (3) and
   everybody loses.

**Win condition:** the character reaches the escape. Co-op — the room wins or
loses together, there is no ranking.
**Scoring:** turns taken, and lives left. Shown on the results screen as a
record to beat, never as a per-player number: nobody's individual turn is
scored, because that would turn a discussion into a blame.

### 2.1 The map, and the guarantee

Grid of `DARK_COLS × DARK_ROWS`, rolled by the referee with its own
`random()`, exactly as Gravity Shooter rolls its board. It holds: the
character's start, the escape, fixed **traps**, and mobile **monsters**.

**The map is guaranteed finishable, and here that is a real guarantee.**
Gravity Shooter has to sample a fan of shots and settle for "probably
winnable" because its space is continuous; a grid is exact. A breadth-first
search either finds a path of at most `DARK_PATH_STEPS` cells from start to
escape touching no trap and no monster, or it does not — cheaply, and with
certainty. The referee re-rolls until it does.

Two honest limits on that guarantee, both worth writing down now:

- **It describes the map at roll time.** Once monsters wake and move they can
  block a route that was clear. A monster moving at a third of the character's
  speed can only truly seal a corridor one cell wide, so the roller
  additionally requires the guaranteed path to be **two cells wide wherever the
  geometry allows**; where it cannot be, the run can be lost by bad play, which
  is acceptable in a co-op game.
- **`DARK_PATH_STEPS` scales down with the player count.** A 15-step path plus
  a light for most steps is ~30 turns; at 8 players and 6–8 s of deliberation
  each that is a 3–5 minute round, past the catalogue's target. The path is 15
  steps at 1–2 players and shortens toward 9 at 8, so the round length is
  roughly flat in the size of the room.

### 2.2 What the dark does — the three rules the issue left open

**Explored terrain is remembered, dimly. Monsters never are.** A cell you have
lit stays on the map as a faded memory of *what kind of cell it was*; a monster
you saw is drawn where you saw it, greyed, and it may not be there any more.
Without memory the team just screenshots the screen, and a player who joins or
looks away loses everything the room has learned. With monster memory, the
danger becomes a solved map. Stale monster information that quietly became a
lie is the right kind of cruelty, and it makes re-lighting a corridor you
already know a real decision instead of a wasted turn.

**A woken monster walks toward the cell where it was lit, not where the
character currently is.** More forgiving, and much more interesting: it can be
*baited*. Light it, walk away, and let it trudge toward where you used to be. A
monster that reaches its target cell and finds nobody there goes back to sleep
after `DARK_MONSTER_PATIENCE` (2) turns — so the bait is a real play, not a
permanent removal.

**Contact and traps cost, they do not kill.** A monster reaching the
character's cell costs **one life** and shoves him one cell back the way he
came; the monster sleeps again. A trap costs the team **the turn** and one cell
of ground, no life. Instant death would make fifteen steps a minefield and a
three-minute round end in twelve seconds; a lost turn punishes walking blind
and keeps the round moving.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `relay` | Take turns. One action each | baseline |
| `blindfold` | Only the player on turn can see the light | The reveal goes to the current player alone, who has to describe it — the arguing becomes talking rather than looking |

**This game is turn-by-turn, and that is what distinguishes it from
[#18](https://github.com/VincentGuigui/FonyGames/issues/18)** (Escape
Labyrinth), which is a **voting** game: there, the whole room decides each
move together. Two different co-op mechanics on adjacent themes, and neither
is a mode of the other — one turn passes a *decision* around the room, the
other pools it. Voting belongs to #18 and is deliberately absent here; the
sequel to a turn here is a different player's turn, not a tally.

`blindfold` is this game's own second idea instead, and it stays inside the
turn structure: the same one action, seen by one person.

## 4. Screens

Standard flow. The primer is where the central dilemma is explained, because a
player who does not understand that light costs a turn will not understand the
game at all.

The round screen, portrait:

- **The map**, filling everything above the controls, the viewport following
  the character so the grid can be far larger than the screen with no zoom and
  no pan. Most of it is black.
- **The lit circle** — the character and one cell in every direction — is the
  only fully-drawn part. Remembered terrain is drawn at low opacity behind it.
- **Two rows of controls** at the bottom for the current player: a D-pad for
  `walk`, and the same D-pad in match-yellow for `light`. Everyone else sees
  the same footprint filled with whose turn it is, so the layout never jumps.
- **A turn log**, three lines, above the controls: *"Ana lit east — a trap"*.
  This is the shared memory the arguing runs on, and it is cheap.

The darkness is a **budget advantage**: most of the screen is black, so this
needs a fraction of the art of a game like Kitchen Sorter. A character, a
monster, a trap, a light, a few trees. Sprites are SVG ≤ 40 KB with
`width`/`height`/`viewBox`, a folder plus `import.meta.glob` for tree and
monster variants (the Goat Siege pattern), and **which variant appears comes
from the server's seed, never `Math.random()`**.

## 5. Inputs & sensors

Touch only. No sensors, no permissions, no fallbacks needed.

## 6. Networking

Profile A, and frames far under 1 KB. One intent per turn.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `dark-state` | server → all | `{ roundId, turn: id, turnEndsAt, at: {x,y}, lit: [{x,y,kind}], seen: [{x,y,kind}], lives, turns, escape?: {x,y} }` | Everything this room is allowed to know |
| `dark-act` | client → server | `{ roundId, turn, action: 'walk' \| 'light', dir: 'N'\|'E'\|'S'\|'W' }` | The current player's one action |
| `dark-over` | server → all | `{ roundId, won, turns, lives }` | The run ended |

**The one real architectural decision: broadcast only what is lit, never the
whole map.** Every other game here can broadcast its full state — Gravity
Shooter ships the entire board, because the board was never secret. Here the
hidden information *is* the game, so a modified client handed the full grid
just reads the fog and the game evaporates. `lit` is this turn's revealed
cells, `seen` is the dim terrain memory, and `escape` appears only once it has
been seen. Sending the visible subset is cheap and keeps the secret
server-side; it is much easier to get right from the start than to retrofit.

The referee owns the map, the character, the turn order, the turn deadline (on
the room's single alarm), monster state and the lives. Fully latency-tolerant:
one action per turn, and a turn is seconds long.

## 7. Failure & edge cases

- **Player leaves mid-round**: dropped from the turn order. If it was their
  turn, the deadline resolves it as an auto-light and play moves on.
- **Host leaves**: nothing special — the referee owns the round.
- **Everybody leaves but one**: the run continues as solo.
- **Solo (1 player)**: fully supported, and it turns the game into a puzzle
  rather than a social one. Worth having: almost nothing else in the catalogue
  has a single-player life of its own.
- **Backgrounded tab**: turns resolve on the referee's alarm, so a
  backgrounded phone's turn auto-lights rather than stalling the room.
- **A monster on the escape cell**: legal, and the roller allows it — the team
  can bait it away. Only the *guaranteed path* must be clear at roll time.
- **The character boxed in**: with `DARK_LIVES` still left this is survivable
  (contact shoves him back rather than killing), but a truly sealed corridor
  ends the run. The two-wide rule in §2.1 is what makes that rare.

## 8. Anti-cheat

This is a co-op game — there is nobody to cheat against, only the game to
spoil. The one exploit that matters is **reading the unlit map**, and §6 closes
it by never sending it. Beyond that:

- **An action from a player whose turn it is not is ignored.**
- **An action for a stale turn index is ignored**, so a double-tap cannot spend
  two turns.
- **The referee resolves the action**, so a client cannot claim to have walked
  two cells or lit a whole row.

## 9. Safety

Nothing to warn about. No motion, no walking about, no sound required.

## 10. Data & privacy

Nothing but the room's own game state crosses the wire, and it lives as long as
the room does.

## 11. Accessibility

- **Cell contents are shapes, not colours**: a trap and a monster differ in
  silhouette, so red/green vision does not change the game.
- **The turn log is the accessible version of the map** — every reveal is
  announced as text, so a low-vision player can follow the whole run through it
  and argue as well as anyone.
- **Reduced motion**: the light does not flicker and the viewport snaps rather
  than easing.
- **No timing pressure within a turn** beyond `DARK_TURN_MS`, which is
  generous and shown as a bar; and the auto-action is a light, which never
  wastes the team's turn.
- **Solo mode is the accessible mode** for anyone who needs to take their time,
  since nobody else is waiting.

## 12. Open questions

Five were open when this spec was written. Three are settled by the build; two
are genuinely room questions and stay open.

1. **`DARK_TURN_MS`** — built at **7 s**, between the 6 and the 8 the spec
   weighed. The round-length risk still lives here and it is the first thing to
   shorten if a real room of eight drags. What the build can say is that the
   deadline behaves: a run left completely alone auto-lights exactly once every
   7 s, measured in a browser rather than argued about.
2. **Does the dim terrain memory make it too easy?** Still open, and still the
   rule most likely to need tightening. Memory that fades after N turns is the
   obvious next thing to try, and nothing in the build makes that hard —
   `seen` is a map from cell to kind and a turn number beside each entry would
   do it.
3. ~~**`DARK_MONSTER_PATIENCE` and re-sleeping.**~~ **Settled at 2, and it
   sleeps again.** A monster that never sleeps makes lighting genuinely
   frightening, and it also makes one bad light permanently ruin a run — which
   in a co-op game is the same as ending it. Baiting one is now a real play,
   and the test drives a full wake-walk-wait-sleep cycle to prove the bait
   works.
4. ~~**Does `blindfold` earn its place?**~~ **Not built.** It needs the reveal
   addressed to one player rather than broadcast, which §6 correctly calls a
   real change rather than a flag — and the base loop already produces the
   arguing, which was the condition for cutting it. Declared in §3 and left
   there.
5. ~~**Whether the escape is visible from the start.**~~ **Settled: hidden.**
   It appears on the wire only once somebody has actually lit it, which is the
   tenser answer and the one that keeps `escape` out of a modified client's
   reach. The compass-arrow middle ground from the spec would cut a lot of
   aimless lighting and is the obvious thing to try if playtesting says the
   first two minutes are dull.

Three the build raised:

6. **The guarantee is verified, not trusted.** The roller builds a map to have
   a clear path and then re-derives it with a BFS that knows nothing about the
   construction; a roll that fails is thrown away. 200 maps across five room
   sizes are checked that way in `shared/darkMap.test.ts`. Worth knowing
   because it makes the *cost* of tightening the map generation almost zero.
7. **The unlit board is invisible, and that is intentional but untested.** An
   unlit cell is `#080b10` on `#05070a`, so the board's extent can barely be
   made out — which is right for a game about darkness and may read as a bug on
   a phone in daylight. The first thing to check outdoors.
8. **Trees are new.** The spec's map has traps and monsters; the build adds
   trees as scenery that blocks a step and costs only the turn, because a
   forest with nothing in it but hazards did not read as a forest. They are on
   the guarantee's blocked list, so a rolled map still has a way through.
