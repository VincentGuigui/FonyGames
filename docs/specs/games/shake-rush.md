# Shake Rush

> Status: **built, beta**. `RUSH_DISTANCE` and the tolerance for a room full of
> real arms are still guesses — see §12.

| | |
| --- | --- |
| **Slug** | `shake-rush` |
| **Catchy sentence** | *Shake like your life depends on it — first to the finish wins* |
| **Illustration** | `www/src/games/shake-rush/art/card.svg` — a phone shaking, motion lines either side of it |
| **Players** | 2–8 |
| **Round length** | ~1 min, hard cap 90 s |
| **Inputs** | motion (shake). **No fallback** — see §5 |
| **Accent colour** | `#4ADE80` |
| **Status** | built, beta |

## 1. Pitch

A track, a finish line, and no skill whatsoever: you move by shaking your phone.
Everyone starts level and the only variable is how hard you are willing to look
ridiculous in front of your friends.

It is the dumbest game in the catalogue and that is the point. Nothing to learn,
nothing to aim, nothing to lose but your dignity.

## 2. Core loop

1. The host starts a round. Everyone's runner sits at 0 on a shared track.
2. Shaking advances your runner. The track is `RUSH_DISTANCE` **shakes** long.
3. Every phone shows the same track with everyone's runner on it, so you can see
   the person next to you pulling ahead — that is the whole social payload.
4. First runner over the line wins. The round ends immediately.
5. If the 90 s cap arrives with nobody home, whoever is furthest wins.

**Win condition:** first to `RUSH_DISTANCE`.
**Scoring:** 1 point for the win. Best of 3 is a session, not a mode.

### 2.1 What counts as a shake

**Oscillations, not magnitude.** A shake is a *direction reversal* along the
dominant axis: the phone accelerates one way, then the other. One violent swing
of the arm is one reversal, no matter how hard it was; a fast wrist flick back
and forth is two.

This is the load-bearing decision of the whole game, and it is worth being
explicit about why, because the obvious implementation is wrong in a way that
matters:

- **Summing acceleration magnitude rewards violence.** The harder you swing, the
  bigger the number, so the winning strategy becomes swinging a phone as hard as
  a human can — which is how a phone leaves someone's hand and hits a wall
  (§9). Counting reversals makes a gentle fast shake beat a wild slow one.
- **It also equalises the phones.** Peak magnitude varies with mass and case;
  the *count* of reversals does not.

Reuses the shape of `www/src/core/sensors/bump.ts`: a threshold with a
refractory period, so one reversal cannot be counted twice.

| Constant | Value | Why |
| --- | --- | --- |
| `SHAKE_THRESHOLD` | 14 m/s² above baseline | Above a walking jiggle, below a comfortable shake |
| `SHAKE_REFRACTORY_MS` | 90 ms | ~5.5 reversals/s is already a fast human |
| `SHAKE_RATE_CAP` | 8 /s | Anything above this is counted as 8 (§8) |
| `RUSH_DISTANCE` | 100 shakes | ~20–30 s of honest effort, and the length the tune is cut to (§5b) |

## 3. Modes / variations

None at launch. The game is one joke told well; a mode picker on a 30-second
shake-off is ceremony nobody wants.

Recorded for later, not built:

| Idea | Difference |
| --- | --- |
| `relay` | Teams of two, one shakes at a time, tap to hand over |
| `marathon` | 4× the distance, and the leaderboard is time not placing |

## 4. Screens

- **Lobby**: the shared template, plus the permission primer (§5) and the safety
  line (§9) — both visible, not folded into How to play.
- **Round**: the track fills the screen, horizontal, one lane per player with
  avatars as runners. Your lane is highlighted and always the one you can find
  without reading. A big number counts your remaining shakes down, because
  "37 to go" is a better motivator than a progress bar.
- **Finish**: the shared end screen ([../../design/game-chrome.md](../../design/game-chrome.md) §8)
  — the winner's avatar, everyone's distance, "Race again" primary.

The screen must be readable while the phone is moving violently, which rules out
anything small, thin, or dependent on fine detail. Big shapes, big type, high
contrast.

## 5. Inputs & sensors

Motion, through the shared `core/sensors/motion.ts`. A new
`core/sensors/shake.ts` implements §2.1 beside `bump.ts`, and both stay the only
places that interpret an accelerometer.

Permission is requested from a **tap in the lobby**, never on arrival — iOS
refuses the prompt outside a user gesture and remembers a denial
([device-capabilities.md](../../device-capabilities.md) §2). Same primer pattern
as [pass-the-bomb.md](pass-the-bomb.md) §11b.

**Fallbacks: there are none, and the card says so.**

