# Deployment

Two things deploy from the same workflow, on the same trigger, independently:

| What | Where | Job |
| --- | --- | --- |
| The site (`dist/`) | the web host, over **SFTP** | `web-deploy` |
| The room server (`worker/`) | **Cloudflare**, via Wrangler | `worker-deploy` |

They are separate jobs on purpose: a Worker problem must not stop the hub from
shipping, and vice versa. No manual upload, ever — the branch *is* the trigger.

Workflow: [`.github/workflows/main.yml`](../.github/workflows/main.yml)

## 1. Branch model

```
feat/…  fix/…  docs/…  →  main  →  dev   →  dev host
                          trunk  →  prod  →  production host
                        (no deploy)
```

| Branch | Site | Room server | When |
| --- | --- | --- | --- |
| `main` | nothing | nothing | never — not in the trigger list |
| `dev` | https://fonygames-dev.guigui.fr | `fonygames-worker-dev` | on every push |
| `prod` | https://fonygames.guigui.fr | `fonygames-worker` | on every push |
| anything else | nothing | nothing | never — the workflow ignores it |

Work happens on a `feat/`, `fix/`, `docs/` or `chore/` branch (see
[conventions/commits.md](conventions/commits.md)) and is merged into **`main`**,
which deploys nothing — so trunk is an integration point, not a release.
Publishing is a separate, deliberate act: fast-forward `dev` from `main` to put
it on the dev host, and `prod` from `main` to release. Neither `dev` nor `prod`
is ever developed on directly.

The workflow can also be run manually (`workflow_dispatch`) — useful after
rotating a credential — but a job guard makes it a no-op unless it is run from
`dev` or `prod`.

### 1.1 Reporting branch state at the end of a task

An agent finishing a change states where `main`/`dev`/`prod` actually stand,
as a plain three-line list, one branch per line — 🟢 for "up to date with
what was just done" (pushed, or merged and pushed), 🔴 for "not yet" (nothing
beyond a commit id or a status word):

```
🟢 main
🔴 dev
🔴 prod
```

## 2. GitHub Environments

Two environments exist in **Settings → Environments**, named **exactly** like
the branches:

| Environment | Fed by branch |
| --- | --- |
| `dev` | `dev` |
| `prod` | `prod` |

That naming is deliberate: the job resolves its environment with

```yaml
environment: ${{ github.ref_name }}
```

so branch → environment needs no mapping table and no workflow edit. **Adding a
third target** = create the branch, create an identically-named environment, add
the branch to the `on.push.branches` list and to the job's `if:` guard.

### Protection rules

Requiring a reviewer on the `prod` environment is recommended: the deploy job
then waits for an approval before touching production, while `dev` keeps
deploying instantly.

## 3. Secrets and variables

**Every credential lives in a GitHub environment secret.** There is exactly one place
to look, and **the room server has no secrets at all** — it reads a public
`flags.json` and nothing else ([specs/backoffice.md](specs/backoffice.md) §2b). That
is deliberate and recent: the admin centre used to run inside the Worker and needed
six Wrangler secrets, one of which had to be kept byte-identical to a GitHub copy with
no way to check it. Moving the admin to PHP deleted all six.

**Nothing below is ever committed** — this table lists names and where they live, never
values.

Each environment holds its own: the two hosts are separate accounts, and a dev
credential must never open prod.

### 3.1 GitHub — environment secrets

**Settings → Environments → `dev`, then again for `prod`.** Environment secrets, not
repository secrets: a repository-level secret of the same name is visible to any job,
including on branches that must not deploy.

**Three Cloudflare secrets, one prefix, one account id.**

| Secret | Scope | Used by |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | — | both, and set **once** |
| `CLOUDFLARE_API_TOKEN` | **Edit Cloudflare Workers** | `wrangler`, to deploy the room server |
| `CLOUDFLARE_ANALYTICS_TOKEN` | **Account Analytics: Read** | the admin centre's usage panel, via `config.php` |

The two tokens stay separate on purpose — the deploy token is not widened to cover a
read-only query (§3.3). The account id is **one secret**, because it is one value.

