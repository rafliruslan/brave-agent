---
name: visual-fallback
description: Decide between the accessibility snapshot and a screenshot, and handle UI that refs cannot target. Use when a snapshot is missing an element, when a click lands on the wrong thing, when canvas or video content is involved, or when the question is about how something looks rather than what it says.
---

# Snapshot first, pixels only when the task is about pixels

`browser_snapshot` is the default read and should stay that way. It returns an
accessibility tree with stable `[ref=eNN]` ids, it is a few KB against a
screenshot's hundreds, it needs no vision, and refs survive re-renders far
better than CSS selectors on modern SPA markup.

Most work should never render an image at all.

## Take a screenshot when

- **The question is visual.** Spacing, alignment, colour, whether a design reads
  well, whether something is cut off. A tree cannot answer any of these.
- **You are about to send something irreversible.** The Slack composer in
  particular lies: it can be silently empty, and it over-reports newlines so one
  blank line reads as `\n\n\n\n\n`. Screenshot before pressing Enter.
- **The snapshot and the behaviour disagree.** A click that lands on the wrong
  element, or a ref that vanished, means the tree is not describing the page you
  are on.
- **The content is not in the DOM**: canvas, video, an embedded PDF, an image
  whose meaning is the point.

## A click that fails is not the same as an element you cannot find

Read the error before escalating. They need opposite fixes.

### "not stable" means use the other browser server

```
TimeoutError: ... waiting for element to be visible, enabled and stable
```

The ref **resolved**. Playwright found your element and refused to click it,
because its actionability gate requires the bounding box to be unchanged across
two consecutive animation frames. Pages that animate continuously never satisfy
that. Retrying does not help. Waiting does not help. Re-snapshotting does not
help, because nothing is wrong with the ref.

You have a second server attached to the same Brave:

```
mcp__devtools__take_snapshot     -> uids, e.g. uid=1_21 button "Create"
mcp__devtools__click  uid=1_21   -> "Successfully clicked on the element"
```

chrome-devtools-mcp dispatches over CDP without that gate. Measured 2026-08-25
on Google Calendar: Playwright failed three times on one button, devtools
clicked first try. Expect the same on any heavily animated app, and on `<canvas>`
apps like Excalidraw, Figma and Miro.

The two servers use **different identifiers**: brave gives `[ref=e123]`,
devtools gives `uid=1_21`. They are not interchangeable. Snapshot with whichever
server you are about to act with.

Read with brave, click with devtools, whenever a click has already refused once.

### The element genuinely is not there

Then escalate in this order, stopping as soon as one works:

1. **Re-snapshot.** The commonest cause is a stale tree after a re-render. Refs
   are only valid for the snapshot that produced them.
2. **Scroll it into view**, then re-snapshot. Virtualised lists genuinely do not
   contain off-screen rows.
3. **Wait and re-snapshot.** A spinner or a lazy panel may not have mounted.
4. **Reach it by keyboard.** Focus a nearby ref, then Tab or arrow to it. This
   works on custom widgets that expose nothing useful to the tree.
5. **Screenshot and click by coordinate.** Last resort, and brittle: it breaks
   on any layout shift, zoom change, or different window size. Verify with
   another screenshot immediately after.

## Canvas apps: Excalidraw, Figma, Miro

The drawing surface is a single `<canvas>` element. There is no tree inside it,
so a snapshot tells you nothing about what is drawn, and there are no refs for
shapes. Everything inside the canvas is pixels.

What this means in practice:

- **Toolbars and panels are still real DOM** and still have refs. Pick tools
  and set properties through the accessibility tree as normal.
- **Only the canvas itself needs screenshots.** Take one before and after each
  drawing action; that pair is your only evidence anything happened.
- **Use `mcp__devtools__click` for the canvas.** These apps animate constantly,
  so Playwright's stability gate is exactly the failure above.
- **Never report that something was drawn without looking at it.** There is no
  tree to confirm from, so an unverified claim here is pure invention.

## After a coordinate click, always verify

A coordinate click reports success whether or not it hit the intended target.
It has no idea what it landed on. Take a screenshot or a snapshot and confirm
the expected state change before doing anything else.

## Do not

- Do not use a screenshot to read text that the snapshot already contains. It is
  slower, costs more, and transcription errors get introduced that the tree
  would never have made.
- Do not describe an image to yourself and act on the description. Act on the
  page.
- Do not report that something "looks right" from a snapshot alone. If the claim
  is visual, the evidence has to be visual.
