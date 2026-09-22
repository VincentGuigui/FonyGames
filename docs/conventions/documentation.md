# Documentation and comments

Keep both minimal. The behavioural summary is [AGENTS.md](../../AGENTS.md) §3.4;
this file is the detail and the reasoning.

## Comments

- Explain **why**, not what. If the code needs a narration to be followed,
  rename things until it does not.
- Write as if the current code had always been this way. No "changed from", no
  "used to", no issue-by-issue history, no apologies for a previous approach.
- No decorative banners, no restating a signature above the signature, no
  commented-out code.
- A constant's comment says what would break if it moved, not what it is.

## Markdown

- Do not create `.md` files for summaries, fix reports, migration notes or task
  write-ups. Update the canonical file instead.
- One source of truth per topic. If two files explain the same thing, one of
  them links to the other.
- Keep docs consistent with the code as it is now — a stale doc is worse than a
  missing one.
- README and `docs/` must not repeat each other: README pitches and points,
  `docs/` explains.

## Where history goes

Commits, pull requests, issues. Not source files, not specs. A commit message is
the right place for "this replaced X because Y"; the file it changed is not.

## Before finishing

Re-read every comment and Markdown block you touched and delete anything
redundant, temporary, historical, obvious, or no longer true.
