# Deployment

The site is deployed by GitHub Actions over **SFTP** to a hosting provider. No
manual upload, ever — the branch *is* the deploy trigger.

Workflow: [`.github/workflows/main.yml`](../.github/workflows/main.yml)

## 1. Branch model

```
feat/…  fix/…  docs/…  →  main  →  dev   →  dev host
                          trunk  →  prod  →  production host
                        (no deploy)
```

| Branch | Deploys to | When |
| --- | --- | --- |
| `main` | nothing | never — it is not in the trigger list |
| `dev` | the dev host | on every push |
| `prod` | the production host | on every push |
| anything else | nothing | never — the workflow ignores it |

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

| Secret | Contents |
| --- | --- |
| `FTPHOST` | Server hostname, e.g. `ftp.example.com` (no scheme, no port) |
| `FTPUSER` | SSH/SFTP account login |
| `FTPPWD` | SSH/SFTP account password |

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

Only the contents of **`www/`**, into **`/www`** on the server (see
[architecture.md](architecture.md) §3). Everything else in the repository
(`docs/`, `AGENTS.md`, `CLAUDE.md`, `.github/`) stays off the public server.

The action runs `lftp mirror --reverse <local-path> <remote-path>`, so
`local-path: www` uploads the *contents* of `www/`, not the folder itself.
`.git*` is skipped by the action; `README.md` is skipped via
`ftp-mirror-options`, so developer notes such as `www/README.md` are not
published.

It also writes two small marker files at the deploy root: `.deploy-revision`
(the deployed commit SHA — handy for checking what is live) and a transient
`.deploy-running`. Both are expected.

### Sync modes

| Mode | Behaviour | When |
| --- | --- | --- |
| `full` | Uploads everything under `www/`. **Never deletes** on the remote. | **Current setting.** The action's own recommendation for an initial deployment, and the safe choice while the site is empty. |
| `delta` | Diffs the pushed commits and transfers only what changed, **including deletions**. Needs `fetch-depth: 0` on checkout (already set). | Switch to this once `www/` holds the real site — it is much faster and keeps the server free of files deleted from the repo. |

If the remote ever drifts out of sync (a failed run, a manual edit on the
server), set `sync: full` for one run to re-upload everything, then switch back.

Until the hub is built, `www/` contains only an excluded `README.md`, so a
successful run legitimately uploads **no site files** — only `.deploy-revision`.
That is a valid connectivity test, not a failure.

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
| Files land one level too deep | `local-path` names the folder whose *contents* are uploaded. `local-path: www` is correct; `local-path: .` would publish the whole repo. |
| Two deploys race | Shouldn't happen: `concurrency` serialises per branch and never cancels a running sync. |

## 7. Related

- Branch and commit rules: [conventions/commits.md](conventions/commits.md)
- Where the site source lives: [architecture.md](architecture.md)
- Hosting decision record: [roadmap.md](roadmap.md)
