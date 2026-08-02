# Joining a room

How players get into the same room. Applies to every game — the lobby is shared
([multiplayer.md](../multiplayer.md) §3).

> Tier 1 is **built**. Tier 2 is **specified, not built** — see
> [roadmap.md](../roadmap.md) M9.

## 1. Tier 1 — always available

Every game offers all three, always. They need no sensor and no permission.

| Method | How |
| --- | --- |
| **Share link** | `/<slug>/#<CODE>` via `navigator.share`, clipboard copy as fallback |
| **4-char code** | Typed on the hub or in the lobby. Alphabet excludes `O`/`0`/`I`/`1` so a code shouted across a noisy room survives — `www/src/core/room/code.ts` |
| **QR code** | The host shows it big; everyone else scans with the OS camera app. We never ask for camera permission ourselves |

The hub's code field routes by code alone: the server resolves `CODE → game`, so
someone pasting a code never needs to know which game their friends picked
([hub.md](hub.md) §4).

## 2. Tier 2 — smart join

The idea: skip typing entirely by proving with a **physical gesture** that the
phones are together.

### 2.1 GPS is a gate, not proof

All the options below were proposed with GPS. Worth being precise about what it
buys: **indoor GPS accuracy is 20–50 m at best** — a whole building, not a room.
It can narrow the candidate set; it cannot establish that two phones are
together.

**The gesture must carry the proof.** At FonyGames' scale — a handful of
concurrent rooms — the gesture alone is nearly always unambiguous, so GPS is a
scalability hedge to add when it earns its place, not a launch requirement.

**If GPS is added**, note that joining happens *before* a room exists, so the
"coordinates never leave the room" rule in
[device-capabilities.md](../device-capabilities.md) §6 does not yet cover it.
The rule for join is: transmit a **coarse geohash (~150 m cell)**, never raw
coordinates, only while the join screen is open, never stored.

### 2.2 The options, compared

| Option | Gesture | Permission | Verdict |
| --- | --- | --- | --- |
| **Draw across** | Phones flat on a table; one finger drawn across all screens | none | **Flagship** |
| **Shake together** | All phones in one fist, shaken | motion | **Fallback when there's no table** |
| **Bump pairs** | Two phones tapped together | motion | Not for joining |

**Bump is rejected for joining** because it is inherently pairwise: a 6-player
room needs a chain of five bumps with someone tracking who has already joined.
It remains the right mechanic for the game it was designed for
([games/bump-relay.md](games/bump-relay.md)).

### 2.3 Draw across devices — the flagship

Every other method answers one question: *are we together?* Drawing answers a
second, more valuable one: **where is each phone relative to the others?**

```
 ┌────────┐   ┌────────┐   ┌────────┐
 │  A  →  │   │  B  →  │   │  C     │
 └────────┘   └────────┘   └────────┘
    exit t₁     entry t₂      gap ≈ physical spacing
```

Each device observes the finger enter at one edge and leave at another, giving
per device: entry point + timestamp, exit point + timestamp, direction, speed.
The Durable Object chains them — A's exit at t₁ must be followed by B's entry at
t₂ across a small gap, with edges geometrically consistent with one continuous
stroke.

**Output: an ordered, spatially-aware set of devices.** That is calibration
disguised as a join gesture, and it unlocks games nothing else gives us — a ball
rolling across a row of screens, a board spanning six phones, something handed
physically left to right. Drawing a **circle** instead of a line yields *cyclic*
order, i.e. a natural turn order.

**The hard prerequisite already exists.** Ordering strokes across devices needs a
common clock, and that is exactly the `ping`/`pong` offset handshake behind
`RoomClient.now()` ([realtime-server.md](../realtime-server.md) §8).

| | |
| --- | --- |
| Clock offset accuracy | ~±20–50 ms |
| Finger speed | ~30 cm/s |
| Resulting positional error | **~1.5 cm** — ample for ordering and adjacency, rough for precise geometry |

Constraints to design around:
- Every screen awake and on the join screen simultaneously (wake lock).
- Someone must physically reach across all the devices.
- Needs a flat surface — **not** the posture of a party where everyone is stood
  in a circle. Hence the fallback below.
- Touch only, so **no permission prompt at all** — the least friction of the three.

### 2.4 Shake together — the practical fallback

All phones held in one fist and shaken. Each streams a short accelerometer
window; the server cross-correlates the magnitude signatures and admits the
devices whose waveforms match within the same window.

Handles **N devices in one gesture** and works standing up, which is the actual
party posture. Costs a motion permission, and on iOS a user-gesture tap before
the prompt ([device-capabilities.md](../device-capabilities.md) §2).

### 2.5 Considered and rejected

**Ultrasonic chirp** — one device emits ~19 kHz, the others hear it. Genuinely
good indoors and needs no GPS, but it costs a **microphone** permission, which
is a far more alarming prompt than motion on a *join* screen, before the player
has any reason to trust us.

## 3. Rules for any smart-join method

1. **Never the only way in.** Tier 1 is always visible on the same screen. A
   gesture that fails must cost nothing but a tap.
2. **No dead ends.** Permission denied or sensor missing → fall straight back to
   Tier 1 with a one-line explanation
   ([AGENTS.md](../../AGENTS.md) §4).
3. **Confirm before joining.** A matched player is *proposed*, not silently
   admitted — a false positive must not drop a stranger into the room.
4. **Time-boxed.** A join gesture window lasts seconds and then closes; no
   sensor stream is left running.
