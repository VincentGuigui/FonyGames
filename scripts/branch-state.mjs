#!/usr/bin/env node
/**
 * Where `main`, `dev` and `prod` stand — the three-line report AGENTS.md §5
 * and docs/deployment.md §1.1 ask for at the end of a task.
 *
 * 🟢 means the branch already has the commit checked out here; 🔴 means it does
 * not yet. It exists because the answer was being written from memory, and
 * memory got it wrong: a deploy branch someone else moved reads as whatever it
 * was last seen as. This asks the remote instead.
 *
 * Fetches first (quietly, briefly) so the remote-tracking refs are not stale.
 * If the network is unavailable it says so per branch rather than reporting a
 * confident 🔴 off a stale ref — a wrong 🟢/🔴 is worse than an honest "?".
 */
import { execFileSync } from 'node:child_process';

const BRANCHES = ['main', 'dev', 'prod'];

function git(args, { quiet = false } = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let fetched = true;
try {
  // --no-tags keeps it to the three refs that matter; 20s is plenty and the
  // report is worth more late than never.
  execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', ...BRANCHES], {
    stdio: 'ignore',
    timeout: 20_000,
  });
} catch {
  fetched = false;
}

const head = git(['rev-parse', 'HEAD']);

/** Does `origin/<branch>` contain HEAD? */
function has(branch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, `refs/remotes/origin/${branch}`], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    // Exit 1 is a real "no". Anything else (a missing ref, say) is unknown,
    // and unknown must not be reported as a confident answer.
    return error?.status === 1 ? false : null;
  }
}

const lines = BRANCHES.map((branch) => {
  const state = has(branch);
  const mark = state === null ? '❔' : state ? '🟢' : '🔴';
  return `${mark} ${branch}`;
});

let report = lines.join('\n');
if (!fetched) {
  report += '\n\n(could not reach origin — the marks above are from the last fetch)';
}

// `--json` is what the Stop hook in .claude/settings.json calls: a hook only
// reaches the user through a `systemMessage` field.
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ systemMessage: report }));
} else {
  console.log(report);
}
