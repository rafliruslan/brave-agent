# brave-agent

An agentic browser for Linux. Tag it in Slack, it works in the browser you are
already signed in to.

A Linux alternative to [Aside](https://aside.com) and a browser-first
counterpart to [Hermes Agent](https://github.com/NousResearch/hermes-agent),
assembled from Claude Code, your real Brave, and about 1400 lines of bridge.

Aside is macOS-only. Hermes runs anywhere but has no first-class browser, and
its Claude path needs a Max plan with purchased extra credits. This fills the
gap in between: Linux, your real logged-in browser, billed to a Claude
subscription rather than per token.

It is smaller and less capable than either. [How it compares](#how-it-compares),
honestly, below.

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
| **`repl/`** | A third MCP server of our own: accessibility snapshots that return a **diff** rather than the whole tree. See `repl/README.md`. |

## It learns while you use it

`bridge/dream.mjs` runs nightly and consolidates two things into the memory tree:
recent conversations with tool calls stripped, and a digest of how you actually
used the browser when nobody asked you anything.

The browsing half matters more than it sounds. Sites you return to daily are the
tools you live in; a site that never appears in a conversation is a project the
agent does not know exists. On the first real run it connected three unrelated
domains and wrote *"something token-adjacent is being scoped"* about work it had
never been told about.

`bridge/observe.mjs` produces that digest and is deliberately **aggregate**:
domains, counts, busiest hours, recurring page titles. Never a URL log. Whatever
it writes ends up in a file an agent reads while also reading arbitrary web
pages, so a browsing history sitting in that context is an exfiltration target.
Domain counts are not. A log is also not a pattern: "177 visits to Slack,
concentrated 09:00-11:00" is worth keeping, 847 timestamped URLs is not.

Lines where you corrected or contradicted the agent are flagged `[PUSHBACK]`,
because a correction is you stating a preference at the one moment you cared
enough to interrupt. It is told to turn those into rules.

Two things this taught us, both now in the code:

- **It must not read its own transcripts.** Dream runs in the same workspace, so
  its output lands where the next run looks. Left alone it consolidates its own
  reflections, and its own "do NOT write" instructions match the correction
  regex and get flagged as you pushing back.
- **It fixes its own bugs.** One run noticed that six sessions had each burned a
  turn on the same permission denial, traced it to a wrong path in its own
  `skill-creator` skill, corrected it, and recorded the exact error text so a
  future session recognises it.

Costs real money: $1.60 for the first twelve sessions, $0.90 for the next batch
once most of it was already recorded. Disable with
`systemctl --user disable --now brave-agent-dream.timer`.

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

## How it compares

Written by someone who ported from Aside and read Hermes' docs, not by a
benchmark. Take the "worse" rows seriously.

| | **brave-agent** | **Aside** | **Hermes Agent** |
|---|---|---|---|
| Platform | Linux | **macOS only** | anywhere |
| Licence | MIT | commercial | open source |
| Browser | first-class, real profile | **first-class, real profile** | not a focus |
| Billing on Claude | **subscription** (`claude -p`) | subscription | Max + purchased extra credits, or per-token API |
| Channels | Slack | Slack, Telegram, Discord | **Slack, Telegram, Discord, WhatsApp, Signal, CLI** |
| Memory | markdown files, grep | local-first, structured | **FTS5 + LLM summarisation** |
| Skills | markdown, self-extending | **markdown, keyword auto-inject** | markdown, self-improving |
| Execution backends | local | local | **6, incl. Docker, SSH, Modal** |
| Users | one, for one day | many | many |

### Where Aside is better

It tops the browser-agent benchmarks — Online-Mind2Web, BU-Bench-V1 and
Odysseys — and this has been used by one person for one day. It shields
credentials from the model at the vault layer, where this only instructs the
agent not to print them. Its single `repl` tool is more expressive than granular
MCP calls: one 120-second call can snapshot, decide, act and verify where this
takes a dozen round-trips.

### Where Aside is worse

It does not run on Linux, which is the entire reason this exists. And its own
internals note that its permission mode was "largely cosmetic", because an
ungated `bash` tool let the agent shell around the file restrictions. Granular
gated tools are less expressive but mean a dangerous capability can actually be
removed: `browser_run_code_unsafe` was denied here after it left a half-created
calendar event behind, and nothing else broke.

### Where Hermes is better

Six messaging channels through one gateway against this one. Six execution
backends against local-only. And real memory *retrieval* — full-text search with
LLM summarisation — where this greps a directory of markdown. That works at ten
files and will not at two hundred.

### Where Hermes is worse

Its `claude-code` OAuth provider requires a Max plan **with purchased extra
credits**; the base allowance is never consumed and Pro cannot use it at all.
The fallback is an API key at per-token pricing. `claude -p` bills a normal
subscription. If that constraint is what brought you here, Hermes does not
satisfy it.

It also has no equivalent browser layer. Driving sites you are already logged in
to is the whole premise here, not an integration.

### What this is honestly good for

Being small enough to read end to end and change, with the reasoning for each
non-obvious decision written next to it. If you want a product, use Aside on a
Mac. If you want breadth, use Hermes. If you want your real Linux browser driven
from Slack on a subscription you already pay for, this is the shape of it.

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
