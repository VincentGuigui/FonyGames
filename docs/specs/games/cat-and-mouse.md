# Cat and Mouse

| | |
| --- | --- |
| **Slug** | `cat-and-mouse` |
| **Catchy sentence** | *One cat, a floor full of mice, and nowhere to hide* |
| **Illustration** | `illustrations/cat-and-mouse.svg` — a cat silhouette lunging, three mice scattering ahead of it |
| **Players** | 2–6 |
| **Round length** | 60–90 s |
| **Inputs** | touch (drag) |
| **Accent colour** | `#C084FC` |
| **Status** | 📝 draft — **not built**, awaiting the maintainer's go-ahead (AGENTS.md §5) |

## 1. Pitch

One player is the cat. Everyone else is a mouse, and every phone shows the same
floor.

Put a finger on your mouse and drag it around. Let go and it stops dead — a mouse
only moves while you are moving it. The cat is doing the same thing, faster, and
it only has to touch you.

Three lives each. Survive the clock and the mice win.

## 2. Core loop

1. Host starts the round. One player is the cat; everyone else is a mouse.
2. A four-second rules panel, first round only
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4).
3. **The same floor is on every screen**, with every mouse and the cat on it.
4. Drag your own icon to move it. Release and it stays put.
5. The cat touching a mouse costs that mouse a **life**, and the mouse is
   dropped somewhere clear with a moment of grace.
6. A mouse out of lives is out, and watches.
7. **Cat wins** by emptying every mouse. **Mice win** if any of them is still
   alive when the clock runs out.

**Scoring:** none beyond the round. The cat rotates so everyone gets a turn at it.

## 3. Modes / variations

| Mode | Blurb | Difference from core |
| --- | --- | --- |
| `chase` | One cat, three lives each, beat the clock | baseline |
| `hoard` | Cheese to collect while you run | later — mice must also touch pickups |
| `blackout` | The floor is dark; you see only what is near you | later — per-player fog |

Only `chase` would be built first.

## 4. The expensive one, and why that is fine

Every game in the catalogue so far avoided streaming positions. Spill and Goat
Siege send **trajectories** — one message describes a whole flight. Sling Puck
goes further: each phone simulates its own half and nobody else can see it, so
positions never go on the wire at all
([sling-puck.md](sling-puck.md) §4).

**None of that works here.** The cat has to see the mice and the mice have to see
the cat, on one shared floor, continuously. There is no private half and no
deterministic arc — a mouse's path is whatever its player's finger does next. So
this is the first **Profile B** game in
[../../realtime-options.md](../../realtime-options.md) §1: positions on the wire,
many times a second.

That is affordable, and the cost work already said so:

- Cloudflare bills **inbound** WebSocket messages at 20:1 and **outbound at
  nothing**, so fan-out to six phones is free. A Profile B round costs about
  **720 billed requests**, and the free tier covers roughly **4,100 such rounds a
  month** — far ahead of every metered alternative, which count fan-out
  ([../../realtime-options.md](../../realtime-options.md) §3).
- Duration is not the binding constraint either: an object awake for a two-minute
  round is ~15 GB-s against 13,000 GB-s/day.

Two things keep the real traffic well under the worst case:

- **A still mouse sends nothing.** Input only exists while a finger is down, so
  the wire is quiet exactly when the game is.
- **The server broadcasts on a fixed tick** (`CM_TICK_HZ`), not once per inbound
  message. Six players flicking at once still produce one frame per tick.

Clients **interpolate** between ticks rather than snapping, so 15 Hz looks smooth.
That is a rendering choice and changes nothing about the rules.

## 5. Coordinates

Normalised, and **isotropic**: one unit is one board width in *both* axes, so `x`
runs 0..1 and `y` runs 0..`1 / CM_BOARD_ASPECT`. The floor is a fixed-aspect
rectangle **letterboxed** into each screen.

This is the lesson from Sling Puck §4, and it matters more here: with a shared
board, phones of different shapes must agree on where things are. Normalising each
axis to its own screen dimension would put the cat in a different place on every
phone, and make a diagonal chase bend.

## 6. Movement

| | |
| --- | --- |
| Grab | Touch **your own icon** (within `CM_GRAB_SLOP`) |
| Move | Drag. The icon follows your finger |
| Stop | Release. It stays exactly where it was |

**You must grab your own icon first**, rather than the icon jumping to wherever
you touch. Two reasons, and the second is the important one:

