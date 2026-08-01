# Deployment

The site is deployed by GitHub Actions over **FTPS** to a hosting provider. No
manual upload, ever — the branch *is* the deploy trigger.

Workflow: [`.github/workflows/main.yml`](../.github/workflows/main.yml)

## 1. Branch model

```
feature branch  →  dev  →  prod
  (no deploy)      ↓        ↓
              dev host   production host
```

| Branch | Deploys to | When |
| --- | --- | --- |
| `dev` | the dev host | on every push |
| `prod` | the production host | on every push |
| anything else | nothing | never — the workflow ignores it |

Work happens on a feature branch (`claude/<topic>`, `<initials>/<topic>`), which
is merged into `dev` to publish it for testing, then `dev` is merged into `prod`
to release. `prod` is only ever fed from `dev`.

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

| Secret | Contents |
| --- | --- |
| `FTPHOST` | FTP server hostname, e.g. `ftp.example.com` (no scheme, no port) |
| `FTPUSER` | FTP account login |
| `FTPPWD` | FTP account password |

Rules:

- These are **environment** secrets, not repository secrets. A repository-level
  secret of the same name would be picked up by any job, including on branches
  that must not deploy.
- Credentials never appear in the repository, in logs, or in this doc.
- Rotating one: change it in the environment, then re-run the workflow from the
  Actions tab (`Run workflow` on the matching branch).

## 4. Protocol

**FTPS, explicit, port 21.**

> ⚠️ Port 22 is SSH/SFTP — a *different protocol*.
> `SamKirkland/FTP-Deploy-Action` does not speak SFTP at all, so `protocol: ftps`
> with `port: 22` can never connect. If the host ever requires real SFTP, the
> action must be replaced (e.g. `wlixcc/SFTP-Deploy-Action`, or `lftp`/`rsync`
> over SSH) and the password secret becomes an SSH key.

Implicit FTPS (port 990) would be `protocol: ftps-legacy`.

## 5. What gets deployed

Only **`./www/`** — the site source (see
[architecture.md](architecture.md) §3). Everything else in the repository
(`docs/`, `AGENTS.md`, `CLAUDE.md`, `.github/`) stays off the public server.

Also excluded: any `.git*` file and every `README.md`, so developer notes such
as `www/README.md` are not published.

The action performs an **incremental sync**: it keeps a
`.ftp-deploy-sync-state.json` file at the deploy root to know what changed, and
only uploads the difference. That file is expected — leave it in place.

Until the hub is built, `www/` contains only an excluded `README.md`, so a
successful run legitimately uploads **zero files**. That is a valid credential
test, not a failure.

## 6. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| `Error: Input required and not supplied: server` | The job is not attached to an environment, or the secret lives at repository level instead of on the environment. Check `environment:` is present on the job and that `FTPHOST`/`FTPUSER`/`FTPPWD` are set on `dev` **and** `prod`. |
| `Missing secret(s) in environment 'dev': FTPPWD` | The pre-flight check naming exactly what is absent. Add it to that environment. |
| Connect timeout / `ECONNREFUSED` | Wrong port or protocol. FTPS is 21 (explicit) or 990 (`ftps-legacy`); 22 is SFTP and unsupported (§4). |
| `530 Login incorrect` | Bad `FTPUSER`/`FTPPWD`, or the host expects the full email-style login. |
| Certificate errors on connect | Host uses a self-signed cert. Do **not** disable verification blindly — ask the host for the right endpoint first. |
| Deploy uploads too many files | `local-dir` lost its trailing slash, or the `exclude` list was edited. |
| Two deploys race | Shouldn't happen: `concurrency` serialises per branch and never cancels a running sync. |

## 7. Related

- Branch and commit rules: [conventions/commits.md](conventions/commits.md)
- Where the site source lives: [architecture.md](architecture.md)
- Hosting decision record: [roadmap.md](roadmap.md)
