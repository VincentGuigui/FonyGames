# Illustrations & game art

Where art lives, what shape a file has to be, and the two rules that fail
silently if you break them.

Style is in [ui-guidelines.md](./ui-guidelines.md) §6 (flat, bold shapes, thick
outlines, high contrast on dark, readable at 160 px). This is the mechanics.

## 1. One folder per game

```
www/src/games/<slug>/
  card.ts                  hub metadata — LEAF ONLY (§3)
  art/
    card.svg               the hub illustration
    <thing>.svg            in-game sprites (§4)
  game.ts render.ts *.tsx *.css        built games only
```

**Every game gets a folder, including the ones that are still `soon`** — for those
it is `card.ts` + `art/card.svg` and nothing else. That is what makes removing a
game one `git rm -r` plus one line out of `games/registry.ts`, and it lets a specced
game have its illustration before it has code.

## 2. Art is referenced by a Vite URL import, never from `public/`

```ts
import art from './art/card.svg?url&no-inline';
```

### `?no-inline` is mandatory, not decoration

`build.assetsInlineLimit` defaults to **4096 bytes**. Our illustrations are smaller
than that, so without the query Vite base64-inlines every one of them **into the JS
chunk** — which breaks [architecture.md](../architecture.md) §4 (illustrations are
budgeted *out* of the hub payload) and [specs/hub.md](../specs/hub.md) §2 (they are
lazy-loaded), while appearing to work perfectly.

In Vite's `shouldInline()`, `/[?&]no-inline\b/` is the **first** check — ahead of the
size limit and everything else — and it is honoured in dev as well as build, so the
two agree. The query is stripped from the emitted URL, and `vite/client.d.ts` already
declares `*?url&no-inline`, so it typechecks with no ambient declaration of ours.

Use it at **every** art import. A global `assetsInlineLimit: 0` is not a substitute:
it is invisible at the call site and one config edit away from silently re-inlining
everything.

### Why not `www/public/`

It would be simpler — no build step at all — and it is rejected for three reasons,
two of them specific to this project's deploy:

- **No content hash.** [deployment.md](../deployment.md)'s SFTP sync uploads
  everything and deletes nothing, so a redrawn illustration has no cache-buster and a
  phone can hold the old one indefinitely.
- **Orphans are immortal.** `public/` is copied verbatim and never in the build
  graph, so art for a deleted game stays on the host forever. An unimported asset
  simply stops being emitted.
- **A typo is a silent 404** at runtime, where a build-graph import fails
  `vite build`.

It would also split every game across two trees, which is the one-folder rule undone.

## 3. Three rules that fail silently

### An `<img>` cannot see the page's CSS

An SVG loaded through `<img>` is a **separate document**. It has no access to
`theme.css`, so:

| In the file | What actually happens |
| --- | --- |
| `fill="currentColor"` | resolves to the initial colour — **black on a dark card** |
| `fill="var(--color-surface-2)"` | invalid — **the shape disappears** |

So **art files hardcode literal hex colours**. Where a colour comes from the theme,
write the hex: `#212530` for `--color-surface-2`, and the game's own accent from its
card.

The consequence is real and worth naming: **the accent appears twice**, in `card.ts`
and inside `card.svg`, and they must agree. `www/src/games/cards.test.ts` asserts
both that no file contains `currentColor` or `var(--`, and that each `card.svg`
contains its card's accent hex. Neither mistake is visible except by eye, which is
why they are tested rather than trusted.

**The accent tint is painted by CSS, not by the file.** Art files are transparent;
`GameIllustration` paints the accent at 14% behind the image, which is also the
placeholder that holds the space while the file loads (hub.md §2). Painting it in
both places doubles it to 26% the moment the image arrives.

### An `<img>` parses SVG as strict XML

Inline JSX is forgiving; a standalone file loaded through `<img>` is not. **Any XML
error renders the card as nothing at all** — no warning, no console message, and the
build stays green.

The one that actually happened: a **doubled hyphen inside a comment**. It is illegal
in XML, and the explanatory comment written into all thirteen files to say *why* they
use literal hexes contained `var(--…)`. Every card shipped blank, and only a
screenshot showed it.

