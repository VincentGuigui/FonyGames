# In-game chrome

Rules that apply to **every** game, so a player who learns one learns all of
them. Code: `www/src/core/ui/` and `www/src/lobby/`.

## 1. The lobby template

**Every game's lobby is `lobby/GameLobby.tsx`.** The panels and their order are
fixed:

1. **Title and tagline** — the title, then the game's `pitch` verbatim.
2. **How to play** — the concept, then the bullets (§2).
3. **Invite a player** — the code, share link and QR, in a panel that collapses.
4. **Players** — the list. Your own row carries **Change**, which opens a sheet with
   your name and the avatars in it; every connected guest also shows ready/not ready.
5. **Start / Ready** — Start for the host, Ready for every guest, plus one line of
   context, **stuck to the bottom of the screen**.

Every room screen opens the connection and its five share controls through
`core/room/useGameRoom()`. It composes `useRoom()` with `useShareRoom()` once; games still
own their referee messages, but do not repeat the slug/title/error plumbing needed by
every lobby.

### Ready is a room rule, not a game feature

Every connected guest must press **Ready** before the host's **Start** button enables.
The Worker checks the same rule, so a crafted Start frame cannot bypass the lobby. Away
seats inside the reconnect grace period are ignored: losing one connection must not
strand everyone who is still at the table.

Readiness is consumed only after a round really starts and is reset for the next one.
The shared result screen therefore carries the same Ready control for guests and holds
Play again / Next round for the host; otherwise resetting the flags would make replay
impossible without returning to the lobby.

Sensor games pass one local `readyBlocked` fact into the shared chrome. Ready (or Start
for the host) stays disabled until that game's primer has resolved: permission granted,
permission declined, an unsupported sensor with its documented fallback, or an explicit
fallback route. A late spectator can run the same setup action from the result screen.
The browser owns this part because sensor permissions never leave the phone; the Worker
owns the room-wide guest flags.

### Why the start button is sticky

Because it was below the fold in every game. Measured at 390×844 with one player: Pass the
Bomb's start button sat at 964px, Shake Rush's at 1064, Steady Hand's at 1005, Ghost Hunt's
at 1384. The host had to scroll past the room code, the player list and two panels of
safety copy to start a round — every round.

The cause is not one fat panel. A lobby legitimately has a lot in it: a code to read out,
everyone who has joined, and whatever a game must say before anybody points a camera at
anything. Sticky keeps all of that and stops it burying the one control the host is there
to press. The gradient behind it fades to the page colour rather than being a flat fill,
because a hard edge across the middle of a panel reads as the page having ended.

### Why the room code collapses

It was a permanently open bordered card, and the biggest thing on the screen: a code set in
`clamp(2rem, 11.5vw, 3.5rem)` so it can be read across a table. Shown to everybody, for a
job **only the host has** and only until the last person has arrived. Four players in five
were scrolling past a code they had already used to get in.

So it is a `Disclosure` like How to play, headed *Invite a player* — the job rather than the
object, because "room code" describes what is in the panel and not why you would open it.
Open for the host, collapsed for everyone else.

**`room.isHost`, not "did they follow a link".** Typing a code into the Join tab is joining
too, and only the host discriminator catches both. The cost is a flicker for the host on the
first frame, since the room says who the host is a moment after the page renders — which is
the right way round, because the guest is the common case and never sees it move.

### Why the avatar picker is behind a button

It used to sit open under the list in every lobby: twelve buttons, **123 vertical pixels**,
permanently, for a choice each player makes once and usually before anybody else has
joined. Measured on a 390×844 phone that is a tenth of the whole lobby and a seventh of the
first screenful, spent on a control that is finished with the moment it has been used.

Both halves of "who am I" now live behind one **Change** button on your own row —
name and avatar, saved together in one frame, because they are one decision and two frames
give the room a moment to show a half-changed player. The button replaced a `rename` link
that opened a native `prompt()`: an OS dialog in the middle of a game, which some browsers
refuse outright and none of them style.

The sheet is `core/ui/Sheet.tsx`, shared with the gear menu — extracted the moment a second
thing needed the same scrim, the same tap-outside-to-close and the same safe-area padding,
rather than copied.

A game customises it only through slots:

