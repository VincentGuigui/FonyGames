<?php

declare(strict_types=1);

/**
 * The shape of `config.php`. Placeholders only — nothing real belongs here.
 * Docs: docs/deployment.md §3.1
 *
 * **`config.php` is written by the deploy from GitHub environment secrets and is never
 * committed.** This repository is public, so a committed copy publishes every value in
 * it. This `.example` exists so the shape is reviewable without the values.
 *
 * It returns an array rather than defining constants or setting globals, so a stray
 * direct request executes it, produces no output, and changes nothing — and on the
 * host it now sits one level above `/www`, outside the web root entirely, so there is
 * no request to go stray from in the first place.
 *
 * The deploy writes it beside `dist/` (mirroring "beside `/www`" on the host); testing
 * by hand does the same — see docs/testing.md §1.1a-bis.
 */

return [
    // MySQL, reachable only from PHP (docs/database.md §3).
    'db_dsn' => 'mysql:host=localhost;dbname=fonygames;charset=utf8mb4',
    'db_user' => 'fonygames',
    'db_pass' => 'not-a-real-password',

    // The one address a magic link may be sent to (docs/specs/backoffice.md §4).
    'admin_email' => 'you@example.com',

    // Break-glass bearer for curl, so a dead mailbox cannot lock the operator out.
    // `openssl rand -hex 32`.
    'admin_token' => 'not-a-real-token',

    // Shared with the Worker's PLAYS_TOKEN secret, so only it can count a finished round
    // (api/played.php). Blank is allowed and means the counter endpoint is open: the
    // catalogue still bounds it to real games, so the worst case is a wrong HOT badge.
    'plays_token' => '',

    // The hidden directory the admin page was renamed to, and the origin it is on.
    // Both come from the deploy: the link is built from these rather than from
    // $_SERVER['HTTP_HOST'], so a poisoned Host header cannot mail the operator a link
    // pointing at somebody else's site.
    'admin_path' => 'ops-7f3a91',
    'site_origin' => 'https://fonygames.guigui.fr',

    // Cloudflare usage panel. Read-only analytics token — never the deploy token
    // (docs/deployment.md §3.3). Blank is fine: the panel says "unavailable".
    'cloudflare_account_id' => '',
    'cloudflare_analytics_token' => '',

    // ipinfo.io, for the city/country on an activity event (docs/specs/analytics.md §3).
    // Sent as a Bearer token; `site_origin` above is the request Referer. Blank is fine:
    // events are still recorded without geography. The caller's IP is never stored.
    'ipinfo_token' => '',

    // The off switch for activity events. Absent or true means on; false stops
    // api/analytics.php recording anything while leaving the endpoint answering 204,
    // so the client cannot tell and nothing retries (docs/specs/analytics.md §5).
    // 'analytics_enabled' => false,

    // Where the published flags land. Left out here on purpose: the default already
    // resolves to the web root's flags.json wherever config.php itself sits
    // (App::boot()), and the real deploy never sets this key.
    // 'flags_path' => '/path/to/www/flags.json',

    // True on the DEV host only: show every game with a badge stating what prod would do,
    // so dev is a preview of the catalogue rather than a copy of prod's restrictions
    // (docs/specs/backoffice.md §2b). The deploy sets this from the branch.
    'show_all' => false,

    // Envelope sender for the magic link.
    'mail_from' => 'noreply@guigui.fr',

    // LOCAL DEVELOPMENT ONLY. A path here writes the magic link to a file instead of
    // mailing it, because a laptop has no working mail(). Leave it out on the host: the
    // sink would be a file full of valid links.
    // 'mail_sink' => '/tmp/fonygames-mail.log',
];
