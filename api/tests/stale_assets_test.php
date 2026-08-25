<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/StaleAssets.php';

/**
 * Which deployed `assets/` files are safe to delete.
 * Spec: docs/specs/backoffice.md §8
 *
 * No database and no App needed: `StaleAssets` only ever touches two directories, so
 * these tests point it at scratch ones instead of a fixture host.
 */

group('orphaned() finds exactly what the manifest does not list');

$assetsDir = tempDir('stale-assets');
$privateDir = tempDir('stale-private');
$manifestPath = $privateDir . '/assets-manifest.json';

file_put_contents($assetsDir . '/keep-a.js', 'a');
file_put_contents($assetsDir . '/keep-b.css', 'b');
file_put_contents($assetsDir . '/orphan-c.svg', 'c');
file_put_contents($manifestPath, json_encode(['keep-a.js', 'keep-b.css']));

$sa = new StaleAssets($assetsDir, $manifestPath);
$orphaned = $sa->orphaned();
check('finds only the unreferenced file', $orphaned === ['orphan-c.svg'], $orphaned);

group('delete() removes exactly the orphaned files, nothing else');

$result = $sa->delete();
check('reports one deleted', $result['deletedCount'] === 1, $result);
check('names it', $result['deleted'] === ['orphan-c.svg'], $result);
check('the referenced files survive', is_file($assetsDir . '/keep-a.js') && is_file($assetsDir . '/keep-b.css'));
check('the orphan is actually gone', !is_file($assetsDir . '/orphan-c.svg'));

group('no manifest means nothing is reported stale, never guessed');

$freshDir = tempDir('stale-fresh');
file_put_contents($freshDir . '/anything.js', 'x');
$noManifest = new StaleAssets($freshDir, $privateDir . '/does-not-exist.json');
check('orphaned() is empty rather than "everything"', $noManifest->orphaned() === []);
$deleted = $noManifest->delete();
check('delete() deletes nothing', $deleted['deletedCount'] === 0);
check('the file is untouched', is_file($freshDir . '/anything.js'));

group('the API dispatch wiring');

$index = (string) file_get_contents(dirname(__DIR__) . '/index.php');
check('the read action exists', str_contains($index, "case 'stale-assets':"));
check('the write action exists', str_contains($index, "case 'delete-stale-assets':"));
check(
    'the write action is POST + X-Admin gated',
    (bool) preg_match("/\\\$writes = \\[[^\\]]*'delete-stale-assets'[^\\]]*\\]/", $index),
);

preg_match("/case 'delete-stale-assets':.*?\\/\\/ no break/s", $index, $deleteCase);
check(
    'the handler never reads a client-supplied file list',
    isset($deleteCase[0]) && !str_contains($deleteCase[0], 'body('),
    $deleteCase[0] ?? null,
);
