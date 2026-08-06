<?php

declare(strict_types=1);

require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/FlagService.php';
require_once __DIR__ . '/Flags.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/PdoAuthStore.php';
require_once __DIR__ . '/PdoFlagStore.php';

/**
 * Wiring: config in, working objects out.
 * Spec: docs/specs/backoffice.md §4 · docs/deployment.md §3
 *
 * The endpoints get everything from here so that "which database, which address, which
 * mailer" is answered once. Nothing in this file makes a decision; it only assembles
 * the things that do.
 */
final class App
{
    /** @param array<string, mixed> $config */
    private function __construct(public readonly array $config)
    {
    }

    /**
     * Load `config.php` from beside the entry point.
     *
     * **Written by the deploy from GitHub environment secrets, never committed** — the
     * repository is public (docs/deployment.md §3.4). A missing file is not fatal: every
     * value defaults to empty, and an empty admin address matches nobody while an empty
     * token authorises nobody. So an unconfigured host has *no admin*, which is the
     * safe reading of "not set up yet" and the opposite of what a naive empty-string
     * comparison would do.
     */
    public static function boot(string $dir): self
    {
        $file = $dir . '/config.php';
        $loaded = is_readable($file) ? require $file : [];

        return new self([
            'db_dsn' => (string) ($loaded['db_dsn'] ?? ''),
            'db_user' => (string) ($loaded['db_user'] ?? ''),
            'db_pass' => (string) ($loaded['db_pass'] ?? ''),
            'admin_email' => (string) ($loaded['admin_email'] ?? ''),
            'admin_token' => (string) ($loaded['admin_token'] ?? ''),
            'admin_path' => (string) ($loaded['admin_path'] ?? ''),
            // Where a magic link points. From config rather than from
            // `$_SERVER['HTTP_HOST']`, deliberately: a poisoned Host header would
            // otherwise mail the operator a link to somebody else's site carrying a
            // valid token. The deploy knows which host it is deploying to.
            'site_origin' => (string) ($loaded['site_origin'] ?? ''),
            'cf_account_id' => (string) ($loaded['cf_account_id'] ?? ''),
            'cf_analytics_token' => (string) ($loaded['cf_analytics_token'] ?? ''),
            // The published file, in the web root. `api/` sits one level below it.
            'flags_path' => (string) ($loaded['flags_path'] ?? dirname($dir) . '/flags.json'),
            'mail_from' => (string) ($loaded['mail_from'] ?? 'noreply@guigui.fr'),
            // Local development only: a path here sends mail to a FILE instead of out.
            // A laptop has no working mail(), and without this the magic-link flow could
            // not be exercised anywhere but production. NEVER set on the host — the sink
            // would be a file full of valid links.
            'mail_sink' => (string) ($loaded['mail_sink'] ?? ''),
        ]);
    }

    public function configured(): bool
    {
        return $this->config['db_dsn'] !== '' && $this->config['admin_email'] !== '';
    }

    public function db(): PDO
    {
        static $db = null;
        if ($db === null) {
            $db = new PDO(
                (string) $this->config['db_dsn'],
                (string) $this->config['db_user'],
                (string) $this->config['db_pass'],
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    // Real prepared statements, not emulated ones. Emulation
                    // interpolates client-side, which is where the escaping bugs live.
                    PDO::ATTR_EMULATE_PREPARES => false,
                ],
            );
        }

        return $db;
    }

    public function flags(): FlagService
    {
        return new FlagService(
            new PdoFlagStore($this->db(), new SystemClock()),
            (string) $this->config['flags_path'],
        );
    }

    public function auth(): Auth
    {
        return new Auth(
            new PdoAuthStore($this->db()),
            new SystemClock(),
            $this->config['mail_sink'] !== ''
                ? new FileMailer((string) $this->config['mail_sink'])
                : new PhpMailer((string) $this->config['mail_from']),
            (string) $this->config['admin_email'],
            (string) $this->config['admin_token'],
            rtrim((string) $this->config['site_origin'], '/') . '/' . trim((string) $this->config['admin_path'], '/'),
        );
    }
}
