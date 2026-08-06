# SEO and link previews

How a FonyGames page is discovered, and how it looks when somebody shares it.

> Status: **built**, on 2026-08-06, when the backoffice moved from the Worker to PHP
> ([backoffice.md](backoffice.md)) and a server-rendered page became possible.
> Not yet verified on a deployed host — the two `.htaccess` traps in §4 are the ones
> to check there first, because both look exactly like "the rendering did not happen".

## 1. The problem, stated plainly

FonyGames is distributed **by sharing a link**. A player taps *share*, a room URL
lands in a group chat, and the person on the other end decides in one glance
whether to tap it.

Two things were wrong before this spec existed:

1. **No `og:` or `twitter:` tags anywhere.** So a shared link previewed as a bare
   URL — no title, no sentence, no picture — on exactly the surfaces the product
   depends on: iMessage, WhatsApp, Messenger, Discord, Slack.
2. **The served HTML was an empty shell.** `dist/index.html` was ~1 KB with an
   empty `<div id="app">`, so a crawler that does not execute JavaScript saw a
   page with no games on it.

The first is a **product bug**, not an SEO nicety. It is fixed first and on its
own (§3), because it needs none of the machinery in §4.

## 2. What is static and what is per request

| Thing | When | Why |
| --- | --- | --- |
| `<title>`, `<meta name="description">` | build | Never change without a code change |
| `og:*`, `twitter:*`, JSON-LD | build | Same |
| The OG image PNG | build (§5) | Derived from committed art |
| **The card grid markup** | **request** | A flag must take effect with no rebuild |
| `robots.txt` | build | Static |
| `sitemap.php` | **request** | A `hidden` game must drop out of it |
| `<meta name="robots" content="noindex">` on a game page | **request** | Same reason |

**Why per request rather than prerendered at build.** The operator can disable or
hide a game from the admin centre at any time, and that must change what the
server serves — including to a crawler — without a deploy. A build-time prerender
would freeze the catalogue at build time and reintroduce the rebuild it exists to
avoid.

**Why PHP.** It is already the only thing on the web host that can execute, and
the flags are already written there ([backoffice.md](backoffice.md) §2b). No new
component.

## 3. The tags every page carries

Written into each `www/**/index.html` head, so `vite build` carries them through:

```html
<meta property="og:type"        content="website" />
<meta property="og:site_name"   content="FonyGames" />
<meta property="og:title"       content="Cat and Mouse — FonyGames" />
<meta property="og:description" content="…the same sentence as the meta description…" />
<meta property="og:image"       content="https://fonygames.guigui.fr/og/cat-and-mouse.png" />
<meta property="og:image:width"  content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url"         content="https://fonygames.guigui.fr/cat-and-mouse/" />
<meta name="twitter:card"       content="summary_large_image" />
```

Rules, each of which exists because getting it wrong is silent:

- **`og:image` must be an absolute URL.** A relative one is ignored by most
  scrapers, and nothing warns you.
- **`og:image` must be a raster.** PNG or JPEG. **Not SVG** — iMessage, WhatsApp,
  X and Facebook all reject it, which is to say the format that would have been
  free is the one that does not work.
- **`og:url` is the canonical page**, never a room URL. A shared
  `/cat-and-mouse/#AB2C` must preview as *Cat and Mouse*, and the fragment is not
  sent to a server anyway.
- **`og:description` is the same sentence as `<meta name="description">`.** One
  pitch per game, not two that drift.
- `twitter:card` is `summary_large_image`; the `og:*` tags supply the rest, so
  there are no duplicate `twitter:title`/`twitter:description` to keep in sync.
- A JSON-LD `VideoGame` block per game page, with `name`, `description`,
  `url`, `image`, `playMode: "MultiPlayer"`, `applicationCategory: "Game"` and
  `operatingSystem: "Any (web browser)"`.

