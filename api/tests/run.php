<?php

declare(strict_types=1);

/**
 * Runs every `*_test.php` beside this file.
 * Docs: docs/testing.md §1.1a
 *
 * Discovery by glob rather than a written-out list, which is the opposite of the
 * choice `www/src/games/registry.ts` makes — and for the opposite reason. The
 * registry needs a curated *order* and must import under node; a test suite needs
 * neither, and a new test file that silently does not run is worse than an
 * unordered one.
 *
 * The glob's own failure mode is covered: `Harness::exitCode()` treats zero checks
 * as a failure, so a renamed directory cannot read as "all green".
 */

require __DIR__ . '/harness.php';

$files = glob(__DIR__ . '/*_test.php');
if ($files === false) {
    fwrite(STDERR, "could not read " . __DIR__ . "\n");
    exit(1);
}

sort($files);

foreach ($files as $file) {
    require $file;
}

exit(summary());
