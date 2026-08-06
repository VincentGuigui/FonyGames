<?php

declare(strict_types=1);

/**
 * The PHP half of `npm test`.
 * Docs: docs/testing.md §1.1a
 *
 * Deliberately the **same shape as the Node harness** (`worker/spill.test.ts`): no
 * framework, no dependency, a `check()` counter, and a non-zero exit when anything
 * fails. Reading one after the other should feel like reading the same file twice.
 *
 * PHP earns a harness at all because the backoffice moved here
 * (docs/specs/backoffice.md), and the rules it enforces are the kind that cannot be
 * eyeballed: a magic-link flow has a replay hole, an expiry hole, a
 * rate-limit-as-oracle hole and a single-use hole, and none of them is visible in a
 * browser. Deleting 81 tested assertions from the Worker and replacing them with
 * untested PHP would have been the real regression.
 *
 * Targets PHP 8.1 syntax, not 8.4. The local box runs 8.4 and GitHub's
 * `ubuntu-latest` runner ships something older; the older one is the constraint.
 */
final class Harness
{
    public static int $checks = 0;
    public static int $failures = 0;

    /** @var list<string> Labels that failed, so the tail of the output names them. */
    public static array $failed = [];

    /** Suppresses printing while a captured block runs (see `capture`). */
    public static bool $quiet = false;

    /**
     * The exit code, as a **pure function** so it can be asserted rather than
     * assumed.
     *
     * `$checks === 0` is a failure, not a pass. A suite that discovers no test files
     * — a renamed directory, a bad glob — would otherwise exit 0 and read as "all
     * green", which is the worst possible way for a test harness to break.
     */
    public static function exitCode(int $checks, int $failures): int
    {
        if ($checks === 0) {
            return 1;
        }

        return $failures > 0 ? 1 : 0;
    }

    /**
     * Run a block with its own counters and no output, and report what it did.
     *
     * Only the harness's own tests use this. It exists so "a failing check really
     * does fail" can be asserted without failing the run that asserts it.
     *
     * @param callable():void $body
     * @return array{checks:int, failures:int}
     */
    public static function capture(callable $body): array
    {
        $checks = self::$checks;
        $failures = self::$failures;
        $failed = self::$failed;
        $quiet = self::$quiet;

        self::$checks = 0;
        self::$failures = 0;
        self::$failed = [];
        self::$quiet = true;

        try {
            $body();
            $result = ['checks' => self::$checks, 'failures' => self::$failures];
        } finally {
            self::$checks = $checks;
            self::$failures = $failures;
            self::$failed = $failed;
            self::$quiet = $quiet;
        }

        return $result;
    }
}

/** A heading. Matches the blank-line-then-name shape the Node harness prints. */
function group(string $name): void
{
    if (!Harness::$quiet) {
        echo "\n{$name}\n";
    }
}

/**
 * One assertion.
 *
 * `$extra` is printed only on failure, and is the difference between "FAIL the
 * session expired" and knowing what the two timestamps actually were.
 *
 * @param mixed $extra
 */
function check(string $label, bool $cond, $extra = null): void
{
    Harness::$checks++;

    if ($cond) {
        if (!Harness::$quiet) {
            echo "  ok   {$label}\n";
        }

        return;
    }

    Harness::$failures++;
    Harness::$failed[] = $label;

    if (!Harness::$quiet) {
        $detail = $extra === null
            ? ''
            : ' ' . json_encode($extra, JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        echo "  FAIL {$label}{$detail}\n";
    }
}

/** Prints the verdict and returns the process exit code. */
function summary(): int
{
    $code = Harness::exitCode(Harness::$checks, Harness::$failures);

    echo "\n";

    if (Harness::$checks === 0) {
        echo "no checks ran — the suite found nothing to run, which is a failure\n";

        return $code;
    }

    if (Harness::$failures === 0) {
        echo 'all passed (' . Harness::$checks . " checks)\n";

        return $code;
    }

    echo Harness::$failures . ' of ' . Harness::$checks . " check(s) failed:\n";
    foreach (Harness::$failed as $label) {
        echo "  - {$label}\n";
    }

    return $code;
}
