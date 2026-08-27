---
name: skill-creator
description: Turn something you just worked out into a reusable skill or a memory file. Use after finishing a task that took real discovery , a site's quirks, a multi-step procedure, a working recipe , so the next run does not rediscover it. Also use when the user says to remember how to do something.
---

# Writing things down

You pay full price to rediscover anything you do not record. This is how you
stop doing that.

## Skill or memory?

The split is simple, and getting it wrong makes both harder to find.

- **A fact** goes in `memory/`. Ids, names, preferences, standing orders, "the
  API path is blocked". Things that are true whether or not you are doing
  anything.
- **A procedure** goes in `.claude/skills/`. An ordered way to accomplish
  something, with the failure modes attached.

If you are writing steps, it is a skill. If you are writing statements, it is
memory.

## Creating a skill

One directory, one `SKILL.md`:

```
.claude/skills/<kebab-name>/SKILL.md
```

Frontmatter needs exactly two fields:

```yaml
---
name: shopify-orders
description: Look up, filter and export orders in Shopify admin. Use when asked about an order, a refund, or sales figures from Shopify.
---
```

The `description` is the whole retrieval mechanism. It is the only thing read
when deciding whether to open your skill, so write it as *when to use this*, not
*what this is about*. Aside injected skills by matching keywords; here the
description does that job, so put the trigger words a task would actually
contain into it.

## What belongs in the body

Write for yourself on a day you have forgotten everything.

- The steps, in order, with the actual tool calls.
- **The failure modes, and how you know you hit one.** This is the highest value
  part and the part most often skipped. "Never call fill then type, it duplicates
  text up to 4x" is worth more than three paragraphs of orientation.
- How to *verify* the thing worked, especially where the obvious check lies. If
  a snapshot misreports something, say so.
- Skip background, motivation, and anything you could re-derive in ten seconds.

## Rules

- **Record only what you actually observed.** A procedure you assume would work
  is worse than no skill, because the next run trusts it. If you did not run it,
  do not write it as if you did.
- **Update in place.** When a skill turns out to be wrong, fix that file. Do not
  add a second skill that contradicts the first and leave the reader to guess.
- **Date corrections** so a future reader can tell which of two claims is newer.
- Keep it short. A skill nobody finishes reading is a skill nobody follows.
