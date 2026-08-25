# Acme Inc — Slack identifiers

> Example file. Every id, name and address below is invented. Replace with your
> own, or delete this and write from scratch.

Ids do not change when the harness does, so a file like this survives migrations
and is worth keeping accurate.

## Workspace

- **Acme Inc**, teamId `T00000000`, slug `acme`
- You: `U00000001` (this should match `ALLOWED_USER` in the bridge config)
- The bot user: `U00000002`, app `A00000003`

## Channels

| Channel | Id | Note |
|---|---|---|
| `#agent-control` | `C00000010` | Where you talk to the bot |
| `#prod-alerts` | `C00000011` | Backend error alerts, bot `B00000012` |
| `#general` | `C00000013` | |
| `#product` | `C00000014` | You are a member |
| `#marketing` | `C00000015` | You are NOT a member |

Record membership. "Post this in #marketing" behaves differently if you are not
in it, and finding that out mid-task wastes a run.

**Record corrections too.** `C00000010` was once mislabelled as `#prod-alerts`
and a message went to the wrong channel. A line saying which id is now trusted,
and when it was confirmed, prevents the same mistake twice.

## People

| Name | Id | Note |
|---|---|---|
| You | `U00000001` | |
| Dana Okafor | `U00000020` | dana@acme.example, DM `D00000021` |
| Sam Reyes | `U00000022` | sam@acme.example, title "Ops", DM `D00000023` |

### Two people with the same first name. Confirm before you send.

The single highest-value entry in a file like this. A name fragment does not
identify someone, and the agent will guess if you let it.

- **Alex Chen** — title "Research", alex@acme.example, `U00000030`,
  DM `D00000031`. Leads the research workshop.
- **Alex Novak** — display "alex", alex.novak@acme.example, `U00000032`,
  DM `D00000033`. A different person entirely, technical contact.

Write down which is which, and instruct the agent to ask rather than guess. A
real workshop reminder once went to the wrong Alex, caught only because the
recipient replied.

## Usergroups

Mention syntax in message text is `<!subteam^ID>`.

| Handle | Id | Name |
|---|---|---|
| eng | `S00000040` | Engineering |
| ops | `S00000041` | Operations |

## If the session logs out

Say **where** the credentials live, never what they are:

> Credentials are in your password manager under the item for this workspace.

Then the recovery procedure, which is the part worth writing down:

Try a plain reload first. A transient failure that looks exactly like a logout
usually is one, and resolves on its own. Only treat it as a real logout if an
actual sign-in screen is on the page.

**Do not put passwords, TOTP secrets or backup codes in a memory file.** The
agent reads arbitrary web pages while holding your sessions; anything in here is
one prompt injection away from being repeated back. Point at the password
manager and let the credential-reading skill fetch it with a stated reason.
