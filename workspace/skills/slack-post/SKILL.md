---
name: slack-post
description: Send a Slack message as the user through the browser, or edit or delete one. Use whenever a task involves posting, replying, DMing, broadcasting to a channel, or scheduling in Slack. Covers the composer bugs that silently corrupt or duplicate text.
---

# Posting in Slack as the user

Your own reply to him is posted by the bridge. This is for messages that go out
**as him**, which nothing normalises for you.

Read `memory/sites/app.slack.com.md` for why each step is here, and
`memory/users/<you>.md` for how the text should read.

## Before typing

1. Confirm the target. Channel ids are in `memory/companies/<company>.md`. If the task
   names "Andreas", stop and check which one, there are two.
2. If it posts an external link to a channel, that reaches outside the company.
   Ask first. Everything internal, just do.
3. Draft the text against his structure rules: one-line answer, blank line, at
   most five bullets with bold scan labels. No em dash.

## Typing

1. `browser_snapshot` to find the composer, and act on its `ref`.
2. `browser_click` the composer.
3. `browser_type` the text.

**Never fill and then type into the same box.** Doing both duplicates the text
up to 4x in the real content, not just in the accessibility tree.

For multi-paragraph text, type one chunk, `Shift+Enter`, pause 200-500ms,
re-snapshot, then continue. Typing straight through with back-to-back
`Shift+Enter` drops and doubles characters.

## Verify before sending, every time

`browser_take_screenshot` and look at it.

This step is not optional and not skippable when you are confident. The composer
fails in two silent ways: it can end up **completely empty** with the send button
disabled and no error, and the accessibility tree **over-reports newlines**, so
one blank line reads as `\n\n\n\n\n`. Neither is visible without looking.

If the text is empty or doubled: `Ctrl+A`, Backspace, retype in smaller chunks.

## Sending, and confirming it landed

Press Enter, then verify from the page, not from the absence of an error.

For a threaded reply with "Also send to channel", check **both** that the thread
reply count went up **and** that a standalone "replied to a thread" card appeared
in the channel feed. A clean send does not prove the checkbox took.

A message you sent as him will **not** appear in the bot's message history, and
querying with the bot token returns nothing. That is expected. It is not evidence
you failed.

## Attachments

Never write a Markdown image tag. Slack cannot render it and it leaks a local
path into the channel. Upload the file. If you cannot, say so in the message
rather than dropping it silently.

## Editing, deleting, scheduling

- `chat.delete` on a message he already deleted returns `message_not_found`.
  That is the expected answer, not a retry.
- `chat.scheduleMessage` rejects the browser's `xoxc` token. Schedule through
  the UI. For anything recurring, use Workflow Builder.

## Report back

Quote verbatim what you sent in his name. He needs to see the exact words that
went out under his identity, not a summary of them.
