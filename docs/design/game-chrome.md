# In-game chrome

Rules that apply to **every** game, so a player who learns one learns all of
them. Code: `www/src/core/ui/` and `www/src/lobby/`.

## 1. The lobby template

**Every game's lobby is `lobby/GameLobby.tsx`.** The panels and their order are
fixed:

1. **Title and tagline** — the title, then the game's `pitch` verbatim.
2. **How to play** — the concept, then the bullets (§2).
3. **Room code** — the code, share link, QR.
4. **Players** — the list, plus your own avatar picker.
5. **Start** — the button and one line of context.

A game customises it only through slots:

| Slot | Where it lands | Used by |
| --- | --- | --- |
| `aside` | inside how-to-play, after the bullets | Spill's table diagram and its no-liquids note |
| `standings` | above the players | Spill, Goat Siege |
| `extras` | below the players | Spill's theme picker |

**A slot can never reorder or replace a panel.** If a game needs something the
template cannot express, change the template for everyone rather than
special-casing one game — that is the entire point. Before this existed each
game had drifted into its own arrangement of the same pieces, so learning your
way around one lobby taught you nothing about the next.

Panels share one `.panel` class for the same reason.

## 2. One source for how to play

Each game's registry entry carries:

- `concept: string` — the one idea the game turns on, in a sentence.
- `rules: string[]` — two or three sentences, each under about 60 characters.

`concept` is **not** the pitch. The pitch sells the game on the hub; the concept
explains the thing you have to *understand* to play it well, and it leads the
bullets because a player who grasps "shooing is not free" can work out the
mechanics, while one who only memorised the taps often cannot.

Both are rendered by the shared `HowToPlay` component in **three** places:

| Where | Component |
| --- | --- |
| The lobby, before anyone starts | `GameLobby` |
| A four-second panel at the top of the **first** round (§4) | `RulesPanel` |
| The in-game menu, any time | `GameMenu` |

**Never retype the text in any of them.** If the lobby and the game disagree
about how to play, one of them is lying to the player, and there is no way to
tell which from the outside. One array plus one component is the fix, not a
convention to remember.

Keep the bullets short enough to read inside the panel's four seconds. That
constraint is the reason for the length limit, not neatness.

## 3. The gear

Every game shows a gear in the **same corner**, opening a bottom sheet that
always contains:

- **How to play** — the concept and the bullets, via the same `HowToPlay`
  component the lobby and the pre-round panel use (§2).
- **Leave game** — a real `<a href="/">`, not a router call, because leaving the
  page is what drops the socket and frees the seat.

A game may add anything else through `children`; Spill puts its table diagram
and theme picker there. Nothing else may be *required*, because the two items
above are what a lost player is looking for.

Placement notes learned the hard way:

- The sheet must not be full-screen. Seeing the board behind it is what makes it
  read as a pause rather than as having left the game.
- The gear sits **outside** any full-screen tap target. On Tap Duel the whole
  viewport is the target, so opening the menu inside it would score as a tap and
  burn the round.
- The HUD that hosts the gear needs a **higher z-index than the other rows**.
  The sheet opens inside the HUD, and `isolation: isolate` (used for the
  scrim) traps its z-index there — level with the button rows, they paint over
  the open sheet.
- Scrims behind a HUD use `isolation: isolate` plus a negative-z pseudo-element,
  **not** a blanket `.hud > * { position: relative }`. That selector also hits
  the menu, which needs `position: fixed`; the two have equal specificity, so
  whichever stylesheet loaded last won and the sheet rendered in the wrong
  place.

## 4. The pre-round window

`PREROUND_MS` (4 s) after the **first** round of a room starts, the rules panel
holds the screen.

**"Play again" gets no panel — and no window either.** Everyone has just read the
rules and played a round of the thing; being told again is four seconds of delay
right when the room is keenest to go again. `preroundFor(roundId)` in the protocol
returns the window length, and it is zero for every round after the first.

That it is the *window* that collapses, not just the panel, is the point. Hiding
the panel over a live-looking board that still rejects input would be strictly
worse than the panel: four silent seconds, with nothing to explain them. One
number decides both, so the client's panel and the server's input gate cannot
disagree.

**It is a real window, not decoration.** The server knows about it:

| Game | How it is enforced |
| --- | --- |
| Spill | `onFling` rejects anything before `startsAt` |
| Goat Siege | `onLob` rejects anything before `startsAt` |
| Tap Duel | `fireAt` is pushed past `startsAt`, so the signal cannot fire behind the panel |

A window only the client respected would be a head start for anyone who skipped
it. Tap Duel is the sharpest case: a signal fired behind a covering panel costs
you the round through no fault of your own, so the server moves the signal
rather than the client hiding the panel early.

Two details:

- The panel is mounted **keyed on the round id**, so a fresh round never reuses a
  dismissed panel.
- The countdown is **clamped to `PREROUND_MS`**. `startsAt` is the server's clock
  plus four seconds, and the client's estimate of the offset can sit a few tens
  of milliseconds behind — enough for a four-second wait to open by announcing
  "5". The same slack is why a window shorter than `MIN_PANEL_MS` renders nothing
  at all: a replay's zero-length window must not flash a panel for one frame.

## 5. Opponent rows

Where a game shows a row of buttons for the other players, it is captioned:
Spill's is **Throw at**, Goat Siege's is **Attack**. The row means the same
thing in both, so `.aimbar__label` is shared rather than styled twice.

These rows are also the accessibility path for anything whose primary input is a
gesture (Spill's flick), per the fallback rule in
[ui-guidelines.md](ui-guidelines.md) — so they are always present, never behind
a setting.

## 6. Everyone else's score

Every game in the catalogue is a race against the other players, so every game
needs the same glance: *how am I doing against them?* One component,
`core/ui/OpponentScores.tsx`, along the top of the board.

| | |
| --- | --- |
| Where | Top of the screen, directly under the player's own number, inside the game's HUD scrim |
| Shows | Avatar, name, score — one entry per **other** player |
| Hides | Itself entirely when there are no opponents, so a spectator gets no empty strip |
| Out of the round | Dimmed **and** struck through, never colour alone (ui-guidelines §7) |
| The unit | Named once for the row ("pucks", "cabbages"), not repeated per player |

Shared rather than per-game for the same reason as the gear and the rules panel:
the first attempt at this was written separately in each game and drifted into
three different shapes. It also means the game's own number and the opponents'
are laid out the same way everywhere — own score large on the left, gear on the
right, opponents small underneath.

The component takes plain data, not a game state, so nothing about it knows which
game it is in. A game maps its own state into `OpponentScore[]` **during render**
rather than mirroring it into component state on a timer — see
[../conventions/code-style.md](../conventions/code-style.md), and Sling Puck's
`view.theirs`, which was deleted when this shipped because two sources for one
number is how they come to disagree.

Enabled in **Sling Puck** and **Goat Siege**. Spill and Tap Duel still show their
own shapes; they should move to this when next touched.