So art files are checked for well-formedness in `cards.test.mjs`: no `--` inside a
comment, and tags that balance under a single `<svg>` root. Write "a CSS variable" in
prose rather than the literal syntax.

### A `card.ts` is a leaf

The hub imports every card. So if one card imports anything from its own game, **the
hub bundle pulls in every game** — a regression that shows up only as size creep.

> A `card.ts` may import **only** `core/types` (types), `shared/players`, and files
> under its own `art/`. Not `./game`, not `./render`, not a `.tsx`, not a package,
> and **not `shared/protocol`**.

`shared/protocol.ts` is excluded even though it looks like constants: it is hundreds
of lines with helper functions and module-scope state. Rollup will probably shake it
down; "probably" is not good enough when the failure is silent. Player limits
therefore live in `shared/players.ts`, which imports nothing.

Enforced by `www/src/games/cards.test.ts` in `npm test`.

## 4. Sprites: what may become a file, and what may not

Canvas cannot draw an SVG; `core/art/sprites.ts` loads one into an `Image`,
rasterises it to a `<canvas>` once per size bucket, and hands back something
`drawImage` can blit.

> **State-driven drawing cannot be a static sprite.** A sprite may be translated,
> scaled and rotated. Anything that changes its shape, its fill, its alpha over
> time, or its agreement with the physics stays procedural.

| Game | Sprite | Stays procedural |
| --- | --- | --- |
| goat-siege | goats (three designs, one set for adults and kids), cabbage, stump | sky, ground, fence, the chomp burst, the arc-driven shadow, the empty-slot ring |
| sling-puck | the puck | felt, **the walls and the gap**, the band's V, the aim dashes, the arrival glow |
| spill | the drop | the pool (two summed sines on level and tilt), the splash (age-driven) |
| cat-and-mouse | the cat, the mouse (filled **and** hollow) | the floor and its grid, the grace ring (turns on a clock), the own-icon ring (depends who is looking) |
| tap-duel | — | no canvas; the bullseye is CSS |

### A fill variant is derived, never maintained by hand

Cat and Mouse needs a mouse both filled and hollow (its §7). By the time canvas sees a
sprite it is **pixels**, and filled-versus-hollow is a difference of *geometry*, not of
colour — so no runtime trick produces one from the other. What canvas *can* do to a
sprite, for reference, is `globalAlpha` (free) and a flat recolour via an offscreen
`source-in` composite (one extra raster per colour, so it competes with `MAX_RASTERS`).
Neither gives an outline: recolouring a solid silhouette outlines the whole blob and
loses the ear as a separate ring.

So the second file has to exist. What it must not be is hand-maintained — two copies of
one silhouette drift the moment somebody redraws it, and **nothing fails when they
do.**

One file is the art, the other is generated:

```
art/mouse.svg           the art. data-outline="6.6" opts in
art/mouse-hollow.svg    GENERATED by www/src/games/outlines.mjs
```

```bash
npm run art:outlines     # rewrite the derived files (also runs on prebuild)
npm test                 # fails if a committed variant is stale
```

The transform is one rule: an element with a solid `fill` becomes
`fill="none" stroke="<that colour>" stroke-width="<data-outline>"`, and anything already
stroked is left exactly alone — the mouse's tail is a stroked curve in both versions.
An element may override the width with its own `data-outline`.

It is deliberately not an SVG engine. Anything the rule cannot express is a sign the
variant should be drawn by hand, with `data-outline` left off.

Three properties this buys, each of which was checked rather than assumed:

- **Redrawing the mouse cannot desync the pair** — regenerate, and the outline follows.
- **A stale or hand-edited variant fails `npm test`**, exit 1. Demonstrated by editing
  each in turn and watching `--check` report `STALE`.
- **The generator checks its own output** for the doubled-hyphen trap below and for
  losing `width`/`height`/`viewBox`. A tool writing prose into an XML comment is
  exactly how thirteen blank hub cards happened once already.

The derived files **are committed**: a fresh clone must run `vite dev` without knowing
the script exists. Source and generated SVG text is normalised to LF before comparison;
Git's CRLF checkout on Windows is not a redraw and must not make the variant stale.