It used to be two, under two conventions: `CLOUDFLARE_ACCOUNT_ID` for the deploy and
`CF_ACCOUNT_ID` for the analytics call, holding the same string. The worker job also
aliased its secrets into shell variables called `CF_API_TOKEN` / `CF_ACCOUNT_ID`, so
`CF_ACCOUNT_ID` meant two different things twenty lines apart and reading the workflow
could not tell you which secret to set. Renamed with **no fallback**: the old names are
not read anywhere, so anything still set under `CF_*` is dead and can be deleted.

| Secret | Contents | Used by |
| --- | --- | --- |
| `FTPHOST` | Server hostname, e.g. `ftp.example.com` (no scheme, no port) | site |
| `FTPUSER` | SSH/SFTP account login | site |
| `FTPPWD` | SSH/SFTP account password | site |
| `CLOUDFLARE_API_TOKEN` | **Edit Cloudflare Workers** token | room server — **required on `prod`**, see below |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | room server **and** the usage panel — one secret, both jobs |
| `ADMIN_PATH` | Folder name the admin page is deployed under, e.g. `ops-7f3a91` | site (§3.4) |
| `ADMIN_EMAIL` | The one address a magic link may be sent to | site (admin config) |
| `ADMIN_TOKEN` | Break-glass bearer, **and what the deploy uses to apply migrations** (§3.7). `openssl rand -hex 32` | site (admin config) |
| `CLOUDFLARE_ANALYTICS_TOKEN` | **Account Analytics: Read** token for the usage panel (§3.3) | site (admin config) |
| `DB_DSN` | PDO DSN, e.g. `mysql:host=localhost;dbname=fonygames;charset=utf8mb4` | site (admin config) |
| `DB_USER` | MySQL account for that database | site (admin config) |
| `DB_PASS` | Its password | site (admin config) |
| `MAIL_FROM` | Envelope sender for the magic link. Optional — defaults to `noreply@guigui.fr` | site (admin config) |
| `PLAYS_TOKEN` | Shared with the Worker so only it may count a finished round. **Optional**, see below | site (admin config) |

The Cloudflare pair is **optional until set**: `worker-deploy` detects them missing and
skips with a warning rather than failing, so the site keeps deploying either way.

`PLAYS_TOKEN` is optional in a different sense: without it the play counter still works,
it is simply unauthenticated ([specs/backoffice.md](specs/backoffice.md) §7). Setting it
takes **two** steps, because two systems have to agree on the value — the repository
secret, which the deploy writes into `api/config.php`, and the Worker's own secret:

```sh
wrangler secret put PLAYS_TOKEN --env dev     # then paste the same value
wrangler secret put PLAYS_TOKEN --env prod
```

Set one side only and counting stops: the endpoint requires the header the Worker is not
sending. Both or neither.

The admin values are written by the deploy into `config.php` one level above `/www`
on the host, so a rebuilt host is reproducible from CI alone and there is no manual
step on the server.

**Where that file sits, honestly.** One level above `/www` — outside the web root
entirely, not inside it. The SFTP account's own root is that parent directory, with
`www` as one folder inside it, so the deploy has always been able to write there; the
file lived inside `api/` for a while regardless, protected only by an `.htaccess` deny
and a `chmod 600`, which is weaker than it needs to be: **`.htaccess` depends on
Apache actually reading it**, and a misconfigured handler that serves `.php` as text
would publish the file. Living outside the web root removes that dependency —
there is no web root there for a misconfigured handler to serve *from*.

`hosts.json` and `db/` (the migration files) moved the same way, for the same reason,
in the same upload — see `dist-private/` in [`stage-api.mjs`](../scripts/stage-api.mjs)
and the **📂 Sync private files** step. `App.php` looks for all three there first, and
falls back to the older inside-`www` locations for a host not yet redeployed with this
change — see `App::boot()`, `App::hosts()`, `App::migrator()`.

**One-time cleanup on each host, by hand.** The main sync is `full` and never deletes
(§5), so the *old* `api/config.php`, `api/hosts.json` and `db/` left by the last deploy
before this change stay on the host indefinitely otherwise — delete them once, on
`dev` and on `prod`, the same way a stale `index.html` gets deleted
([specs/seo.md](specs/seo.md) §4).

