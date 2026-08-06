<?php

declare(strict_types=1);

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
    public function __construct(
        private FlagStore $store,
        /** Absolute path of the published `flags.json` in the web root. */
        private string $publishPath,
    ) {
    }

    /** @return array<string, array<string, mixed>> */
    public function all(): array
    {
        return $this->store->load();
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

    /** @param array<string, array<string, mixed>> $flags */
    private function publish(array $flags): bool
    {
        return Flags::publish($this->publishPath, Flags::encode($flags));
    }
}
