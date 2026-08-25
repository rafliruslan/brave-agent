# Drawing in Excalidraw Plus from the browser

Learned 2026-08-25, building a Slack -> bridge -> Claude Code -> Brave flowchart.

## Do not draw with the mouse. Paste a scene.

Excalidraw accepts a paste of its own clipboard JSON and rebuilds the elements,
ids remapped, bindings intact. Building the JSON in `browser_evaluate` and
dispatching a synthetic paste is one call and gives exact coordinates.

```js
const payload = JSON.stringify({ type: "excalidraw/clipboard", elements, files: {} })
const dt = new DataTransfer()
dt.setData("text/plain", payload)
document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }))
```

**The paste is dropped unless the app already has focus.** Excalidraw's handler
bails when `document.activeElement` is outside `.excalidraw-container`. First
`browser_click` on `canvas.excalidraw__canvas.interactive` (the `.static` canvas
is covered and will time out), then dispatch. Silent no-op otherwise: no error,
undo stays greyed out.

## Element shape that worked

Every element needs the full set of `angle, strokeColor, backgroundColor,
fillStyle, strokeWidth, strokeStyle, roughness, opacity, groupIds, frameId,
roundness, seed, version, versionNonce, isDeleted, boundElements, updated, link,
locked`. Beyond that:

- Rounded box: `type: "rectangle"`, `roundness: {type: 3}`.
- Label inside a box: a separate `type: "text"` with `containerId: <boxId>`, and
  the box carries `boundElements: [{id: <textId>, type: "text"}]`.
- Text needs `fontSize, fontFamily: 1, textAlign, verticalAlign, originalText,
  lineHeight: 1.25`.
- Arrow: `points: [[0,0],[dx,dy]]`, `endArrowhead: "arrow"`, plus
  `startBinding`/`endBinding` `{elementId, focus: 0, gap: 8}` so it reflows.

## New scene, and renaming

The `+` next to "Private" in the sidebar makes a blank scene and navigates to it.
Do that rather than pasting into whatever scene is already open, which is
usually the last thing he was shown.

The scene title is a React-controlled `input[title="Click to rename scene"]`.
Set it with the native value setter plus an `input` event; `browser_click` on it
times out on the stability check.

## Screenshotting the result

`Shift+1` is zoom-to-fit but only when the canvas has focus, otherwise it opens
the menu. Collapse the scene sidebar (first button left of the hamburger), then
`browser_take_screenshot` and crop with `magick <in> -crop WxH+X+Y +repage <out>`.
There is no PIL on this machine; ImageMagick is at `/usr/bin/magick`.
