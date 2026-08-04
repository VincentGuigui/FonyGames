# Spill

| | |
| --- | --- |
| **Slug** | `spill` |
| **Catchy sentence** | *Fling your water at the neighbours before they flood you* |
| **Illustration** | `www/src/games/spill/art/card.svg` — four phones laid flat in a square, a fat droplet arcing from one to the next |
| **Players** | 2–4 (4 is the cap until we field-test more) |
| **Round length** | 1–3 min |
| **Inputs** | touch (drag / flick) |
| **Accent colour** | `#38BDF8` |
| **Status** | 🎮 `ring` mode built and playable. **Beta** until a real table test — every number in §12 is still a guess |
| **Code** | `worker/spill.ts` (referee) · `www/src/games/spill/` (client) · `shared/spillGeometry.ts` (the seating maths, shared by both) |

## 1. Pitch

Phones go flat on the table in a ring. Each one is half full of water. You flick
your water off your screen and onto somebody else's — and because the phones are
physically arranged, **you aim in the real world**: flick toward Ben and it
lands on Ben's phone.

Empty your phone and you win. Reach forty drops and you are out.

The novelty is that the table *is* the game board. Nothing else in the catalogue
uses the physical arrangement of the devices.

## 2. The hard part: how does a phone know where the others are?

Aiming across devices needs a **shared coordinate frame**. Two ways to get one:

| Approach | Verdict |
| --- | --- |
| **Assigned seats + a placement convention** | **v1.** No sensors, works today. |
| Draw-across-devices calibration | The real answer, but it is M9 ([../join.md](../join.md) §2.3) |

### v1 — the convention

The lobby assigns each player a **seat index** `0…N-1` and shows a diagram of
where to put their phone. The rule shown to players is one line:

> **Lay your phone flat, screen up, with the top edge pointing at the middle of
> the table.**

That single convention is what makes aiming work without any sensor. With it:

- Seat `k` sits at angle `αₖ = 2πk/N` around the table centre.
- That phone's screen-up direction points **inward**, i.e. world bearing
  `αₖ + π`.
- A flick on that screen at angle `φ` clockwise from screen-up therefore has
  world bearing `αₖ + π + φ`.

The server converts every flick into a world bearing, works out which seat lies
closest to it, and delivers the drop there if the error is within
`AIM_TOLERANCE`. Outside the tolerance the drop sails off the table and is lost
(and, pleasingly, still leaves your phone — a wild flick is a free way to lose
water, which keeps wild flicks tempting rather than punished).

Layouts: **2** = facing each other, **3** = triangle, **4** = square.

#### As built

`shared/spillGeometry.ts` is the single source of this maths, imported by the
Worker (which referees every flick) and the browser (which draws the diagram and
the aim preview) so the two cannot drift apart. Its frame is **the view from
above, with canvas handedness** — x right, y down, angles clockwise from up —
because mixing handedness between a table model and a canvas is the obvious way
to end up with an aiming system that is silently mirrored.

The resulting screen angles are pleasingly simple, and identical from every
seat:

| Players | Where you flick to hit each opponent |
| --- | --- |
| 2 | straight up (0°), tolerance ±63° |
| 3 | ∓30°, tolerance ±42° |
| 4 | −45° / 0° / +45°, tolerance ±32° |

Tolerance is `SPILL_AIM_FRACTION` (0.7) of the half-gap between seats, so there
is always a sliver you can miss through.

**The layout diagram is drawn from each player's own point of view**, and uses
true relative positions rather than one radius per seat — with four players the
seat opposite is √2 further away, and plotting everyone at one radius turns a
square table into a huddle. Each phone glyph is also rotated so *its* top edge
faces the middle: a diagram that showed every phone upright would contradict the
one instruction it exists to give.

> Why not the compass? `webkitCompassHeading` would let each phone discover its
> own rotation and drop the convention. It also needs a motion permission, is
> famously inconsistent between iOS and Android, and is useless indoors near
> metal. A one-line instruction beats a flaky sensor.

**When M9 lands**, the draw-across-devices gesture measures the true positions
and the convention becomes a fallback rather than a requirement.

## 3. Core loop

1. Everyone lays their phone out per the diagram; host starts.
2. A four-second rules panel holds every screen
   ([../../design/game-chrome.md](../../design/game-chrome.md) §4). Flinging is
   rejected server-side until it clears, so nobody gets a head start by
   dismissing it.
3. Each phone begins with **20 drops** — the water sits at half height, moving.
4. **Flick** to fling a drop toward a neighbour.
5. You **cannot flick again until your drop has left your screen** (§4).
6. A drop that lands adds to that player's water.
7. An incoming drop can be **caught** — see §5. A caught drop doubles.
8. First to **0 drops wins**. First to **40 drops is out**.

## 4. Launch lock

> *A user cannot launch another drop until his previous drop leaves his screen.*

