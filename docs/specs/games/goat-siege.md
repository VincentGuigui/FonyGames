# Goat Siege

| | |
| --- | --- |
| **Slug** | `goat-siege` |
| **Catchy sentence** | *Shoo the neighbours' goats before they eat your cabbages* |
| **Illustration** | `illustrations/goat-siege.svg` — a tidy row of cabbages, three goats sailing in over the fence, one mid-bleat |
| **Players** | 2–4 |
| **Round length** | 2–3 min |
| **Inputs** | touch (tap, drag to aim) |
| **Accent colour** | `#4ADE80` |
| **Status** | 🎮 built and playable. **Beta** — the balance questions in §11 are real and unanswered |
| **Code** | `worker/goatSiege.ts` (referee) · `www/src/games/goat-siege/` (client) · `shared/goatSplit.ts` (split lanes, shared by both) |

## 1. Pitch

You have a vegetable patch. So does everybody else. Everybody's goats are
starving.

Lob a goat over the fence at a neighbour, and tap the ones sailing into yours to
shoo them off. A shooed goat does not politely leave — it **splits into two
kids** that scatter in random directions, and you have to tap those too. Let one
land and it eats a cabbage.

Last patch with a vegetable left standing wins.

## 2. Why goats

The theme is doing real work, not decoration. "Attack splits into two smaller
ones" is arbitrary as missiles and *obvious* as goats: shoo the adult, the kids
scatter. Players will not need the rule explained twice.

Cats-and-dogs was the alternative and was rejected: throwing pets at people
reads worse than shooing livestock out of a garden, and the split has no natural
meaning.

## 3. Core loop

1. Each player starts with **6 cabbages** and a small herd.
2. Drag to aim, release to **lob a goat** at a chosen neighbour's patch.
3. Incoming goats arc in over your fence. **Tap one to shoo it.**
4. A shooed adult goat **splits into 2 kids**, each flying off at a random
   angle, each needing its own tap. Kids do **not** split again.
5. A goat or kid that reaches the ground **eats one cabbage**. Kids eat too — a
   badly-timed shoo is worse than no shoo at all.
6. Lose all 6 cabbages and you are out. Last patch standing wins.

**The tension:** shooing is not free. One tap becomes two problems. Sometimes
you let one through on purpose because you are already swamped.

### Numbers, all provisional

| | |
| --- | --- |
| Cabbages per player | 6 |
| Goat flight time | ~2.5 s |
| Kid flight after a split | ~1.2 s |
| Kids per shooed adult | 2 |
| Do kids split? | No — or the screen becomes a fractal and nobody has fun |
| Lob cooldown | 1.5 s |

## 4. Screens

- **Lobby** — standard, plus who you can lob at.
- **Rules panel** — four seconds at the top of every round
  ([../../design/game-chrome.md](../../design/game-chrome.md) §3). Lobbing is
  rejected server-side until it clears.
- **Patch** — your garden across the bottom, cabbages as discrete objects so
  damage is legible at a glance. Sky above, goats arcing in. A drag from your
  patch shows an aim arc; release lobs.
- **Eaten** — a cabbage vanishes with a chomp; the count is always also a number.
- **Out** — your patch is bare. You keep watching, and you can still see who is
  winning.
- **Result** — cabbages remaining per player, winner first.

The row of opponent buttons is labelled **Attack**. The gear in the corner opens
the shared in-game menu (how to play, leave game).

## 5. Networking — the expensive one

This is the first game in the catalogue that is **continuously animated**, and
that has a real cost. Two ways to do it:

| Approach | Cost | Verdict |
| --- | --- | --- |
| Stream positions at 20 Hz | Profile **B** — ~28,800 msgs/round | Rejected |
| Send **trajectories**, animate locally | Profile **A** — a few hundred | **Chosen** |

A goat is a deterministic arc. Sending `{id, from, to, launchedAt, arrivesAt,
seed}` once lets every client draw the whole flight without another byte. Only
*events* cross the wire: a lob, a shoo, a split, a cabbage eaten.

The split direction comes from the **server's** `seed`, so every phone draws the
kids going the same way without any of them deciding it locally. The function
that turns a seed into lanes lives in `shared/goatSplit.ts` and is run by both
sides — same reasoning as Spill's shared geometry: two copies of the same maths
is two chances to disagree.

Kids scatter *away* from where the adult was, alternating sides, and are clamped
inside the patch. A kid that drifted off-screen could not be tapped, so it would
be an unavoidable lost cabbage — a punishment for playing well.

