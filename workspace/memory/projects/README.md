# Projects

Ongoing work with a shape: what it is, where it stands, what is blocked, and the
decisions already made so they are not relitigated.

One file per project, named for how the user refers to it rather than its formal
name. He will say "the store" or "the Web3 PoC", not the repository name, and a
file that cannot be found by the words he actually uses is a file that gets
rewritten from scratch.

## Format

```markdown
# <what he calls it>

**Status:** one line, dated.
**Surfaces:** the repos, boards, stores or sites it lives in.

## What it is

Two or three sentences. Enough that a session with no context can act.

## Decisions made

- **<decision>** the reason, and when it was settled, so it is not reopened.

## Open

- What is actually blocked, and on whom.
```

Note the bold lead with plain prose after it, rather than a dash. The em dash is
banned everywhere, including in templates, and a template that violates a
standing rule teaches the wrong habit to everything that copies it.

## What makes this different from `companies/` or `users/`

Those hold facts that are true regardless of what is happening. A project file
holds **state**, which means it goes stale, and a stale project file is worse
than none because it will be trusted.

So every project file carries a dated status line, and anything read from here
that looks more than a week old should be verified before acting on it.

## What does not belong

- A task list. Linear is the task list.
- Meeting notes.
- Anything with no decision in it. If nothing has been decided, there is no
  project memory yet, only activity.
