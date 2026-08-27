# Episodic memory

One file per day, `YYYY-MM-DD.md`. What happened, in order, with a pointer back
to where it came from.

This is the layer the rest of `memory/` is distilled *from*. A fact in
`memory/users/` says what is true; the episodic entry says when it was learned
and from what, so a claim can be checked rather than taken on trust.

## Format

```markdown
# 2026-08-26

## Short title for the episode

What happened, in plain prose. What was tried, what failed, what the user said,
what changed as a result. Reference: session 3c1c849a.
```

Session ids come from the transcript filenames under
`~/.claude/projects/<encoded-workspace>/`. Cite the first eight characters; that
is enough to find it and short enough to write.

## What belongs here

- Corrections the user made, and what prompted them.
- Something that failed, and what it turned out to be. The failure is usually
  more reusable than the fix.
- A decision and its reasoning, especially one that overrode a default.
- The first time a project, tool or person is mentioned.

## What does not

- Routine successes. "Posted the message" is not an episode.
- Anything already distilled into a semantic file, unless the episode records
  *why* it changed.
- Secrets, in any form.

## Keep it bounded

The system this pattern came from reached 1.6MB of episodic memory across 48
files, which is more than anything can read. It became a write-only archive.

So: **one file per day, and a day's file should stay under about 8KB.** If a day
is busier than that, the overflow is a sign the material belongs in a semantic
file or a skill, not that the episode needs more prose. Entries older than 90
days can be deleted once their durable content has been distilled; the semantic
tree is what survives, not this.