Tap Fighter's two runtime sprite sheets are authored PNGs: `fighter1.png` and
`fighter2.png`. Each is a transparent 4×2 grid of 256 px frames; the second sheet
is already mirrored, so the canvas and CSS use it directly without runtime transforms.

**Four cards are exceptions to "cards are pure vector":** Tap Fighter, Aliens
love cows, Random Game and Gravity Shooter. Every other card redraws its
sprite's shape as fresh paths (this section's Goat Siege/Sling Puck/Spill
examples); Tap Fighter's `card.svg` instead embeds base64 crops of the actual
`fighter1.png`/`fighter2.png` frames, Aliens love cows' embeds crops of its own
`barn.png`/`cow.png` (the UFO, its cone, the stars and the ground stay fresh
vector paths around them), Random Game's embeds a downscaled crop of
`art/src/dice.png` over a mosaic of nine other games' own card art (the mosaic
tiles stay fresh — they are those games' real `card.svg` markup, not a redraw),
and Gravity Shooter's embeds its own two ship sprites, two planet sprites and
its missile — because a hand-drawn approximation of a detailed authored
pixel-art subject reads worse than the real thing at this size.

**Two of the four are generated** rather than hand-assembled, both gated by a
committed content-hash manifest (`art/.card-manifest.json`) the same way
`og.mjs` guards its own derived PNGs, both regenerated by an `art:` script, and
both failing `npm test` when the committed file is stale:

- `random-game/generate-card.mjs` extracts the nine mosaic tiles and
  crops/embeds the die on every run (`npm run art:random-card`).
- `gravity-shooter/generate-card.mjs` composes that game's own sprites **and
  runs that game's own `simulateShot`** to draw the trail
  (`npm run art:gravity-card`). The dashed curve on the card is a real
  trajectory over a posed board, with the missile at a real point on it and
  rotated to that point's real tangent — so retuning `GRAVITY_G` or the launch
  speed redraws the card. The posed board is asserted legal against the spec's
  own placement rules before anything is drawn, and the script hashes **its own
  source** into the manifest rather than a hand-listed set of inputs: the first
  change made to it added a framing constant that no listed input covered, and
  the card silently stayed "already current".

**A mosaic tile must be a pure-vector card.** Random Game lifts each tile's
markup verbatim, so an exception card arrives at full weight — Gravity
Shooter's single tile took that file from 35 KB to 64 KB against its own 40 KB
cap the moment its card became generated. It left the mosaic (Asteroid Race
took its place), which is the same reason Tap Fighter and Aliens Love Cows were
never in it.

Two things make any of the four safe rather than a shortcut: a bare `<image href="./fighter1.png">` would 404 once Vite hashes the
SVG and the PNG into `dist/assets/` under different names and does not rewrite
hrefs inside `.svg` files, so the frame has to be a data URI; and the ≤ 40 KB
budget still applies, met only by cropping each frame to its actual content
(dropping transparent padding) before downscaling — the raw source frames are
50–120 KB each, base64 alone would blow the budget several times over.

Where a sprite hardcodes a colour that also lives in a `render.ts` — Cat and Mouse's
cat has eyes painted in the floor's own colour — **say so in both**. Neither file can
see the other, and nothing will fail if they drift apart; the cat just stops looking
at you.

**The sling-puck walls and gap must never be sprites.** `layout.ts` has the wall's
inner face landing exactly where the physics stops a puck, and `GAP_LEFT`/`GAP_RIGHT`
come from `physics.ts`. A sprite lets the drawn gap and the real one drift, which is
a correctness bug — and sling-puck §13 makes the gap's readability an accessibility
requirement.

Requirements on a sprite file:

- Declare **`width`, `height` *and* `viewBox`**. Readiness is `onload` +
  `naturalWidth > 0`, and without an intrinsic size `naturalWidth` is 0 or 300
  depending on the engine. (`img.decode()` is not used: it has been flaky in Safari
  for SVGs, and a rejection means a permanently blank sprite.)
- Keep the procedural drawing as the fallback. `sheet.at()` returns null while
  loading and forever if the fetch failed, and a missing file must not stop a round —
  [AGENTS.md](../../AGENTS.md) §4, degrade rather than dead-end.

