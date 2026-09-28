import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "node_modules", "pdfjs-dist");
const files = [
    ["build/pdf.min.mjs", "vendor/pdf.min.mjs"],
    ["build/pdf.worker.min.mjs", "vendor/pdf.worker.min.mjs"],
    ["web/pdf_viewer.css", "vendor/pdf_viewer.css"],
    ["LICENSE", "vendor/LICENSE"],
];

for (const [source, target] of files) {
    const destination = join(root, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(packageRoot, source), destination);
}

for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    await cp(join(packageRoot, directory), join(root, "vendor", directory), { recursive: true });
}
