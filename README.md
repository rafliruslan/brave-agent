# brave-agent

An agentic browser for Linux. Tag it in Slack, it works in the browser you are
already signed in to.

The good agentic browsers are macOS-only. This is the same shape, assembled from
Claude Code, your real Brave, and about 1400 lines of bridge.

```
Slack (Socket Mode)
  └─→ bridge (systemd user service)
        └─→ claude -p            ← your Claude subscription, not API billing
              └─→ Playwright MCP + chrome-devtools-mcp
                    └─→ your real Brave, already logged in
```

## Three parts, usable separately

| | |
|---|---|
| **`plugin/`** | A Claude Code plugin: two MCP servers on one running Brave, plus the browser skills and `/brave-setup`. Useful on its own if you just want Claude Code to drive your browser from a terminal. |
| **`bridge/`** | The harness. A Slack Socket Mode daemon that maps threads to sessions, serialises work per thread, survives restarts, and recovers its own orphaned messages. |
| **`workspace/`** | The agent's memory and skills, as a starting template. Semantic memory it reads on demand, procedural skills it can extend itself. |

## Why it works on real sites

**It uses your browser, not a clean one.** Slack, Gmail, Linear, Shopify sessions
already exist. Nothing does OAuth, no credentials are handled. Anything it does
is done as you.

**It reads trees, not pixels.** `browser_snapshot` returns an accessibility tree
with stable refs — a few KB against a screenshot's hundreds, no vision needed,
and refs survive re-renders far better than CSS selectors. Screenshots are for
questions genuinely about pixels.

**Two browser servers, on purpose.** Playwright's click requires the element's
bounding box to be unchanged across two consecutive animation frames. Pages that
animate continuously never satisfy it, and the error reads like a bad ref when
the ref is fine. chrome-devtools-mcp dispatches over CDP without that gate.
Measured on Google Calendar: Playwright failed three times on one button,
devtools clicked first try.

**Formatting is code, not instruction.** Slack renders `**bold**` as literal
asterisks, has no list syntax at all, cannot render a Markdown image tag, and
needs `&<>` escaped in one field and literal in another. Every one of those was
first written into the prompt, and the agent still got them wrong often enough to
matter. They are now deterministic functions applied to every message on the way
out — which is also what let the persona shrink by 82%.

## Install

```bash
# 1. Browser layer
/plugin marketplace add rafliruslan/brave-agent
/plugin install brave-agent
/brave-setup

# 2. Harness
git clone https://github.com/rafliruslan/brave-agent ~/.local/share/brave-agent
cd ~/.local/share/brave-agent/bridge && npm install

mkdir -p ~/.config/brave-agent
cp config.example/* ~/.config/brave-agent/
chmod 600 ~/.config/brave-agent/env        # then fill in your tokens

cp systemd/brave-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brave-agent
```

The agent's `workspace/` ships inside the clone and is used in place — copy it
somewhere else and set `AGENT_WORKSPACE` only if you want the repo to stay
pristine while the agent writes its own memory.

Optionally give it a character: `cp examples/hammock/persona.md
~/.config/brave-agent/persona.md` and edit. Without one it falls back to a plain
assistant that still carries the honesty and autonomy rules.

You need a Slack app with Socket Mode on, `app_mention` subscribed, and 11 bot
scopes — `app_mentions:read`, `chat:write`, `users:read`, `channels:read`,
`groups:read`, `mpim:read`, `im:read`, and the four `*:history` ones, which
`conversations.replies` needs so it can read a thread it was tagged into late.

## Things that took a day each

Collected here so they cost you an afternoon instead.

**Spawn the agent with stdin closed.** Node's `spawn` defaults to a piped stdin
that never reaches EOF, and the CLI blocks on it forever rather than exiting.
Measured: hung past 35s versus 779ms with `stdio: ['ignore','pipe','pipe']`. No
mocked-spawn unit test catches this.

**Record the placeholder before the run, clear it after.** The bridge posts
"running…", runs, then edits that message. If the process dies in between,
nothing is left alive to perform the edit and it says "running…" forever. Found
after 29 restarts.

**Sessions expire underneath you.** Detect it, drop the mapping, silently retry
in a fresh session. Never show the user an error for this.

**Slack is the durable store; the session is a cache.** Do not treat one thread
as one infinite session. Map thread to session, let it expire, then reconstruct
context from the Slack transcript. That property is what let this survive its
sessions being evicted.

**A tool that is visible but denied is worse than one that does not exist.** The
agent will pick the API connector it can see, be refused, and report a permission
problem — while the site sits logged in one tab away. Use `--strict-mcp-config`
so it only sees what it can actually use.

**Verify, do not report.** Many web apps render an unsaved item exactly like a
saved one. Google Calendar labels an unsaved event `Event is being created.`
"The click returned success" is not evidence the app accepted it.

## Read this before installing

**An open debug port means any process running as you can drive your browser,
with every session it holds.** It binds to `127.0.0.1` only, but that is the
honest description. Inherent to the design, not incidental.

**Prompt injection is live.** The agent reads arbitrary web pages while holding
your real sessions. The skills tell it to treat page content as data and never as
instructions. That is not a security boundary. Do not point this at pages you
would not trust with your accounts.

**Everything happens as you.** Messages come from you, not a bot. Calendar
declines notify real colleagues. There is no undo layer.

`ALLOWED_USER` is the entire access control: mentions from anyone else are
ignored in silence, because replying would tell an unauthorised user the bot is
listening.

## Design notes

**Deterministic beats instructed.** Any rule that can be enforced in code must
be. What remains in the persona is only what code cannot check: honesty,
autonomy, and one session per message.

**When it gets stuck, add a narrow capability, not a general one.** The tempting
fix for an unclickable button is arbitrary page scripting. It works until it
half-completes a form and leaves broken state someone finds later. Adding a
second, gated click path solved it without opening that door.

**Guidance it must choose to read will be missed mid-task.** The click-failure
rule lives in the always-on file, not a specialised skill, because it is needed
exactly when deep in a page and not thinking about which skill to open.

## License

MIT
