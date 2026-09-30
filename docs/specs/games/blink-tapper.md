# Blink Tapper

| | |
| --- | --- |
| **Slug** | `blink-tapper` |
| **Catchy sentence** | Catch the blink. Miss it and lose the point |
| **Illustration** | `www/src/games/blink-tapper/art/card.svg` — a bulb mid-flash with a finger closing in on it, a second bulb dim beside it waiting its turn |
| **Players** | 1–8 |
| **Round length** | 30 s / 60 s / 100 s, or unlimited (ends at 10 misses) |
| **Inputs** | touch |
| **Accent colour** | `#FFC400` |
| **Status** | 🎮 beta |

## 1. Pitch

One light, blinking. Tap it while it's lit and you score; let it go dark
without tapping it and you pay for it. It starts lazy enough to look easy — a
blink every two seconds — and by the one-minute mark it is flickering faster
than any thumb can follow. Whoever is still ahead on points when it's over
wins.

## 2. Core loop

1. The host sets the options (§3) and starts. The referee broadcasts a shared
   start time; from there every phone runs its own blink loop against that
   clock and reports back only once, at the very end (§6) — **the blinking and
   the scoring both happen entirely on the phone**.
2. Each **blink** is one on/off cycle at the current interval (§2.1): the
   light turns on, stays on for `BLINK_ON_FRACTION` of the interval, and goes
   dark for the rest — the next blink follows immediately after.
3. **Tap while it's on** and it goes dark early: +1, and the light waits out
   the rest of this cycle before the next blink starts.
4. **Let it go dark on its own** and that blink counts as a miss: −1.
5. **Tap a dark light, or the wrong one**, and that is a miss too: −1. Without
   it a thumb mashing every light would score every blink.
6. With more than one light (§3), each blink lands on the next light in a
   fixed rotation, one at a time — never two lit together.
7. The round ends at the chosen duration, or — in `unlimited` — the moment a
   player reaches 10 misses (§7).

**Win condition:** highest net score (hits minus misses) when the round ends.
A tie at the top is unranked.
**Scoring:** +1 for a tap on the lit light, −1 for a blink that goes dark
untapped and −1 for a tap on a dark or wrong light. Nothing else scores.

### 2.1 Cadence — the one thing that isn't a constant fight over tuning

The blink **rate** (not the interval) climbs linearly:

```
rate(t) = BLINK_START_RATE + (BLINK_MAX_RATE - BLINK_START_RATE) · min(t, BLINK_RAMP_MS) / BLINK_RAMP_MS
```

