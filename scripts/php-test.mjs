import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, '.runtime');
const LOCAL_PHP = join(RUNTIME, 'php', 'php.exe');
const LOCAL_MARIA = join(RUNTIME, 'mariadb-11.8.0-winx64');
const MARIA_BIN = join(LOCAL_MARIA, 'bin');
const MARIA_DATA = join(RUNTIME, 'mariadb-data');
const MARIA_INI = join(MARIA_DATA, 'my.ini');
const TEST_DSN = 'mysql:host=127.0.0.1;port=3306;dbname=fonygames_test;charset=utf8mb4';

const portablePhp = process.platform === 'win32' && existsSync(LOCAL_PHP);
const php = process.env.FONY_PHP_BINARY || (portablePhp ? LOCAL_PHP : 'php');
const phpArgs = portablePhp
  ? [
      '-d',
      `extension_dir=${join(RUNTIME, 'php', 'ext')}`,
      '-d',
      'extension=pdo_mysql',
      '-d',
      'extension=mbstring',
    ]
  : [];

let database = null;
const env = { ...process.env };

try {
  /*
   * An explicit DSN is authoritative. schema.php deliberately refuses to fall back
   * from one, and this launcher follows the same rule rather than hiding a bad setting
   * behind the portable server.
   */
  if (
    process.platform === 'win32' &&
    !env.FONY_TEST_DSN &&
    existsSync(join(MARIA_BIN, 'mariadbd.exe')) &&
    !(await portOpen(3306))
  ) {
    if (!existsSync(MARIA_INI)) {
      console.error('php-test: portable MariaDB is not initialised — run tools/setup_windows_tests.ps1');
      process.exit(1);
    }

    database = spawn(
      join(MARIA_BIN, 'mariadbd.exe'),
      [`--defaults-file=${MARIA_INI}`, '--bind-address=127.0.0.1', '--console'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );

    let startupError = '';
    database.stderr.setEncoding('utf8');
    database.stderr.on('data', (chunk) => {
      startupError = (startupError + chunk).slice(-8_000);
    });

    for (let attempt = 0; attempt < 60 && !(await portOpen(3306)); attempt++) {
      if (database.exitCode !== null) break;
      await delay(250);
    }

    if (!(await portOpen(3306))) {
      console.error(`php-test: portable MariaDB did not start\n${startupError}`);
      process.exit(1);
    }

    env.FONY_TEST_DSN = TEST_DSN;
    env.FONY_TEST_USER = 'root';
    env.FONY_TEST_PASS = 'dev';
  }

  const result = spawnSync(php, [...phpArgs, join(ROOT, 'api', 'tests', 'run.php')], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`php-test: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} finally {
  if (database) {
    spawnSync(
      join(MARIA_BIN, 'mariadb-admin.exe'),
      ['--skip-ssl', '--host=127.0.0.1', '--port=3306', '--user=root', '--password=dev', 'shutdown'],
      { cwd: ROOT, stdio: 'ignore', windowsHide: true },
    );

    await Promise.race([
      new Promise((done) => database.once('exit', done)),
      delay(5_000).then(() => database.kill()),
    ]);
  }
}

function portOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(250);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