### Variants: several designs for one thing

Where a thing has interchangeable designs (Goat Siege's goats), the folder is the
list. `art/goats.ts` globs it, so **dropping in `goat-04.svg` is the whole job**:

```ts
const adults = import.meta.glob('./goats/*.svg', {
  query: '?url&no-inline', import: 'default', eager: true,
}) as Record<string, string>;
export const ADULT_URLS = Object.keys(adults).sort().map((k) => adults[k]!);
```

Sorted, so a file's index is stable across builds.

**One set can serve two sizes.** Goat Siege's kids share the adults' folder: a kid is an
adult drawing blitted at `base` 16 against 26, so a second folder bought nothing but a
second thing to maintain. A kid also derives its design from **its parent's** seed rather
than its own — `parent.seed * 31 + i` divides back — so a split reads as one goat becoming
two rather than three unrelated goats. The cost is on the record in goat-siege.md §12: the
two roles are now told apart by size alone.

`import.meta.glob` is fine here because only `render.ts` imports this module and no
node-run test loads it. It is **not** fine for discovering cards — see §6.

**Which variant a thing gets must be derived from server-assigned state**, never from
`Math.random()`:

- a per-frame random strobes between designs;
- a per-client random shows one object two ways where two people can see it.

Goat Siege uses the `seed` the server already puts on every `Goat`, so both vanish with
no protocol change — and it survives a refresh mid-flight, because the seed is part of
the round state rather than something the client made up. (In Goat Siege itself only
the victim ever sees a given goat, so the cross-phone half is free rather than needed.
Cat and Mouse, where everyone watches the same floor, is where it would earn its keep.) Hash it — `((seed * 2654435761) >>> 0) % n` — rather
than `seed % n` (seed is a counter, so that cycles the designs in visible order) and
rather than reusing `laneFrom`'s golden-ratio step (which would make a goat's design
predict its lane).

## 5. File shape

| | Hub card | Sprite |
| --- | --- | --- |
| Path | `art/card.svg` | `art/<thing>.svg` |
| `viewBox` | `0 0 120 90` — 4:3, per ui-guidelines §3 | whatever suits the shape |
| `width`/`height` | `120` / `90` | required, see §4 |
| Background | transparent | transparent |
| Colour | literal hex only | literal hex only |
| Size | ≤ 40 KB (ui-guidelines §6) | ≤ 40 KB |

**The phone glyph**, used by several cards: `22×38` with `rx="5"` at scale 1. The
rect and the `rx` scale together when it is drawn bigger or smaller; the
**`stroke-width` is 3 at every size and never scales**, because the house style is
one outline weight across the whole grid. That is also why it must never be wrapped
in an SVG `scale()` — that would thicken the stroke along with the shape. Resize the
rect and the `rx` by hand. Copy [assets/phone.svg](./assets/phone.svg) rather than
redrawing it.

## 6. Things deliberately not done

- **No JSON metadata.** `GameCard` catches a missing field or a bad value at
  `npm run typecheck`; JSON would trade that for a runtime check. `card.ts` gives the
  colocation without the loss.
- **No `import.meta.glob` for cards.** It is a Vite-only transform, so any node-run
  test that imports `registry.ts` breaks; it returns an untyped record; and it
  destroys the curated card order hub.md §2 requires. The imports are written out.
- **No per-game "show this UI" config flags.** Whether a game renders
  `core/ui/Scoreboard.tsx` is one line in that game's own TSX. A boolean beside
  it could only ever disagree with reality.

## 7. Proving it worked

A budget with no check is a wish:

```bash
npm run build
grep -c 'data:image/svg' dist/assets/hub-*.js   # 0 — nothing was inlined
grep -o '"M[0-9]' dist/assets/hub-*.js | wc -l  # 0 — no path data left in the JS
ls dist/assets/*.svg                             # one hashed file per illustration
gzip -9c dist/assets/hub-*.js | wc -c            # was 3444 on 2026-08-04
```

And in a browser, with the `.svg` requests blocked: every card still shows its accent
placeholder at the right size and **the grid does not shift**. That is the hub.md §2
claim, tested directly.
