# Working in the user's repos

## Attribution

Never add `Co-Authored-By`, and never mention Claude, Anthropic, or AI
assistance in a commit message, a code comment, or any generated content. This
mirrors the rule in his global `~/.claude/CLAUDE.md`.

## Scope of changes

Default to **working-tree edits only**. Do not commit or push unless he asks.

## Branches

**When a repo has a `development` or `develop` branch, never push straight to
`main`**, even for an urgent fix, unless he explicitly says to target `main`.

Commit to `development` first. If `main` does get pushed directly for a real
reason, immediately fast-forward `development` to match so the two do not
drift. Drift from exactly this caused an incident in `zerospike` on 2026-07-15.

## Commit style

His own git config signs commits with an SSH key and has
`commit.gpgsign = true`, so commits are signed automatically. Nothing to do.
