# Color Hunt

> Status: **draft, awaiting approval** ([issue #27](https://github.com/VincentGuigui/FonyGames/issues/27)).
> Nothing is built until the maintainer approves this (AGENTS.md §5.2).
> **Q1 in §12 is a governance question, not a design one**: this game as
> written would be the sixth entry on AGENTS.md §4's closed no-fallback list,
> and that list says a sixth needs the maintainer to add it.

| | |
| --- | --- |
| **Slug** | `color-hunt` |
| **Catchy sentence** | *Hunt that exact colour down in the room around you* |
| **Illustration** | `www/src/games/color-hunt/art/card.svg` — a phone-shaped square viewport over a corner of a room, a ring magnifier dead centre filled with flat orange, and the target swatch of the same orange pinned above it |
| **Players** | 2–8 |
| **Round length** | ~6 s per round, no fixed length — a hunt ends when the room stops scoring (§2.1) |
| **Inputs** | camera |
| **Accent colour** | `#14B8A6` |
| **Status** | draft |

## 1. Pitch

The referee names a colour. Everyone points their camera at something that
*is* that colour — a book spine, a jumper, the sky through a window, someone's
shoe — and the magnifier in the middle of the screen tells you what you have
actually found, which is rarely what you think you are pointing at.

It is Color Match (§[color-match.md](color-match.md)) with the room you are
sitting in as the palette. The whole game is people standing up.

## 2. Core loop

1. The referee picks a target colour and sends it to the room.
2. The target sits at the top of every screen. Below it, this phone's own
   camera feed, cropped square. Dead centre, a **magnifier**: a ring showing
   the average colour of the middle `COLOR_HUNT_SAMPLE` × `COLOR_HUNT_SAMPLE`
   pixels of the feed. That average is the colour you are offering.
3. Players move — physically — until the magnifier reads close to the target.
4. When the timer expires, each phone sends whatever its magnifier last read.
   The referee scores every submission by distance, exactly as Color Match does
   (§2.2), and the next round starts immediately.

**There is no end-of-round screen.** The issue is explicit about it and it is
the right call: the fun is continuous searching, and a two-second results panel
between rounds would break the one thing this game has that Color Match does
not, which is momentum. Scores appear live on the ladder strip instead (§4).

**Win condition:** highest total when the hunt ends — nobody has scored for
`COLOR_BARREN_ROUNDS` consecutive rounds, or `COLOR_HUNT_CAP_MS` is reached.

**Scoring:** identical to Color Match, from the same `shared/color.ts`: redmean
distance, `round(100 × max(0, 1 − dNorm / COLOR_MISS))`.

### 2.1 Why the same barren-streak ending, with a different reason

In Color Match the ladder outruns the room. Here nothing gets harder — the
difficulty is entirely *what is in the room*. Three scoreless rounds means the
players have run out of surfaces, which happens in a small beige room after
about a dozen targets and never happens outdoors. Same rule, same constant
name, different thing being measured, and worth saying out loud so nobody
later "fixes" one to match the other.

### 2.2 Targets are primary and secondary colours, not the ladder

The issue says *primary, secondary*: red, green, blue, cyan, magenta, yellow,
and this game does not climb. A real room does not contain a
`#7A3FC1`, so a Color Match rung past level 15 would score zero for everybody
every round and end the hunt in three. Six saturated targets, drawn without
immediate repetition, is the whole generator.

**They are not pure `#FF0000` either.** A red book photographed under a warm
bulb is nowhere near `(255, 0, 0)`, so a pure target would be unreachable
indoors. The target is the primary or secondary hue at
`COLOR_HUNT_TARGET_V` value and `COLOR_HUNT_TARGET_S` saturation — a colour a
real object can plausibly be — and §12 Q3 is whether those two numbers survive
a real room.

## 3. Modes / variations

| Mode | Blurb (one line, shown in the lobby) | Difference from core |
| --- | --- | --- |
| `classic` | Six colours, whatever is in the room, no second chances | baseline |

One mode. §12 Q5 records the obvious second one (a shared target versus a
per-player target) as deliberately not specced.

## 4. Screens

Lobby → primer → round, and then **nothing but rounds** until the hunt ends and
the standard results screen appears. No countdown between rounds, no reveal.

The round screen, top to bottom:

- **The target**, a full-width band of flat colour with its name written on it
  (*"RED"*, *"CYAN"*). The name matters: at a glance across a room, a word is
  faster than a swatch, and it is the one concession this game can make to §11.
- **The pie timer**, in the band's corner, draining over `COLOR_HUNT_ACTION_MS`.
- **The camera feed**, cropped to a square the full width of the board — the
  issue's own framing. `object-fit: cover` on the short axis, so a portrait
  sensor is centre-cropped rather than letterboxed.
- **The magnifier**, dead centre of that square: a ring of `COLOR_HUNT_RING_PX`
  filled with the current sampled average, with a two-tone stroke so it reads
  against whatever it is sitting on. This is the game's only readout and it is
  the thing the player actually watches.
- **The ladder strip**, the shared `Scoreboard`, live — since there is no
  results panel, this is where a score landing is seen at all. A point scored
  flashes its row.

## 5. Inputs & sensors

**Rear camera, and nothing else.** No orientation, no motion, no GPS. The feed
is opened with the same `startCamera()` shape UFO Hunt and Ghost Hunt already
each carry a copy of (`www/src/games/ufo-hunt/camera.ts` — game folders do not
import from one another, so this game carries its own copy for the reason that
file's own header states).

Sampling: one `drawImage` of the video into an offscreen
`COLOR_HUNT_SAMPLE`×`COLOR_HUNT_SAMPLE` canvas per frame, source-rect'd to the
centre of the feed, then a mean over the returned `ImageData`. That is
`COLOR_HUNT_SAMPLE²` pixels — 100 at the issue's own 10×10 — read at
`COLOR_HUNT_SAMPLE_HZ`, not at frame rate: a magnifier that updates 60 times a
second is a strobe, and averaging over a few reads is what makes it settle
enough to aim with.

**Fallbacks:** there are none, and that is the point of §12 Q1. A camera game
whose entire mechanic is "what is the camera pointing at" has no touch version
— a colour picker with no camera is Color Match, which is a different game in
the same catalogue. So a refusal means this player cannot play, and per
AGENTS.md §4 that requires the maintainer to extend the closed list. If they
do, the permission is asked for by **Ready** (or **Start** for the host), not
by a button of its own, and the lobby says who it excludes before anyone
starts — the shape [../../device-capabilities.md](../../device-capabilities.md)
§2 rule 3 lays down and the five existing games follow.

### 5b Constants

| Constant | Value | Why |
| --- | --- | --- |
| `COLOR_HUNT_ACTION_MS` | 6000 | ⚖ Longer than Color Match's 3 s, because finding a red thing means walking to it |
| `COLOR_BARREN_ROUNDS` | 3 | The issue's own rule, and Color Match's (§2.1) |
| `COLOR_HUNT_SAMPLE` | 10 | The issue's own 10×10 pixel patch |
| `COLOR_HUNT_SAMPLE_HZ` | 10 | ⚖ How often the magnifier re-reads. Fast enough to aim, slow enough not to strobe |
| `COLOR_HUNT_RING_PX` | 72 | ⚖ The magnifier's diameter. Big enough to judge a colour by |
| `COLOR_HUNT_TARGET_S` | 0.85 | ⚖ Target saturation — a colour a real object can be (§2.2) |
| `COLOR_HUNT_TARGET_V` | 0.80 | ⚖ Target value, same reason |
| `COLOR_HUNT_CAP_MS` | 600000 | Ten minutes. A safety cap, as in Color Match |
| `COLOR_MISS` | — | Shared with Color Match, from `shared/color.ts`. ⚖ and very likely to need a *larger* value here (§12 Q2) |
| `COLOR_HUNT_MIN_PLAYERS` / `_MAX` | 2 / 8 | From `PLAYERS['color-hunt']` |

## 6. Networking

Same profile as Color Match, one round shorter: the referee owns the target and
the scores, the phone owns a colour.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `hunt-round` | server → all | `{ roundId, round, target: [r,g,b], name, dueAt, endsAt }` | A new target and when submissions close |
| `hunt-find` | client → server | `{ roundId, round, rgb: [r,g,b], at }` | What this phone's magnifier read. Last before `dueAt` wins |
| `hunt-scores` | server → all | `{ roundId, round, finds: {id: {rgb, score}}, totals, barren }` | What everyone found and what it was worth |

**No image data is on the wire, ever** — three integers per player per round.
See §10.

**Latency:** the deadline is an absolute server time rendered through
`client.now()`; a submission up to `COLOR_PICK_GRACE_MS` late still counts.
Because the next round starts the instant scoring completes rather than after a
reveal, a phone 300 ms behind sees its next target 300 ms late and loses that
sliver of its six seconds — noticeable in a way Color Match's seven-second
level is not, which is why the grace exists at all.

## 7. Failure & edge cases

- **Camera denied or absent**: this player cannot play (§5). Pending §12 Q1,
  they hold a spectator seat and the lobby says so before the host can start.
- **Camera opens then dies** (another app grabs it, phone locks): the magnifier
  freezes on its last read and the phone submits that. On return, the feed is
  reopened; if it will not reopen, the seat becomes a spectator seat mid-hunt
  rather than the round hanging.
- **Player leaves mid-round**: their submission counts if it arrived; the
  ladder drops them.
- **Host leaves**: reassigned, hunt continues. Nothing depends on the host.
- **Too few players**: 2 minimum. Unlike Color Match this is not worth playing
  alone — with no ladder and no opponent there is nothing to lose to.
- **Backgrounded tab**: the camera is suspended by the browser; the phone
  submits its last read and re-syncs on the next `hunt-round`.
- **Nobody scores**: normal. Three in a row ends it (§2.1).
- **Ties**: shared rank, unbroken, as in Color Match.

## 8. Anti-cheat

Better placed than Color Match, and worth stating: **the target is on screen
but the answer is not.** A script can read the target colour, but it cannot
make the phone's camera see it — unless it simply submits the target as its own
find, which wins every round perfectly.

That last exploit is unpreventable from the server: a submitted colour is
indistinguishable from a sampled one. The referee's honest checks:

- One scored find per player per round, matching `roundId` and `round`.
- Nothing accepted after `dueAt + COLOR_PICK_GRACE_MS`.
- Scores computed on the referee, never taken from the client.
- **A perfect score is suspicious and is not treated as such.** A real camera
  read is essentially never an exact match, so `score === 100` from a phone is
  almost certainly synthetic — but "almost" is doing real work in a room with
  a colour-calibrated monitor in it, and a game that accuses a player of
  cheating for finding a good red is worse than one that lets a determined
  person win a party game. Recorded here rather than implemented, and §12 Q4
  asks whether the maintainer wants it implemented after all.

## 9. Safety

**Mandatory here**, because this game makes people get up and walk around
looking at a phone. That is the same class of risk as a GPS game and gets the
same treatment (AGENTS.md §7).

Proposed lobby copy, shown before the first round and not dismissible until the
host starts:

> *"You will be walking around looking at your screen. Look up. Don't hunt
> colours in traffic, on stairs, or out of a window you could fall out of."*

Enforced limits: `COLOR_HUNT_CAP_MS` caps a hunt at ten minutes, and the six
second round is short enough that nobody is walking far. No mechanic rewards
covering ground — a target found two metres away scores exactly what the same
colour found across the building scores, and §12 Q5's "everyone hunts the same
target" variant must not change that.

## 10. Data & privacy

**No pixel ever leaves the phone.** The feed is rendered locally, sampled
locally into a 10×10 canvas, averaged locally, and the only thing that reaches
the referee is one RGB triple per round — the same three integers Color Match
sends, carrying no more information about the room than "something here was
this colour".

The `MediaStream` is stopped when the hunt ends, when the component unmounts,
and when the tab is hidden. Nothing is recorded, nothing is buffered, and no
frame is written anywhere — which is exactly what
[../../device-capabilities.md](../../device-capabilities.md) requires of a
camera and what Ghost Hunt and UFO Hunt already do.

The lobby primer says this in plain words before the permission is asked for,
because "we want your camera" is the single biggest reason a player says no,
and the true answer — *we look at 100 pixels and send you a colour* — is
reassuring enough to be worth the sentence.

## 11. Accessibility

- **Colour blindness**: the same hard exclusion Color Match has, stated the
  same way in the lobby. The target's *name* is written on the band (§4),
  which helps a player who knows a red thing when they see one but cannot pick
  it off a swatch — but it does not make the scoring fair, and the copy must
  not pretend it does.
- **Mobility**: this game asks players to move around a room, and a player who
  cannot has a much smaller palette within reach. There is no version of this
  mechanic that does not, so the honest handling is that Color Match is the
  sibling game that asks for none of it — say so on the card, the way Grid
  Attack's card says it is the landscape one.
- **Reduced motion**: nothing animates except the pie timer and the score
  flash; the flash becomes a static highlight.
- **Low vision**: the magnifier is the largest single readout on the board and
  the target band is full width. Both are colour, and neither can be made to
  work without it.
- **No sound**: nothing depends on sound.

## 12. Open questions

Q1 blocks the build outright; the rest block their own numbers.

1. **Does Color Hunt join AGENTS.md §4's closed list?** It is a camera game
   with no fallback that is not a lesser version of itself — the same test the
   five existing entries pass — but the list is closed and only the maintainer
   opens it. A no means either the game is not built, or it is built with a
   fallback nobody has designed yet. **Nothing else in this file matters until
   this is answered.**
2. **`COLOR_MISS` almost certainly needs to be looser here than in Color
   Match.** A camera under a warm bulb reads a red book as something like
   `(180, 60, 45)`; against a `(204, 31, 31)` target that is a normalised
   redmean distance of roughly 0.1, which scores well — but a blue jumper under
   the same bulb can be 0.3 off its target and still be, unarguably, the blue
   thing in the room. Sharing one constant between the two games may be the
   wrong economy. Only a real room answers this.
3. **Are `COLOR_HUNT_TARGET_S`/`_V` reachable indoors?** §2.2's whole argument
   is that a pure primary is not findable and a plausible one is. 0.85/0.80 is
   a guess at where "plausible" starts, and a beige meeting room may not
   contain anything that clears it even so.
4. **Should a perfect 100 be rejected as synthetic?** §8 argues no. It is a one
   line check if the maintainer disagrees.
5. **One shared target, or one per player?** Specced as shared, because
   everybody hunting the same red is the conversation. Per-player targets would
   stop the fastest player from simply telling everyone where the red thing is,
   which is either the flaw in the shared version or the best part of it.
6. **Is six seconds enough to stand up and walk?** `COLOR_HUNT_ACTION_MS` is
   double Color Match's and still short. Too short and every round is "whatever
   is on the table"; too long and the momentum §2 is built around is gone.
