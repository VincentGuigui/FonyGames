# Tap Fighter

| | |
| --- | --- |
| **Slug** | `tap-fighter` |
| **Catchy sentence** | *Pick six moves, then watch the fight unfold* |
| **Illustration** | `www/src/games/tap-fighter/art/card.svg` — two original pixel-art fighters, blue versus green, colliding punch and kick effects between them |
| **Players** | 2 exactly |
| **Round length** | 15–75 s; first to 3 round wins |
| **Inputs** | touch |
| **Accent colour** | `#F97316` orange |
| **Status** | live · beta |

## 1. Pitch

Tap Fighter is a turn-by-turn fighting game presented like an original retro
arcade brawler. Each player secretly programs six moves, locks them with
**Fight**, then watches both fighters execute one confrontation per second.
The strategy is reading the opponent: attack high or low, or evade at the right
height.

The two players control the same original fighter design with different
clothes: blue for one seat and green for the other. No character, animation,
sound, name or visual asset is copied from an existing fighting franchise.

## 2. Core loop

Both players privately choose an ordered sequence of six actions. Actions may
repeat and may be replaced or reordered until **Fight** is pressed. Pressing
Fight locks that player's whole sequence; the opponent sees only that they are
ready, never the chosen moves. When both sequences are locked, the server
resolves all six confrontations, then reveals and plays them one per second.

1. Choose six actions: high punch, low kick, jump or crouch.
2. Review their order and press **Fight** to lock the sequence.
3. Wait until the opponent has locked theirs.
4. Watch the six server-resolved confrontations, one every second.
5. Award the round to the fighter who received fewer impacts.
6. Reset both health bars and sequences for the next round.

**Win condition:** first player to win three rounds wins the match. A drawn
round gives neither player a round win.

**Scoring:** round wins only, shown as three empty/filled pips for each player.
There are no points and health does not carry between rounds.

### 2.1 Actions

| Action | Height | Effect |
| --- | --- | --- |
| Punch | high attack | Hits a standing or jumping opponent; a crouching opponent evades it |
| Kick | low attack | Hits a standing or crouching opponent; a jumping opponent evades it |
| Jump | high defence | Evades a kick; does not deal damage |
| Crouch | low defence | Evades a punch; does not deal damage |

Every selector tile is illustrated with the player's own blue or green fighter
performing that action. Text and an action icon accompany colour and animation,
so the move is never communicated by colour alone.

### 2.2 Complete confrontation table

“P1” and “P2” below mean that player receives one impact.

| Player 1 | Player 2 | Result |
| --- | --- | --- |
| Punch | Punch | impact P1 and P2 |
| Punch | Kick | impact P1 and P2 |
| Punch | Jump | impact P2 |
| Punch | Crouch | no impact |
| Kick | Punch | impact P1 and P2 |
| Kick | Kick | impact P1 and P2 |
| Kick | Jump | no impact |
| Kick | Crouch | impact P2 |
| Jump | Punch | impact P1 |
| Jump | Kick | no impact |
| Jump | Jump | no impact |
| Jump | Crouch | no impact |
| Crouch | Punch | no impact |
| Crouch | Kick | impact P1 |
| Crouch | Jump | no impact |
| Crouch | Crouch | no impact |

### 2.3 Precalculated health timeline

The referee resolves all six pairs before animation and counts how many impacts
each fighter will receive: `hitsP1` and `hitsP2`. The player with fewer impacts
wins the round; equal counts are a draw.

For a non-draw, `damageUnit = 100 / max(hitsP1, hitsP2)`. Each received impact
removes one damage unit from that fighter. This guarantees that the losing
health bar reaches exactly zero on their final impact, while the winner's bar
ends at the proportional amount implied by the same damage unit. The displayed
health after beat `n` is calculated from cumulative impacts, not repeatedly
subtracted, avoiding rounding drift.

For an impact draw with one or more hits, `damageUnit = 100 / hitsP1`, so both
bars reach zero together on the last shared impact. A zero-impact draw leaves
both bars full. Health values are rounded only for pixels/text; the referee's
timeline retains full precision.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Six secret moves, first to three rounds | baseline |

Every mode shares the core loop. A mode that does not is a different game.

## 4. Screens

- **Lobby:** shared lobby, exactly two players, blue/green seat labels and the
  normal one-time Ready gate. The host may swap the two colours. No readiness
  is requested again between rounds.
- **Plan:** the player's fighter stands above four illustrated action tiles.
  Six numbered slots show the private sequence. A selected slot can be removed
  or replaced before locking. Fight is disabled until all six slots are full.
- **Waiting:** the local sequence stays visible but locked. The opponent is
  shown as “Choosing…” or “Ready”, never with their moves.
