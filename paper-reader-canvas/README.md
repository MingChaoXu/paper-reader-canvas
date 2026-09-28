# Paper Reader

A personal [GitHub Copilot app canvas](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions) for reading English PDFs and translating selected text into Chinese. The PDF is rendered in a side panel with a selectable text layer. Highlight a word, sentence, or paragraph to make the selection available to the current session; click **翻译选中内容** to send a translation request, or ask the agent to translate the selection.

## Install

In the Copilot app, install this GitHub folder URL at **User** scope:

```text
https://github.com/MingChaoXu/paper-reader-canvas/tree/main/paper-reader-canvas
```

Or place the `paper-reader-canvas` folder in `~/.copilot/extensions/` (or `$COPILOT_HOME/extensions/`) and reload extensions. PDF.js is bundled; installing or running the extension does **not** require `npm install` or a network connection.

## Use

Ask Copilot to open the **Paper Reader** canvas with a PDF path, for example:

```text
Open Paper Reader with doc/paper.pdf
```

You can also paste an absolute or project-relative `.pdf` path into the canvas, or use **选择本机 PDF** for a file outside the project. File-picker PDFs stay in the browser's memory and must be selected again after a reload.

Select text in the rendered page. The extension stores the selected text, page number, and nearby context in the running canvas; its `get_selection` action lets the agent read it when you ask, e.g. “翻译我刚划选的单词”. For immediate translation, click **翻译选中内容**. Selecting text alone never starts a model request. To avoid accidental huge prompts, selections over 12,000 characters are rejected.

The canvas also exposes `open_document` to let Copilot switch the PDF without closing the panel. The current PDF path can be absolute or relative to the session's project directory.

## Privacy and limitations

- The PDF and viewer assets are served on a random-token URL bound only to `127.0.0.1`. No PDF bytes are sent to GitHub or an external PDF service by the extension. Translation sends the **selected text and nearby context** to the active Copilot session, which processes it according to your Copilot service settings.
- The GitHub repository contains only extension source and PDF.js assets; do not commit papers or personal data.
- Scanned/image-only PDFs have no selectable text; OCR is not included.
- The current selection is transient and clears when a different PDF is opened or the extension restarts. A PDF chosen through the file picker needs to be chosen again after a reload.
- Canvas APIs are experimental; a future Copilot app release may require updates.

## Development

Node.js 22.13+ is needed only to refresh the vendored PDF.js assets and run tests (the pinned PDF.js version requires it):

```sh
npm ci
npm run vendor
npm test
```

`scripts/vendor.mjs` copies the pinned PDF.js build, text-layer stylesheet, fonts, CMaps, WASM, and license into `vendor/`. The app's GitHub folder installer limits individual files to 1 MB and the folder to 5 MB. The script splits the worker and compresses the CMaps into a local pack; the reader server serves both in PDF.js's expected formats. Changes to the extension must be followed by **Reload extensions** in the Copilot app. The extension's SDK dependency is supplied by Copilot at runtime.

## License

Extension code: MIT (see [LICENSE](LICENSE)). Vendored [Mozilla PDF.js](https://github.com/mozilla/pdf.js): Apache-2.0 with separately licensed components (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the included `vendor/**/LICENSE*` files).
