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

Three places hold credentials, and each holds different ones. **Nothing below is ever
committed** — this table lists names and where they live, never values.

Each environment holds its own: the two hosts are separate accounts, and a dev
credential must never open prod.

### 3.1 GitHub — environment secrets

**Settings → Environments → `dev`, then again for `prod`.** Environment secrets, not
repository secrets: a repository-level secret of the same name is visible to any job,
including on branches that must not deploy.

| Secret | Contents | Used by |
| --- | --- | --- |
| `FTPHOST` | Server hostname, e.g. `ftp.example.com` (no scheme, no port) | site |
| `FTPUSER` | SSH/SFTP account login | site |
| `FTPPWD` | SSH/SFTP account password | site |
| `CLOUDFLARE_API_TOKEN` | **Edit Cloudflare Workers** token | room server |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | room server |
| `MAIL_SECRET` | Shared secret the Worker presents to the PHP mailer. **Must be byte-identical to the Wrangler secret of the same name** | site (baked into the PHP config at deploy) |
| `ADMIN_PATH` | Folder name the admin page is deployed under, e.g. `ops-7f3a91` | site (§3.4) |

The Cloudflare pair is **optional until set**: `worker-deploy` detects them missing and
skips with a warning rather than failing, so the site keeps deploying either way.

### 3.2 Cloudflare — Wrangler secrets

Set per environment, so a dev link can never open prod:

```bash
wrangler secret put ADMIN_EMAIL --env dev      # then again with --env prod
```

| Secret | Contents | Generate with |
| --- | --- | --- |
| `ADMIN_EMAIL` | The one address a magic link may be sent to | — |
| `ADMIN_SESSION_KEY` | HMAC key for signing admin sessions | `openssl rand -hex 32` |
| `ADMIN_TOKEN` | Break-glass bearer for `curl` | `openssl rand -hex 32` |
| `MAIL_SECRET` | Shared secret presented to the PHP mailer. **Same value as GitHub's** | `openssl rand -hex 32` |
| `CF_ANALYTICS_TOKEN` | Read-only analytics token (§3.3) | — |
| `CF_ACCOUNT_ID` | Cloudflare account id, for the analytics call | — |

**`MAIL_SECRET` lives in two systems and must match.** That duplication is inherent —
two runtimes share one secret — so it is the one most likely to drift. Rotating it means
changing *both* and redeploying both, in that order, or mail stops.

Rotating `ADMIN_SESSION_KEY` is how you **sign out everywhere**: sessions carry their own
signature and there is no session table to clear.

### 3.2a No terminal? Two other ways to set a Wrangler secret

`wrangler secret put` is the documented route, not the only one.

**The Cloudflare dashboard.** Workers & Pages → the Worker → Settings → *Variables and
Secrets* → Add, type **Secret**. Do it on `fonygames-worker-dev` and again on
`fonygames-worker` — the dashboard has no notion of `--env`, so you pick the Worker by
name instead of by flag, which sidesteps the `--env` trap below. Works from a phone.

A deploy **inherits** existing secrets rather than replacing them, so a later
`wrangler deploy` does not wipe what the dashboard set. Worth confirming once with
`wrangler secret list` after the next deploy rather than taking it on trust — plain-text
`vars` behave differently from secrets, and the two are easy to conflate.

**Or simply wait.** Nothing reads these until the admin endpoints exist. An unset
`ADMIN_EMAIL` matches nobody and an unset `ADMIN_TOKEN` authorises nobody, both by
design, so the deployed Worker is not in a half-configured state in the meantime — it
just has no admin.

### 3.2b Local development — `.dev.vars`, not Cloudflare

`wrangler dev` does **not** read the secrets above: it reads `.dev.vars` in the repo
root. So the whole admin flow can be built and driven locally with no Cloudflare access
at all.

```bash
cp .dev.vars.example .dev.vars   # then fill in
```

`.dev.vars` is gitignored and must stay that way — **this repository is public**, so a
committed copy publishes every value in it. `.dev.vars.example` is committed on purpose
and holds placeholders only; the ignore rules are asserted by `git add --dry-run` on
both files.

Local values only have to be self-consistent. Nothing local talks to the real mailer, so
`MAIL_SECRET` just needs to exist.

### 3.3 Cloudflare — one new API token to mint

**Dashboard → My Profile → API Tokens → Create Token → Custom.**

| Permission | Scope |
| --- | --- |
| Account → **Account Analytics** → **Read** | The FonyGames account |

Nothing else. Its value goes into `CF_ANALYTICS_TOKEN`.

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
- **Not a reason to relax anything else.** Assume the path is known; the Worker still
  checks every write.