- **Fight:** an original pixel-art scene fills the useful width. Fighters face
  one another and animate idle, punch, kick, jump, crouch, hit and knockout
  states. The current pair of actions is labelled. Health bars sit at the
  bottom of the scene, immediately above each player's name and round pips.
- **Round overlay:** after the sixth animation settles, a retro panel overlays
  the scene with “<nickname> wins” / “<nickname> gagne” or “Draw” / “Match nul”.
  The host gets **Next round**; the guest sees that the host is continuing.
- **Match result:** after a player's third round win, the shared match result
  screen names the winner and offers Play again / Leave game. Play again clears
  both players' round-win pips.

Each one-second beat reserves time for anticipation, contact and recovery. A
hit flash and health-bar change occur at contact, not at the start of the beat.
The next beat cannot visually begin early.

### 4.1 Rendering decision

Tap Fighter uses original SVG sprite sheets plus CSS pose/impact animation. Two
fighters, seven discrete poses and six fixed beats need neither a scene graph
nor a physics engine. PixiJS's previously measured minimal import (~221 KB
gzipped in this repository) exceeds the per-game budget by itself; Phaser is
larger and adds a game loop, input system and physics abstractions this design
would not use. Custom rendering keeps the fighter route small and its timing
driven directly by the authoritative server timestamps.

## 5. Inputs & sensors

Touch only. There are no permissions or sensor fallbacks. Every action tile and
sequence slot meets the shared minimum touch-target size.

## 6. Networking

The Durable Object is authoritative for locked plans, confrontation results,
health timeline, round wins, phase and winner. Plans remain private until both
players lock. The client animates the already-resolved timeline from server
timestamps; latency cannot change an outcome.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `fighter-lock` | client → server | `{roundId, actions[6]}` | Validate and permanently lock this player's plan |
| `fighter-ready` | server → clients | `{roundId, readyByPlayer}` | Public lock status only; contains no actions |
| `fighter-fight` | server → clients | `{roundId, startsAt, actionsByPlayer, beats[6], roundWins}` | Reveal both plans and the authoritative health/impact timeline |
| `fighter-round-result` | server → clients | `{roundId, winner, draw, roundWins, endsAt}` | Show the overlay after the final recovery animation |
| `fighter-match-result` | server → clients | `{winner, roundWins}` | A player has won their third round |

`startsAt` is at least the shared reveal lead time after both locks arrive. A
reconnecting or backgrounded client derives the current beat from server time
and catches up without replaying old damage.

## 7. Failure & edge cases

- A player who disconnects keeps their seat and private plan during the normal
  reconnect grace. After grace expires, the connected opponent wins that round
  by forfeit. A third forfeit win can end the match.
- If a tab backgrounds during the automatic fight, the server continues. On
  return, the client renders the health and animation state for the current
  server-time beat.
- A player cannot unlock or replace a submitted sequence. A network retry of
  the identical lock is idempotent; a different second plan is ignored.
- If neither player receives an impact, the round is a full-health draw.
- If both receive the same positive number, both reach zero together and the
  round is a draw.
- The host leaving transfers host as usual; fighter colour/seat identity stays
  attached to player ids for the active match.
- A round cannot start with fewer or more than two connected players. Solo test
  mode alternates blue and green plans on one phone and bypasses Ready.

## 8. Anti-cheat

The server accepts exactly six values from the closed action enum and one plan
per player per round. It computes every confrontation, impact, health value and
winner itself. Clients cannot report damage, health or animation completion.
Plans are not broadcast until both are immutable, preventing the second player
from choosing after seeing the first plan.

## 9. Safety

No motion or physical movement is requested. The game is playable seated and
one-handed. The automatic sequence has no flashing faster than three changes
per second.

## 10. Data & privacy

Only the six selected action ids leave each phone. Plans and match state exist
inside the room Durable Object for the room lifetime and are never written to
analytics or permanent storage.

## 11. Accessibility

- Every move has text, a distinct silhouette/action icon and animation; colour
  is supplementary.
- Health has a numeric percentage in accessible text in addition to bar width.
- Reduced-motion mode replaces movement across the scene with pose changes and
  a brief non-strobing contact highlight; timing and results remain identical.
- Sound is optional and never communicates an outcome by itself.
- The action sequence is keyboard-focusable on desktop and exposes slot order,
  action names and lock state to assistive technology.

## 12. Validated decisions

- Health is normalized per round so the losing bar reaches zero.
- A positive-impact draw knocks both fighters out at zero; a zero-impact draw
  leaves both at full health.
- Actions may repeat without a per-action limit.
- Only the host receives the active Next round button; the guest sees a waiting
  state on the same overlay.