There is no `ADMIN_SESSION_KEY` and no `MAIL_SECRET`: PHP's own sessions replace the
first, and `mail()` runs in the same process that mints the link, so there is nothing to
authenticate ([specs/backoffice.md](specs/backoffice.md) §4, §5).

### 3.2 The room server needs no secrets

`worker-deploy` uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to *publish*,
and the deployed Worker itself reads nothing secret. Its only configuration is
`ALLOWED_ORIGINS` and `FLAGS_URL`, both committed `vars` (§3.5).

So there is no `wrangler secret put` step, and no `.dev.vars` file: `wrangler dev` needs
nothing that is not already in `wrangler.jsonc`. That is worth stating because it used
not to be true — six Wrangler secrets existed for the admin centre before it moved to
PHP, and one of them (`MAIL_SECRET`) had to match a GitHub copy exactly with no
automated way to verify it ([specs/backoffice.md](specs/backoffice.md) §5).

### 3.3 Cloudflare — one new API token to mint

**Dashboard → My Profile → API Tokens → Create Token → Custom.**

| Permission | Scope |
| --- | --- |
| Account → **Account Analytics** → **Read** | The FonyGames account |

Nothing else. Its value goes into `CLOUDFLARE_ANALYTICS_TOKEN`.

**Do not widen the deploy token instead.** `CLOUDFLARE_API_TOKEN` is *Edit Cloudflare
Workers* and deliberately cannot read analytics; a token that can both deploy and read
everything is a bigger blast radius for no gain
([specs/backoffice.md](specs/backoffice.md) §2).

### 3.4 Why the admin path is a secret at all

**This repository is public.** So a hidden path committed as `www/ops/` is not hidden:
the folder name is readable by anyone, and the layer is gone before it does anything.

The build therefore emits the admin page to a placeholder directory and the deploy
**renames it to `ADMIN_PATH`** on the way to the host. The real path exists only in the
GitHub environment secret and on the host.

Two things this is not:

- **Not the security.** The magic link is ([specs/backoffice.md](specs/backoffice.md)
  §4). This only stops casual discovery and crawlers, which is worth one `mv`.
- **Not a reason to relax anything else.** Assume the path is known; the session check
  still runs on every write.
- **Not listed in `robots.txt`.** A `Disallow:` line naming it would publish it to
  anyone who reads the file ([specs/seo.md](specs/seo.md) §3).

### 3.5 Not secrets — committed variables

These live in `wrangler.jsonc` under each environment's `vars`, because they are not
credentials and reading them buys an attacker nothing:

| Var | Contents |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated origins the room server accepts sockets from |
| `FLAGS_URL` | URL of `flags.json` on the web host, which the Worker reads to enforce a flag |
| `DISABLE_FLAG_GATE` | `'1'` to bypass the flag gate entirely. Set only on `env.dev` (and the local block) |

`FLAGS_URL` is per environment, so the dev Worker reads the dev host's flags. It is a
plain URL to a public file — reading it buys an attacker nothing, and the Worker
fails open if it is wrong ([specs/backoffice.md](specs/backoffice.md) §2b).

`DISABLE_FLAG_GATE` is absent (enforced) on `prod` and must stay that way — it exists
so dev, which already shows every game as clickable, also lets you actually play one
that is `soon`/`hidden` ([specs/backoffice.md](specs/backoffice.md) §2b).

### 3.6 What the deploy checks, and what it cannot

The `🔐 Check deployment secrets` step fails the deploy when `FTPHOST`, `FTPUSER` or
`FTPPWD` is missing, and additionally when `ADMIN_PATH`, `ADMIN_EMAIL` or `ADMIN_TOKEN`
is missing — but **only once `www/ops-placeholder/` exists in the tree.**

Gating on the directory rather than a hand-flipped flag means the check starts enforcing
itself the moment the admin centre lands and cannot be forgotten, while today's deploys
keep working before the secrets have been set. Until then it prints a notice.

