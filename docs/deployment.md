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

## 3. Secrets

Each environment holds its own credentials — the two hosts are separate, with
separate accounts.

| Secret | Contents | Used by |
| --- | --- | --- |
| `FTPHOST` | Server hostname, e.g. `ftp.example.com` (no scheme, no port) | site |
| `FTPUSER` | SSH/SFTP account login | site |
| `FTPPWD` | SSH/SFTP account password | site |
| `CLOUDFLARE_API_TOKEN` | "Edit Cloudflare Workers" token, scoped to the account | room server |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | room server |

The Cloudflare pair is **optional until set**: the `worker-deploy` job detects
them missing and skips with a warning instead of failing, so the site keeps
deploying either way.

Rules:

- These are **environment** secrets, not repository secrets. A repository-level
  secret of the same name would be picked up by any job, including on branches
  that must not deploy.
- Credentials never appear in the repository, in logs, or in this doc.
- Rotating one: change it in the environment, then re-run the workflow from the
  Actions tab (`Run workflow` on the matching branch).

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
