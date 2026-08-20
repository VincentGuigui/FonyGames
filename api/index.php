<?php

declare(strict_types=1);

/**
 * The admin API. One entry point, one action per request.
 * Spec: docs/specs/backoffice.md §2b, §4
 *
 * A single file rather than one per endpoint, because the session bootstrap, the
 * method check, the CSRF header and the JSON envelope are the same for all of them —
 * and four copies of a security check is three chances to forget one.
 *
 * ## The layers, and which one is real
 *
 * The hidden path stops crawlers. The magic link authenticates. **The session check
 * below is the only real control**, and it runs on every action that is not itself
 * part of getting a session (spec §4).
 */

/*
 * ── The last resort, registered before anything can fail ───────────────────
 *
 * An uncaught throwable answers **500 with an empty body** on any host with
 * `display_errors` off, which is every shared host. That is how the first dev deploy of
 * `?a=migrate` failed: the workflow could only report "answered 500", the body was
 * empty, and the cause was unknowable from the log.
 *
 * Registered ABOVE the require, on purpose. Top-level function declarations are hoisted,
 * so `reply()` and `crash()` are callable before their textual position — and doing it
 * here means a parse error in one of the `lib/` files is reported too, rather than being
 * the one failure that still answers nothing.
 *
 * What it CANNOT cover is a parse error in *this* file: PHP never runs a line of it. That
 * is what `api/preflight.php` is for (docs/deployment.md §3.6c).
 */
set_exception_handler(static function (Throwable $e): void {
    crash(get_class($e), $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
});

register_shutdown_function(static function (): void {
    $last = error_get_last();
    $fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR;

    // Shutdown functions run on every request, including successful ones. Only a fatal
    // that produced no output is ours to report; `reply()` echoes and exits, so a normal
    // answer has already sent its headers by the time we get here.
    if ($last === null || ($last['type'] & $fatal) === 0 || headers_sent()) {
        return;
    }

    crash('fatal', $last['message'] . ' @ ' . basename($last['file']) . ':' . $last['line']);
});

/**
 * Report a crash as JSON.
 *
 * The message is included **only for a caller we have already authorised**. A PDO connect
 * failure quotes the database user and host, and a stack of file paths is reconnaissance;
 * an anonymous caller gets the class and nothing else, which is still enough to tell a
 * database fault from a bug.
 */
function crash(string $kind, string $message): never
{
    $authorised = ($GLOBALS['authorised'] ?? null) === true;

    reply(500, ['error' => 'unavailable', 'kind' => $kind] + ($authorised ? ['detail' => $message] : []));
}

require_once __DIR__ . '/lib/App.php';

$app = App::boot(__DIR__);

/** JSON out, and nothing cached — a flag change must never be served from a cache. */
function reply(int $status, mixed $body = null): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    // The admin URL must not leak through a Referer when the page links out.
    header('Referrer-Policy: no-referrer');
    // Framing protection belongs on the *page*, not on a JSON response —
    // `frame-ancestors` applies to documents. It is set in the admin directory's
    // .htaccess, which travels with the directory when the deploy renames it.

    echo $body === null ? '{}' : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * The JSON body, or an empty array. A malformed body is not a 500.
 *
 * **Read once and cached.** `php://input` is re-readable on most SAPIs but not all, and
 * calling this twice in one action silently gave the second caller an empty body — a
 * bug that reads as "the form sent nothing".
 */
function body(): array
{
    static $parsed = null;

    if ($parsed === null) {
        $raw = file_get_contents('php://input');
        $decoded = ($raw === false || $raw === '') ? null : json_decode($raw, true);
        $parsed = is_array($decoded) ? $decoded : [];
    }

    return $parsed;
}

/**
 * Start the session with a cookie that cannot be read by script or sent cross-site.
 *
 * `SameSite=Lax` is the CSRF defence: browsers do not attach a Lax cookie to a
 * cross-site POST, so another site cannot make an authenticated write on the
 * operator's behalf. The `X-Admin` header requirement below is the second lock —
 * a cross-origin request carrying a custom header needs a CORS preflight, and there is
 * no CORS here to succeed at.
 */
function beginSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        // Only over HTTPS in production. Computed rather than hardcoded true, or the
        // whole flow is untestable over plain http on a laptop; the deployed host is
        // HTTPS-only, so in practice this is always on where it matters.
        'secure' => (($_SERVER['HTTPS'] ?? '') !== '') || (($_SERVER['REQUEST_SCHEME'] ?? '') === 'https'),
        'samesite' => 'Lax',
    ]);
    session_name('fonyops');
    session_start();
}