It also rejects an `ADMIN_PATH` containing a slash or a space, or starting with a dot: a
bad value would put the admin page somewhere unintended or break the rename outright, and
CI is the only thing that ever sees the value.

**What it cannot check: whether `mail()` actually delivers.** Presence of an address is
not deliverability, and shared-host mail can be accepted and then dropped by the
recipient's spam filter. Do not read a green pre-flight as "the magic link works" — send
one and look. `ADMIN_TOKEN` exists precisely so a silent mailbox cannot lock the operator
out ([specs/backoffice.md](specs/backoffice.md) §5).

There used to be a second unprovable thing here — whether the GitHub and Wrangler copies
of `MAIL_SECRET` matched. That secret no longer exists, so neither does the gap.

### 3.6b Migrations run at the end of the deploy, by asking the host

The runner **cannot reach the database** — MariaDB is bound to localhost on the web host
and 3306 is not exposed ([database.md](database.md) §3). So the deploy cannot apply DDL
itself. After the sync it `POST`s to `api/index.php?a=migrate` with `ADMIN_TOKEN`, and the
host does it.

After the sync, not before: the new migration file has to be on the host before we ask
for it.

- **No `ADMIN_TOKEN` ⇒ skipped with a notice**, so this cannot break a deploy on a host
  with no admin configured.
- **A failed migration fails the deploy**, quoting the file and statement. The site is
  already live by then, so a silent failure would leave it running against a schema that
  does not match it.
- **A failed `flags.json` publish is a warning, not an error.** The schema is correct and
  flags default to active, but the Worker is reading a stale or absent file — so it must
  not pass in silence.

`prod` gets the same treatment. A required reviewer on the `prod` environment (§2) is what
gates automatic production DDL, and is now worth having for that reason as well.

### 3.6c The host must run PHP 8.1, and the deploy now checks

The API needs **PHP 8.1 or newer**, on two lines:

- `api/index.php` — `function reply(int $status, mixed $body = null): never`
- `api/lib/App.php` — `private function __construct(public readonly array $config)`

`never` and `readonly` are both 8.1 syntax. On an older interpreter these files are a
**parse error**, and that is the failure mode worth understanding: PHP never runs a line of
them, so no handler inside them can report anything, and with `display_errors` off — the
shared-hosting default — the request answers **500 with an empty body**. Every endpoint,
identically, with nothing in any log the deploy can read.

That is not a hypothetical. It is indistinguishable from the *other* empty-500 (an uncaught
exception, §3.6d), which is why the first deploy of the migration endpoint could not be
diagnosed from CI at all.

**`api/preflight.php`** answers it. Token-gated, and deliberately written in pre-7 syntax —
no type declarations, no arrow functions, no `??`, no `str_contains` — because **it has to
parse on the interpreter that cannot parse the rest**. That property is the entire point of
the file: modernising it, however much a linter wants to, destroys it. Its header says so.

It reports the PHP version, the required extensions (`pdo`, `pdo_mysql`, `json`,
`session`), and **a count of `db/migrations/*.sql` present on the host**. That last number
closes a gap CI otherwise cannot see: SFTP hands back no manifest, so "the sync uploaded
`db/`" and "the sync silently skipped it" look identical from the runner.

The `🐘 Host PHP check` step runs it after the sync and before the migration, and fails
with the real version — *"the host runs PHP 8.0.30, the API needs 8.1"* beats *"answered
500"*. Skipped with a notice when `ADMIN_TOKEN` is unset, like the migrate step.

**And it immediately earned its place, by failing on something else entirely.** The host's
PHP was fine; the token was refused. `Authorization` is **not reliably visible to PHP**:
Apache consumes it for its own auth and, behind a CGI/FastCGI/FPM handler, does not forward
it without `CGIPassAuth` — so the header can be absent in `$_SERVER` while the client
plainly sent it, which looks exactly like a wrong token.

So the token is accepted from three places, in order — `Authorization: Bearer`, its
mod_rewrite alias `REDIRECT_HTTP_AUTHORIZATION`, and **`X-Admin-Token`**, an ordinary
custom header every SAPI forwards. `Auth::presentedToken()` decides; the deploy and the
admin page both send the standard header *and* the fallback.

