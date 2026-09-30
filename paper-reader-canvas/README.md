# Paper Reader

A local PDF reader with selectable text and AI-assisted translation. Highlight a word, sentence, or paragraph to make it available to the current session. Click **翻译选中内容** to request a Chinese translation, or ask the agent about the selection. Reading and selecting text does not itself send a translation request.

## Current integration

The available integration is a [GitHub Copilot App canvas](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions). Install this GitHub folder URL in the app at **User** scope:

```text
https://github.com/MingChaoXu/paper-reader-canvas/tree/main/paper-reader-canvas
```

Or place the `paper-reader-canvas` folder in `~/.copilot/extensions/` (or `$COPILOT_HOME/extensions/`) and reload extensions. PDF.js is bundled; installing or running the extension does **not** require `npm install` or a network connection.

## Use

Ask the agent to open the **Paper Reader** canvas with a PDF path, for example:

```text
Open Paper Reader with doc/paper.pdf
```

You can also paste an absolute or project-relative `.pdf` path into the canvas, or use **选择本机 PDF** for a file outside the project. File-picker PDFs stay in the browser's memory and must be selected again after a reload.

Scroll the mouse wheel over the PDF to zoom in or out around the pointer. Hold **Shift** while scrolling to move through pages instead; the **− / +** buttons zoom around the center of the reading area.

Drag with the **right mouse button** to pan the page horizontally or vertically. Panning ends when the pointer leaves the reading area or the window loses focus, so it does not capture clicks elsewhere in the app. Left-button text selection still works. The native context menu is disabled inside the PDF reading area so it does not interrupt right-button dragging.

Select text in the rendered page. The extension stores the selected text, page number, and nearby context in the running canvas; its `get_selection` action lets the agent read it when you ask, e.g. “翻译我刚划选的单词”. For immediate translation, click **翻译选中内容**. Selecting text alone never starts a model request. To avoid accidental huge prompts, selections over 12,000 characters are rejected.

For PDFs whose embedded fonts differ from the browser's fallback fonts, selectable words are positioned using the PDF's own line and glyph widths so the highlighted text matches the page image, including beside superscript citations where PDF.js separates a leading space into another text item. If a page's selection cannot be calibrated, the reader reports the error and clears the invalid selection rather than syncing incorrect text.

The canvas also exposes `open_document` to switch the PDF without closing the panel. The current PDF path can be absolute or relative to the session's project directory.

## Other agents

The PDF renderer, local server, and selection handling can be reused by other agents. The current canvas registration and `session.send()` message delivery depend on the Copilot SDK. A Codex integration would need a separate adapter (for example, a local MCP server exposing `open_document` and `get_selection`, plus a browser UI for selection). **Codex support is not implemented; this extension cannot be installed directly in Codex.**

## Privacy and limitations

- The PDF and viewer assets are served on a random-token URL bound only to `127.0.0.1`. No PDF bytes are sent to GitHub or an external PDF service by the extension. Clicking translate or asking the agent about the selection passes the **selected text and nearby context** to the active AI session, subject to your provider's service settings.
- The GitHub repository contains only extension source and PDF.js assets; do not commit papers or personal data.
- Scanned/image-only PDFs have no selectable text; OCR is not included.
- The current selection is transient and clears when a different PDF is opened or the extension restarts. A PDF chosen through the file picker needs to be chosen again after a reload.
- Temporary connection loss after waking from sleep is retried automatically without reopening the canvas. If the extension process has stopped and its loopback address no longer works, reopen the canvas to get a new address.
- Canvas APIs are experimental; a future Copilot app release may require updates.
- The text layer reads PDF.js's text stream through `getReader()` because the macOS app's WebKit does not implement the stream's async iterator used by `getTextContent()`.

## Development

Node.js 22.13+ is needed only to refresh the vendored PDF.js assets and run tests (the pinned PDF.js version requires it):

```sh
npm ci
npm run vendor
npm test
```

`scripts/vendor.mjs` copies the pinned PDF.js build, text-layer stylesheet, fonts, CMaps, WASM, and license into `vendor/`. The app's GitHub folder installer limits individual files to 1 MB and the folder to 5 MB. The script splits the worker and compresses the CMaps into a local pack; the reader server serves both in PDF.js's expected formats. Changes to the extension must be followed by **Reload extensions** in the Copilot app; close and reopen an existing Paper Reader panel to load the new scripts. The extension's SDK dependency is supplied by Copilot at runtime.

## License

Extension code: MIT (see [LICENSE](LICENSE)). Vendored [Mozilla PDF.js](https://github.com/mozilla/pdf.js): Apache-2.0 with separately licensed components (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the included `vendor/**/LICENSE*` files).
