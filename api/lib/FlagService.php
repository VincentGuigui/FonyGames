<?php

declare(strict_types=1);

require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/FlagStore.php';
require_once __DIR__ . '/Flags.php';

/**
 * The one place a flag change happens.
 * Spec: docs/specs/backoffice.md §2b
 *
 * ## Why this exists rather than the route calling the store directly
 *
 * Because there is an invariant worth a name: **the published file can never be
 * behind the database.** Two readers depend on `flags.json` — the Worker, which
 * enforces, and `index.php`, which renders — so a write that updates MySQL and
 * forgets to republish leaves a disabled game playable, with the admin page happily
 * showing it as disabled. Putting store-then-publish in one method makes that
 * impossible to forget and gives the test something to assert.
 *
 * Publishing failure is reported, not thrown. The database write has already
 * committed by then, so the honest answer to the operator is "saved, but not
 * published" — which they can act on. Throwing would suggest nothing happened.
 */
final class FlagService
{
    /**
     * The floor on `count()`'s own republish (spec §2.2). Not on anything a human is
     * waiting on: an admin flag edit and the explicit repair `republish()` always
     * write immediately, both below.
     */
    public const RECOUNT_DEBOUNCE_MS = 1_800_000;

    public function __construct(
        private FlagStore $store,
        /** Absolute path of the published `flags.json` in the web root. */
        private string $publishPath,
        private Clock $clock,
    ) {
    }

    /** @return array<string, array<string, mixed>> */
    public function all(): array
    {
        return $this->store->load();
    }

    /**
     * Finished rounds per slug.
     *
     * @return array<string, int>
     */
    public function plays(): array
    {
        return $this->store->plays();
    }

    /**
     * Count one finished round, and republish if the last *auto*-republish has had
     * long enough to be read.
     *
     * The count always lands — `$this->store->bump()` is an atomic `UPDATE ... SET
     * plays = plays + 1`, so nothing here is ever lost, however many rounds finish at
     * once. The republish is the part that does not scale the same way: it rereads
     * every row and rewrites the whole file, and at real traffic "a few a minute"
     * becomes many a second, all racing to rename the same path. So this is the one
     * write in `FlagService` allowed to fall behind — nobody is waiting on a round's
     * own script tag for it, unlike an admin flag edit or the explicit repair
     * `republish()` below, which always write immediately. A skipped republish here
     * is picked up by the very next round, or by `RECOUNT_DEBOUNCE_MS` passing.
     *
     * Returns the new total and whether the file was rewritten this call, so a caller
     * can report a counted-but-not-yet-published round rather than claiming success.
     *
     * @return array{plays: int, published: bool}
     */
    public function count(string $slug): array
    {
        $total = $this->store->bump($slug);

        if (!$this->dueToRepublish()) {
            return ['plays' => $total, 'published' => false];
        }

        $published = $this->republish();
        if ($published) {
            $this->markRepublished();
        }

        return ['plays' => $total, 'published' => $published];
    }

    /**
     * Has it been at least `RECOUNT_DEBOUNCE_MS` since `count()` last actually wrote
     * the file?
     *
     * Tracked in its own small stamp file, next to `flags.json` — not the file's own
     * mtime, which an admin flag edit or the repair `republish()` also move, and
     * neither of those is what this throttle exists to protect against. And not
     * in-memory: PHP starts a fresh process per request on the hosts this runs on,
     * so nothing here survives between one call and the next except what is on disk.
     */
    private function dueToRepublish(): bool
    {
        $raw = @file_get_contents($this->recountStampPath());
        if ($raw === false || $raw === '') {
            return true; // no auto-republish has ever landed — nothing to protect yet
        }

        return $this->clock->now() - (int) trim($raw) >= self::RECOUNT_DEBOUNCE_MS;
    }

    /** Stamp now as the last time `count()` actually rewrote the file. */
    private function markRepublished(): void
    {
        // Best-effort: a failed write here only means the next round tries again
        // immediately rather than waiting out the window, which is the safe direction
        // to fail in.
        @file_put_contents($this->recountStampPath(), (string) $this->clock->now());
    }

    private function recountStampPath(): string
    {
        return dirname($this->publishPath) . '/flags.recount-stamp';
    }

    /**
     * Apply a patch to one slug.
     *
     * Returns null for a slug that fails the sanitiser, so the caller answers 400
     * rather than storing something that will later be turned into a URL.
     *
     * @param array<string, mixed> $patch
     * @return array{flags: array<string, array<string, mixed>>, published: bool}|null
     */
    public function update(?string $rawSlug, array $patch): ?array
    {
        $slug = Flags::slug($rawSlug);
        if ($slug === null) {
            return null;
        }

        $flags = Flags::apply($this->store->load(), $slug, $patch);
        $this->store->put($slug, $flags[$slug]);

        return ['flags' => $flags, 'published' => $this->publish($flags)];
    }

    /**
     * The change log, for the admin page.
     *
     * Exposed here rather than letting a caller build its own store: two stores over one
     * connection is two chances to disagree about which database this is.
     *
     * @return list<array<string, mixed>>
     */
    public function history(int $limit = 50): array
    {
        return $this->store->history($limit);
    }

    /**
     * Rewrite `flags.json` from whatever the store currently holds.
     *
     * Public because it is also the repair action: if a publish once failed, the
     * operator needs a way to retry it without inventing a flag change.
     */
    public function republish(): bool
    {
        return $this->publish($this->store->load());
    }

    /**
     * @param array<string, array<string, mixed>> $flags
     */
    private function publish(array $flags): bool
    {
        // The counts come from the store even when the caller already had the flags: the
        // published file is a snapshot of both halves, and writing it from a stale count
        // would undo every round played since the caller loaded its flags.
        return Flags::publish($this->publishPath, Flags::encode($flags, $this->store->plays()));
    }
}
