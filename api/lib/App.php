<?php

declare(strict_types=1);

require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/Health.php';
require_once __DIR__ . '/FlagService.php';
require_once __DIR__ . '/Flags.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/PdoAuthStore.php';
require_once __DIR__ . '/PdoFlagStore.php';
require_once __DIR__ . '/Usage.php';

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
            // Does this host show every game, badged, whatever the flag says? True on
            // dev, false on prod (docs/specs/backoffice.md §2b). From config rather than
            // from sniffing $_SERVER['HTTP_HOST'] — a hostname test is one string away
            // from showing prod's hidden games to the world.
            'show_all' => ($loaded['show_all'] ?? false) === true,
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

    public function usage(): Usage
    {
        return new Usage(
            (string) $this->config['cf_account_id'],
            (string) $this->config['cf_analytics_token'],
        );
    }

    public function health(): Health
    {
        return new Health();
    }

    /**
     * What to check, and where.
     *
     * The Worker URLs are derived from the room-server naming in
     * docs/realtime-server.md §6 rather than configured, because they are public and
     * fixed; a config key for them would be one more thing to get wrong on a fresh host.
     *
     * @return array<string, string>
     */
    public function healthTargets(): array
    {
        // NO self-check, and the first reason only showed up by running one: fetching your
        // own origin from inside a request DEADLOCKS on PHP's built-in server, which is
        // single-threaded — a guaranteed 4-second timeout in local development. It would
        // also be near-worthless: if this code is answering, the site is up. What is worth
        // knowing about this host is whether `flags.json` is there, and that is a disk
        // read (`flagsState()`).
        return [
            'room server (dev)' => 'https://fonygames-worker-dev.vincent-f02.workers.dev/health',
            'room server (prod)' => 'https://fonygames-worker.vincent-f02.workers.dev/health',
        ];
    }

    /**
     * Is the file the Worker depends on actually there?
     *
     * The one thing about this host worth reporting, and it is a disk read rather than an
     * HTTP call. If `flags.json` is missing, the Worker fails open and every game is
     * playable regardless of what the switches above say — which is the single most
     * confusing state this system can be in, so it gets said out loud.
     *
     * @return array{ok: bool, detail: string}
     */
    public function flagsState(): array
    {
        $path = (string) $this->config['flags_path'];

        if (!is_readable($path)) {
            return [
                'ok' => false,
                'detail' => 'flags.json is missing — the Worker is failing open, so every'
                    . ' game is playable whatever the switches above say. Use republish.',
            ];
        }

        $age = time() - (int) filemtime($path);
        $count = count(Flags::read($path));

        return [
            'ok' => true,
            'detail' => "flags.json holds {$count} flag(s), written " . self::ago($age) . ' ago',
        ];
    }

    private static function ago(int $seconds): string
    {
        if ($seconds < 90) {
            return "{$seconds}s";
        }
        if ($seconds < 5400) {
            return (int) round($seconds / 60) . 'min';
        }
        if ($seconds < 172800) {
            return (int) round($seconds / 3600) . 'h';
        }

        return (int) round($seconds / 86400) . 'd';
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