- Tapping the far side of the floor would be a teleport, which is not a chase.
- It makes the speed limit meaningful. With a grab-and-drag, distance travelled is
  distance your finger travelled, so `CM_MOUSE_SPEED` is a cap the server can
  enforce (§9) rather than a suggestion.

The **cat is faster** than a mouse (`CM_CAT_SPEED > CM_MOUSE_SPEED`) — otherwise
a mouse simply runs forever — and the mice are more numerous and can turn on the
spot. Whether that asymmetry is the *right* one is an open question (§12).

### Lives and grace

A touch costs a life. Without more than that, the cat would park on a mouse and
take all three in a quarter of a second, so:

- The mouse is moved to a clear spot, as far from the cat as the floor allows.
- It cannot be caught again for `CM_GRACE_MS`, and is drawn plainly as untouchable
  during it — by **flashing outline, not by colour alone**.

## 7. Screens

- **Lobby** — the shared template ([../../design/game-chrome.md](../../design/game-chrome.md) §1),
  plus who is the cat this round.
- **Floor** — the shared board. Your own icon is marked so you can find it
  instantly; lives are a **number** as well as pips. Gear top-right.
- **Result** — cat or mice, and how long the mice lasted.

## 8. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| The cat leaves | Round ends; mice win. There is no game without a cat |
| A mouse leaves | Their icon is removed; the round continues |
| Last mouse leaves | Round ends; the cat wins by default |
| A player refreshes | Same seat, same lives; their icon reappears where the server last had it |
| Tab backgrounded | Their icon simply stops, because input stops. A mouse that stops is a mouse that gets caught — which is the honest outcome |
| Two catches in the same tick | Both count, on different mice; a single mouse can only lose one life per tick |
| Round cap | `CM_ROUND_CAP_MS`, then the mice win |

## 9. Anti-cheat

Positions come from clients, so this needs saying plainly.

- **Speed is clamped, per tick, server-side.** A move further than
  `CM_MOUSE_SPEED × Δt` is truncated to that distance in the same direction, not
  rejected — a lagging player must not be punished for a late frame.
  Truncation is what makes teleporting and speed-hacking useless.
- **Bounds are clamped.** Nothing leaves the floor.
- **Only the server decides a catch.** It compares the positions it holds, on its
  own tick. A cat that claimed catches would otherwise win instantly.
- **A mouse cannot refuse a catch**, because it is not asked: the mouse client
  reports where it is and nothing else.

What this does **not** stop: a mouse client that reports a position slightly
behind where it really dragged, to dodge by a hair. Bounding it would need the
server to simulate the drag itself, which it cannot — the input is a finger. The
exposure is small (a few pixels of lag-shaped advantage) and it is here in writing
rather than left implied.

## 10. Safety

Nothing is thrown, waved or swung. Phones are held and touched. Six people
crowding one screen is not required — everyone plays on their own.

## 11. Data & privacy

Positions and lives, for the life of the round. Player id, name, avatar. Nothing
else, and none of it outlives the room
([../../database.md](../../database.md) §1).

## 12. Open questions

- **Is dragging your own icon the right input?** It is direct and needs no
  tutorial, but it puts your thumb on top of the thing you are trying to see. A
  thumbstick in a corner is the alternative, and it is worse to explain and better
  to look at. Only a play test settles it.
- **An accessible fallback is required before this ships**, and is not designed
  yet. Sustained precise dragging is exactly what some players cannot do. The
  likely answer is *tap a spot and your mouse walks there at its own speed* —
  slower and less controllable, fully playable — mirroring Sling Puck §13, where
  the fallback had to **aim** rather than imitate the hard input.
- **How much faster is the cat?** Too little and the round always times out; too
  much and mice are farmed. This is the balance number the whole game turns on.
- **Does the cat rotate, or is it earned?** Rotating is fair; "whoever was caught
  last is the next cat" is funnier and punishes the worst mouse twice.
- **Is 2 players a game?** One cat, one mouse, nowhere to hide and nobody to
  share the cat's attention. It may need a smaller floor, or a 3-player minimum.
- **Does a shared board even work on phones of very different sizes?** The
  letterboxing in §5 makes the *coordinates* agree, but a 4.7" screen shows the
  same floor smaller, so the same swipe is a shorter real distance. Worth watching
  for whether the big-phone player has an advantage.
