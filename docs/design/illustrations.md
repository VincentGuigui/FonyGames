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
| goat-siege | goats, kids, cabbage, stump | sky, ground, fence, the chomp burst, the arc-driven shadow, the empty-slot ring |
| sling-puck | the puck | felt, **the walls and the gap**, the band's V, the aim dashes, the arrival glow |
| spill | the drop | the pool (two summed sines on level and tilt), the splash (age-driven) |
| cat-and-mouse | the cat, the mouse (filled **and** hollow) | the floor and its grid, the grace ring (turns on a clock), the own-icon ring (depends who is looking) |
| tap-duel | — | no canvas; the bullseye is CSS |

**A fill variant is a second file, not a runtime recolour.** Cat and Mouse needs a
mouse both filled and hollow (its §7), and by the time canvas sees a sprite it is
pixels — pixels cannot be tinted the way a `fill` attribute can. So `mouse.svg` and
`mouse-hollow.svg` are the same silhouette twice and **have to stay in step**; the
numbers in one are the numbers in the other. That is the honest cost of the sprite,
and it is the reason to keep variants few: one more state would be one more file.

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
list. `art/goats.ts` globs it, so **dropping in `goat-03.svg` is the whole job**:

```ts
const adults = import.meta.glob('./goats/*.svg', {
  query: '?url&no-inline', import: 'default', eager: true,
}) as Record<string, string>;
export const ADULT_URLS = Object.keys(adults).sort().map((k) => adults[k]!);
```

Sorted, so a file's index is stable across builds.

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
  `core/ui/OpponentScores.tsx` is one line in that game's own TSX. A boolean beside
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
