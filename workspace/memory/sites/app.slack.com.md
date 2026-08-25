# Driving Slack in the browser

Read this before typing into any Slack composer. Every entry below was found by
a real send going wrong, not by reasoning about the DOM.

These are properties of **Slack's contenteditable**, not of the old harness, so
they survived the move from Aside. Only the calling syntax changed: what used to
be `page.keyboard.type()` is now `browser_type`, and `.locator.type()` has no
direct MCP equivalent, so the fallback is typing in smaller chunks with a pause.

## The composer is unreliable in three specific ways

**1. Never fill and then type into the same box.** Doing both duplicated text up
to 4x in the real contenteditable content, confirmed by screenshot, so it was a
genuine send-time bug rather than a snapshot artifact. Found 2026-08-13. Click
the box, then type. Nothing else.

**2. Typing can silently produce an empty composer.** The send button stays
disabled and no error appears. Seen twice, 2026-08-19. If it happens, clear with
`Ctrl+A` then Backspace, and retype in smaller chunks with a short pause between
them.

**3. Interleaving typing with back-to-back `Shift+Enter` corrupts text.** A
dropped character and a stray trailing character were observed. Put a 200-500ms
pause between each chunk and each `Shift+Enter`, and re-snapshot after each
chunk before continuing.

## Always screenshot before pressing Enter

None of the three methods is reliable on its own, and the accessibility tree
lies about the composer in a specific way: Slack over-reports newlines, so one
intended blank line can show as `\n\n\n\n\n` in the snapshot text node. Do not
use a raw `\n` count as a formatting check. Take a screenshot and look at the
actual paragraph spacing before sending.

This is the one place where the cheap read is not good enough.

## Threaded replies with "Also send to channel"

After posting, confirm the broadcast actually worked by checking **both** that
the reply count incremented inside the thread **and** that a standalone "replied
to a thread" card appeared in the channel's main feed. A successful send does not
prove the checkbox took effect.

## Attaching a file

There is no `filesUploadV2` tool on this machine, so uploads go through the UI.
Found 2026-08-25.

`browser_click` on Slack's Attach button times out on Playwright's "stable"
check. What works: `document.querySelector('[data-qa="threads_flexpane"]
input.p-hidden_file_input').click()` from `browser_evaluate`, which opens a real
file chooser that `browser_file_upload` then fills. Send with a JS `.click()` on
`[data-qa="texty_send_button"]` inside the same flexpane. A file with no message
text sends fine.

Scope the selectors to the flexpane. There are two `p-hidden_file_input`s on the
page, one for the channel composer and one for the thread.

## Canvas

The API path is blocked, so canvases are created through the web UI. The
toolbar "Share" button opens a combobox to add a person or channel. "Send as a
direct message" is checked by default when a single person is added; that plus a
composer message sends the canvas as a DM without posting to any channel.

## Editing or deleting

`chat.delete` on a message the user already deleted himself returns
`message_not_found`. That is the expected answer, not an error worth retrying.

## Scheduling

`chat.scheduleMessage` rejects the browser's `xoxc` token. Schedule through the
UI instead. For anything recurring, Slack's Workflow Builder is the right tool.

## Two identities post into a thread

Your Slack reply is posted by the bridge under the bot token, so it appears as
`agent APP`. Anything you post yourself goes through the user's logged-in session
and appears **as him**, with no bot label.

Consequence when verifying: a message you sent as him will not appear in the
bot's own message history, and querying with the bot token returns nothing. That
absence is not evidence you failed. Check the page, or your own transcript.

Do not say the same thing twice in one thread. Your reply already lands there.
If teammates in the thread need a message in his voice, post that one as him,
then keep your reply to a single line saying you posted it.
