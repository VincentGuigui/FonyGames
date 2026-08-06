<?php

declare(strict_types=1);

/**
 * Tests the harness.
 *
 * This is not navel-gazing. Every PHP assertion the backoffice will ever have rests
 * on two behaviours here: a failing check must make the process exit non-zero, and a
 * suite that ran nothing must not report success. A harness that quietly passes on
 * failure makes every test written after it decorative, and the symptom is a green
 * CI badge — so it is checked first and explicitly.
 */

group('the harness counts');

$r = Harness::capture(static function (): void {
    check('a true thing', true);
});
check('a passing check counts once and fails nothing', $r['checks'] === 1 && $r['failures'] === 0, $r);

$r = Harness::capture(static function (): void {
    check('a false thing', false);
});
check('a failing check is counted as a failure', $r['checks'] === 1 && $r['failures'] === 1, $r);

$r = Harness::capture(static function (): void {
    check('one', true);
    check('two', false);
    check('three', true);
});
check('mixed results are tallied, not short-circuited', $r['checks'] === 3 && $r['failures'] === 1, $r);

// Asserted as "unchanged", not as "zero". An earlier version compared against 0,
// which made this check fail spuriously whenever anything *else* in the suite failed
// — adding a bogus third failure to a report at exactly the moment the report needs
// to be readable.
$outerChecks = Harness::$checks;
$outerFailures = Harness::$failures;
Harness::capture(static function (): void {
    check('inner pass', true);
    check('inner fail', false);
});
check(
    'capture leaves the outer counters alone',
    Harness::$checks === $outerChecks && Harness::$failures === $outerFailures,
    ['checks' => [$outerChecks, Harness::$checks], 'failures' => [$outerFailures, Harness::$failures]],
);

group('the exit code');

check('all passing exits 0', Harness::exitCode(12, 0) === 0);
check('one failure exits 1', Harness::exitCode(12, 1) === 1);
check('every check failing exits 1', Harness::exitCode(12, 12) === 1);

// The one that protects the glob in run.php. A renamed directory or a changed
// filename convention finds no files, runs no checks, and would otherwise exit 0 —
// a green suite that tested nothing at all.
check('zero checks is a failure, not a pass', Harness::exitCode(0, 0) === 1);