`robots.txt` allows everything and points at `/sitemap.xml`, which is the name every
crawler looks for; the root `.htaccess` rewrites that to `sitemap.php`, because a
sitemap has to be generated per request for a hidden game to drop out of it. It cannot *hide* the admin path — a `Disallow` line publishes it
to anyone who reads the file — so the admin path is **not** listed there. See
[backoffice.md](backoffice.md) §4: the path is not the security, and `robots.txt`
is a place it must not leak.

## 4. Server-side rendering — PHP authors no markup

The trap: PHP cannot run Preact. A PHP function that emits card markup would be a
**second implementation** of `GameCardTile`, and it would drift — invisibly,
because the only reader of the server-rendered copy is a crawler.

So the build generates the markup and PHP only chooses between finished strings:

```
build   preact-render-to-string over the REAL <Hub/>, <HubGrid/> and <GameCardTile/>
          ├── dist/_hub/page.html    Vite's index.html, MOVED here (see trap 1)
          ├── dist/_hub/shell.html   the hub, with <fony-grid></fony-grid> where the cards go
          ├── dist/_hub/cards.php    order + grid wrapper + slug → variant → <li> string
          └── dist/_hub/.htaccess    none of the above is a page

request dist/index.php
          = page.html, with #app filled by
              shell, with the marker replaced by
                the variant each game's current flag selects
          + <script type="application/json" id="fony-flags">…</script> in the head
```

`scripts/ssr.mjs` builds it, with an esbuild plugin that resolves the Vite-only
`?url&no-inline` art imports to their **content-hashed** URLs from
`dist/.vite/manifest.json` — so the markup is byte-identical to the client's and
hydration has nothing to correct.

- **The variants are enumerated mechanically.** For each card, for each
  `availability` × `isNew` × `showAll` combination — twelve — call `cardState()` from
  [`shared/flags.ts`](../../shared/flags.ts) and render the real component with the
  result. A `hidden` game on prod is the empty string, so it is **absent from the
  document** rather than dimmed with CSS, which would still put its title and its link
  in the source for a crawler to read. **No decision logic is duplicated** —
  `shared/flags.ts` stays the only place the rules live, and the node harness already
  covers it.
- `showAll` is the dev-vs-prod dimension, and it comes from `show_all` in
  `api/config.php`, which the deploy sets from the branch. Not from sniffing
  `$_SERVER['HTTP_HOST']`, which is one string away from showing prod's hidden games to
  the world.
- **The grid's `<ul>` comes from `HubGrid`'s own output**, extracted at build time, so
  the class name `hub.css` depends on is authored in exactly one place.
- **The order comes from the build**, recorded alongside the variants. `hub.md` §2
  requires a curated order, and iterating the flags map instead would quietly replace it
  with whatever order the JSON happened to be written in.
- A `disabled` card's reason is the one runtime string, injected with a single
  `str_replace` into a placeholder the build left behind. It is
  HTML-escaped on the way in; it is operator-supplied text landing in a page.
- **PHP reads `flags.json` from disk**, not MySQL — one `file_get_contents`, no
  database round trip on the page that owns the ≤ 2.5 s budget
  ([../architecture.md](../architecture.md) §4).
- **Missing or unparseable `flags.json` ⇒ every game `active`.** The same
  fail-open rule as everywhere else, and for the same reason: a broken file must
  not blank the catalogue.
- **The flags are inlined into the page.** So the client's first render matches
  the server's byte for byte, `hydrate()` is a real hydration rather than a
  patch-up, and **the hub makes no flag request at all** — which also removes the
  paint-then-reconcile flicker the old design had to excuse.
- `main.tsx` picks its mount mode from the DOM:
  `(root.firstElementChild ? hydrate : render)(<Hub />, root)`. One line, because
  `vite dev` serves the plain `index.html` with an empty `#app` and must keep
  working. **This branch is intent, not a workaround**: both directions were measured
  in a real browser and both work on the Preact this project ships
  ([../testing.md](../testing.md) §1.1d).

### The two traps that make SSR live but invisible

Both of these look identical to "the server-side rendering simply did not
happen", which is why they are written down rather than remembered.

