# Spill

| | |
| --- | --- |
| **Slug** | `spill` |
| **Catchy sentence** | *Fling your water at the neighbours before they flood you* |
| **Illustration** | `illustrations/spill.svg` — four phones laid flat in a square, a fat droplet arcing from one to the next |
| **Players** | 2–4 (4 is the cap until we field-test more) |
| **Round length** | 1–3 min |
| **Inputs** | touch (drag / flick) |
| **Accent colour** | `#38BDF8` |
| **Status** | 📝 spec — not built |

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

> Why not the compass? `webkitCompassHeading` would let each phone discover its
> own rotation and drop the convention. It also needs a motion permission, is
> famously inconsistent between iOS and Android, and is useless indoors near
> metal. A one-line instruction beats a flaky sensor.

**When M9 lands**, the draw-across-devices gesture measures the true positions
and the convention becomes a fallback rather than a requirement.

## 3. Core loop

1. Everyone lays their phone out per the diagram; host starts.
2. Each phone begins with **20 drops** — the water sits at half height, moving.
3. **Flick** to fling a drop toward a neighbour.
4. You **cannot flick again until your drop has left your screen** (§4).
5. A drop that lands adds to that player's water.
6. An incoming drop can be **caught** — see §5. A caught drop doubles.
7. First to **0 drops wins**. First to **40 drops is out**.

## 4. Launch lock

> *A user cannot launch another drop until his previous drop leaves his screen.*

The lock is owned by the **server**, not the animation: the client would
otherwise be free to lie. On a flick the server computes the drop's exit time
from the flick speed and the distance to the screen edge, clamped to
`[LAUNCH_LOCK_MIN, LAUNCH_LOCK_MAX]`, and rejects any flick from that player
until then. The client animates the same interval, so the rule reads as physical
rather than as a cooldown.

## 5. Catching

While a drop is travelling toward you, it is visible on your screen for
`APPROACH_MS` before it lands. Touch it in that window and you **catch** it:

- It does **not** join your water.
- It becomes worth **2×** what it was.
- You may fling it at **anyone**, including back where it came from.
- Hold it longer than `HOLD_MS` and it soaks in — you take the doubled amount.

That is the risk: catching is the only way to move a big payload, and the only
way to take one in the face.

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
    index.ts       the Theme interface + registry
    water.ts       default
    balloon.ts     water balloons
    poo.ts         inevitable
```

A theme supplies everything visual and nothing else:

```ts
export type Theme = {
  id: string;
  name: string;              // shown in the lobby picker
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

Adding a theme is adding one file and one registry line. **No theme may change
the rules** — sizes, speeds and counts live in `game.ts`.

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
| `fling` | client → server | `{ angle, speed, roundId }` — screen-space angle |
| `catch` | client → server | `{ dropId, roundId }` |
| `drop` | server → clients | `{ dropId, from, to, size, arrivesAt }` |
| `land` | server → clients | `{ dropId, on, size, levels }` |
| `levels` | server → clients | `{ levels: Record<PlayerId, number> }` |
| `over` | server → clients | `{ winner, loser, levels }` |

Traffic is **event-driven, not streamed** — a flick, a catch, a landing. That
keeps it in Profile A of the cost model ([../../realtime-options.md](../../realtime-options.md) §1),
so a round costs almost nothing. Drop flight is animated client-side from
`arrivesAt` in server time, exactly like Tap Duel's fire signal.

## 8. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves mid-round | Their seat empties; drops aimed there are lost. Below 2 players the round ends |
| Flick outside `AIM_TOLERANCE` | Water leaves, lands nowhere. Legal and sometimes smart |
| Two drops land at once | Both apply; the server holds one count |
| A player refreshes | Same seat, same level ([../../realtime-server.md](../../realtime-server.md) §4) |
| Someone rotates their phone mid-round | Their aim is now wrong. The layout diagram stays reachable from a corner button |
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
- Should the name survive theming? "Spill" reads fine for water and poo, poorly
  for balloons.
- 5+ players: the ring gets crowded and aiming tolerance shrinks. Capped at 4
  deliberately.