A tap route was designed and then cut, and the reasoning is worth keeping because
it will be proposed again. A thumb taps at 8–10/s against an arm's 5–6/s, so
tapping does not *substitute* for shaking, it **beats** it. Three ways out were on
the table — convert at a ratio, race tappers separately, or let it be unfair and
mark it — and all three are worse than the honest answer: this game is one
physical act, and a version of it played with a thumb is a different game wearing
its name.

So Shake Rush joins Steady Hand and Cat and Mouse as a game that names who it
excludes rather than shipping a fallback it does not believe in. A player without
motion access **spectates**, and the track is worth watching.

| Missing | Behaviour |
| --- | --- |
| Motion denied / unavailable | Spectator, with the reason said plainly in the lobby before the round |
| Tab backgrounded | Counting stops, the lane shows `away`, the runner freezes |

## 5b. The tune — one note per shake

Every counted shake plays a note, and the notes are a melody rather than a
repeated blip: the pitch climbs across the track, so "nearly home" is audible.
That matters more here than in any other game, because **the screen is unreadable
while a phone is being shaken hard** — the ear is the only sense with a clear
channel, and §11 already accepts that this game asks a lot of the body.

| Piece | File | What it owns |
| --- | --- | --- |
| The melody | `www/src/games/shake-rush/melody.ts` | `PHRASE`, the song; `MELODY`, the phrase twice; `noteFor(shakes)` |
| The synth | `www/src/games/shake-rush/tune.ts` | Tone.js, the AudioContext, mute, the note index, and the ending |
| The moment | `core/sensors/shake.ts` `detectShakes(onShake)` | Fires the instant a shake is counted |

**One note per shake, fired from the detector — not from the send interval.** The
interval batches into `RUSH_TICK_MS` frames (§6), so notes played from it would
arrive in bursts of three on a 90 ms grid instead of on the movement. That is why
`detectShakes()` takes a callback at all.

**The song runs twice across the track**: fifty-four notes, played through twice,
is a hundred and eight for a hundred shakes. Hearing the phrase come round again
is what says the line is close, which a single pass through a longer tune does not.

**The eight notes left over are the ending, and the game plays them for you.**
Crossing the line calls `tune.finish()`, which schedules the rest of the song in
time (`FINISH_GAP_S`) — so arriving and the tune landing are one event, and nobody
has to keep shaking a race they have already won to hear how it ends. Further
shakes are silent after that: the song is over, not paused.

`game.test.ts` holds the two bounds that matter — there must be *something* left at
the line, or the tune loops back to its opening mid-run, and not much, or a
finisher listens to playback long after the result is on screen.

Shaking past the end of the whole song wraps rather than falling silent — the
server clips progress, not shaking, and silence mid-shake reads as the sound
breaking. The local note index is corrected against the server's position only when
the two diverge by more than a few notes (`RESYNC_SLACK`); correcting on every frame
would drag the tune backwards ten times a second.

**Tone.js is loaded from the permission tap**, not with the page: it is ~200 KB of
synthesiser, and the same gesture is needed anyway to resume an AudioContext, which
every browser starts suspended. A player who never grants motion never downloads
it. Anything that fails on the way — a blocked context, a chunk that will not load
— leaves the race playable and silent rather than broken.

**Replacing the tune is one file.** Swap `PHRASE` in `melody.ts` for any melody you
have the right to use, keeping it a bit under half the track so the doubling still
lands near the line, and nothing else changes.

The notes shipped are the ones the owner supplied, in their own notation —
`A-B  ^D-B  ^F# ^F# ^E` and so on, where `^` is the octave above the base. The base
is **A4**, not A3: a phone speaker has almost nothing below ~300 Hz, so the lower
octave was audible in a room and gone in a pocket. The hyphens grouped notes into
beats and are dropped, because here a shake *is* the beat.

Sound is **on by default** with a toggle in the game menu, remembered in
`localStorage`. In the menu rather than on the track, because a control small
enough to sit in a corner of this screen is one that gets hit mid-shake.

## 6. Networking

Server is authoritative for distance, the finish and the result. The phone counts
its own shakes because only the phone sees the accelerometer, and the server
decides what that is worth.

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `shake` | client → server | `{n, roundId}` | I felt `n` new shakes since my last frame |
| `rush` | server → clients | `{roundId, at: {playerId: distance}, finished[]}` | Where everyone is |
| `rush-end` | server → clients | `{roundId, order[]}` | Finish order, first to last |

**Batched, not per shake.** At 5 shakes a second across 8 players a
frame-per-shake is 40 messages/s for a progress bar nobody reads that precisely.
The phone sends its count on a **250 ms** tick, the server integrates, and
broadcasts on its own **~10 Hz** tick. Under
[realtime-server.md](../../realtime-server.md)'s Profile B, this is well inside
budget.

**An empty window is never sent.** The phone reports only ticks that actually
contained accelerometer samples. A window with none has a count of zero, which is
indistinguishable from "did not shake" — and sending it would keep a backgrounded
or sensor-less runner from ever being marked `away` (§7). Steady Hand learnt this
the hard way; see steady-hand.md §6.

