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
only moves while you are moving it. The cat is doing the same thing, and it only
has to touch you once.

Three lives each. Survive the clock and the mice win.

## 2. Core loop

1. Host starts the round. One player is the cat; everyone else is a mouse.
2. A four-second rules panel, first round only
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4).
3. **The same floor is on every screen**, with every mouse and the cat on it.
4. Drag your own icon to move it. Release and it stays put.
5. The cat touching a mouse costs that mouse a **life**. That mouse reappears in
   the **centre**, with two seconds of grace it can already drag out of.
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
| Move | Drag — see the two modes below |
| Stop | Release. It stays exactly where it was |

**You must grab your own icon first**, rather than the icon jumping to wherever
you touch. Tapping the far side of the floor would be a teleport, and a teleport
is not a chase.

### The two drag modes

The host picks one in the lobby. They are not two flavours of the same thing —
they are two different games, and both are worth having.

| Mode | How | Speed |
| --- | --- | --- |
| `direct` | Grab your icon; it follows your finger exactly | Thumb speed. **No speed stat exists** |
| `capped` | Grab your icon and drag *away* from it; where your finger is becomes the destination, and the icon walks toward it | `CM_MOUSE_SPEED`, cat at **1.2×** |

Both start with the same grab, so the input is learned once. In `capped` the finger
runs ahead and the icon follows at its own pace; in `direct` there is no gap between
them.

Both keep the game's signature rule: **release and your icon stops.** In `capped`
that means releasing clears the destination — the icon does **not** coast on to it.
That is deliberate, and worth vetoing if you disagree: an icon that keeps walking
after release would make the whole game playable without holding at all, which is
a different game from this one.

Why they are not equivalent:

- **`direct` is reaction-tag.** Everyone crosses the phone in about 150 ms, so
  there is nothing to balance and no per-role speed — a cat is not "faster", it is
  just the one doing the chasing. Its risk is **scribbling**: the cat sweeping
  frantically and catching by luck rather than by reading a mouse.
- **`capped` is a real chase.** `1.2×` means the cat gains ground slowly, so a
  mouse escapes by turning well rather than by out-running it. A destination point
  is what makes a speed cap usable at all: the finger says *go there*, so the icon
  never has to keep up with the finger and never feels rubbery.

`CM_CAT_COOLDOWN_MS` is the anti-scribble lever and applies to **both** modes: once
the cat catches, it cannot catch again for that long. Together with the grace period
it bounds how fast luck can drain a mouse's lives.

### Internal settings

| Constant | Does |
| --- | --- |
| `CM_BOARD_ASPECT` | Floor width ÷ height (§5) |
| `CM_TICK_HZ` | Server broadcast rate (§4) |
| `CM_GRAB_SLOP` | How near your icon a touch counts as grabbing it |
| `CM_MOUSE_SPEED` | **`capped` only.** Board widths per second |
| `CM_CAT_SPEED_FACTOR` | `1.2` — cat speed as a multiple of the mouse's |
| `CM_CATCH_RADIUS` | How close counts as a touch |
| `CM_CAT_COOLDOWN_MS` | The cat cannot catch again for this long |
| `CM_GRACE_MS` | `2000` |
| `CM_LIVES` | `3` |
| `CM_ROUND_CAP_MS` | 60–90 s |

One **base speed plus a factor**, rather than an absolute speed per role: the
asymmetry is the interesting number, and a single factor cannot drift out of step
with itself the way two absolutes can.

### Lives and grace

A touch costs a life. Without more than that, the cat would park on a mouse and
take all three in a quarter of a second, so:

- The mouse reappears at the **centre of the floor**. A fixed, known point rather
  than "the clearest spot", so nobody has to work out where they went.
- It cannot be caught again for `CM_GRACE_MS` (**2 s**), and the player **can drag
  it during that time**. That is the point of the grace: they leave under their own
  control instead of being handed back as a sitting duck.
- It is drawn plainly as untouchable while grace lasts — see §7, and never by
  colour alone.

