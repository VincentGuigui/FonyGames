<?php

declare(strict_types=1);

require_once __DIR__ . '/AuthStore.php';

/**
 * The magic link's storage. Schema: db/init.sql
 *
 * `admin_link` is a **single-row table**, pinned by `id = 1`. One outstanding link at a
 * time is a rule from the spec, and a primary key that can only hold one value enforces
 * it in the schema rather than in a `DELETE` somebody might forget.
 */
final class PdoAuthStore implements AuthStore
{
    private const LINK_ROW = 1;

    public function __construct(private PDO $db)
    {
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    public function saveLink(string $tokenHash, int $expiresAtMs): void
    {
        // Delete-then-insert rather than an upsert, for the same portability reason as
        // PdoFlagStore: MySQL and SQLite spell upsert differently, and the tests must
        // run the statements production runs. In a transaction, so there is no instant
        // with no link at all — a redeem racing a re-request would otherwise see none.
        $this->db->beginTransaction();

        try {
            $this->db->prepare('DELETE FROM admin_link WHERE id = ?')->execute([self::LINK_ROW]);
            $this->db
                ->prepare('INSERT INTO admin_link (id, token_hash, expires_at) VALUES (?, ?, ?)')
                ->execute([self::LINK_ROW, $tokenHash, $expiresAtMs]);
            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();

            throw $e;
        }
    }

    public function link(): ?array
    {
        $stmt = $this->db->prepare('SELECT token_hash, expires_at FROM admin_link WHERE id = ?');
        $stmt->execute([self::LINK_ROW]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return null;
        }

        return ['hash' => (string) $row['token_hash'], 'expiresAt' => (int) $row['expires_at']];
    }

    public function deleteLink(): void
    {
        $this->db->prepare('DELETE FROM admin_link WHERE id = ?')->execute([self::LINK_ROW]);
    }

    public function countAttempts(string $ipHash, int $sinceMs): int
    {
        $stmt = $this->db->prepare(
            'SELECT COUNT(*) FROM admin_link_attempt WHERE ip_hash = ? AND at >= ?',
        );
        $stmt->execute([$ipHash, $sinceMs]);

        return (int) $stmt->fetchColumn();
    }

    public function recordAttempt(string $ipHash, int $atMs): void
    {
        $this->db
            ->prepare('INSERT INTO admin_link_attempt (ip_hash, at) VALUES (?, ?)')
            ->execute([$ipHash, $atMs]);
    }

    public function pruneAttempts(int $beforeMs): void
    {
        $this->db->prepare('DELETE FROM admin_link_attempt WHERE at < ?')->execute([$beforeMs]);
    }
}
