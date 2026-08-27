---
description: Configure Brave on Linux so Claude Code can drive the user's real logged-in profile over CDP
argument-hint: "[--revert]"
---

Set up (or undo) agentic control of the user's real Brave browser.

If the argument is `--revert`, skip to **Reverting** at the end.

Work through this in order. Report what you find at each step rather than
assuming the defaults hold.

## 1. Establish the facts first

```bash
brave --version 2>/dev/null || brave-browser --version
uname -m
ls -d ~/.config/BraveSoftware/Brave-Browser 2>/dev/null
pgrep -a brave | head -3
```

You need four things: the binary name (`brave` on Arch, `brave-browser` on
Debian/Ubuntu), the architecture, whether a profile already exists, and whether
Brave is currently running.

**If no profile exists**, stop and ask the user to launch Brave and sign in to
the sites they care about first. A profile with no sessions makes this pointless.

## 2. Which profile directory is which

Inside the user data directory, profiles are directories (`Default`,
`Profile 1`…) whose display names live in `Local State`. Never assume `Default`
is the one they mean.

```bash
python3 -c "
import json,os
p=os.path.expanduser('~/.config/BraveSoftware/Brave-Browser/Local State')
d=json.load(open(p))['profile']
for k,v in d.get('info_cache',{}).items(): print(k,'->',v.get('name'))
print('last_used:', d.get('last_used'))
"
```

If there is more than one, **ask which profile the agent should drive.** Getting
this wrong means acting in the wrong identity.

## 3. Move the profile out of the default path

Chromium 136+ refuses `--remote-debugging-port` when the profile sits at the
**default** path. This is the step people miss, and the symptom is a debug port
that silently never opens.

Ask the user to quit Brave completely, confirm with `pgrep`, then:

```bash
mv ~/.config/BraveSoftware/Brave-Browser ~/.local/share/brave-profile
```

Same filesystem, so it is instant. Cookies stay decryptable because the OS
keyring entry is unchanged. Do **not** copy to a different machine or user.

## 4. Add the flags

Check whether the launcher reads a flags file. On Arch, `/usr/bin/brave` is a
shell script that sources `$XDG_CONFIG_HOME/brave-flags.conf` and prepends
whatever it finds:

```bash
head -20 $(command -v brave)
```

**If it does**, append to `~/.config/brave-flags.conf`. This is much better than
a wrapper script or editing `.desktop` files, because every launcher inherits
it: the desktop entry, any web-app entries, and the user's own shell.

```
--user-data-dir=/home/USER/.local/share/brave-profile
--remote-debugging-port=9222
--profile-directory=Default
```

Substitute the real home path (no `~`, it is not expanded) and the profile
directory chosen in step 2.

**If it does not**, create a wrapper, but check PATH order first, because
`~/.local/bin` is often placed *after* `/usr/bin` and then shadows nothing:

```bash
python3 -c "
import os;p=os.environ['PATH'].split(':')
h=os.path.expanduser('~/.local/bin')
print('local/bin', p.index(h) if h in p else 'absent', '| /usr/bin', p.index('/usr/bin'))
"
```

## 5. Verify CDP actually opened

```bash
brave & sleep 5
curl -s http://127.0.0.1:9222/json/version | head -5
```

Expect JSON with `Browser` and `webSocketDebuggerUrl`. Then confirm it is the
*intended profile*, not a fresh one. Navigate to `brave://version` and read the
`Profile Path` line, or check the cookie count:

```bash
python3 -c "
import sqlite3,shutil,os,tempfile
src=os.path.expanduser('~/.local/share/brave-profile/Default/Cookies')
t=tempfile.mktemp(); shutil.copy(src,t)
c=sqlite3.connect(t)
print('cookies:', c.execute('select count(*) from cookies').fetchone()[0])
"
```

A near-zero cookie count means you are looking at the wrong profile.

## 6. Stop the browser stealing focus (Hyprland only)

Every CDP tab-select and navigate makes Chromium ask the compositor to raise its
window, which interrupts the user constantly. Check:

```bash
hyprctl getoption misc:focus_on_activate
```

If `true`, offer to set it false in the user's Hyprland config, and **state the
trade-off**: it is global, so links clicked in other apps will no longer switch
to the browser either. Hyprland has no per-app rule for activation requests.

Optionally also pin the browser to one workspace so agent activity stays off
whatever the user is looking at:

```lua
o.window("^brave-browser$", { workspace = "2 silent" })
```

`silent` is the load-bearing half. Without it, opening Brave drags them there.
Anchor the class: web-app windows are a different class
(`brave-app.slack.com__client-Default`) and should not be moved.

On GNOME or KDE the equivalent is a focus-stealing-prevention setting; say so
rather than pretending the Hyprland step applies.

## 7. Confirm both MCP servers see it

The plugin registers `brave` (Playwright) and `devtools` (chrome-devtools-mcp),
both pointing at `127.0.0.1:9222`. Verify with `claude mcp list`, then list tabs
through `mcp__brave__browser_tabs` and confirm the user's real tabs appear.

Newly registered MCP servers do not expose their tools to an already-running
session. If the tools are missing, the session needs restarting.

## Tell the user what they just enabled

Be direct about it. The debug port is open for every Brave launch from now on.
It binds to `127.0.0.1` only, but **any process running as this user can drive
the browser with all of its logged-in sessions**. That is inherent to the design,
not incidental. It is the same exposure any agentic browser has, and they should
know it is on.

## Reverting

Two changes, both reversible in a minute:

1. Delete the added lines from `~/.config/brave-flags.conf`.
2. `mv ~/.local/share/brave-profile ~/.config/BraveSoftware/Brave-Browser`

Plus, if they were added: the Hyprland `focus_on_activate` and workspace rules.
