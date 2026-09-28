import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "node_modules", "pdfjs-dist");
const files = [
    ["build/pdf.min.mjs", "vendor/pdf.min.mjs"],
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

// The app's GitHub folder installer rejects files larger than 1 MB and folders above 5 MB.
const cmaps = join(root, "vendor", "cmaps");
const names = (await readdir(cmaps)).filter((name) => name.endsWith(".bcmap")).sort();
const chunks = await Promise.all(names.map((name) => readFile(join(cmaps, name))));
let offset = 0;
const index = {};
for (let i = 0; i < names.length; i++) {
    index[names[i]] = [offset, chunks[i].length];
    offset += chunks[i].length;
}
await writeFile(join(cmaps, "index.json"), JSON.stringify(index));
await writeFile(join(cmaps, "packed.br"), brotliCompressSync(Buffer.concat(chunks), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}));
await Promise.all(names.map((name) => rm(join(cmaps, name))));

const worker = await readFile(join(packageRoot, "build/pdf.worker.min.mjs"));
const split = Math.ceil(worker.length / 2);
for (const [index, part] of [worker.subarray(0, split), worker.subarray(split)].entries()) {
    await writeFile(join(root, "vendor", `pdf.worker.min.mjs.part${index + 1}`), part);
}
await rm(join(root, "vendor", "pdf.worker.min.mjs"), { force: true });