| Slot | Where it lands | Used by |
| --- | --- | --- |
| `aside` | inside how-to-play, after the bullets | Spill's table diagram and its no-liquids note |
| `extras` | below the players | Spill's theme picker |

There used to be a `standings` slot as well, and it was a mistake worth recording: four
games ended a round by dropping back into this lobby with their result panel wedged
between the room code and the avatar picker. Finishing looked like leaving. The end of a
round is its own screen now (§8), and the slot is gone.

**A slot can never reorder or replace a panel.** If a game needs something the
template cannot express, change the template for everyone rather than
special-casing one game — that is the entire point. Before this existed each
game had drifted into its own arrangement of the same pieces, so learning your
way around one lobby taught you nothing about the next.

Panels share one `.panel` class for the same reason.

## 2. One source for how to play

Each game's registry entry carries:

- `concept: string` — the one idea the game turns on, in a sentence.
- `rules: string[]` — two or three sentences, each under about 60 characters.

`concept` is **not** the pitch. The pitch sells the game on the hub; the concept
explains the thing you have to *understand* to play it well, and it leads the
bullets because a player who grasps "shooing is not free" can work out the
mechanics, while one who only memorised the taps often cannot.

Both are rendered by the shared `HowToPlay` component in **three** places:

| Where | Component |
| --- | --- |
| The lobby, before anyone starts | `GameLobby` |
| A four-second panel at the top of the **first** round (§4) | `RulesPanel` |
| The in-game menu, any time | `GameMenu` |

**Never retype the text in any of them.** If the lobby and the game disagree
about how to play, one of them is lying to the player, and there is no way to
tell which from the outside. One array plus one component is the fix, not a
convention to remember.

Keep the bullets short enough to read inside the panel's four seconds. That
constraint is the reason for the length limit, not neatness.

