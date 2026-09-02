<?php

declare(strict_types=1);

require_once __DIR__ . '/Flags.php';

/**
 * Assembling a page from build-rendered markup.
 * Spec: docs/specs/seo.md §4
 *
 * ## This file authors no markup
 *
 * That is the whole design. `scripts/ssr.mjs` renders the real Preact components — once
 * per flag state — and everything here does is choose between finished strings and
 * concatenate them. A PHP function that emitted a card would be a second implementation
 * of `GameCardTile`, and it would drift silently, because the only reader of the
 * server-rendered copy is a crawler.
 *
 * The two places a string is *created* rather than chosen are the flags payload and the
 * escaped reason, and both are escaped at the point of creation.
 */
final class Page
{
    /** The marker `ssr.mjs` leaves where the grid goes. */
    public const GRID_MARKER = '<fony-grid></fony-grid>';

    /** The sentinel a `soon` card's badge carries until a real reason replaces it. */
    public const REASON_SENTINEL = '%%REASON%%';

    /**
     * The one card that isn't a real game (`www/src/games/random-game/card.ts`) —
     * kept as a plain literal, mirrored by hand in `HubGrid.tsx` and
     * `scripts/ssr.mjs`'s `weekOrder()`, the same way this class already mirrors
     * `worker/router.ts`'s slug pattern rather than inventing a cross-language
     * constant for a single case.
     */
    public const RANDOM_GAME_SLUG = 'random-game';

    /**
     * The break between the hub's three tiers (issue #4), byte-for-byte what
     * `preact-render-to-string` produces for `<li class="hub__spacer" aria-hidden="true" />`
     * — `grid()` below has to emit exactly this literal or a client that hydrates the
     * server-rendered page finds a spacer in a different shape than the one it would
     * have drawn itself.
     */
    public const GRID_SPACER = '<li class="hub__spacer" aria-hidden="true"></li>';

    /**
     * Which pre-rendered variant a flag selects.
     *
     * The key format is fixed by `ssr.mjs`; both sides building it the same way is the
     * one coupling between them, and `page_test.php` asserts every key the renderer emits
     * is one this function can ask for.
     */
    public static function variantKey(string $state, bool $hot, bool $week, bool $showAll): string
    {
        return $state . ':' . ($hot ? '1' : '0') . ':' . ($week ? '1' : '0') . ':' . ($showAll ? '1' : '0');
    }