| Message | Direction | Payload |
| --- | --- | --- |
| `lob` | client → server | `{ to, roundId }` |
| `shoo` | client → server | `{ goatId, roundId }` |
| `siege` | server → clients | Whole round: `{ roundId, players, cabbages, out, air, phase }` |
| `goat` | server → clients | `{ goatId, victim, from, kind, lane, launchedAt, arrivesAt, seed }` |
| `split` | server → clients | `{ goatId, by, kids: Goat[] }` — empty `kids` when a kid was shooed |
| `chomp` | server → clients | `{ goatId, victim, cabbages, out }` |
| `siege-over` | server → clients | `{ roundId, winnerId, cabbages }` |

Two departures from the sketch above, both deliberate:

- **`lob` carries no angle.** You choose a *patch*, not a trajectory. An angle
  would imply the arc is aimable, and it is not — where a goat crosses the
  fence is the server's `lane`, and pretending otherwise would be a lie in the
  interface.
- **`shoo` carries no client timestamp.** Unlike a Tap Duel reaction, nothing
  here is scored on speed: a shoo is either inside the goat's flight window or
  it is not, and the server already knows when that window is. Accepting a
  client time would add an attack surface for no gain.

`lane` is where the goat crosses the fence, 0..1 across the patch. It is derived
from the seed by golden-ratio stepping rather than drawn at random, so
successive lobs land far apart and a resent state puts every goat back exactly
where it was.

**The server owns the clock and the outcome.** A shoo is accepted only if it
arrives before that goat's `arrivesAt`, judged in server time — the same
clock-corrected comparison Tap Duel uses.

Costed against the free tier: a 3-minute 4-player round is on the order of a few
hundred messages, so this stays comfortably inside the Cloudflare allowance from
[../../realtime-options.md](../../realtime-options.md).

## 6. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player leaves | Their patch stops receiving; goats already in flight there vanish |
| A player is out | They spectate; they cannot lob |
| Two players shoo the same goat | Cannot happen as built: a goat belongs to one patch, and only its victim may shoo it |
| A shoo lands after the goat has already eaten | Rejected — the chomp already happened |
| Shooing a **kid** | It simply vanishes. Kids do not split again, or the screen becomes a fractal |
| A player drops off the network | Same rule as Spill: they are only out once their seat is reaped, so a refresh does not cost them the round |
| Everyone is out at once | Draw |
| Refresh mid-round | Same seat, same cabbages; goats in flight are re-sent |
| Tab backgrounded | Goats keep arriving; on return the state is resynced rather than replayed |

## 7. Anti-cheat

- **Cabbage counts change only on the server.**
- A shoo is only valid inside that goat's flight window.
- Lob cooldown enforced server-side.
- Auto-tapping every incoming goat is the obvious bot. It is also **not
  obviously good play**, because every shoo doubles the incoming count — the
  mechanic itself punishes indiscriminate tapping, which is a nicer defence than
  a rate limit.

## 8. Safety

None. Nobody moves, nothing is swung. Rapid tapping is the only physical strain;
rounds are capped so it stays short.

## 9. Data & privacy

Lob and shoo timestamps, player id, name, avatar. Nothing else, and none of it
outlives the room ([../../database.md](../../database.md) §1).

## 10. Accessibility

- Tapping small moving targets is the core skill, and that **excludes people**.
  A `calm` mode with slower flight and larger goats belongs in the first
  iteration, not a later one.
- Goats must be distinguishable by **silhouette**, not colour — adult and kid
  have clearly different shapes and sizes.
- Cabbage count is always a number, never only a row of icons.
- No strobing. A chomp is one animation, not a flash.

## 11. Open questions

- Is 6 cabbages too few? A round that ends in 30 s is not a round.
- **Is shooing strictly bad?** As built, a kid eats a full cabbage, so shooing an
  adult and missing both kids costs *two* cabbages instead of one — the logic
  tests assert exactly that. If players learn to never tap, the central mechanic
  is broken and kids need to be worth half a cabbage, or to fly slower. **This
  is the one question a play test must answer.**
- Can you aim at a *specific* patch with 4 players, or is it a random neighbour?
  Currently chosen, which rewards ganging up on the leader. That might be the
  best part or the worst part.
- Do goats bleat? Yes. (D9 says sound is M6, so: eventually.)

## 12. Not built yet

- The `calm` mode promised in §10 — slower flight, larger goats. The renderer
  honours `prefers-reduced-motion` for the idle bobbing only, which is **not**
  the same thing and does not discharge that promise.
- Per-goat sound (D9, M6).
