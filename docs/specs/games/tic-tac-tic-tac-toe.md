# Tic-Tac-Tic-Tac-Toe

| | |
| --- | --- |
| **Slug** | `tic-tac-tic-tac-toe` |
| **Catchy sentence** | *Play tic-tac-toe inside a giant tic-tac-toe* |
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
The host starts the match; the host keeps X and the other player keeps O for
the entire match. The player whose turn it is to choose a small board selects
any unresolved meta cell. The screen zooms into that board, and the two players
play ordinary alternating tic-tac-toe there, with the chooser making the first
move using their own fixed symbol. When that small
board ends, it zooms back out and its meta cell becomes the small-board winner's
symbol. A drawn small board becomes blocked. If the meta grid fills without a
winning line, every blocked cell reopens for another small round. The other player
chooses the next unresolved meta cell, and the loop repeats.

1. Choose an unresolved cell in the meta grid.
2. Zoom into its 3×3 board and alternate X/O taps.
3. Zoom out and claim the meta cell, or block it as a draw.
4. Hand meta-cell choice to the other player.
5. Continue until the meta board is won or has no unresolved cells.

**Win condition:** three claimed X or O meta cells in a row, column or diagonal
wins the match. If all nine small boards are closed without a meta line, the
match is a draw only when it fills without a line and has no blocked cells to
reopen.
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
- **The winning finale:** the tap that wins the meta grid used to take the
  board off the screen in the same frame — the one move the whole match was
  played for was the one move nobody ever saw land. It now gets five seconds,
  in two beats, before the result panel appears:

  1. **The stamp**, 2 s (`TTT_STAMP_MS`): the child grid that was just won
     stays on screen, full size, with the winner's own symbol over it in the
     same yellow a claimed meta cell wears — because that is what it is about
     to become.
  2. **The line**, 3 s (`TTT_PULSE_MS`): back out to the meta grid, and the
     **three aligned symbols pulse once a second**. The win is shown as a line
     rather than announced as a name.

  Only a real meta win earns it. A draw has no line to pulse and the
  five-minute cap ends the match with no winner from wherever it had got to;
  holding a winner's send-off over either would be the game lying about what
  happened (`finaleLine` in `game.ts`, and its test).

  The clock starts when the phone first sees the won state rather than from a
  server time. It is cosmetic and the same length for everybody, so a phone
  that arrives late should see the celebration from where it arrived rather
  than miss it or catch the tail of it.
- **Results:** the shared end screen names the meta winner or draw and shows the
  final meta grid. No score panel is shown.

The zoom lasts 1000 ms and is keyed to the server's `zoomAt` time. Reopened cells
blink and fade their blocked dot out while their empty mini grid fades in over
the same 1000 ms. A reduced-motion
preference skips the animation but preserves the same state sequence — including
the finale's, which keeps both beats and their timings and only drops the
movement: the stamp appears without scaling, and the winning line wears a steady
ring instead of a pulse.

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
| Meta grid fills with no line and has blocked cells | Every blocked cell clears and becomes playable again after its 1000 ms transition |
| Meta grid fills with no line and no blocked cells | The match ends as a draw |
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

- **Chooser and first move:** symbols stay fixed for the match (host X, guest O).
  The chooser starts each selected small board with their own symbol, then hands
  chooser duty to the other player after every small board. Confirm this
  alternating advantage is desired.
- **Drawn small boards:** a draw blocks the cell until a full meta grid has no
  winner, then all blocked cells reopen together.
- **Forfeit:** this draft awards the match to the remaining player rather than
  claiming the current small board; confirm the desired leave behaviour.