The centre being fixed means **the cat can camp it**. Grace, plus being able to move
during grace, should be enough; it is in §13 as something a play test has to check.

### On the wire

The drag mode is a **host setting, not a game mode** — it is orthogonal to `chase`,
and `hoard` or `blackout` would each want the choice too. So `start` gains a field
next to the mode it already carries:

```ts
{ mode: 'chase', drag: 'direct' | 'capped' }
```

The lobby renders the picker in `GameLobby`'s existing **`extras`** slot, host-only,
where Spill's theme picker used to live. Everything else on the wire is unchanged
from §4: positions in, one broadcast per tick out.

## 7. Screens, and what each player sees

- **Lobby** — the shared template ([../../design/game-chrome.md](../../design/game-chrome.md) §1),
  plus who is the cat this round, plus the host's drag-mode picker (§6).
- **Floor** — the shared board, drawn differently depending on who you are (below);
  lives are a **number** as well as pips. Gear top-right.
- **Result** — cat or mice, and how long the mice lasted.

### Hollow and filled

Everyone is looking at the same floor, but not at the same problem, so the same
floor is not drawn the same way:

| You are | Your icon | Other mice | A mouse in grace |
| --- | --- | --- | --- |
| a mouse | **filled** | **hollow** | hollow **+ dashed outline** |
| the cat | **filled** | filled | **hollow + dashed outline** |

- **A mouse player** needs to find their own mouse instantly, in a scatter of five
  others. Filling only yours does that in one glance and needs no legend.
- **The cat** needs the opposite: every mouse solid and catchable, except the one it
  is not allowed to catch. A grace mouse goes hollow — visibly there, visibly
  untouchable.
- **Hollow therefore means two things** — "not yours" to a mouse, "untouchable" to
  the cat. So grace gets a **second cue on top of hollow**: a dashed or pulsing
  outline. A mouse player can still tell a grace mouse from any other mouse, and
  the state never rests on fill alone, which is the same reason it never rests on
  colour alone.
- **The cat is always filled, on every screen**, and reads by **shape** — it is the
  one icon that is not a mouse. Nothing about the cat is ever hollow, so hollow
  always means "a mouse, and not one of yours to worry about".

## 8. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| The cat leaves | Round ends; mice win. There is no game without a cat |
| A mouse leaves | Their icon is removed; the round continues |
| Last mouse leaves | Round ends; the cat wins by default |
| A player refreshes | Same seat, same lives; their icon reappears where the server last had it |
| Tab backgrounded | Their icon simply stops, because input stops. A mouse that stops is a mouse that gets caught — which is the honest outcome |
| Tab backgrounded mid-drag, `capped` | The destination is **cleared**, same as a release. Otherwise a hidden tab would keep walking a player toward a point they can no longer see or change |
| Caught during grace | Cannot happen — the server holds the grace deadline and ignores the contact. The cat is told nothing beyond what §7 already shows it |
| Two catches in the same tick | Both count, on different mice; a single mouse can only lose one life per tick |
| Round cap | `CM_ROUND_CAP_MS`, then the mice win |

## 9. Anti-cheat

Positions come from clients, so this needs saying plainly. Same posture as Sling
Puck §10 — client-authoritative, written down rather than implied.

What holds in **both** modes:

- **Bounds are clamped.** Nothing leaves the floor.
- **Only the server decides a catch.** It compares the positions it holds, on its
  own tick, and applies `CM_CATCH_RADIUS` and `CM_CAT_COOLDOWN_MS` itself. A cat
  that claimed its own catches would win instantly.
- **A mouse cannot refuse a catch**, because it is not asked: the mouse client
  reports where it is and nothing else.

**What the two modes cost is different**, and this is the real reason to say which
one is running:

- **`capped`: enforceable.** The server knows the speed, so a move further than
  `CM_MOUSE_SPEED × Δt` (× `CM_CAT_SPEED_FACTOR` for the cat) is **truncated** to
  that distance in the same direction, not rejected — a lagging player must not be
  punished for a late frame. Truncation makes teleporting and speed-hacking useless.