**Not fixed with `.htaccess`, deliberately.** `RewriteEngine On` in a directory where
`AllowOverride` forbids `FileInfo` is a **500 for that whole directory** — the API would go
down to fix a header. A custom header needs no server cooperation and, over HTTPS, is
exactly as private as the one Apache eats.

The 401 body reports `configReadable`, `tokenChars`, `presentedChars` and `presentedVia` —
booleans and lengths, never a value. That is what tells the three causes apart:
`tokenChars: 0` means `config.php` never arrived, `presentedChars: 0` means this host
forwards neither header, and two non-zero numbers mean the tokens really differ. The first
version of this step answered a bare `{"error":"no"}` and the workflow named one cause out
of three, which was a guess CI could not check.

### 3.6d An empty 500 is a bug in us, not just a symptom

`api/index.php` registers a `set_exception_handler` and a `register_shutdown_function`
**above** its `require`, so an uncaught throwable — or a parse error in one of the `lib/`
files — answers JSON instead of nothing. The detail is included **only for a caller already
authorised**, because a PDO connect failure quotes the database user and host.

Ordering matters and is load-bearing: the token half of authorisation is settled *before*
`App::auth()` opens the connection, via the database-free `App::tokenMatches()`. Otherwise
an unreachable database throws before anyone has been authorised, and the crash report has
to withhold its detail from the deploy, which is the one caller entitled to it.

### 3.7 Rules

- Credentials never appear in the repository, in logs, or in this doc.
- Rotating one: change it in the GitHub environment, then re-run the workflow from the
  Actions tab (`Run workflow` on the matching branch). One place, one re-run — there is
  no second copy anywhere to keep in step.
- The admin needs **no manual step on the host**: its config is written from the GitHub
  secrets at deploy time, so a rebuilt host is reproducible from CI alone. Same reasoning
  as "no manual upload, ever" in §1.

## 4. Protocol

**SFTP over SSH, port 22, username + password.**