**A rule can colour one of its own words**, `{{#hex|word}}` — `HowToPlay`
renders `word` in that colour and strips the markup; a rule with no marker is
untouched. Grid Attack is the one game that needs it: "green"/"purple" name its
two grids, and colour is the one thing the word alone cannot carry at a glance.
The word still says the meaning in text — colour reinforces it, never replaces
it (§2's own rule, [ui-guidelines.md](ui-guidelines.md) §2). The colour is
self-contained in the marker rather than read from `--game-accent`, because the
same string also renders inside `GameMenu`'s sheet, which is not guaranteed to
inherit a custom property set on the board underneath it.

## 3. The gear

Every game shows a gear in the **same corner**, opening a bottom sheet that
always contains:

- **How to play** — the concept and the bullets, via the same `HowToPlay`
  component the lobby and the pre-round panel use (§2).
- **Leave game** — a real `<a href="/">`, not a router call, because leaving the
  page is what drops the socket and frees the seat.

Two smaller pieces are shared once a second game needs them:

- `core/ui/PermissionPrimer.tsx` owns the common sensor-primer panel, resolved state and
  action layout; each game still supplies its own translated explanation and fallback.
- `core/ui/SoundToggle.tsx` owns the immediate `aria-pressed` mute control; each game
  supplies its translated on/off wording and keeps its own sound implementation.

The boundary is visual and behavioural, not vocabulary. A permission primer does not
decide whether denial means touch fallback or spectating, and a sound toggle never imports
a game's tune.

A game may add anything else through `children`; Spill puts its table diagram
and theme picker there. Nothing else may be *required*, because the two items
above are what a lost player is looking for.

Placement notes learned the hard way:

- The sheet must not be full-screen. Seeing the board behind it is what makes it
  read as a pause rather than as having left the game.
- The gear sits **outside** any full-screen tap target. On Tap Duel the whole
  viewport is the target, so opening the menu inside it would score as a tap and
  burn the round.
- The HUD that hosts the gear needs a **higher z-index than the other rows**.
  The sheet opens inside the HUD, and `isolation: isolate` (used for the
  scrim) traps its z-index there — level with the button rows, they paint over
  the open sheet.
- Scrims behind a HUD use `isolation: isolate` plus a negative-z pseudo-element,
  **not** a blanket `.hud > * { position: relative }`. That selector also hits
  the menu, which needs `position: fixed`; the two have equal specificity, so
  whichever stylesheet loaded last won and the sheet rendered in the wrong
  place.

## 4. The pre-round window

`PREROUND_MS` (4 s) after the **first** round of a room starts, the rules panel
holds the screen.

**"Play again" gets no panel — and no window either.** Everyone has just read the
rules and played a round of the thing; being told again is four seconds of delay
right when the room is keenest to go again. `preroundFor(roundId)` in the protocol
returns the window length, and it is zero for every round after the first.

That it is the *window* that collapses, not just the panel, is the point. Hiding
the panel over a live-looking board that still rejects input would be strictly
worse than the panel: four silent seconds, with nothing to explain them. One
number decides both, so the client's panel and the server's input gate cannot
disagree.

**It is a real window, not decoration.** The server knows about it:

| Game | How it is enforced |
| --- | --- |
| Spill | `onFling` rejects anything before `startsAt` |
| Goat Siege | `onLob` rejects anything before `startsAt` |
| Tap Duel | `fireAt` is pushed past `startsAt`, so the signal cannot fire behind the panel |

A window only the client respected would be a head start for anyone who skipped
it. Tap Duel is the sharpest case: a signal fired behind a covering panel costs
you the round through no fault of your own, so the server moves the signal
rather than the client hiding the panel early.

Two details:

- The panel is mounted **keyed on the round id**, so a fresh round never reuses a
  dismissed panel.
- The countdown is **clamped to `PREROUND_MS`**. `startsAt` is the server's clock
  plus four seconds, and the client's estimate of the offset can sit a few tens
  of milliseconds behind — enough for a four-second wait to open by announcing
  "5". The same slack is why a window shorter than `MIN_PANEL_MS` renders nothing
  at all: a replay's zero-length window must not flash a panel for one frame.

## 5. Opponent rows

Where a game shows a row of buttons for the other players, it is captioned:
Spill's is **Throw at**, Goat Siege's is **Attack**. The row means the same
thing in both, so `.aimbar__label` is shared rather than styled twice.

These rows are also the accessibility path for anything whose primary input is a
gesture (Spill's flick), per the fallback rule in
[ui-guidelines.md](ui-guidelines.md) — so they are always present, never behind
a setting.

## 6. The score panel

Every game in the catalogue is a race against the other players, so every game needs
the same glance: *how am I doing against them?* **One panel, in every game, with
everybody in it.** Component `core/ui/Scoreboard.tsx`, styles in
`core/ui/scoreboard.css`, imported by `game-chrome.css` so a game cannot ship it
unstyled.

```
┌──────────────────────┐
│ 🙂 Vincent         3 │   ← you, always the top row
│ 🐙 Sam             5 │   ← the leader, bold
│ 🦊 Ada             1 │
└──────────────────────┘
```

| | |
| --- | --- |
| Where | Floating in a **corner of the board**, over its own 50%-black scrim. The corner is a per-game setting; the default is bottom left |
| Shows | Avatar, name, value — one row per player, **including you** |
| Order | You first, then room order. Never sorted by score |
| The leader | Bold, and only when exactly one player holds the best value |
| Out of the round | Dimmed **and** struck through, never colour alone (ui-guidelines §7) |
| Colour | Name white, value `--game-accent`. The panel has its own dark ground, so it does not follow the page theme |
| Hides | Itself entirely below two players — a panel restating the status bar is furniture |
| The unit | On the panel's `aria-label` and each row's hidden text ("pucks", "cabbages"), never drawn |

### Why you are the top row rather than sorted

A list that reorders while you are playing is a list you have to re-read, and the row
you look for most is your own. Sorting by score moves it under your thumb at exactly
the moment something interesting happened.

### Why the leader is bold only when there is one

Every round starts level. Bolding a four-way tie at nil says nothing while making the
panel look like it is shouting, so `arrange()` marks a leader only when a single player
holds the extreme value — and never a player who is out.

### Winning is not always the biggest number

`best` is `'high'`, `'low'` or `'none'` per game, and it has to be:

| Game | Value | `best` |
| --- | --- | --- |
| Tap Duel | session points | `high` |
| Ghost Hunt | ghosts caught | `high` |
| Goat Siege | cabbages left | `high` |
| Cat and Mouse | lives | `high` |
| Shake Rush | shakes to go | **`low`** |
| Spill | water carried | **`low`** |
| Sling Puck | pucks left | **`low`** |
| Pass the Bomb | "has it" / "clear" | **`none`** — there is no score until somebody is out |
| Steady Hand | lives, as pips | **`none`** — the game is won by lasting longest, not by finishing with the most left |

A single hard-coded `>` would print the bold beside whoever is *losing* in three of
these, visible only to somebody who plays those three and thinks about it.
`www/src/core/ui/scoreboard.test.ts` asserts both directions and fails on that
mutation.

### Where the corner has to move, and why

The default is bottom left everywhere. Three games override it, each because the
default corner is not theirs to take:

| Game | Corner | Because |
| --- | --- | --- |
| Goat Siege | top right | The lob bar owns the bottom — the game's only control |
| Spill | top left | The throw row owns the bottom, for the same reason |
| Sling Puck | top right | The bottom half of the screen is the player's own board |
| Cat and Mouse | top left | Its hint line runs the full width of the bottom |
| Pass the Bomb | top left | The holder's tap-to-pass buttons are down there, and they are how a player without a motion sensor plays at all |

**The top corners carry a 4rem offset** so they clear the status bar, which starts at the
same edge and is the same width. Without it the panel lands exactly on the bar: Spill's
own drop count vanished behind it and Goat Siege's panel sat over the gear.

Pass the Bomb is the reason to set a corner for **every screen a game has**, not only the
one that happened to be checked: the collision is on the *holder's* screen and the walk
that found the other three was driving a phone that was watching. A panel that jumped
corners as the bomb changed hands would be worse than one in the wrong place.

The panel is `pointer-events: none` regardless, so it can never swallow a tap on a
board played by dragging and flicking. That is a correctness property, not a nicety: a
panel that ate taps in one corner would be reported as "the game misses my finger
sometimes".

### What this replaced

Two components that were each half of it:

- An **opponent slot on the status bar**, filled only in a two-player round, because
  with three or more a single "them" is a lie.
- An **`OpponentScores` strip** along the top of the board, which hid itself whenever
  there was exactly one opponent so the two would not collide.

Between them, a player got the answer to "how am I doing" in one place at two players
and somewhere else at three, and every screen carried the code to work out which case
it was in. Ghost Hunt had a *third* shape — a row of avatar-and-number chips capped at
four players — which the panel also replaced.

Games that place players **spatially** keep doing so: Spill's ring puts every player at
their real bearing around the table and Shake Rush's track puts each runner at their
real distance. Those answer *where*, which is what aiming needs; the panel answers *how
much*. Shake Rush's lane numbers do now say the same thing as the panel, which is a real
duplication — if one goes, it is the number on the end of each lane.

## 7. The status bar

One row across the top of every game screen. Component:
`www/src/core/ui/StatusBar.tsx`, styles in `core/ui/statusbar.css`, imported by
`game-chrome.css` so a game cannot ship it unstyled.

```
[ my score / status ]                        [ ☰ ]
```

Every game had grown its own — `.steady__bar`, `.rush__bar`, `.hunt__bar`,
`.spill__hud`, and a `hud__row` in three more. The same three things in six
arrangements, so learning one game's chrome taught you nothing about the next.

**Other players are not on this bar.** There used to be an opponent slot here; §6's
panel replaced it, and the reasoning is recorded there. What is left is the player's
own number, a free-text status, and the gear.

The bar also carries `--game-accent` for its own number — which means every round
screen has to **set** that variable on its root. Most of them did not: the lobby
template sets it for lobby screens, and a round screen is not inside the template, so
Steady Hand, Shake Rush, Pass the Bomb, Cat and Mouse, Goat Siege and Sling Puck were
all drawing the site accent in the middle of their own colour scheme. They each take an
`accent` prop now and set it, which fixes the panel's values and the bar's number in one
line per game.

**Tap Duel has no status bar, deliberately.** Its round screen is a bare tap target
measuring a reaction in milliseconds — a bar across the top would steal taps at the
edge and give the eye somewhere to be other than the signal. Its scores are on its
result screen. It keeps the same gear in the same corner as everything else.

## 8. The end of a round

Every game ends on the same screen: `core/ui/GameOver.tsx`, a panel bordered in the
game's accent.

```
┌──────────────────────────────┐   border: the game's accent
│             🦊               │   the winner, centred
│           You won            │
│  🦊 Ana              12 left │   everybody, the winner in bold
│  🐢 Bo                4 left │   your own row tinted
│     fastest 6.2s · avg 12.1s │   `detail`, when a game has more to say
│      [ Next round ]          │   or [ Play again ] + [ Leave game ]
└──────────────────────────────┘
```

### What it replaced, and why that mattered

Nine games had nine endings, in two families:

- **Four dropped back to the lobby** — Spill, Goat Siege, Sling Puck, Cat and Mouse —
  with a small "Result" panel wedged between the room code and the avatar picker. So
  finishing a game looked exactly like leaving one, and the thing everybody wants next
  sat below two panels of joining furniture.
- **Five grew their own screen**, each with its own trophy, its own placing list and
  its own class names: `rush__place`, `hunt__place`, `duel`'s `scoreline`, and three
  more. The same three facts — who won, how everyone did, what happens next — laid out
  five ways.

### The rules of the panel

- **Avatar, name, score.** The number is the game's accent so it is findable down a
  column; the unit beside it is not, because colouring the word undoes that. The
  winner's whole row is bold, your own row is tinted, and anyone out is dimmed *and*
  struck through — never colour alone.
- **The component never sorts.** Ranking is each game's own rule and a fiddly one:
  fewest cabbages loses in Goat Siege and wins in Sling Puck, Pass the Bomb ranks on
  lives in a duel and on rounds won above that, Cat and Mouse has a side that cannot
  place at all. A component that guessed would be wrong in three of nine, silently.
- **The unit is per row**, so a game can mix "12 left" with "caught", and it is dropped
  for a row whose value is a word.
- **The detail is per row and optional**: a second line spanning the row, small and dim,
  for the story behind the figure — Ghost Hunt's fastest, slowest and average find. It
  spans rather than sitting inside the name, which squeezed it into whatever the score
  left over and wrapped it mid-number. A row with nothing to say renders no second line
  at all, so a game not using it keeps one line per player.

- **Nothing takes a tap for the first two seconds.** Half the catalogue ends a round with
  a thumb still going — Grid Attack and Pass the Bomb are mashing games, Tap Duel's whole
  skill is tapping the instant something appears — and the panel lands under the finger
  doing it. The first stray tap hit Play again and started the next round before anybody
  had read who won: the result of the round you just played, skipped by the round you
  just played.

  `inert`, not `disabled`. `disabled` would grey the controls and read as "not your
  turn", which is a different and wrong message on buttons that are about to work
  perfectly well — and it cannot touch the Leave game anchor at all, which needs the
  guard just as much, since leaving by accident is worse than replaying by accident.
  The actions fade in over the two seconds so the wait is visible: a control that
  silently ignores you reads as broken, which is the failure this exists to prevent.

- **The panel fits a short viewport.** Below 480px of height — a phone on its side — the
  crest shrinks, the gaps tighten, the rows scroll and the two buttons sit side by side.
  Grid Attack's board is sideways and so is its result, and a height query rather than an
  orientation one means no game has to opt in.
- **Mid-match gets one host button**, the next round: Tap Duel at 6–4 does not want to be
  asked whether to play again. A finished match gets two — play again, and leave.
- **Leave is a link, not a button.** Leaving the page is what drops the socket and frees
  the seat, the same reason the gear menu's exit is one.
- **A non-host gets Ready and can still leave.** The host's action stays disabled until
  every connected guest is ready. Not being the host is not a reason to be trapped in
  a room.
- The screen keeps the **status bar**, so how-to-play and the way out stay where they
  are in every other screen of every other game.

### What a game still owns

The row order, the unit, the detail line, the words on the buttons, and anything that
needs a line of its own for the whole room rather than for one player — who was the cat,
Tap Duel's reaction times. Those go in `note`, one line under the list; anything that is
per player goes in that row's `detail`. Pass the Bomb passes its explosion as a child so
the blast still plays *above* the panel: the bomb going off is the ending, and cutting
to a scoreboard over the top of it is a fix this game has already had once.
