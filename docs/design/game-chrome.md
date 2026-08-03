# In-game chrome

Rules that apply to **every** game, so a player who learns one learns all of
them. Code: `www/src/core/ui/`.

## 1. One source for the rules

Each game's registry entry carries `rules: string[]` — two or three sentences,
each under about 60 characters.

That array is rendered in **three** places:

| Where | Component |
| --- | --- |
| The lobby, before anyone starts | the game's room screen |
| A four-second panel at the top of every round | `RulesPanel` |
| The in-game menu, any time | `GameMenu` |

**Never retype the text in any of them.** If the lobby and the game disagree
about how to play, one of them is lying to the player, and there is no way to
tell which from the outside. The array is the fix, not a convention to remember.

Keep the bullets short enough to read inside the panel's four seconds. That
constraint is the reason for the length limit, not neatness.

## 2. The gear

Every game shows a gear in the **same corner**, opening a bottom sheet that
always contains:

- **How to play** — the rules array.
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

## 3. The pre-round window

`PREROUND_MS` (4 s) after a round starts, the rules panel holds the screen.

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

- The panel is mounted **keyed on the round id**, so "Play again" always shows a
  fresh one instead of reusing a dismissed one.
- The countdown is **clamped to `PREROUND_MS`**. `startsAt` is the server's clock
  plus four seconds, and the client's estimate of the offset can sit a few tens
  of milliseconds behind — enough for a four-second wait to open by announcing
  "5".

## 4. Opponent rows

Where a game shows a row of buttons for the other players, it is captioned:
Spill's is **Throw at**, Goat Siege's is **Attack**. The row means the same
thing in both, so `.aimbar__label` is shared rather than styled twice.

These rows are also the accessibility path for anything whose primary input is a
gesture (Spill's flick), per the fallback rule in
[ui-guidelines.md](ui-guidelines.md) — so they are always present, never behind
a setting.