`BLINK_START_RATE` = 0.5/s (one blink every two seconds — the first one is
~1.4 s in practice, because the rate starts climbing at once), `BLINK_MAX_RATE` =
30/s, `BLINK_RAMP_MS` = 60 000. Past the ramp, the rate holds flat at 30/s —
this is the literal reading of the issue ("linearly increases until 30 blinks
per second after 60 sec and stay at this pace"), and it is well past human
reaction time on purpose (§12 Q2).

The **interval** between blinks is `1 / rate(t)`, shrinking from 2000 ms down
to ~33 ms — and each blink is on for `BLINK_ON_FRACTION` (0.5) of whatever that
interval currently is.

Rate rather than interval is what climbs linearly because it is what makes
the anti-cheat bound in §8 a closed-form integral instead of a per-sample
simulation: the number of blinks a phone could possibly have shown by elapsed
time `t` is `∫ rate`, computable on the referee with nothing but `t`. The same
integral is how the phone plays: its integer part is the blink under way, its
fraction how far through that blink the light is (`shared/blink.ts`). Blinks
are scored **by index, not by frames seen** — at 30 a second a blink is two
frames long, and one a phone never drew has still gone by.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Tap the blink before it's gone | baseline |

There is one mode. The two host choices below are **options**, not modes —
the same call Math-o-matic's spec makes — and travel in the `start` payload
rather than the mode slug.

**Host options**, set in the lobby before Ready/Start, host-only to edit and
read-only for everyone else:

| Option | Values | Default |
| --- | --- | --- |
| Number of lights | 1–4 | 1 |
| Round duration | 30 s / 60 s / 100 s / unlimited | 60 s |

On the wire a duration of 0 is `unlimited`. Anything else that arrives falls
back to the default rather than to a neighbour (`normaliseBlinkOptions`).

More lights does not change the cadence in §2.1 at all — it only spreads the
same blinks across more positions, so each individual light blinks less often
while the player has more places to watch at once. That trade is the entire
reason the option exists.

## 4. Screens

Lobby (with the options panel) → primer (safety, §9) → countdown → round →
results.

The lobby carries the flashing warning (§9) and the options panel, above
Start.

The round screen is portrait, one light or up to four laid out for an even
glance — one centred and big; two side by side; three as two over one; four as
a 2×2 grid — each a plain circle that switches between a dim and a lit fill,
with no transition (a fade would smear one blink into the next). A tap flashes
a green or red ring on the light it landed on.

The results show each player's points and their accuracy — hits as a share
of everything scored, hits and misses together. A player who scored nothing
shows no accuracy rather than 0%. Above them: the running net score, big. In `unlimited`,
misses remaining before elimination ("7 misses left") next to it; in a timed
round, the seconds left instead.

No per-seat difference — every phone shows the identical layout, running its
own independent schedule from the same shared start time.

## 5. Inputs & sensors

Touch only. No sensors, no permissions, no fallbacks needed.

## 6. Networking

**The phone runs the whole round and reports once, at the end.** This is
lighter than anything else in the catalogue: even Maximum Jump, the closest
precedent, reports once per attempt (`jump-result`, its own spec §6) — Blink
Tapper reports once for the *entire round*, because the issue is explicit that
"blinking process and point counting is fine on client." Profile A
([../../realtime-options.md](../../realtime-options.md) §1), pared down as far as it
goes.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `start` | client → server | `{ mode: 'blink', solo, blink: { lights, duration } }` | Host starts; carries the lobby's own option choices |
| `blink-tapper` | server → all | `{ roundId, phase, startsAt, endsAt, options, finals: {id: {hits, misses, score} \| null}, solo, winner }` | Sent at start — `startsAt` is the shared clock every phone schedules its blinks against — and again as each final arrives |
| `blink-final` | phone → room | `{ roundId, hits, misses }` | Sent once, when this phone's own round ends; the referee computes the score |

The referee owns nothing about the blinking itself — only `startsAt`, the
options every phone must schedule against, and the ladder of finals as they
arrive. It ends the round once every connected phone has reported or
`BLINK_REPORT_GRACE_MS` has passed since the round's expected end
(`startsAt` + duration for a timed round, `startsAt` +
`BLINK_UNLIMITED_CAP_MS` for `unlimited`, §7).

**Latency tolerance:** nothing here is frame-perfect between players — each
phone only ever races its own clock, never another phone's tap — so the
100–300 ms budget in [../../multiplayer.md](../../multiplayer.md) §6 is spent
entirely on `startsAt` agreeing closely enough that two phones' *rates* line up,
not on any single tap.

## 7. Failure & edge cases

- **Player leaves mid-round**: no `blink-final` ever arrives; scored as DNF,
  excluded from the winner calculation, and the round proceeds for everyone
  else exactly as if they had never joined it.
- **Host leaves**: promoted silently, standard flow.
- **Too few players**: one is a legitimate round (1–8); solo has no winner.
- **Backgrounded tab**: the schedule is anchored to `startsAt`, a shared
  timestamp, not to the phone's own render loop — so a phone that comes back
  from the background has simply missed every blink that passed while hidden,
  the same as Maximum Jump's "the attempt in flight is lost" (its own spec
  §7). The round does not wait for it.
- **`unlimited` and a player who never taps at all**: every blink past
  the on-window is a miss, so 10 misses arrives in well under a minute even at
  the starting cadence (10 × 2 s at the slowest, far sooner once it has
  ramped) — so a phone left alone ends its own round within seconds. The
  room still needs an alarm for a phone that has gone *silent* (disconnected,
  not unlucky), and `BLINK_UNLIMITED_CAP_MS` (3 min) is that: past the top of
  the ramp nobody survives long, so no honest round comes near it.
- **`unlimited` and different players hitting 10 misses at different times**:
  expected and fine — each phone ends and reports independently; the round
  itself ends once every connected phone has either reported or timed out.
- **Nobody taps anything, ever**: everyone finishes at or below zero, still a
  legitimate result — whoever is least negative wins.
- **Ties**: a tie at the top is unranked — no winner — the same call every
  other game in the catalogue makes.

## 8. Anti-cheat

The phone reports its own `hits` and `misses` once, so the referee bounds
the claim by what the cadence in §2.1 could possibly have produced — a closed
form, not a simulation:

