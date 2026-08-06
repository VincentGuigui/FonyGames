<?php

declare(strict_types=1);

/**
 * The shape of `api/config.php`. Placeholders only — nothing real belongs here.
 * Docs: docs/deployment.md §3.1
 *
 * **`config.php` is written by the deploy from GitHub environment secrets and is never
 * committed.** This repository is public, so a committed copy publishes every value in
 * it. This `.example` exists so the shape is reviewable without the values.
 *
 * It returns an array rather than defining constants or setting globals, so a stray
 * direct request executes it, produces no output, and changes nothing. `api/lib`'s
 * `.htaccess` denies access anyway; this is the second layer.
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

    // The hidden directory the admin page was renamed to, and the origin it is on.
    // Both come from the deploy: the link is built from these rather than from
    // $_SERVER['HTTP_HOST'], so a poisoned Host header cannot mail the operator a link
    // pointing at somebody else's site.
    'admin_path' => 'ops-7f3a91',
    'site_origin' => 'https://fonygames.guigui.fr',

    // Cloudflare usage panel. Read-only analytics token — never the deploy token
    // (docs/deployment.md §3.3). Blank is fine: the panel says "unavailable".
    'cf_account_id' => '',
    'cf_analytics_token' => '',

    // Where the published flags land. The web root, one level above api/.
    'flags_path' => __DIR__ . '/../flags.json',

    // Envelope sender for the magic link.
    'mail_from' => 'noreply@guigui.fr',

    // LOCAL DEVELOPMENT ONLY. A path here writes the magic link to a file instead of
    // mailing it, because a laptop has no working mail(). Leave it out on the host: the
    // sink would be a file full of valid links.
    // 'mail_sink' => '/tmp/fonygames-mail.log',
];