- **`direct`: not enforceable.** There is no speed to clamp to. A genuine flick
  already crosses the board in ~150 ms, so a teleport is indistinguishable from a
  fast thumb. All that is left is a **sanity cap** set far above any human flick —
  order of 4–5 board widths per second — which never touches real play but stops
  outright teleport-hacking.

What neither mode stops: a client that reports a position slightly behind where it
really dragged, to dodge by a hair. Bounding it would need the server to simulate
the drag itself, which it cannot — the input is a finger. The exposure is small (a
few pixels of lag-shaped advantage) and it is here in writing rather than left
implied.

## 10. Safety

Nothing is thrown, waved or swung. Phones are held and touched. Six people
crowding one screen is not required — everyone plays on their own.

## 11. Data & privacy

Positions and lives, for the life of the round. Player id, name, avatar. Nothing
else, and none of it outlives the room
([../../database.md](../../database.md) §1).

## 12. Accessibility

- **Dragging is the whole input, and there is no fallback.** That is a decision,
  taken 2026-08-03, not an omission: a chase is a continuous input, and every
  discrete substitute we could think of — tap a spot and walk there, tilt, hold a
  direction pad — is either a different game or trivially better than dragging.
  Rather than ship a bad one, the game ships without.

  So say who that excludes: **anyone who cannot sustain precise dragging for a
  60–90 s round.** They cannot play this game. Other games in the catalogue can be
  played one-handed, by tap, or by a single flick, and Sling Puck's tap-to-launch
  (§13 there) exists precisely because a fallback *was* possible there. Here it is
  not, and that cost is on the record rather than discovered later.

  This is what [../../design/ui-guidelines.md](../../design/ui-guidelines.md) §7
  now allows: a mechanic **should** declare a fallback, and a game that
  deliberately does not must name who it excludes. This is that naming.
- **`capped` mode lowers the motor demand**, and that is worth stating honestly.
  Placing a destination needs far less precision than tracing a whole path, and it
  forgives a wobbling finger entirely. It is **not** a fallback — it still needs a
  sustained hold, so it does not help the players named above — but it is a real
  mitigation, and a host who knows their group should reach for it.
- Lives are a **number**, never only a row of pips.
- Grace reads by **outline**, not by colour (§7).
- No strobing. A catch is not a flash.

## 13. Open questions

- **Is dragging your own icon the right input?** It is direct and needs no
  tutorial, but it puts your thumb on top of the thing you are trying to see. A
  thumbstick in a corner is the alternative, and it is worse to explain and better
  to look at. Only a play test settles it.
- **Does `CM_CAT_COOLDOWN_MS` kill scribbling in `direct` without making the cat
  feel broken?** This is now the main balance unknown: too short and the cat farms
  lives by sweeping, too long and a cat who earned a catch is made to stand still
  for it.
- **Can the cat camp the centre respawn?** The centre is a fixed point the cat can
  sit on. Grace plus dragging during grace should make camping a bad idea rather
  than a free kill, but only a play test shows whether it feels that way.
- **Do both modes want the same `CM_LIVES` and round length?** `direct` is faster
  and more chaotic; it may burn three lives well before `CM_ROUND_CAP_MS` while
  `capped` times out.
- **Does the cat rotate, or is it earned?** Rotating is fair; "whoever was caught
  last is the next cat" is funnier and punishes the worst mouse twice.
- **Is 2 players a game?** One cat, one mouse, nowhere to hide and nobody to
  share the cat's attention. It may need a smaller floor, or a 3-player minimum.
- **Does a shared board even work on phones of very different sizes?** The
  letterboxing in §5 makes the *coordinates* agree, but a 4.7" screen shows the
  same floor smaller, so the same swipe is a shorter real distance. Worth watching
  for whether the big-phone player has an advantage.
