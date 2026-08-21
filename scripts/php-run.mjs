import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_PHP = join(ROOT, '.runtime', 'php', 'php.exe');
const portable = process.platform === 'win32' && existsSync(LOCAL_PHP);
const php = process.env.FONY_PHP_BINARY || (portable ? LOCAL_PHP : 'php');
const script = process.argv[2];

if (!script) {
  console.error('php-run: expected a PHP script path');
  process.exit(1);
}

const config = portable
  ? [
      '-d',
      `extension_dir=${join(ROOT, '.runtime', 'php', 'ext')}`,
      '-d',
      'extension=pdo_mysql',
      '-d',
      'extension=mbstring',
    ]
  : [];

const result = spawnSync(php, [...config, script, ...process.argv.slice(3)], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`php-run: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
