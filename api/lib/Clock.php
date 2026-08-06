<?php

declare(strict_types=1);

/**
 * Time, behind an interface.
 * Docs: docs/testing.md §1.1a
 *
 * Same reasoning as the `Ctx` interface every game module is written against
 * (docs/testing.md §1.1): a link that expires in ten minutes and a rate limit over
 * an hour are *rules*, and a rule tested by sleeping is a rule not tested at all.
 *
 * Milliseconds, to match `Date.now()` and the constants in `shared/protocol.ts`.
 * PHP's own `time()` is seconds, which is a unit mismatch waiting to be found the
 * hard way, so nothing outside `SystemClock` ever calls it.
 */
interface Clock
{
    /** Milliseconds since the epoch. */
    public function now(): int;
}

final class SystemClock implements Clock
{
    public function now(): int
    {
        // `microtime(true)` rather than `time() * 1000`: the latter quantises to a
        // whole second, which would make two writes in the same second
        // indistinguishable.
        return (int) round(microtime(true) * 1000);
    }
}

/** A clock the tests move by hand. */
final class FakeClock implements Clock
{
    public function __construct(private int $ms = 1_700_000_000_000)
    {
    }

    public function now(): int
    {
        return $this->ms;
    }

    public function advance(int $ms): void
    {
        $this->ms += $ms;
    }
}
