# Example memory files

The agent's semantic memory: one fact per file, grouped by kind, read on demand
rather than loaded every turn. `workspace/CLAUDE.md` indexes them, and the agent
extends the tree itself as it learns.

Everything here is invented. Copy the shape, not the contents.

```
workspace/memory/
├── agent/         this machine, the browser, how much to do before asking
├── users/         who you are, how you write, what you expect
├── companies/     workspace ids, channels, people, processes
├── sites/         how a specific site actually behaves
└── concepts/      cross-cutting rules, e.g. how to work in your repos
```

`agent/`, `sites/` and `concepts/` ship populated in `workspace/`, because they
are about the tool rather than about you. `users/` and `companies/` are yours to
write: these two files show what belongs in them.

## What makes a memory file earn its place

**Facts, not procedures.** An id, a preference, a standing order, "the API path
is blocked". If you are writing ordered steps, it is a skill, not a memory.

**Things that were expensive to discover.** Ids you had to hunt for, a
correction after something went to the wrong place, a quirk that wasted a run.
Anything you could re-derive in ten seconds is noise.

**Dated corrections.** When a fact replaces an earlier one, say so and date it.
A file that contradicts itself with no ordering is worse than one that is merely
out of date.

## What must never go in one

**No passwords, TOTP secrets, backup codes, or API tokens.** Point at the
password manager instead. The agent reads arbitrary web pages while holding your
live sessions, so anything written here is one prompt injection away from being
repeated back to a page.

**Think about other people before you write them down.** Colleagues' emails,
DM channel ids and titles are useful to the agent and are also other people's
data. Fine in a file on your own machine; not fine in a repo you push. This
directory exists precisely so the structure can be shared without the contents.

## Letting the agent maintain it

`workspace/.claude/skills/skill-creator/` tells the agent when to write a memory
versus a skill, and to record only what it actually observed. That last rule is
what stops the tree filling with plausible guesses: a procedure it assumed would
work is worse than no note at all, because the next run trusts it.