    /**
     * The grid, in the hub's five tiers (issue #4): **Random Game always leads**, when
     * it's live, then the week's spotlight and the hottest game pinned next, then every
     * NEW-flagged game alphabetically, then everything else alphabetically, then every
     * not-yet-live game in its curated `registry.ts` order — `Flags::hubSections()`
     * supplies the pinned/fresh/rest three, which `HubGrid.tsx` applies identically on
     * the client; `$soonOrder` is appended verbatim, exactly as `HubGrid.tsx` appends
     * its own `soon` list, since a `soon` card cannot be hot, spotlighted or NEW and so
     * has no place in that sort at all. Identically matters: the client hydrates this
     * markup, and a grid built two ways is a mismatch on every card after the first,
     * including where the `GRID_SPACER` between tiers lands.
     *
     * A slug with no variant is skipped rather than guessed at: that means the build and
     * the flags disagree about which games exist, and inventing markup for it is how a
     * deleted game reappears.
     *
     * `$weekOrder` — every live game except `RANDOM_GAME_SLUG`, alphabetical by title,
     * from `weekOrder()` in `scripts/ssr.mjs` — is also what bounds `Flags::hottest()`
     * now and what `hubSections()` sorts NEW and "everything else" from, so there is
     * only the one list to keep in step with the client, the same reasoning
     * `HubGrid.tsx` itself applies to its own `alphabetical`. The exclusion lives in
     * `weekOrder()` itself (not here) because it never opens a room and so can never
     * honestly earn HOT, and leaving it in the rotation would occasionally hand it the
     * WEEK badge by chance. `$soonOrder` is `soonOrder()` from the same file, unrelated
     * to that sort.
     *
     * Whether Random Game gets its own leading tier is decided from data already in
     * scope rather than a new parameter: it's live this build if a variant exists for
     * it (`$cards`) and it isn't in `$soonOrder` — the same two facts `weekOrder()`'s
     * caller already has, just read back out.
     *
     * `$now` is a plain timestamp rather than a read of the clock in here, the same
     * reasoning `Flags::gameOfWeek()` itself is written that way: a test has to be able
     * to ask "what does the grid look like in week 1" without waiting for it.
     *
     * No `GRID_SPACER` between `pinned` and `fresh` specifically, nor between `random`
     * and whatever tier follows it: hot/week and NEW are both "look at this one"
     * tiers, and a rule between them read as a boundary that was not there for any
     * other adjacent pair; Random Game is chrome, not a tier of games, so nothing
     * separates it from the section under it (`HubGrid.tsx` carries both exceptions).
     *
     * A live game an operator has flagged `soon` is moved out of pinned/fresh/rest
     * and appended to `$soonOrder`, exactly like `HubGrid.tsx`'s own `demoted` — see
     * that function's doc comment for why.
     *
     * @param array<string, array<string, string>> $cards
     * @param array<string, array<string, mixed>> $flags
     * @param array<string, int> $plays
     * @param list<string> $weekOrder
     * @param list<string> $soonOrder
     */
    public static function grid(array $cards, array $flags, bool $showAll, array $plays = [], array $weekOrder = [], ?int $now = null, array $soonOrder = []): string
    {
        $hot = Flags::hottest($plays, $weekOrder);
        $week = Flags::gameOfWeek($weekOrder, $now ?? time());
        $sections = Flags::hubSections($weekOrder, $flags, $hot, $week);

        // Any live game flagged `soon` moves out of its section and joins the bottom,
        // after $soonOrder's own build-time games — mirrors HubGrid.tsx's `demoted`.
        $demoted = [];
        $keep = static function (array $slugs) use ($flags, &$demoted): array {
            return array_values(array_filter($slugs, static function (string $slug) use ($flags, &$demoted): bool {
                if (($flags[$slug]['state'] ?? Flags::ACTIVE) !== Flags::SOON) {
                    return true;
                }
                $demoted[] = $slug;
                return false;
            }));
        };
        $pinnedLive = $keep($sections['pinned']);
        $freshLive = $keep($sections['fresh']);
        $restLive = $keep($sections['rest']);
        $soonAll = array_merge($soonOrder, $demoted);

        $randomGameLive = isset($cards[self::RANDOM_GAME_SLUG]) && !in_array(self::RANDOM_GAME_SLUG, $soonOrder, true);

        $tiers = array_values(array_filter(
            [
                ['key' => 'random', 'slugs' => $randomGameLive ? [self::RANDOM_GAME_SLUG] : []],
                ['key' => 'pinned', 'slugs' => $pinnedLive],
                ['key' => 'fresh', 'slugs' => $freshLive],
                ['key' => 'rest', 'slugs' => $restLive],
                ['key' => 'soon', 'slugs' => $soonAll],
            ],
            static fn (array $tier): bool => count($tier['slugs']) > 0,
        ));

        $out = '';
        foreach ($tiers as $index => $tier) {
            $previous = $tiers[$index - 1] ?? null;
            // The two adjacencies with no spacer: Random Game leading into anything,
            // and hot/week leading straight into NEW.
            $afterRandom = $previous !== null && $previous['key'] === 'random';
            $freshAfterPinned = $tier['key'] === 'fresh' && $previous !== null && $previous['key'] === 'pinned';
            if ($index > 0 && !$afterRandom && !$freshAfterPinned) {
                $out .= self::GRID_SPACER;
            }

            foreach ($tier['slugs'] as $slug) {
                $variants = $cards[$slug] ?? null;
                if (!is_array($variants)) {
                    continue;
                }

                $flag = $flags[$slug] ?? Flags::default();
                $state = in_array($flag['state'] ?? null, Flags::STATES, true)
                    ? (string) $flag['state']
                    // Fail open, the same rule as everywhere: an unreadable flag means the
                    // game is playable, never that it vanishes.
                    : Flags::ACTIVE;

                $html = $variants[self::variantKey(
                    $state,
                    $slug === $hot,
                    $slug === $week,
                    $showAll,
                )] ?? '';
                if ($html === '') {
                    // Legitimately empty: a hidden game on prod is absent from the document
                    // rather than hidden with CSS, which would still put its title and link
                    // in the page for anyone who looked.
                    continue;
                }

                $reason = isset($flag['reason']) && is_string($flag['reason']) && trim($flag['reason']) !== ''
                    ? trim($flag['reason'])
                    // `cardState` falls back to "soon"; that fallback lives in TypeScript,
                    // so the only thing to do here is supply the same word.
                    : 'soon';

                $out .= str_replace(
                    self::REASON_SENTINEL,
                    // Operator-supplied text landing in a page. Escaped here, at the moment
                    // it stops being data and becomes HTML.
                    htmlspecialchars($reason, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
                    $html,
                );
            }
        }

        return $out;
    }

    /**
     * The flags, as a payload the client can adopt without a request.
     *
     * A `<script type="application/json">` rather than a global assignment: its contents
     * are never executed, so a reason containing a quote or a bracket cannot become code.
     * The one thing that still has to be neutralised is the literal sequence `</script`:
     * it ends the element wherever it appears, including inside a JSON string, and a
     * `reason` is operator-supplied text. **`JSON_HEX_TAG`** escapes `<` and `>` to
     * `\u003C`/`\u003E`, which `JSON.parse` turns straight back into the same characters
     * — so the payload is unchanged and the element cannot be closed early.
     */
    public static function flagsScript(array $flags, bool $showAll, array $plays = []): string
    {
        $json = json_encode(
            [
                'flags' => $flags === [] ? new stdClass() : $flags,
                // The counts the grid above was ordered with. Inlined rather than fetched:
                // a count arriving after paint would reorder the cards under a thumb
                // already on its way to one.
                'plays' => $plays === [] ? new stdClass() : $plays,
                'showAll' => $showAll,
            ],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG,
        );

        // A payload we cannot encode is not a reason to serve a broken page: an empty map
        // means every game active, the same fail-open rule as everywhere else.
        return '<script type="application/json" id="fony-flags">'
            . ($json === false ? '{"flags":{},"showAll":false}' : $json)
            . '</script>';
    }

    /**
     * Put the rendered grid and the flags into the page template.
     *
     * The template is Vite's own `index.html`, so the head — hashed asset links, `og:`
     * tags, JSON-LD — is never rebuilt here and cannot drift from the build.
     */
    public static function render(
        string $template,
        string $shell,
        string $gridOpen,
        string $gridClose,
        string $gridItems,
        array $flags,
        bool $showAll,
        array $plays = [],
    ): string {
        $grid = $gridOpen . $gridItems . $gridClose;
        $body = str_replace(self::GRID_MARKER, $grid, $shell);

        $html = str_replace('<div id="app"></div>', '<div id="app">' . $body . '</div>', $template);

        // Before </head>, so the payload is parsed before the module script runs and
        // `main.tsx` never has to wait for anything.
        return str_replace('</head>', '  ' . self::flagsScript($flags, $showAll, $plays) . "\n  </head>", $html);
    }

    /**
     * Read `flags.json` and decide whether to show everything.
     *
     * `show_all` comes from config — the deploy sets it true on dev and false on prod —
     * rather than from sniffing the hostname. A hostname test would be one string away
     * from showing prod's hidden games to the world.
     *
     * @return array{0: array<string, array<string, mixed>>, 1: bool, 2: array<string, int>}
     */
    public static function context(array $config): array
    {
        $both = Flags::readAll((string) ($config['flags_path'] ?? ''));

        return [$both['flags'], ($config['show_all'] ?? false) === true, $both['plays']];
    }
}
