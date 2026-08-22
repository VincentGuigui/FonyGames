# Tic-Tac-Tic-Tac-Toe

| | |
| --- | --- |
| **Slug** | `tic-tac-tic-tac-toe` |
| **Catchy sentence** | *Win the little boards to conquer the big one* |
| **Illustration** | `www/src/games/tic-tac-tic-tac-toe/art/card.svg` — a 3×3 meta grid whose centre cell opens into a tiny X/O grid |
| **Players** | 2 (exactly) |
| **Round length** | 2–5 min, hard cap 5 min |
| **Inputs** | touch |
| **Accent colour** | `#F472B6` pink |
| **Status** | 📝 draft — awaiting approval |

## 1. Pitch

It is tic-tac-toe nested inside tic-tac-toe: win a small board to claim its
cell on the large board, then win three claimed cells in a row. The table sees
the whole meta board, while a short zoom makes the one small board being played
feel like the arena.

## 2. Core loop

The lobby shows the empty 3×3 meta board and all nine empty 3×3 small boards.
The host starts the match; the host is X and the other player is O. The player
whose turn it is to choose a small board selects any unresolved meta cell. The
screen zooms into that board, and the two players play ordinary alternating
tic-tac-toe there, with the chooser making the first move as X. When that small
board ends, it zooms back out and its meta cell becomes the small-board winner's
symbol. A drawn small board becomes closed and stays blank. The other player
chooses the next unresolved meta cell, and the loop repeats.

1. Choose an unresolved cell in the meta grid.
2. Zoom into its 3×3 board and alternate X/O taps.
3. Zoom out and claim the meta cell, or close it as a draw.
4. Hand meta-cell choice to the other player.
5. Continue until the meta board is won or has no unresolved cells.

**Win condition:** three claimed X or O meta cells in a row, column or diagonal
wins the match. If all nine small boards are closed without a meta line, the
match is a draw.
**Scoring:** none. There is one winner, one loser, or a draw — no points or
carry-over tally.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Nine little games, one big win | baseline |

Every mode shares the core loop. A mode that doesn't is a different game.

## 4. Screens

- **Lobby:** the shared `GameLobby`, with the nested-board illustration in the
  rules and a compact preview of the empty meta grid. Exactly two connected
  players are required. The normal ready gate applies before the first match;
  readiness persists for replay.
- **Meta choice:** the full meta grid is visible, with claimed cells marked X/O,
  drawn cells visibly closed, and the current chooser's name highlighted. Only
  unresolved cells are buttons for the chooser.
- **Small board:** the selected mini board zooms to the foreground. The other
  eight boards remain dimly visible behind it so the player never loses the
  match context. The active player's name and X/O mark are clear above the
  board; the nine cells are large touch targets.
- **Small-board result:** after the winning or draw tap is acknowledged, hold
  the result briefly, zoom back to the meta grid, stamp the cell, and hand
  selection to the other player. The transition is one server event so both
  phones zoom together.
- **Results:** the shared end screen names the meta winner or draw and shows the
  final meta grid. No score panel is shown.

The zoom is cosmetic and keyed to the server's `zoomAt` time. A reduced-motion
preference skips the animation but preserves the same state sequence.

## 5. Inputs & sensors

Touch only. No permission, sensor or fallback is needed. A tap outside the
current small board, on a closed meta cell, or by the wrong player is ignored.

## 6. Networking

The Worker is authoritative for the match phase, meta board, every small board,
turn, chooser, winner and draw. Clients send intent only; they never send a
claimed winner or a board state.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `tttt-select` | client → server | `{roundId, metaCell}` | Current chooser selects an unresolved meta cell |
| `tttt-tap` | client → server | `{roundId, smallCell}` | Current small-board player taps one of its nine cells |
| `tttt-meta` | server → clients | `{roundId, meta, chooser, phase, zoomAt}` | Meta board, current chooser and transition state |
| `tttt-small` | server → clients | `{roundId, metaCell, board, turn, phase, zoomAt}` | Selected mini board and its authoritative turn/state |
| `tttt-over` | server → clients | `{roundId, meta, winner, draw}` | Final meta board and match result |

The server timestamps transition events. A 100–300 ms delayed tap is checked
against the server's current phase, turn and round id; stale taps are ignored.
No client needs to predict a win, and both screens render the same board from
the same event.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| Fewer than 2 connected players | The host cannot start; the lobby says it needs the other phone |
| More than 2 players | The room rejects the start and the extra seat remains outside the match |
| A player leaves mid-small-board | The remaining player wins the match by forfeit; no partial board is claimed |
| Host leaves in the lobby | Normal room host reassignment applies before start |
| A small board is a draw | Its meta cell closes blank; the other player chooses next |
| A meta line appears | The match ends immediately; unresolved small boards stop accepting taps |
| All nine small boards close with no line | The match ends as a draw |
| Backgrounded tab | On return, render the latest authoritative phase and board; never resume a stale zoom or turn |
| Duplicate or stale tap | Ignore by round id, phase, turn and cell bounds |

## 8. Anti-cheat

The server checks that the sender is in the two-player match, that the sender is
the chooser or current small-board player as appropriate, that the selected
cell is unresolved, and that a small cell is empty. It computes each mini-board
winner and the meta winner itself. A client can fake its animation, but cannot
claim a cell, skip a turn, or submit a winning board.

## 9. Safety

Touch only; no special safety copy is required. The board must not require
rapid repeated taps or encourage unsafe movement.

## 10. Data & privacy

Only the room-scoped match state leaves the phone: selected meta cells, small
board taps and authoritative board/result frames. It exists for the lifetime of
the room and is not written to analytics or a database. No names beyond the
room's existing optional nickname are added.

## 11. Accessibility

- Every meta and small cell is a real button with an accessible row/column label
  and its current state (empty, X, O, closed).
- X and O use shape and text, not colour alone; the winning meta line gets a
  non-colour outline.
- `prefers-reduced-motion` removes zoom interpolation while keeping the same
  focus order and state changes.
- The game is fully playable without sound. The active player and chooser are
  announced through a live status line.
- The compact meta view remains available after zoom, so a player with limited
  visual attention can orient themselves between small boards.

## 12. Open questions

- **Chooser and first move:** this draft makes the chooser start the selected
  small board as X, then hands chooser duty to the other player after every
  small board. Confirm this alternating advantage is desired.
- **Drawn small boards:** this draft closes a drawn cell blank and continues;
  confirm that a draw should not be replayable.
- **Forfeit:** this draft awards the match to the remaining player rather than
  claiming the current small board; confirm the desired leave behaviour.