```
blinksByElapsed(t) = BLINK_START_RATE·t + (BLINK_MAX_RATE - BLINK_START_RATE)·min(t, BLINK_RAMP_MS)² / (2·BLINK_RAMP_MS)
                      + BLINK_MAX_RATE·max(0, t - BLINK_RAMP_MS)
```

(the integral of `rate(t)` from §2.1, split at the ramp). For an elapsed time
`t = now - startsAt`, the referee clamps every claim to:

- `hits ≤ ⌊blinksByElapsed(t)⌋ + 1` — no more hits than blinks had started
  (`maxHits`), with `t` capped at the round's own length,
- the score is the referee's own `hits − misses`, never sent by the phone,
- in `unlimited`, `misses ≤ 10` — the limit that ended it.

Misses have no upper bound: a tap on a dark light is a miss and taps are
unbounded, and the only phone an inflated miss count hurts is the one sending
it.

A report over the bound is **clamped, not rejected** — the same call Asteroid
Race's §8 makes, so a phone whose clock drifts a little is trimmed rather than
thrown out. Note the option for "number of lights" plays no part in the bound:
it only decides which light a blink lands on, never how often blinks happen,
so a client cannot inflate its allowance by lying about it.

What is left unsolved: a client that reports an honest-looking number within
the bound but did not actually earn it is indistinguishable from one that did
— the same posture Gravity Shooter's and Ball Bounce's own §8 take with a
trusted outcome. This is a party game among people in one room.

## 9. Safety

⚠️ **This game flashes well above the repo's usual 3 Hz ceiling**
([../../design/ui-guidelines.md](../../design/ui-guidelines.md) §7) — by
design, ramping to 30 Hz, ten times over it. That ceiling exists because
flashing above roughly 3 Hz is a recognised trigger for photosensitive
seizures, and this game is allowed past it by explicit maintainer decision —
an exception recorded in ui-guidelines.md §7, not a precedent for any other
game.

The primer, before anyone plays, says plainly: **this game flashes fast, and
gets faster — anyone with photosensitive epilepsy or a flash sensitivity
should not play.** The lobby carries the same line so a player choosing the
game sees it before they join, the same rule Rhino Spin's throwing warning
follows for its own exception.

## 10. Data & privacy

Nothing leaves the phone during play at all. At the very end, one message
carries three small integers. Nothing about individual taps or timings is
ever sent or stored.

## 11. Accessibility

**No fallback is offered, and none is possible** — the mechanic is tapping a
light the instant it changes state, which excludes anyone who cannot see a
fast visual change or react to one, the same carve-out §2 of
[../../device-capabilities.md](../../device-capabilities.md) allows for a
mechanic that is one physical/perceptual act through and through (Rhino Spin's
own spec §11 makes the identical call for throwing). The lobby says so before
anyone joins.

Beyond that population, the ramp itself is the accessibility floor from
roughly the one-minute mark on: nobody's reaction time clears 30 Hz, so the
late game is closer to "how long can you keep up" than a fair contest — which
is the intended shape of the party game (§12 Q2), not a bug to work around.

No sound is required or offered; there is nothing to say about hearing here.

## 12. Open questions

1. **The 3 Hz exception is recorded, not yet playtested.** Whether the primer
   copy in §9 is enough warning, or whether the game needs a harder gate (a
   confirmation tap, not just a line of text) before anyone can start it, is
   worth a second look once it exists.
2. **Is racing past human reaction time the actual design, or a numbers
   slip?** The issue is explicit about 30 blinks/sec by 60 s, so this spec
   takes it literally — the late game becomes "everyone loses points at
   roughly the same rate" rather than a skill contest. If that is not the
   intent, `BLINK_MAX_RATE` and `BLINK_RAMP_MS` are the two numbers to revisit,
   not the cadence formula itself.
3. **`BLINK_ON_FRACTION` = 0.5 is this spec's own invention** — the issue says
   nothing about how long a light stays lit relative to its own interval.
   Untested on real thumbs at any speed, let alone near the top of the ramp.
4. **Guests see the options panel at its defaults, not the host's picks** —
   the same as Math-o-matic's panel: the choice only reaches other phones in
   the `start` frame. Worth a lobby message of its own if it confuses a room.
5. **Does `unlimited` need a shared "misses remaining" ladder** so players can
   see how close everyone else is to being out, or is each phone's own count
   enough? Nothing in the issue says the ladder is live during play, and §6
   deliberately keeps the referee silent until the end — a live miss ladder
   would be a second message type this spec does not currently need.