The lock is owned by the **server**, not the animation: the client would
otherwise be free to lie. On a flick the server computes the drop's exit time
from the flick speed and the distance to the screen edge, clamped to
`[LAUNCH_LOCK_MIN, LAUNCH_LOCK_MAX]`, and rejects any flick from that player
until then. The client animates the same interval, so the rule reads as physical
rather than as a cooldown.

## 4a. Two players: the drop bounces

With three or four phones the ring is the game — you pick a neighbour and aim at
them. With **two** it degenerates: there is one opponent, so a flick either hits
them or sails off the table, and the direction you flicked stops meaning anything.

So with two players the drop **bounces off the left and right edges** and keeps
going, and when it crosses the join onto the other screen it **keeps its
direction**. Now the flick chooses *where on their screen* it arrives and *from
which side* — which is worth being good at, and worth watching.

The geometry (`shared/spillGeometry.ts`):

- The two half-boards are one strip. The whole flight is a **single straight
  line** through it, reflected off the sides; the bounces are the folding, not
  extra cases.
- The receiver's screen is the mirrored continuation of that line, so the handoff
  is `x → A − x` and nothing has to *preserve* the direction — it survives
  because the mirror is the crossing. The same trick as Sling Puck's rotation
  ([sling-puck.md](sling-puck.md) §4).
- The strip is `SPILL_NOMINAL_ASPECT` wide (0.46 — a nominal phone), **not** the
  real screen. Both ends have to agree on where the drop crosses, and they cannot
  agree on something only one of them can measure. Nothing new goes on the wire:
  the flick angle already there is enough for both to compute their own half.
- A drop that **missed** the table has no path to the other side, so it still
  just sails off along its angle. Flicking backwards is still how you throw water
  on the floor.

The aim preview draws the bounces too. A preview that showed a straight line
would be showing the player something that is not going to happen.

It follows that the splash lands **where the path ran out**, not in the middle of
the screen — which is the visible payoff for aiming.

## 4b. Everyone else's count, where they are

Each other player's avatar and current count are drawn **at their real position
around the table**, using the same bearing that aims a flick at them
(`screenAngleTo`).

Two reasons it goes there rather than in a list:

- It is the score. Spill is a race to empty, so who is close to winning is the
  single most useful thing on screen, and the throw row at the bottom did not
  carry it.
- It reinforces the one convention the game depends on. A number that sits in the
  direction of the person holding that phone teaches the table layout every time
  you glance at it.

Every other seat is across the table from you, and your top edge points at the
table centre, so **every marker lands in the upper part of the screen** — the
bottom stays clear for the throw row. That is a property of the seating, not a
layout fudge.

## 5. Catching

While a drop is travelling toward you, it is visible on your screen for
`APPROACH_MS` before it lands. Touch it in that window and you **catch** it:

- It does **not** join your water.
- It becomes worth **2×** what it was.
- You may fling it at **anyone**, including back where it came from.
- Hold it longer than `HOLD_MS` and it soaks in — you take the doubled amount.

That is the risk: catching is the only way to move a big payload, and the only
way to take one in the face.

**A hold has exactly two ends**, and the client must be told about both: the
`drop` frame that throws it on carries `replaces`, and a soak arrives as `land`.
Missing the first end was a real bug — the client kept a phantom hold, attached
its dead id to every later flick, and the server rejected all of them, locking
the player out for the rest of the round with a stalled timer on screen. If a
third way to end a hold is ever added, it needs a frame too.

## 6. Theming — a hard requirement

> *The rendering should be done by a specific file so it is possible to change
> artistic direction easily, or let the player choose a theme.*

Game logic and rendering are **completely separate**. The rules never mention
water.

```
games/spill/
  game.ts          rules, state, networking — no drawing, no theme words
  render.ts        canvas loop; asks the theme what to draw
  themes/
    index.ts       the Theme interface
    water.ts       the one theme
```

A theme supplies everything visual and nothing else:

```ts
export type Theme = {
  id: string;
  name: string;
  accent: string;
  /** The pool at the bottom of the screen. `level` is 0..1. */
  drawPool(ctx: CanvasRenderingContext2D, level: number, t: number): void;
  /** One projectile. `size` is 1 for a normal drop, 2 after a catch. */
  drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: number): void;
  drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void;
  /** Words the UI uses, so "drops" is not baked in. */
  words: { unit: string; unitPlural: string; verb: string };
};
```

Adding a theme is adding one file. **No theme may change the rules** — sizes,
speeds and counts live in `game.ts`.

### As built

The real interface takes a `ThemeDraw` bundle (`ctx`, `w`, `h`, `t`, `calm`)
rather than a long argument list, and adds `drawBackdrop`.

**One theme ships: `water`, and it is not a player-facing setting.** A `balloon`
theme was built alongside it to prove the interface was a real abstraction rather
than water with a colour knob — balloons are discrete objects, not a liquid, so
they exercised parts of `Theme` water never touched. It did its job and has been
**removed**: the maintainer did not want it in the game, and a picker with one
entry is not a picker. What the exercise leaves behind is the interface itself,
and the confidence that a second look would slot in without touching `game.ts`.

