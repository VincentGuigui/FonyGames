# Multiplayer & networking

> Status: **proposal** for the transport details; the *rules* below (rooms, join
> flow, resilience) are decided and apply to every game.

## 1. Rooms

- A game session = a **room**. Rooms are ephemeral, in memory, and disappear
  shortly after the last player leaves (grace period: 60 s for reconnects).
- A room is identified by a **4-character code** (uppercase, no ambiguous
  characters: no `O`, `0`, `I`, `1`).
- Joining is possible three ways, all equivalent:
  1. **Link**: `/<game-slug>/#<CODE>` — shared via any messaging app.
  2. **QR code**: shown big on the host's screen, scanned with the camera app.
  3. **Typing the code** on the game's lobby screen.
- No account, no nickname required. A player gets an auto-generated silly name
  and an emoji avatar, editable in one tap.

## 2. Roles

| Role | Meaning |
| --- | --- |
| **Host** | The player who created the room. Picks the mode, starts the round. |
| **Player** | Anyone who joined. Can be promoted if the host disappears. |
| **Spectator** | Joined mid-round; watches, plays next round. |

The host is a *UI* role, not a source of truth: the server owns the round state
so a host leaving never kills the game.

## 3. Lobby flow (same for every game)

```
Hub → Game card → "Play"
   → Lobby: mode picker (host) · player list · room code + QR + share button
   → Permission primer (only for the sensors this mode needs)
   → Countdown (3·2·1)
   → Round
   → Results + "Play again" (same room, keeps everyone)
```

Rules:
- **Permissions are requested inside the lobby, never on the hub**, and always
  after a one-line explanation of why (see
  [device-capabilities.md](device-capabilities.md)).
- "Play again" must never require re-sharing the link.

## 4. Transport

- **WebSocket**, JSON messages, one connection per player.
- Message envelope:

  ```ts
  type Msg = {
    t: string;        // type, e.g. 'join' | 'state' | 'input' | 'event'
    r?: string;       // room code
    p?: string;       // player id
    s?: number;       // server sequence number
    d?: unknown;      // payload
  };
  ```

- **Server is the referee** for anything scored: timers, hits, points, winner.
  Clients send *intent* (`input`), the server emits *truth* (`state`/`event`).
  A client never tells another client "you lost".
- **Clock**: the server timestamps events; clients estimate offset at join and
  render countdowns from server time, never from `Date.now()` alone.
- **Rate limit**: 20 messages/s per player, sensor streams throttled client-side
  before sending.

## 5. Resilience (mandatory behaviour)

| Situation | Expected behaviour |
| --- | --- |
| Network blip | Auto-reconnect with backoff, rejoin same room + seat, resync state |
| Player leaves mid-round | Round continues; they can rejoin as spectator or player |
| Host leaves | Another player is promoted silently |
| Screen locks / tab backgrounded | Sensors stop; player marked `away`; on return, resync (never resume a physical game mid-action without a 3·2·1) |
| **Page refresh** | Same seat, same name, same host role. The seat id is kept in `sessionStorage` per tab, so a reload resumes but closing the tab releases the seat |
| Server unreachable | Clear message + retry button; local/solo mode offered when the game has one |
| Two players, one drops | Round ends gracefully with a "no contest" result |

## 6. Fairness

- Latency varies wildly on mobile. Prefer mechanics that are **tolerant to
  100–300 ms** (hold, accumulate, be-in-a-zone) over frame-perfect races. When a
  game *is* a race (Tap Duel), score on **server-received order with a
  client-timestamp correction**, and say so in the game's spec.
- Never trust client-reported scores, positions, or sensor magnitudes without a
  plausibility check (see anti-cheat notes in each game spec).

## 7. Privacy

Room traffic is not logged beyond the room's lifetime. GPS coordinates are
relayed only to players in the same room, never stored. Details in
[device-capabilities.md](device-capabilities.md).
