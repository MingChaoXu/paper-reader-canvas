# Third-party notices

This extension bundles Mozilla PDF.js (`pdfjs-dist` 6.3.289), including its browser build, worker, viewer CSS, CMaps, standard fonts, and WASM resources.

PDF.js is licensed under the Apache License, Version 2.0; see [`vendor/LICENSE`](vendor/LICENSE). Bundled resources also carry their own notices and licenses:

- CMaps: [`vendor/cmaps/LICENSE`](vendor/cmaps/LICENSE)
- Standard fonts: [`vendor/standard_fonts/LICENSE_FOXIT`](vendor/standard_fonts/LICENSE_FOXIT) and [`LICENSE_LIBERATION`](vendor/standard_fonts/LICENSE_LIBERATION)
- WASM components: the `LICENSE_*` files in [`vendor/wasm/`](vendor/wasm/), including the JBIG2, OpenJPEG, and QCMS notices

Copyright remains with the respective contributors. The upstream assets are copied without modifying their source; `web/style.css` contains this extension's own presentation rules.