Rules any future theme still has to keep:

- **The chrome must stay readable.** The board scrims the top and bottom strips
  precisely so no theme can make the HUD illegible.
- **Projectile size is fixed across themes** (`18 * √size`). Changing it would
  quietly change how hard the game is to play, which is a rule change.
- `calm` (from `prefers-reduced-motion`) **flattens, never removes**.

There is no picker and no stored preference. Both were removed with the second
theme; `localStorage` no longer holds anything for Spill.

### The water look

Wavy and alive, per the request. Two summed sine waves at different frequencies
and speeds for the surface, a lighter band under the crest, and the whole pool
tilted slightly by the last flick so it sloshes. Cheap: one `<canvas>`, one path,
no physics engine. `prefers-reduced-motion` flattens the waves to a still
surface rather than removing the pool.

## 7. Networking

Server-authoritative. Clients send intent; the server owns every count.

| Message | Direction | Payload |
| --- | --- | --- |
| `fling` | client → server | `{ angle, speed, roundId, dropId? }` — screen-space angle; `dropId` re-flings a caught drop |
| `catch` | client → server | `{ dropId, roundId }` |
| `spill` | server → clients | Whole round: `{ roundId, seats, levels, out, air, phase }` |
| `drop` | server → clients | `{ dropId, from, to, angle, size, launchedAt, leavesAt, arrivesAt, levels }` |
| `caught` | server → clients | `{ dropId, by, size, soaksAt }` |
| `land` | server → clients | `{ dropId, on, size, levels, out }` |
| `spill-over` | server → clients | `{ roundId, winnerId, levels }` |

Three details of the shapes above are load-bearing:

- **`speed` is in screen heights per second, not pixels.** The server must not
  need to know how big anyone's phone is, and a device-independent unit is what
  lets one clamp be fair on a small Android and a large iPhone alike.
- **`drop` carries `levels`.** Flinging is the only thing that empties your
  phone, so without it your own counter would sit unchanged for the second and
  a half until the drop landed somewhere else.
- **`drop` carries `angle`.** The thrower animates it leaving along that angle;
  the target animates it arriving from *their* bearing back to `from`. That is
  what makes the physical arrangement legible in both directions — water comes
  in from the side of the screen the thrower is actually sitting on.

There is no separate `levels` message: every frame that can change a level
already carries the new ones, which keeps the round inside Profile A.

Traffic is **event-driven, not streamed** — a flick, a catch, a landing. That
keeps it in Profile A of the cost model ([../../realtime-options.md](../../realtime-options.md) §1),
so a round costs almost nothing. Drop flight is animated client-side from
`arrivesAt` in server time, exactly like Tap Duel's fire signal.

## 8. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Their **seat stays put** and becomes a hole; drops aimed there are lost. Renumbering seats would silently rotate everyone else's aim. Below 2 players the round ends |
| A player drops off the network | Nothing happens until their seat is actually reaped (`RECONNECT_GRACE_MS`). Acting on the socket closing would knock anyone who refreshed out of the round |
| Flick outside `AIM_TOLERANCE` | Water leaves, lands nowhere. Legal and sometimes smart |
| Two drops land at once | Both apply; the server holds one count |
| A player refreshes | Same seat, same level ([../../realtime-server.md](../../realtime-server.md) §4) |
| Someone rotates their phone mid-round | Their aim is now wrong. The layout diagram stays reachable from the in-game gear menu ([../../design/game-chrome.md](../../design/game-chrome.md) §3) |
| Both 0 and 40 reached in one tick | Reaching 0 wins; that resolves first |

## 9. Anti-cheat

- **Levels only ever change on the server.** The client renders what it is told.
- The launch lock is server-side (§4), so a modified client cannot machine-gun.
- `angle` and `speed` are clamped to plausible human ranges; a flick faster than
  a finger can move is clamped, not rejected — silently capping a cheat is
  better UX than accusing an honest player with a fast screen.
- `catch` is only honoured inside that drop's approach window.

## 10. Safety

Phones are flat on a table and nobody moves. The only caution worth printing:
**no actual liquids near the phones.** The joke writes itself and someone will
try it.

## 11. Accessibility

- Flicking needs a directional drag, which is harder than a tap. A **tap-a-seat
  fallback** picks the target from a list and flings at standard speed — slower,
  fully playable, always available rather than only on request.
- Level is shown as a **number as well as** the pool height; never height alone.
- Themes must keep projectiles distinguishable from the background at a glance;
  the theme registry notes this as a review criterion.

## 12. Open questions

- Is 20 starting drops and 40 to lose the right shape? Pure guesswork until a
  table test.
- Does a caught drop keep doubling if it is caught repeatedly? A drop bouncing
  around at 2 → 4 → 8 sounds hilarious and possibly game-ending. Currently: yes,
  it keeps doubling, and that is a headline risk to watch.
- 5+ players: the ring gets crowded and aiming tolerance shrinks. Capped at 4
  deliberately.
