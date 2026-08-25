<?php

declare(strict_types=1);

/**
 * Which files in the deployed `assets/` are orphaned, and deleting exactly those.
 * Spec: docs/specs/backoffice.md §8 · docs/deployment.md §5
 *
 * The deploy's SFTP sync never deletes on the remote, so every content-hashed file a
 * build has ever emitted into `assets/` stays there forever. This class tells a live
 * file from an orphaned one by comparing against the CURRENT build's own manifest —
 * never by file age, because the sync skips re-uploading a file already present under
 * the same name and size, so an unchanged file's remote mtime can predate several
 * deploys while still being exactly what the live pages reference.
 */
final class StaleAssets
{
    public function __construct(
        /** Absolute path of the deployed `assets/` directory. */
        private string $assetsDir,
        /** Absolute path of the trimmed manifest `scripts/ssr.mjs` writes at build time. */
        private string $manifestPath,
    ) {
    }

    /**
     * Filenames present on disk but not in the current build's manifest.
     *
     * No manifest (a host not yet redeployed with this feature, or a plain repo
     * checkout) means nothing to safely compare against — report zero rather than
     * guess, since guessing here means deleting files.
     *
     * @return string[]
     */
    public function orphaned(): array
    {
        if (!is_file($this->manifestPath) || !is_dir($this->assetsDir)) {
            return [];
        }

        $current = array_flip((array) (json_decode((string) file_get_contents($this->manifestPath), true) ?: []));
        $onDisk = array_diff(scandir($this->assetsDir) ?: [], ['.', '..']);

        return array_values(array_filter(
            $onDisk,
            fn (string $name): bool => !isset($current[$name]) && is_file($this->assetsDir . '/' . $name),
        ));
    }

    /**
     * Deletes exactly the files `orphaned()` recomputes right now — never a
     * caller-supplied list, so there is no path a request body can use to name what
     * gets deleted.
     *
     * @return array{ok: bool, deletedCount: int, deleted: string[]}
     */
    public function delete(): array
    {
        $deleted = [];
        foreach ($this->orphaned() as $name) {
            if (@unlink($this->assetsDir . '/' . $name)) {
                $deleted[] = $name;
            }
        }

        return ['ok' => true, 'deletedCount' => count($deleted), 'deleted' => $deleted];
    }
}