/** 12 hours from the redeem, checked here rather than trusted to the cookie. */
const SESSION_TTL_MS = 43_200_000;

function signedIn(): bool
{
    beginSession();
    $since = $_SESSION['admin_since'] ?? null;

    if (!is_int($since)) {
        return false;
    }

    // The age is checked server-side against our own timestamp. A session cookie's own
    // lifetime is a hint the browser may ignore; this is not.
    if ((int) round(microtime(true) * 1000) - $since > SESSION_TTL_MS) {
        $_SESSION = [];
        session_destroy();

        return false;
    }

    return true;
}

$action = is_string($_GET['a'] ?? null) ? $_GET['a'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Reads are GET, writes are POST. Stated once, here, so no action has to remember.
$writes = ['link', 'session', 'flags', 'logout', 'migrate', 'republish'];
if (in_array($action, $writes, true) && $method !== 'POST') {
    reply(405, ['error' => 'POST only']);
}

/*
 * Every write needs `X-Admin: 1`.
 *
 * Not authentication — anyone can set a header. It is a CSRF lock: a cross-origin
 * request with a custom header triggers a preflight, this endpoint answers no CORS
 * headers, so the browser never sends the real request. Together with SameSite=Lax
 * that is two independent reasons another site cannot drive the admin.
 */
if (in_array($action, $writes, true) && ($_SERVER['HTTP_X_ADMIN'] ?? '') !== '1') {
    reply(400, ['error' => 'missing X-Admin header']);
}

if (!$app->configured()) {
    // No database and no admin address means the host was never set up. Said plainly,
    // because the alternative is an operator debugging a magic link that was never
    // going to be sent (docs/deployment.md §3.1).
    reply(503, ['error' => 'the admin centre is not configured on this host']);
}

/*
 * Settle the token BEFORE anything opens the connection.
 *
 * `$app->auth()` builds a PdoAuthStore, so the line below is where an unreachable database
 * first throws — and it is above every one of this file's own handlers. Deciding token
 * authorisation first (a config comparison, no database) means the crash that follows can
 * include its detail for the caller that is entitled to it, which is the deploy.
 *
 * `$authorised` is completed after the switch, where `signedIn()` joins it. This is not the
 * access decision; it is the half of it that costs nothing.
 */
$authorised = $app->tokenMatches($_SERVER);

try {
    $auth = $app->auth();
} catch (PDOException $e) {
    // Named rather than fatal. Before this, an unreachable database made EVERY action —
    // including `?a=schema`, the one that exists to work on a fresh install — answer 500
    // with an empty body on any host with display_errors off.
    reply(503, [
        'error' => 'the database is not reachable from this host',
        'dbUnreachable' => true,
    ] + ($authorised ? ['dbError' => $e->getMessage()] : []));
}

switch ($action) {
    /*
     * Ask for a link. **Always 204**, whatever happened — wrong address, rate limited,
     * or sent. A different answer for a wrong address would turn this into a way to
     * discover who the operator is (spec §4), and a different answer when rate limited
     * would say "you guessed right, try later".
     *
     * The one thing that does surface is a broken mailer, as a 502: that is a fault on
     * our side, and hiding it leaves the operator staring at a link that never arrives
     * with no way to tell it from a spam folder.
     */
    case 'link':
        $in = body();
        $email = is_string($in['email'] ?? null) ? $in['email'] : '';
        try {
            $auth->requestLink($email, clientIp());
        } catch (PDOException) {
            /*
             * PDOException EXTENDS RuntimeException, so this branch must come first.
             * Without it, a missing table was reported as "the mailer refused the message"
             * — found by running the flow against an empty database, where it is the most
             * misleading answer possible: the operator would go and check their mail
             * configuration.
             *
             * And on an empty database this is the ONLY thing that can happen, because
             * requesting a link records a rate-limit attempt first.
             */
            reply(503, [
                'error' => 'the database schema is not installed, so a link cannot be recorded',
                'schemaMissing' => true,
                'pending' => $app->migrator()->pending(),
            ]);
        } catch (RuntimeException) {
            reply(502, ['error' => 'the mailer refused the message']);
        } catch (Throwable) {
            reply(500, ['error' => 'unavailable']);
        }
        reply(204);

        // no break — reply() exits

    case 'session':
        $token = is_string(body()['token'] ?? null) ? body()['token'] : '';
        if (!$auth->redeem($token)) {
            reply(401, ['error' => 'no']);
        }
        beginSession();
        // A brand-new session id for the authenticated session, so a fixated one handed
        // to the operator beforehand cannot be the one that ends up signed in.
        session_regenerate_id(true);
        $_SESSION['admin_since'] = (int) round(microtime(true) * 1000);
        reply(200, ['ok' => true]);

        // no break

    case 'logout':
        beginSession();
        $_SESSION = [];
        session_destroy();
        reply(204);

        // no break
}

// The token half is already settled above, before the connection was opened. `signedIn()`
// is the other half and costs a session read.
$authorised = $authorised || signedIn();

/*
 * ONE deliberate pre-auth answer: "the schema is not installed".
 *
 * Without it the first run is a dead end. The auth gate below answers 401 to an anonymous
 * visitor whatever the schema state, so the page could never learn that it should be asking
 * for ADMIN_TOKEN — and a magic link cannot work on an empty database, because signing in
 * writes to a table the migrations create.
 *
 * What it gives away is one bit, to somebody who already has the secret admin path and can
 * therefore already see a login form. It carries **no applied list and no file names**, and
 * it stops answering the moment the schema exists — at which point there is both something
 * to protect and a way to authenticate.
 */
if ($action === 'schema' && !$authorised) {
    $migrator = $app->migrator();
    try {
        if ($migrator->installed()) {
            reply(401, ['error' => 'no']);
        }
        reply(200, ['installed' => false, 'pending' => $migrator->pending(), 'applied' => [], 'files' => $migrator->files()]);
    } catch (PDOException) {
        // No detail on the anonymous path: the driver's message names the database user
        // and host. "Not reachable" is all this caller needs, and offering the bootstrap
        // panel here would propose migrating a database we cannot even connect to.
        reply(503, ['error' => 'the database is not reachable from this host']);
    }
}

/* ── Everything below is privileged ───────────────────────────────────────── */

if (!$authorised) {
    reply(401, ['error' => 'no']);
}

/*
 * The schema may not exist yet.
 *
 * Without this, a fresh database makes `?a=state` throw a PDOException, which the page
 * reports as "The admin API answered 500" — true and useless. A named 503 lets the page
 * show the migrate panel instead of an error.
 *
 * Only the actions that read tables are guarded. `?a=usage` reads a file and makes outbound
 * calls, so it works on an empty database and is worth having then.
 */
function requireSchema(App $app): void
{
    try {
        if ($app->migrator()->installed()) {
            return;
        }

        $pending = $app->migrator()->pending();
    } catch (PDOException $e) {
        // A DIFFERENT state, and it used to be indistinguishable: `installed()` reported
        // every failure as "not installed", so a wrong DSN offered the operator a migrate
        // button that could not possibly work. Reachability is the operator's problem to
        // fix, not ours to paper over.
        reply(503, ['error' => 'the database is not reachable', 'dbError' => $e->getMessage()]);
    }

    reply(503, [
        'error' => 'the database schema is not installed',
        'schemaMissing' => true,
        'pending' => $pending,
    ]);
}

switch ($action) {
    /*
     * The schema panel. Reachable on an EMPTY database, which is the whole point:
     * `?a=state` cannot answer there, and this is what tells the operator why.
     */
    case 'schema':
        try {
            reply(200, $app->migrator()->status());
        } catch (PDOException $e) {
            reply(503, ['error' => 'the database is not reachable', 'dbError' => $e->getMessage()]);
        }

        // no break

    /*
     * Apply pending migrations.
     *
     * Then republish `flags.json`, so a freshly migrated host has the file the Worker and
     * the hub read. Without that it stays absent until the first flag change, and the
     * health panel reports the Worker as failing open — technically true and needlessly
     * alarming on a working install.
     */
    case 'migrate':
        try {
            $result = $app->migrator()->apply((int) round(microtime(true) * 1000));
        } catch (PDOException $e) {
            /*
             * `apply()` handles a failing *statement* itself and reports which one. What
             * lands here is everything around it: a refused connection, an unknown
             * database, a user without CREATE. Those used to be UNCAUGHT — and an uncaught
             * throwable is an empty 500 on a host with display_errors off, which is how
             * this endpoint's first real deploy failed with nothing in the log.
             *
             * 503, not 500: the request was fine, the dependency is not.
             */
            reply(503, [
                'ok' => false,
                'error' => 'the database refused the migration',
                'dbError' => $e->getMessage(),
            ]);
        }

        reply($result['ok'] ? 200 : 500, $result + [
            'published' => $result['ok'] ? $app->flags()->republish() : false,
        ]);

        // no break

    case 'state':
        requireSchema($app);
        $service = $app->flags();
        reply(200, [
            'flags' => $service->all() ?: new stdClass(),
            'history' => $service->history(20),
            'revision' => Health::revision(dirname(__DIR__)),
        ]);

        // no break

    case 'flags':
        requireSchema($app);
        $in = body();
        $patch = [];
        // Only the three fields, only the right types. Everything else is dropped
        // rather than rejected: the caller is a form, and Flags::apply() treats a
        // partial patch as a merge (spec §5).
        if (isset($in['availability']) && is_string($in['availability'])) {
            $patch['availability'] = $in['availability'];
        }
        if (isset($in['isNew']) && is_bool($in['isNew'])) {
            $patch['isNew'] = $in['isNew'];
        }
        if (array_key_exists('reason', $in)) {
            $patch['reason'] = is_string($in['reason']) ? $in['reason'] : null;
        }

        $result = $app->flags()->update(
            is_string($in['slug'] ?? null) ? $in['slug'] : null,
            $patch,
        );
        if ($result === null) {
            reply(400, ['error' => 'bad slug']);
        }

        // `published` is reported rather than assumed. The database write has already
        // committed, so "saved but not published" is a real state and the operator has
        // to be able to see it — otherwise the Worker keeps enforcing the old answer
        // while this page shows the new one.
        // `publishWhy` only when it failed: the operator's next move is to fix the cause,
        // and "saved but not published" without a reason sends them to a republish button
        // that fails identically.
        reply(200, ['flags' => $result['flags'] ?: new stdClass(), 'published' => $result['published']]
            + ($result['published'] ? [] : ['publishWhy' => Flags::publishDiagnosis($app->flagsPath())]));

        // no break

    case 'republish':
        requireSchema($app);
        $done = $app->flags()->republish();
        reply(200, ['published' => $done]
            + ($done ? [] : ['publishWhy' => Flags::publishDiagnosis($app->flagsPath())]));

        // no break

    /*
     * Health and Cloudflare usage, on their OWN action rather than folded into `state`.
     *
     * Both make outbound HTTP calls with their own timeouts, and the flag switches must
     * stay usable while they are slow or down — which is exactly when the operator has
     * come to look at them. Loading them separately means a hung Worker delays one panel
     * instead of the whole page.
     */
    case 'usage':
        reply(200, [
            'flagsFile' => $app->flagsState(),
            'health' => $app->health()->check($app->healthTargets()),
            'cloudflare' => $app->usage()->daily(7),
        ]);

        // no break

    /*
     * The activity dashboard. Requires the schema, unlike `usage` — this one reads a
     * table rather than a file and an outbound call, so an empty database has nothing
     * to answer with.
     *
     * `?days=` is the only input, clamped inside `Analytics::summary()` itself rather
     * than here — the ceiling is a fact about that method, not about this endpoint.
     */
    case 'analytics':
        requireSchema($app);
        $days = (int) ($_GET['days'] ?? 7);
        reply(200, $app->analytics()->summary($days > 0 ? $days : 7));

        // no break
}

reply(404, ['error' => 'no such action']);

/**
 * The caller's address, for the rate limit only.
 *
 * `REMOTE_ADDR` and nothing else. `X-Forwarded-For` is caller-supplied and would let
 * anyone reset their own rate limit by inventing a new value per request — which is
 * the same as having no rate limit. If this host is ever put behind a proxy, the
 * proxy's real header goes here explicitly, after checking the proxy sets it.
 */
function clientIp(): string
{
    return is_string($_SERVER['REMOTE_ADDR'] ?? null) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
}