### 3.5 Not secrets — committed variables

These live in `wrangler.jsonc` under each environment's `vars`, because they are not
credentials and reading them buys an attacker nothing:

| Var | Contents |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated origins the room server accepts sockets from |
| `MAIL_ENDPOINT` | URL of the PHP mailer on the web host |

### 3.6 What the deploy checks, and what it cannot

The `🔐 Check deployment secrets` step fails the deploy when `FTPHOST`, `FTPUSER` or
`FTPPWD` is missing, and additionally when `MAIL_SECRET` or `ADMIN_PATH` is missing —
but **only once `www/ops-placeholder/` exists in the tree.**

Gating on the directory rather than a hand-flipped flag means the check starts enforcing
itself the moment the admin centre lands and cannot be forgotten, while today's deploys
keep working before the secrets have been set. Until then it prints a notice.

It also rejects an `ADMIN_PATH` containing a slash or a space, or starting with a dot: a
bad value would put the admin page somewhere unintended or break the rename outright, and
CI is the only thing that ever sees the value.

**What it cannot check: whether the two `MAIL_SECRET` copies match.** CI can read the
GitHub one and has no access to the Wrangler one, so presence is the whole of what a
pre-flight can prove. Only a live call proves the pair, which is why the admin centre
carries a **test the mail path** action. Do not read a green pre-flight as "mail works".

### 3.7 Rules

- Credentials never appear in the repository, in logs, or in this doc.
- Rotating one: change it where it lives, then re-run the workflow from the Actions tab
  (`Run workflow` on the matching branch). For a Wrangler secret, redeploy the Worker.
- The PHP mailer needs **no manual step on the host**: its config is written from
  `MAIL_SECRET` at deploy time, so a rebuilt host is reproducible from CI alone. That is
  the same reasoning as "no manual upload, ever" in §1.

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

Consequence: stale files are never removed from the server automatically. If a
file is dropped from the build, delete it on the host by hand, or clear `/www`
and let the next run repopulate it.

The upside is that `full` is self-healing — if the remote drifts, the next push
re-uploads everything.

## 6. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| `Error: Input required and not supplied: server` | The job is not attached to an environment, or the secret lives at repository level instead of on the environment. Check `environment:` is present on the job and that `FTPHOST`/`FTPUSER`/`FTPPWD` are set on `dev` **and** `prod`. |
| `Missing secret(s) in environment 'dev': FTPPWD` | The pre-flight check naming exactly what is absent. Add it to that environment. |
| `Missing secret(s) … MAIL_SECRET ADMIN_PATH` | The admin centre is in the tree now, so both are required (§3.6). Set them on **both** `dev` and `prod`. |
| `ADMIN_PATH must be a single directory name` | It has a slash, a space, or a leading dot. It is one folder name, e.g. `ops-7f3a91`, not a path. |
| Pre-flight green but the magic link never arrives | Presence is all CI can check. The two `MAIL_SECRET` copies are probably out of step — compare the Wrangler one against the GitHub one and redeploy both (§3.2). |
| `500 'AUTH': command unrecognized` | An FTP action is being pointed at port 21, which this host serves without TLS. Use SFTP on 22 (§4). |
| Connect timeout / `ECONNREFUSED` | Wrong port. SFTP is 22 here. |
| `Permission denied (password)` | Bad `FTPUSER`/`FTPPWD`, or the host expects the full email-style login, or SSH access is not enabled on the account. |
| Host key / `known_hosts` errors | The action accepts the host key on first connect. If the host is rebuilt and the key changes, the error is expected — verify the new fingerprint with the host before trusting it. |
| Files land in the wrong folder | `remote-path` is absolute (`/www`). If the SFTP account is chrooted to its home, the web root may be `www` or `~/www` instead. |
| Files land one level too deep | `local-path` names the folder whose *contents* are uploaded. `local-path: dist` is correct; `local-path: .` would publish the whole repo. |
| Deploy uploads nothing | Almost certainly `sync: delta`, which cannot see generated files (§5). Use `full`. |
| Raw `.tsx` files on the server | `local-path` is pointing at `www/` (source) instead of `dist/` (build output). |
| Build fails on a type error | Intended — `npm run build` runs `tsc --noEmit` first, so broken types never ship. |
| Two deploys race | Shouldn't happen: `concurrency` serialises per branch and never cancels a running sync. |

## 7. Related

- Branch and commit rules: [conventions/commits.md](conventions/commits.md)
- Where the site source lives: [architecture.md](architecture.md)
- Hosting decision record: [roadmap.md](roadmap.md)
