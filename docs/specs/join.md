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
| **4-char code** | Typed on the hub or in a game's chooser — the same field in both (§Landing on a game page). Alphabet excludes `O`/`0`/`I`/`1` so a code shouted across a noisy room survives — `www/src/core/room/code.ts` |
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

## Landing on a game page

The URL hash decides which of three screens you get. All three go through one gate,
`www/src/lobby/RoomGate.tsx`, so every game answers identically:

| Hash | Meaning | Behaviour |
| --- | --- | --- |
| empty | you have not chosen yet | **the join-or-create chooser** (below). Nothing is minted and no socket opens until you pick |
| a valid code | joining | straight into the lobby — arriving by a friend's link must never cost an extra tap |
| anything else | the link arrived damaged | **"This room doesn't exist"**, with the bad hash left in place |

### The chooser, and why the code is no longer minted on arrival

Opening a game page used to mint a code, rewrite the URL and connect **immediately**, so
you were the host of a new room before deciding you wanted one — and anyone who had come
to *join* a friend had to go back to the hub to type their code. Merely browsing the
catalogue created rooms.

**How to play leads the screen**, above the two choices and expanded. Deciding whether to
start a room or wait for a friend's code is a decision about *this* game, so the rules come
before the choice rather than below it. It is a collapsible panel
(`www/src/core/ui/Disclosure.tsx`) so someone who knows the game can fold it away.

**In the lobby its state depends on how the player arrived** (`www/src/lobby/arrival.ts`):
collapsed for whoever came through the chooser and read the rules there, **open for anyone who
followed a link**, because they never saw the chooser. Collapsing it for everyone assumed the
rules had been read on the way in — true of the host and false for most of the table.

So an empty hash shows two choices, either of which is one tap away from the other. **Create is
the default tab**: a valid hash goes straight to the lobby and the hub's code field navigates
straight to a lobby, so the only way to reach this screen is to tap a game card on the hub —
which means very nearly everyone who sees it just chose a game and wants to start it. Opening on
Join charged all of them a tap and showed an empty code field to someone with no code. Being
wrong costs one tap to Join, the cheaper of the two mistakes.

- **Join a room** — the hub's own code field, the same component
  (`www/src/core/ui/JoinByCode.tsx`), so there is one place where a typed code is validated,
  resolved and followed. Its rule is unchanged: the code names the game, so a code for a
  *different* game navigates there. Its button takes `var(--game-accent, var(--color-accent))`
  — the game's colour on a game page, the site accent on the hub where no game is in scope,
  the same chain `.btn--primary` uses.
- **Create a room** — one button. It mints the code **at that moment**, writes it to the hash and
  goes straight into the lobby, where the code, share link and QR live. The code is deliberately
  *not* shown on the chooser as well: it was, briefly, and the host then met the same panel twice
  with a button between them whose only visible effect was "that panel again".

Tapping Create twice does not mint a second code — it reads the hash first, so a code that may
already have been read out loud does not change underneath the player.

**Minting is not creating.** The room exists server-side only once someone connects, and whoever
connects first is the host — so tapping **Create the room** is what makes the creator the host.
Because that tap also connects, the creator now reliably *is* the host; while the code sat on the
chooser waiting for a second tap, a friend who opened the link first took the role instead.

Nothing is minted before that tap, so browsing the catalogue still creates no rooms.

An invalid hash used to mint a fresh code as well, which dropped the player into a
*different, empty room* and erased the bad code from the URL. They believed they had
joined, they were alone, and the evidence was gone — a chat app eating a character, or
a code copied one short, does exactly that.

The copy names the room, not the code: from where the player stands they followed a
link and there is nothing at the end of it, and whether the code was malformed or
merely unused changes nothing they can act on. Two exits, because the screen it
replaces was a silent dead end — start a fresh room of that game, or go back and type
the code.

**A hash is validated whole; a typed field is normalised.** The two need different rules,
and using the typing rule on the hash was a live bug until `hash.test.ts` was written.
`normaliseRoomCode()` is lossy on purpose — it drops characters outside the alphabet and
truncates to four — which is right while somebody types and wrong for a link that has
already arrived: `#lobby` lost its `O` and became room `LBBY`, and `#AB2CD` was truncated to
`AB2C`. Both silently produced a *valid* code for a room the sender never named, which is
exactly the failure the table above exists to prevent. So `roomFromHash()` tests the whole
value with `isRoomCode()` and forgives only case, because some clients lowercase a URL in
transit and that is the same code rather than a different one.

**Codes are generated from the alphabet, never sanitised into it.**
`generateRoomCode()` draws every character from `ROOM_CODE_ALPHABET`, so it cannot
emit an excluded glyph. `normaliseRoomCode()` exists only for input the app does not
control — what a human types, and what arrives in a hash.