1. **A stale `index.html` outranks `index.php`.** The deploy's SFTP sync
   *uploads everything and deletes nothing* ([../deployment.md](../deployment.md)
   §5), so an `index.html` from an earlier deploy stays on the host forever, and
   Apache's default `DirectoryIndex` prefers it. Fix, **both halves**:
   `www/public/.htaccess` carries `DirectoryIndex index.php index.html`, *and*
   the old `index.html` is deleted once by hand on each host. Either alone is a
   single point of silence.

   The build helps by not emitting one at all: `scripts/ssr.mjs` **moves** Vite's
   `index.html` to `_hub/page.html`. That protects every future deploy; it cannot
   remove the file an earlier deploy already put there, which is why the manual delete
   is still owed.
2. **A cached page defeats the point.** The same `.htaccess` sets
   `Cache-Control: no-cache, must-revalidate` for `.php`, while content-hashed
   assets keep their long cache. Without it a flag change waits on a CDN edge or
   a phone.

## 5. The OG image

One 1200×630 PNG per game at `www/public/og/<slug>.png`, composed from that
game's existing `art/card.svg` on its accent background — the same tint the card
uses, so a shared link looks like the card the player will land on.

Generated by `www/src/games/og.mjs` using **`@resvg/resvg-js`**, a devDependency:
prebuilt binaries, SVG→PNG with no browser, and it never touches the site
payload.

**No text in the image.** `resvg` needs a real font file to render `<text>`, and
committing one is a licence and a size question for no gain — every platform
displays `og:title` next to the picture already.

### ⚠️ Staleness is a content hash, never a timestamp

`git` does not store mtimes. A fresh CI checkout stamps every file with the
checkout time, so "is the SVG newer than the PNG?" becomes a coin toss —
sometimes regenerating everything, sometimes nothing, and never for a reason you
can see.

So `www/public/og/.manifest.json` is **committed** and holds each source SVG's
SHA-256 plus a generator version. A PNG is regenerated exactly when its hash
moved. Locally that is the behaviour you want — touch one piece of art,
regenerate one file. In CI it is correct rather than lucky.

`og.mjs --check` exits 1 when any entry is stale, and runs as part of `npm test`
— the same guard `outlines.mjs` already uses for the hollow sprites
([../design/illustrations.md](../design/illustrations.md)).

## 6. How this is verified

Local, with PHP's own server so `.php` actually executes, on **port 5173**
because that is the origin the Worker allow-lists:

```bash
npm run build && php -S localhost:5173 -t dist
curl -s localhost:5173/ | grep -c 'game-card'      # ≥ 13, no JS involved
```

Then the check that is the entire justification for doing this per request:
**disable a game in the admin and `curl` again without rebuilding.** The card's
state must change in the response.

The rest, in [../testing.md](../testing.md):

- hydration **adopts** the server's grid rather than replacing it, proved with a
  MutationObserver installed before the page's own scripts — a console warning cannot
  tell you, because Preact's production build is silent on a mismatch
  ([../testing.md](../testing.md) §1.1d);
- the grid is present and its links work with JavaScript disabled;
- a build-time assertion that every page carries `og:title`, `og:description` and
  `og:image`, and that the PNG exists and is ≤ 300 KB;
- `curl -I` against the deployed hub returns `Cache-Control: no-cache`, and the
  old `index.html` is gone from both hosts. Skip this and every other check
  passes locally while nothing is live.

## 7. Deliberately not doing

- **No prerendering of game lobbies.** A lobby is a room code and a share button;
  there is nothing to index. Their heads carry the tags, their bodies stay
  client-rendered.
- **No sitemap of room URLs.** Rooms are ephemeral and private by design
  ([../database.md](../database.md) §1).
- **No `hreflang`, no translations.** The site is English-only today; a language
  decision belongs in [../roadmap.md](../roadmap.md) before any markup appears.
- **No analytics tag, no consent banner.** The about sheet promises nothing is
  stored, and a third-party script would make that a lie
  ([backoffice.md](backoffice.md) §1).
