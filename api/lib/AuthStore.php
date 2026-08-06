<?php

declare(strict_types=1);

/**
 * What the magic-link flow has to remember.
 * Spec: docs/specs/backoffice.md §4
 *
 * Two things, and deliberately no more: the one outstanding link, and enough recent
 * request history to rate-limit. There is no user table, no password, no session table
 * — PHP's own session handling covers the last of those, which is most of why the
 * admin moved here.
 */
interface AuthStore
{
    /**
     * Store the one outstanding link, replacing any previous one.
     *
     * Only the **SHA-256** of the token is stored. A database dump then contains
     * nothing that can be redeemed, which is the entire reason for hashing something
     * that already expires in ten minutes.
     */
    public function saveLink(string $tokenHash, int $expiresAtMs): void;

    /**
     * The outstanding link, or null. Does **not** delete — see `deleteLink()`.
     *
     * @return array{hash: string, expiresAt: int}|null
     */
    public function link(): ?array;

    public function deleteLink(): void;

    /** How many link requests this caller has made since `$sinceMs`. */
    public function countAttempts(string $ipHash, int $sinceMs): int;

    public function recordAttempt(string $ipHash, int $atMs): void;

    /** Drop attempt rows older than `$beforeMs`, so the table cannot grow forever. */
    public function pruneAttempts(int $beforeMs): void;
}