**The last window is flushed, not dropped.** Crossing the line, the race ending
or motion turning off mid-round all stop the tick before it next fires — the
shakes counted since the previous frame would otherwise sit in the detector and
never reach the server. The client reads and sends that final partial window
once, right there, instead of waiting on a tick that will not come.

**The broadcast deadline is a stored moment**, not "now plus a tick": Room's one
alarm slot decides which game woke it by comparing the clock against that number,
and a deadline computed from the caller's own clock is never due.

## 7. Failure & edge cases

| Case | Behaviour |
| --- | --- |
| A player disconnects mid-round | Their runner freezes and is marked `away`; the round continues. They rejoin to the same lane at the same distance |
| Everyone disconnects | Round is abandoned, no result |
| Two runners cross on the same server tick | Earlier server-side arrival wins; a genuine tie is broken by whoever sent the crossing frame first |
| The 90 s cap arrives | Furthest wins. Nobody wants a shake-off that never ends |
| Fewer than 2 players | Start disabled: "Need one more player" |

## 8. Anti-cheat

A client that lies about its shake count wins, and there is no way to prove it
did not — the accelerometer is not observable from the server. Everything below
is about making the *easy* cheats pointless rather than pretending to solve it.

There are **three** ceilings, and none of them is redundant — each closes a hole
the other two leave open. All three are pinned by `worker/shakeRush.test.ts`.

- **The frame cap.** A batch is clipped to `SHAKE_RATE_CAP × elapsed`, plus one
  shake of slack so a frame that lands early does not clip an honest player.
  Reporting 500 shakes in one 250 ms frame advances you by 3.
- **The trajectory cap** (`reachableBy`). The frame cap's slack is *per frame*,
  so at a 250 ms tick a client claiming the maximum every time banks 12 shakes a
  second against a cap of 8 — a third off the race, just by sending more frames.
  Bounding the *position* by the elapsed round time makes the slack a constant
  rather than a rate, and splitting a lie across frames stops paying.
- **The claim window** (`RUSH_AWAY_MS`). Both caps above measure from a clock, so
  a phone that says nothing for sixteen seconds may then claim sixteen seconds'
  worth in one frame and arrive at the line from a standing start — both caps
  satisfied. A frame may only claim for as long as the away threshold, which is
  the same rule the player is already being shown: an away runner freezes (§7).
- **No client-reported distance, ever.** The phone reports increments; the server
  owns the position.
- **And the phone throttles itself first.** `SHAKE_REFRACTORY_MS` means the
  detector cannot report more than ~11/s however hard the phone is shaken, so an
  unmodified client never reaches the server's cap at all.
- Beyond that: it is a party game among people in the same room, and the
  strongest anti-cheat is that everyone can see you not shaking.

## 9. Safety

Shown in the lobby before the permission primer, in its own visible panel — not
inside a collapsible How to play, which is where the same line was accidentally
hidden in Pass the Bomb:

> **Grip it properly and keep your arm down. No throwing, no swinging near
> faces, and take the strap or popsocket off if it makes you loosen your grip.**

Enforced: the 90 s cap, and the rate cap in §8 — which exists as much for this as
for cheating, since it removes any reward for shaking harder than is sensible.

## 10. Data & privacy

Leaves the phone: a shake count per tick, player id, chosen name and avatar.
Never the accelerometer stream itself. Lives in room memory, discarded with the
room.

## 11. Accessibility

- **This game asks for sustained vigorous shaking and has no way around it.**
  Anyone who cannot do that cannot play it, and §5 explains why a tap route was
  cut rather than shipped. Three of the catalogue's games now exclude somebody
  this way; that is a real cost and the catalogue has to stay large enough and
  varied enough to carry it.
- The spectator role is a real seat: the track with everyone's runner on it is the
  best view in the room.
- The track uses position **and** a number, never colour alone, to say who is
  ahead.
- No flashing. A finish celebration respects `prefers-reduced-motion`.

## 12. Open questions

- `RUSH_DISTANCE` 100 — is ~20–25 s the right length? Long enough to be funny,
  short enough that arms survive best-of-three. It is now also a musical number:
  the song runs twice in a hundred and eight notes, so changing the track length
  means re-cutting the tune (§5b).
- Should a runner **slow down** when you stop, rather than freezing? Decay would
  punish pacing and reward continuous effort, which is funnier but crueller.
- Is one lane per player readable at 8 players on a 390 px screen, or does it
  need to collapse to "you + the leader" above some count? Verified legible at 3
  lanes on a 390 px viewport; 8 is untested.
- `SHAKE_THRESHOLD` at 14 m/s² is set against a synthesised accelerometer, not a
  real arm. It is the number most likely to be wrong on contact with a phone.
