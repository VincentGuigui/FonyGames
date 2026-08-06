<?php

declare(strict_types=1);

/**
 * Apply pending migrations from the command line.
 * Docs: docs/database.md §5
 *
 * The layout `database.md` documents, and the counterpart to the admin centre's schema
 * panel — both drive the same `api/lib/Migrator.php`, so there is one implementation of
 * "what does applying a migration mean".
 *
 * Reads its connection from `api/config.php`, the same file the site uses, so there is no
 * second place to configure a database. On a laptop with no config, `--dsn` covers it.
 *
 * Usage:
 *   php db/migrate.php                 apply everything pending
 *   php db/migrate.php --status        list applied and pending, change nothing
 *   php db/migrate.php --dsn=... --user=... --pass=...
 */

require_once __DIR__ . '/../api/lib/Migrator.php';

$args = [];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $arg, $m) === 1) {
        $args[$m[1]] = $m[2] ?? true;
    }
}

/** @return array{dsn: string, user: string, pass: string} */
function connection(array $args): array
{
    if (isset($args['dsn']) && is_string($args['dsn'])) {
        return [
            'dsn' => $args['dsn'],
            'user' => is_string($args['user'] ?? null) ? $args['user'] : 'root',
            'pass' => is_string($args['pass'] ?? null) ? $args['pass'] : '',
        ];
    }

    $config = __DIR__ . '/../api/config.php';
    if (!is_readable($config)) {
        fwrite(STDERR, <<<TEXT
            No api/config.php and no --dsn.

            On the host the deploy writes that file (docs/deployment.md §3.1). Locally,
            copy api/config.example.php or pass a DSN:

              php db/migrate.php --dsn='mysql:host=127.0.0.1;dbname=fonygames' --user=root --pass=x

            TEXT);
        exit(1);
    }

    $loaded = require $config;

    return [
        'dsn' => (string) ($loaded['db_dsn'] ?? ''),
        'user' => (string) ($loaded['db_user'] ?? ''),
        'pass' => (string) ($loaded['db_pass'] ?? ''),
    ];
}

$conn = connection($args);
if ($conn['dsn'] === '') {
    fwrite(STDERR, "no db_dsn configured\n");
    exit(1);
}

try {
    $db = new PDO($conn['dsn'], $conn['user'], $conn['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (Throwable $e) {
    fwrite(STDERR, 'could not connect: ' . $e->getMessage() . "\n");
    exit(1);
}

$migrator = new Migrator($db, __DIR__ . '/migrations');

if (isset($args['status'])) {
    $status = $migrator->status();
    echo 'schema installed: ' . ($status['installed'] ? 'yes' : 'no') . "\n\n";
    foreach ($status['files'] as $file) {
        $at = $status['applied'][$file] ?? null;
        echo $at === null
            ? "  PENDING  {$file}\n"
            : '  applied  ' . $file . '  (' . gmdate('Y-m-d H:i', intdiv($at, 1000)) . " UTC)\n";
    }
    exit(0);
}

$result = $migrator->apply((int) round(microtime(true) * 1000));

foreach ($result['applied'] as $file) {
    echo "applied  {$file}\n";
}

if (!$result['ok']) {
    // The file and the 1-based statement index, because the alternative is opening files
    // by hand at the moment you are most likely to make it worse.
    $f = $result['failed'];
    fwrite(STDERR, "\nFAILED in {$f['file']}, statement {$f['statement']}:\n  {$f['error']}\n\n");
    fwrite(
        STDERR,
        "Nothing was rolled back — MariaDB commits DDL as it goes, so earlier statements in\n"
        . "that file have taken effect. The file is NOT recorded as applied, so fix it and\n"
        . "run this again; migrations are required to be idempotent for exactly this reason\n"
        . "(docs/database.md §4 rule 2).\n",
    );
    exit(1);
}

echo $result['applied'] === []
    ? "nothing to do — " . count($result['skipped']) . " migration(s) already applied\n"
    : "\n" . count($result['applied']) . " migration(s) applied\n";