The host's port 21 does answer FTP, but it rejects `AUTH TLS`
(`500 'AUTH': command unrecognized`), so **explicit FTPS is not available** and
plain FTP would put the password on the wire in clear text. SFTP is therefore
the only encrypted option, which is why the deploy uses
[`milanmk/actions-file-deployer`](https://github.com/milanmk/actions-file-deployer)
(lftp over SSH) rather than an FTP-only action.

> Note for anyone swapping the action: `SamKirkland/FTP-Deploy-Action` cannot
> speak SFTP at all, and `SamKirkland/web-deploy` does SFTP but **requires an
> SSH private key** — it has no password input. Password auth over SFTP narrows
> the field considerably.

Moving to SSH-key auth later is a strict improvement: add the public key to the
host, store the private key as an environment secret, and pass it as
`ssh-private-key` instead of `remote-password`.

## 5. What gets deployed

**The build output, not the source.** `www/` holds TypeScript and TSX that no
browser can run; `npm run build` (Vite) compiles it to `dist/`, and the contents
of **`dist/`** are uploaded into **`/www`** on the server.

```
www/  (source: .tsx, .css)  ──npm run build──>  dist/  ──sftp──>  host:/www
```

Everything else in the repository (`docs/`, `AGENTS.md`, `CLAUDE.md`,
`.github/`, `node_modules/`) never reaches the server — it isn't in `dist/`.

The build runs **before** the upload and `npm run build` typechecks first
(`tsc --noEmit && vite build`), so a type error fails the deploy rather than
shipping a broken site.

The action runs `lftp mirror --reverse <local-path> <remote-path>`, so
`local-path: dist` uploads the *contents* of `dist/`, not the folder itself.

It also writes two small marker files at the deploy root: `.deploy-revision`
(the deployed commit SHA — handy for checking what is live) and a transient
`.deploy-running`. Both are expected.

### Sync modes

| Mode | Behaviour | When |
| --- | --- | --- |
| `full` | Uploads everything under `dist/`. **Never deletes** on the remote. | **Current setting, and the only viable one — see below.** |
| `delta` | Diffs the pushed git commits and transfers only what changed, including deletions. | **Cannot be used here.** |

> ⚠️ **`delta` is incompatible with a build step.** It works out what to transfer
> by running `git diff` over `local-path`. `dist/` is generated and gitignored,
> so git reports no changes and delta would upload **nothing**, silently. It
> would only work if we committed build output, which we won't.

Consequence: stale files are never removed from the server automatically.

For the one place this actually accumulates — `assets/`, where every
content-hashed file a build has ever emitted still sits — the admin centre's
Diagnostics → **Stale files** page now shows how many are safe to delete and
does it on request, compared against the current build's own manifest rather
than by file age (`specs/backoffice.md` §8 has the full design and why age
doesn't work). That page is scoped to `assets/` only: a whole leftover route
directory from a renamed or removed game (an old `dist/tap-tap-revolution/`
after a rename, say) is still not auto-detected — delete it on the host by
hand, or clear `/www` and let the next run repopulate it, same as before.

The upside is that `full` is self-healing — if the remote drifts, the next push
re-uploads everything.

## 6. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| `Error: Input required and not supplied: server` | The job is not attached to an environment, or the secret lives at repository level instead of on the environment. Check `environment:` is present on the job and that `FTPHOST`/`FTPUSER`/`FTPPWD` are set on `dev` **and** `prod`. |
| `Missing secret(s) in environment 'dev': FTPPWD` | The pre-flight check naming exactly what is absent. Add it to that environment. |
| `Missing secret(s) … ADMIN_PATH ADMIN_EMAIL` | The admin centre is in the tree now, so these are required (§3.6). Set them on **both** `dev` and `prod`. |
| `ADMIN_PATH must be a single directory name` | It has a slash, a space, or a leading dot. It is one folder name, e.g. `ops-7f3a91`, not a path. |
| `dist/<path> already exists; ADMIN_PATH collides with a real route` | The value is the name of a game folder or another route. Pick something that is not a slug — the whole point is that it is unguessable. |
| The admin page is 404 after a deploy | `ADMIN_PATH` was unset, so the deploy **removed** the placeholder rather than publishing it under a guessable name. Set the admin secrets and re-run. |
| The admin page loads but every call answers 503 | `config.php` has no `db_dsn` or no `admin_email`. An unconfigured host has no admin by design; check the six admin secrets are on **this** environment. |
| Pre-flight green but the magic link never arrives | Presence is all CI can check, and shared-host `mail()` can be accepted then dropped. Check the host's mail log and the recipient's spam folder; use `ADMIN_TOKEN` in the meantime (§3.6). |
| The hub greys or hides the wrong games | The Worker fails open, so this is a `flags.json` problem rather than an outage. Check `FLAGS_URL` for the environment and that the file is readable over HTTPS (§3.5). |
| Flag changes never show on the hub | Almost always one of two things, both in [specs/seo.md](specs/seo.md) §4: an `index.html` left by an earlier deploy is still being served instead of `index.php` — the sync deletes nothing, so **delete it on the host once by hand** — or the page is being cached. `curl -I` should show `Cache-Control: no-cache`. |
| `500 'AUTH': command unrecognized` | An FTP action is being pointed at port 21, which this host serves without TLS. Use SFTP on 22 (§4). |
| Connect timeout / `ECONNREFUSED` | Wrong port. SFTP is 22 here. |
| `Permission denied (password)` | Bad `FTPUSER`/`FTPPWD`, or the host expects the full email-style login, or SSH access is not enabled on the account. |
| Host key / `known_hosts` errors | The action accepts the host key on first connect. If the host is rebuilt and the key changes, the error is expected — verify the new fingerprint with the host before trusting it. |
| Files land in the wrong folder | `remote-path` is absolute (`/www`). If the SFTP account is chrooted to its home, the web root may be `www` or `~/www` instead. |
| Files land one level too deep | `local-path` names the folder whose *contents* are uploaded. `local-path: dist` is correct; `local-path: .` would publish the whole repo. |
| Deploy uploads nothing | Almost certainly `sync: delta`, which cannot see generated files (§5). Use `full`. |
| **Every game says "Connection lost — reconnecting…", but the site itself is fine** | The room server is not there. The site and the Worker deploy in two independent jobs, so the hub can be perfectly current while no Worker has ever been published. Check the run's **☁️ Deploy room server** job: if its `☁️ Publish` step says *skipped*, `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are missing from that GitHub **Environment**. This is now a failed deploy on `prod` rather than a warning — it was a warning once, and prod ran without a room server because nobody reads a green run's warnings. |
| `does not export class 'MyDurableObject' … [code: 10064]` | The prod Worker was created in the **dashboard**, whose Durable Object template class is `MyDurableObject`; our code exports `Room`, and Cloudflare will not replace a script while live objects depend on a class that has vanished. The site still deploys, so prod looks healthy while no game can open a room. **Runbook in §6a.** |
| `https://…workers.dev/health answered 000` | The Worker published but is not reachable at the hostname the site is compiled to use. Most likely its **workers.dev route is disabled** in the Cloudflare dashboard (Worker → Settings → Domains & Routes) — publishing does not enable it. Confirm the name matches `www/src/core/room/config.ts`. |
| `No room server mapped for <host>` | The site's hostname is not in `www/src/core/room/config.ts`, so the browser would fall back to `ws://127.0.0.1:8787` and no game could connect. Add the mapping. |
| Raw `.tsx` files on the server | `local-path` is pointing at `www/` (source) instead of `dist/` (build output). |
| Build fails on a type error | Intended — `npm run build` runs `tsc --noEmit` first, so broken types never ship. |
| Two deploys race | Shouldn't happen: `concurrency` serialises per branch and never cancels a running sync. |

### 6a. The prod room server will not deploy (error 10064)

The Worker on prod was created in the Cloudflare dashboard rather than by
`wrangler`, and a dashboard Worker with Durable Objects comes from a template whose
class is `MyDurableObject`. Our code exports `Room`. Cloudflare refuses to replace a
script while objects depend on a class the new version does not contain, so every
`deploy --env prod` fails — and because the site deploys in a separate job, prod stays
current while no game can open a room.

**Delete the Worker and let CI recreate it.** It has never served a game, so there is
no room state to lose, and a fresh Worker gets `v1 new_sqlite_classes: ["Room"]`
applied cleanly with its workers.dev route on by default. The name is unchanged, so
`www/src/core/room/config.ts` needs no edit.

```sh
# Needs a CLOUDFLARE_API_TOKEN with Edit Cloudflare Workers, and the account id.
npm run worker:delete:prod:dry   # confirm it targets fonygames-worker
npm run worker:delete:prod
```

Then re-run the failed **☁️ Deploy room server** job, or push to `prod` again. The
`🩺 Room server answers` step confirms it is actually reachable afterwards; if that
step fails, the workers.dev route is off (see the row above).

The dashboard route is the same thing by hand: Workers & Pages → `fonygames-worker` →
Settings → Delete, accepting the Durable Object namespace deletion it warns about.

**The alternative, and why it is second.** You can keep the Worker and add a
migration that drops the stale class, scoped to the `prod` block in
`wrangler.jsonc`:

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["Room"] },
  { "tag": "v2", "deleted_classes": ["MyDurableObject"] }
]
```

Two traps make this the worse first move. Env-level `migrations` **replace** the
inherited list rather than merging, so the whole chain has to be restated — miss `v1`
and `Room` is never declared as a SQLite class, which is irreversible on the free
plan (§ the note in `wrangler.jsonc`). And migrations are applied by *tag*: if the
dashboard already claimed `v1` for its own template, wrangler skips ours and deletes
the old class without ever creating `Room`. Check what has actually been applied
first:

```sh
npx wrangler deployments list --env prod
```

## 7. Related

- Branch and commit rules: [conventions/commits.md](conventions/commits.md)
- Where the site source lives: [architecture.md](architecture.md)
- Hosting decision record: [roadmap.md](roadmap.md)
