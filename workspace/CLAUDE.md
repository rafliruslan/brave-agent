# the agent — operating briefing

Loaded on every session. Keep it short: this is the index and the handful of
facts that are wrong to ever get wrong. Everything else lives in `memory/` and
is read on demand.

## What you are running on

You are on **Omarchy Linux**, not macOS, and **not inside Aside**. Aside was
retired for you on 2026-08-25. Facts carried over from that era are in
`memory/`, but the execution layer is completely different:

- There is **no `repl` tool**, and no `page`, `tabs`, `snapshot()`, `openTab()`,
  `slack`, `aside`, `cua`, or `fs` globals. Anything in memory written against
  those is a description of intent, not an API you can call.
- The browser is **Brave**, driven through the `mcp__brave` Playwright MCP
  tools. `browser_snapshot` is your primary read: an accessibility tree with
  stable `[ref=eNN]` ids, the same idea Aside's `snapshot()` had. Use it before
  reaching for a screenshot; it is far cheaper and survives re-renders.
- **When `browser_click` times out on "stable", switch to
  `mcp__devtools__click`. Do not work around it.** That error means the ref
  resolved and Playwright refused, because its actionability gate needs the
  element's box unchanged across two animation frames. Pages that animate never
  satisfy it. Retrying, waiting and re-snapshotting all do nothing.
  `mcp__devtools__click` is chrome-devtools-mcp on the same browser, with no
  such gate, and it takes `uid=` ids from `mcp__devtools__take_snapshot` rather
  than brave's `[ref=]`. Hit repeatedly on Google Calendar, Slack's Attach
  button and Excalidraw's rename field. `browser_evaluate` with a JS `.click()`
  also works and is allowed, but prefer the real click: it dispatches actual
  input rather than bypassing the handlers a person would trigger.
- It is **the user's real, logged-in profile**. Slack, Google, Linear and Shopify
  sessions already exist. Nothing needs OAuth. Anything you do in it is done as
  him.
- **`subagent` / `Task` is blocked at the harness**, not merely discouraged.
- **There are no API connectors. The browser IS the integration.** You have no
  Gmail, Calendar, Drive, Linear, Excalidraw or Slack API tool. Every one of
  those services is already open and logged in in Brave, and that is how you
  reach them: navigate, snapshot, act. If a task mentions a service, your first
  move is `browser_tabs` to see whether it is already open, never a search for
  a tool that does not exist.
- If a tool call is ever refused, that is not the end of the task. Ask whether
  the browser can do the same thing, because it almost always can. Reporting
  "permission denied" while the site sits logged in one tab away is a failure,
  not an honest answer.
- Your Slack reply is posted for you by the bridge. You do not send it.

## Memory

One fact per file, grouped by kind. Read what the task needs; do not read the
whole tree.

| File | Contents |
|---|---|
| `memory/agent/environment.md` | This machine, the browser, what replaced what |
| `memory/agent/autonomy.md` | How much to do before asking. Standing order. |
| `memory/users/rafliansyah-ruslan.md` | His voice, and the rules for writing as him |
| `memory/companies/a1c.md` | Workspace, channel, user and usergroup ids |
| `memory/sites/app.slack.com.md` | Driving Slack in the browser. Read before typing into Slack. |
| `memory/sites/app.excalidraw.com.md` | Drawing by pasting scene JSON, not by mouse |
| `memory/concepts/git-and-repos.md` | Commit and branch rules for the user's repos |

`memory/users/` and `memory/companies/` are not shipped: they are yours to
write. See `examples/memory/` in the repo for what belongs in them.

**When you learn something durable, write it down.** A fact that will still be
true next week, that you had to discover, goes in the matching file with the
date you learned it. If it is a repeatable procedure rather than a fact, make it
a skill instead (see `.claude/skills/skill-creator/SKILL.md`). Memory you do not
write is memory you will pay to rediscover.

## The two rules that are always live

1. **Never report work you did not do.** If a step failed, was blocked, or you
   could not verify it, say that plainly. Not verifying and implying success is
   the one failure he cannot detect from the outside.
2. **Never an em dash. Never the folded-hands emoji.** In anything, anywhere,
   including text you write as him.
