# Commit convention

**Rule: one modification = one commit.** Short, explicit, prefixed. No
"misc fixes", no 40-file dumps. If docs must change with the code, they can ride
in the same commit or in an adjacent `docs:` commit — never be forgotten.

## Format

```
<type>: <short imperative summary>

[optional body: why, not what]
```

- Type is lowercase, followed by `: `.
- Summary is imperative ("add", not "added"/"adds"), ≤ 72 characters, no
  trailing period.
- Scope may be added when useful: `game(bump-relay): tune bomb timer`.

## Types

| Type | Use it for | Example |
| --- | --- | --- |
| `feat` | New user-facing capability that isn't a whole game | `feat: add room code sharing via QR` |
| `game` | Adding or changing a game's playable content | `game(tilt-arena): add sudden-death mode` |
| `ui` | Visual / layout / interaction work, no logic change | `ui: make hub cards thumb-reachable` |
| `spec` | Writing or amending a specification in `docs/specs` | `spec: add Bump Relay game spec` |
| `docs` | Any other documentation | `docs: define commit convention` |
| `test` | Adding or changing tests | `test: cover bump detection threshold` |
| `fix` | Bug fix | `fix: stop timer drifting on tab resume` |
| `perf` | Speed, payload, battery | `perf: throttle motion listener to 30 Hz` |
| `refactor` | Behaviour-preserving restructuring | `refactor: extract room client` |
| `dev` | Tooling, build, scripts, CI, local setup | `dev: add vite config for www` |
| `chore` | Housekeeping that fits nothing above | `chore: add .gitignore` |

## Rules

1. **Explicit over clever.** A reader must know what changed from the subject
   line alone.
2. **No mixed types.** Refactor and feature in one commit → split it.
3. **Working tree per commit.** Each commit should leave the site loadable.
4. **Breaking changes** get a `BREAKING:` line in the body.
5. **Never** commit secrets, API keys, `.env`, or real GPS traces.
6. **No agent trailers.** A commit message ends at its last line of prose. No
   `Co-Authored-By:` naming a model, no session or chat URL, no "generated with"
   footer — and the same goes for PR bodies.

   Three reasons, in order of weight. A link into a chat transcript is a
   **dangling reference**: nobody but its author can open it, and it rots, so
   whatever it was meant to explain must be in the message itself or it is lost.
   The trailer is also **redundant** — the committer is already
   `Claude <noreply@anthropic.com>`, pinned globally so commits verify on
   GitHub, so a co-author line naming the same model says it twice and adds a
   phantom contributor to the repository. And a **model version is not
   provenance a reader can use**: it dates the message without telling anyone
   what changed or why, which is what the body is for.

   Commits already carrying trailers are left alone — rewriting shared history
   to strip a footer costs more than the footer does.

   **Enforced, not trusted.** `.githooks/commit-msg` strips these lines and
   rejects a subject that breaks the format above. It exists because an
   assistant's own system prompt may instruct it to append exactly the trailers
   this section forbids, and a rule the reader has to go and find loses to an
   instruction that is always in front of them — as happened once here, caught
   only just before the merge. A `Co-Authored-By:` naming a **human** survives;
   only model co-authors are removed.

   The hook is armed by `npm install` (the `prepare` script points
   `core.hooksPath` at `.githooks`, since `.git/hooks` is not cloned), and
   `--no-verify` bypasses it deliberately — a hook should not be able to trap
   someone mid-rebase.

   Agent harnesses commonly instruct otherwise. This rule overrides that
   instruction for this repository.

## Branches

### Long-lived

| Branch | Role | Rules |
| --- | --- | --- |
| `main` | Trunk and default branch. The source of truth. | Never committed to directly — only merged into. Deploys nothing. |
| `dev` | Deploys to the dev host on every push. | Only ever fast-forwarded from `main`. Never developed on. |
| `prod` | Deploys to production on every push. | Only ever fast-forwarded from `main`. Never developed on. |

See [../deployment.md](../deployment.md) for what each deploy does.

### Work branches

`<prefix>/<topic>`, topic in kebab-case:

| Prefix | For |
| --- | --- |
| `feat/` | New games, new capabilities |
| `fix/` | Bug fixes |
| `docs/` | Documentation and specs |
| `chore/` | Tooling, CI, deployment, housekeeping |

For game work the topic **is the game slug**, so everything lines up:

```
branch  feat/bump-relay
spec    docs/specs/games/bump-relay.md
code    www/src/games/bump-relay/
```

Branch prefixes are deliberately coarser than the commit types above. One
`feat/tap-duel` branch will contain `spec:`, `ui:`, `test:` and `game:` commits —
that is expected.

- Push with `git push -u origin <branch>`.
- PRs are opened only on request.
