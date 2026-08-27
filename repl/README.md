# brave-repl

A third MCP server for the same Brave, built to close the round-trip gap with
single-`repl` agents like Aside. It ships one clear win and one measured
disappointment, both documented here because the disappointment is the more
useful finding.

## The win: snapshots that diff

Measured on a live Google Calendar day view:

| | bytes |
|---|---|
| Playwright `ariaSnapshot()` | 6717, and carries no refs, so you cannot act on it |
| `snapshot` full | 5415 (153 refs, 27ms) |
| `snapshot` mode `diff` | **227** |

**24× smaller.** After the first read of a page, every subsequent read can be a
diff: what appeared, what went away. Opening a menu returns four `menuitem`
lines and one changed `[expanded]` state rather than the whole tree again.

This is the property that made Aside's follow-up calls cheap, and nothing else
in the stack had it.

## The disappointment: batching saved nothing

`act` takes a list of typed steps and runs them in one call. On a real task
(open a menu, pick an item, confirm the dialog) it saved **zero** turns against
granular tools. Both runs took 8 turns, $0.167 versus $0.154.

The reason generalises: **browser steps are usually data-dependent.** You cannot
reference the "Out of office" menu item until the menu is open, so no batch can
span that boundary. Batching only pays when steps are genuinely independent:
filling six known form fields, then submitting.

`act` is kept because that case is real, and its tool description now says
plainly when it does not help. It was written before the measurement and
oversold; this is the corrected version.

## Deliberately not a REPL

`op` is a closed enum: `click`, `type`, `press`, `navigate`, `select`, `wait`,
`screenshot`. There is no op for evaluating script.

That is the entire difference from Aside's model. Its one `repl` tool was more
expressive, and Aside's own internals note that its permission mode was "largely
cosmetic" because an ungated escape hatch let the agent route around
restrictions. Arbitrary page scripting is also what left a half-created calendar
event behind here, which then had to be hunted down and deleted.

## Refs are ours alone

Three servers now attach to the same browser and none of their ids interchange:

| Server | id form |
|---|---|
| `mcp__brave__` (Playwright MCP) | `[ref=e12]` |
| `mcp__devtools__` (chrome-devtools-mcp) | `uid=1_21` |
| `mcp__brave-repl__` | `[ref=e12]`, tagged as `data-bref` |

Snapshot with the server you are about to act with. Ours are DOM attributes
written during the snapshot and cleared at the next one, so a ref is valid only
for the snapshot that produced it.

## Two bugs worth knowing about, found building this

**Zero-size ancestors must not stop the walk.** Popups are routinely anchored to
a 0×0 element holding an absolutely-positioned child. Treating zero size as
hidden silently dropped Google Calendar's entire Create menu from the snapshot
while it was plainly visible at 140×32. Only `display:none`,
`visibility:hidden`, `hidden` and `aria-hidden` prune a subtree now.

**Accessible names live in descendants.** Google's buttons are icon-span +
text-span + arrow-span, so own-text-only name computation reported `- button
[ref=e9]` for the Create button. Control roles now descend for their label,
join fragments with spaces so "add" + "Create" does not become "addCreate", and
skip Material icon ligatures, which are glyph names rather than words anyone
sees.

Both are the kind of bug that makes a snapshot quietly incomplete rather than
obviously broken, which is the worst failure mode a read tool has.

## Install

```json
{
  "mcpServers": {
    "brave-repl": { "command": "node", "args": ["/path/to/repl/server.mjs"] }
  }
}
```

`BRAVE_CDP_ENDPOINT` overrides the default `http://127.0.0.1:9222`.
Requires `/brave-setup` to have been run, since it attaches to an existing
browser rather than launching one.
