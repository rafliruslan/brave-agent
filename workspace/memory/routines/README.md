# Routines

Recurring work that runs on a schedule rather than on a mention. One file per
routine: what it does, how to do it, and what has been learned by doing it.

These are where good memory actually comes from. The Slack composer bugs in
`memory/sites/app.slack.com.md` were not discovered by reasoning about Slack;
they were found by a twice-daily affiliate check grinding through the same
composer until it broke in a reproducible way.

## Format

```markdown
# <routine name>

**Schedule:** twice daily, 11:00 and 16:00 WITA
**Reports to:** #operations (C09DE2ZTLP7), thread 1786440953.115899
**Scope:** notify only. Do not approve or deny.

## How to run it

The steps, with the specific selectors, URLs and quirks. Written so a session
that has never done it can follow it exactly.

## What breaks

Failures that have actually happened and how they were recognised.

## Log

- **2026-08-26**: one line. What the outcome was, and anything new.
```

## The log is one line per run

This is the discipline that matters, and the reason to write it down.

The system this came from kept a full paragraph per run, and after fifteen runs
the log was mostly the same sentence repeated: "Pending tab empty, posted no
pending affiliates." The genuinely valuable content, the iframe selector, the
`?status=2` URL, the composer duplication bug, was buried inside prose that
restated itself daily.

So:

- **A normal run gets one line.** Date, outcome, nothing else.
- **A run that discovers something gets that discovery moved out**, into the
  `What breaks` section here or into the relevant `memory/sites/` file. The log
  line then just says a new failure mode was recorded.
- **Prune the log** to the last ~20 runs. Older ones have either taught
  something, in which case it lives elsewhere, or they have not.

A log that grows without bound stops being read, and a routine's memory is
worthless the moment nobody reads it.
