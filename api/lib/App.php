<?php

declare(strict_types=1);

require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/Health.php';
require_once __DIR__ . '/FlagService.php';
require_once __DIR__ . '/Flags.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/Migrator.php';
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
    /**
     * The one connection this App uses.
     *
     * An instance property, not a `static` local inside `db()`. A static local in a
     * non-static method is shared by **every** instance, so two Apps with different
     * configs would silently share one connection — harmless in production, where there
     * is one App per request, and wrong the moment a test builds a second one.
     */
    private ?PDO $pdo = null;

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
            /*
             * Shared with the Worker, so only it can count a finished round
             * (api/played.php). Empty means the endpoint is open — see the trade recorded
             * there. Never the admin token: that one is break-glass access to everything,
             * and handing it to a Worker would put it in a second system's secret store.
             */
            'plays_token' => (string) ($loaded['plays_token'] ?? ''),
            'admin_path' => (string) ($loaded['admin_path'] ?? ''),
            // Where a magic link points. From config rather than from
            // `$_SERVER['HTTP_HOST']`, deliberately: a poisoned Host header would
            // otherwise mail the operator a link to somebody else's site carrying a
            // valid token. The deploy knows which host it is deploying to.
            'site_origin' => (string) ($loaded['site_origin'] ?? ''),
            'cloudflare_account_id' => (string) ($loaded['cloudflare_account_id'] ?? ''),
            'cloudflare_analytics_token' => (string) ($loaded['cloudflare_analytics_token'] ?? ''),
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
        if ($this->pdo === null) {
            $this->pdo = new PDO(
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

        return $this->pdo;
    }

    /**
     * Does this request carry the break-glass token? Answered **without the database**.
     *
     * `auth()` cannot answer it: building an Auth constructs a PdoAuthStore, which opens
     * the connection. So on an unreachable database the old order threw before
     * authorisation had been decided, every action answered 500 before dispatch, and the
     * crash report had to withhold its detail from a caller who was in fact authorised —
     * which is how a failed deploy ended up with an empty body and no cause
     * (docs/specs/backoffice.md §2c).
     *
     * Takes the whole `$_SERVER`, not one header: `Authorization` is not reliably forwarded
     * to PHP on a shared host, so `Auth::presentedToken()` decides where to look.
     *
     * @param array<string, mixed> $server
     */
    public function tokenMatches(array $server): bool
    {
        return Auth::tokenMatches(Auth::presentedToken($server), (string) $this->config['admin_token']);
    }

    /** Where `flags.json` is published — needed by callers that want to explain a failure. */
    public function flagsPath(): string
    {
        return (string) $this->config['flags_path'];
    }

    public function flags(): FlagService
    {
        return new FlagService(
            new PdoFlagStore($this->db(), new SystemClock()),
            (string) $this->config['flags_path'],
        );
    }

    /**
     * The migration runner.
     *
     * `dist/db/migrations` on the host, `db/migrations` in the repo — `api/` sits beside
     * `db/` in both, so one relative path covers both without a config key.
     */
    public function migrator(): Migrator
    {
        return new Migrator($this->db(), dirname(__DIR__, 2) . '/db/migrations');
    }

    public function usage(): Usage
    {
        return new Usage(
            (string) $this->config['cloudflare_account_id'],
            (string) $this->config['cloudflare_analytics_token'],
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
        $targets = [];
        foreach (self::hosts()['environments'] ?? [] as $name => $env) {
            $worker = (string) ($env['worker'] ?? '');
            $subdomain = (string) (self::hosts()['workersSubdomain'] ?? '');
            if ($worker === '' || $subdomain === '') {
                continue;
            }
            $targets["room server ({$name})"] = "https://{$worker}.{$subdomain}/health";
        }

        return $targets;
    }

    /**
     * The deployed hostnames, from the one file that holds them.
     *
     * `shared/hosts.json` is the single source (docs/realtime-server.md §6). Two
     * candidate paths because the file lives in a different place in the repository
     * than on the host: the deploy stages it to `api/hosts.json` beside this code,
     * while a checkout has it in `shared/`. Tried in deployed-first order, since that
     * is the one that has to be fast and certain.
     *
     * Anything wrong returns an empty array, which means no health targets rather
     * than a fatal — the admin page losing one panel is not a reason to lose the page.
     *
     * @return array<string, mixed>
     */
    private static function hosts(): array
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached;
        }

        foreach ([__DIR__ . '/../hosts.json', __DIR__ . '/../../shared/hosts.json'] as $path) {
            if (!is_readable($path)) {
                continue;
            }
            $decoded = json_decode((string) file_get_contents($path), true);
            if (is_array($decoded)) {
                return $cached = $decoded;
            }
        }

        return $cached = [];
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
            /*
             * Two very different situations, and conflating them was misleading.
             *
             * NOTHING POPULATES `games` — an absent row *means* the default, `active`
             * and not new, so a row only appears the first time a game is changed. An empty
             * table with no file is therefore a **working, untouched install**, and the
             * old wording called that a failure.
             *
             * Rows but no file is the real problem: the operator has set something and the
             * file everything READS does not reflect it, so the Worker is enforcing the old
             * answer while this page shows the new one.
             */
            $rows = 0;
            try {
                $rows = count((new PdoFlagStore($this->db(), new SystemClock()))->load());
            } catch (Throwable) {
                // No schema yet. The schema panel is what says so; this line does not
                // need to guess.
                return ['ok' => true, 'detail' => 'no flags yet — the schema is not installed'];
            }

            if ($rows === 0) {
                return [
                    'ok' => true,
                    'detail' => 'no flags set yet, so every game is active — that is the'
                        . ' default, and why the table is empty. A row appears the first time'
                        . ' you change a game.',
                ];
            }

            /*
             * "Use republish" was useless advice on its own: republish writes to the same
             * path, so whatever stopped the write stops it too, and the operator clicks a
             * button that cannot work. Say what is actually in the way.
             */
            $why = Flags::publishDiagnosis($path);

            return [
                'ok' => false,
                'detail' => "{$rows} flag(s) are set but flags.json is MISSING — the Worker is"
                    . ' failing open, so every game is playable whatever the switches above'
                    . ' say. ' . ($why === null
                        ? 'Nothing obvious is wrong with ' . $path . ', so try republish.'
                        : 'Republish will fail the same way until this is fixed: ' . $why . '.'),
            ];
        }

        $age = time() - (int) filemtime($path);
        $count = count(Flags::read($path));

        return [
            'ok' => true,
            'detail' => $count === 0
                // Published and empty is the steady state of an install nobody has touched.
                ? 'flags.json is published and empty — every game is active, which is the'
                    . ' default. Written ' . self::ago($age) . ' ago.'
                : "flags.json holds {$count} flag(s), written " . self::ago($age) . ' ago',
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
