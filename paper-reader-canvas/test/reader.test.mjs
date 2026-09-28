import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReaderServer, translationPrompt } from "../server.mjs";
import * as pdfjs from "../vendor/pdf.min.mjs";

const workerParts = [
    new URL("../vendor/pdf.worker.min.mjs.part1", import.meta.url),
    new URL("../vendor/pdf.worker.min.mjs.part2", import.meta.url),
];
pdfjs.GlobalWorkerOptions.workerSrc = `data:text/javascript;base64,${Buffer.concat(
    await Promise.all(workerParts.map(async (url) => readFile(url))),
).toString("base64")}`;

function samplePdf(text) {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        null,
    ];
    const stream = `BT /F1 16 Tf 72 700 Td (${text}) Tj ET`;
    objects[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(output));
        output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const startXref = Buffer.byteLength(output);
    output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
    output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
    return Buffer.from(output);
}

test("vendored PDF.js extracts selectable English text without network access", async () => {
    const task = pdfjs.getDocument({
        data: new Uint8Array(samplePdf("neural prosthesis")),
        useSystemFonts: true,
    });
    try {
        const pdf = await task.promise;
        assert.equal(pdf.numPages, 1);
        const content = await (await pdf.getPage(1)).getTextContent();
        assert.ok(content.items.some((item) => item.str === "neural prosthesis"));
    } finally {
        await task.destroy();
    }
});

test("reads local PDF ranges and sends only the selected words and context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-reader-test-"));
    const bytes = samplePdf("neural prosthesis");
    await writeFile(join(dir, "paper.pdf"), bytes);
    const sent = [];
    let reader;
    try {
        reader = await createReaderServer({
            workspaceRoot: dir,
            initialPath: "paper.pdf",
            send: async (message) => { sent.push(message); return "message-123"; },
        });
        const base = new URL(reader.url);
        const post = (route, data, origin = base.origin) => fetch(new URL(route, base), {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });

        const state = await (await fetch(new URL("state", base))).json();
        assert.equal(state.document.name, "paper.pdf");
        const servedWorker = Buffer.from(await (await fetch(new URL("vendor/pdf.worker.min.mjs", base))).arrayBuffer());
        const sourceWorker = Buffer.concat(await Promise.all(workerParts.map((url) => readFile(url))));
        assert.deepEqual(servedWorker, sourceWorker);
        const version = state.version;
        assert.equal(reader.getSelection(), null);
        const range = await fetch(new URL("pdf", base), { headers: { Range: "bytes=0-7" } });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get("content-range"), `bytes 0-7/${bytes.length}`);
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 8));
        assert.equal((await fetch(new URL("pdf", base), { headers: { Range: `bytes=${bytes.length}-` } })).status, 416);
        const selection = { text: "neural", page: 1, context: "a neural prosthesis", version };
        assert.equal((await post("selection", selection, "https://not-this-canvas.test")).status, 403);
        assert.equal((await post("selection", selection)).status, 200);
        assert.equal(reader.getSelection().text, "neural");
        assert.equal((await post("translate", {})).status, 200);
        assert.equal(sent.length, 1);
        assert.match(sent[0].prompt, /neural/);
        assert.match(sent[0].prompt, /a neural prosthesis/);
        assert.ok(!("attachments" in sent[0]));

        assert.equal((await post("open", { path: "missing.pdf" })).status, 404);
        assert.equal(reader.getSelection().text, "neural");
        assert.equal((await post("browser-file", { name: "another.pdf" })).status, 200);
        assert.equal(reader.getSelection(), null);
        assert.equal((await post("selection", selection)).status, 409);
        assert.equal((await post("translate", {})).status, 409);
    } finally {
        if (reader) await reader.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test("invalid PDF paths fail clearly and quoted document text stays data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-reader-invalid-"));
    try {
        await writeFile(join(dir, "not-pdf.pdf"), "not a PDF");
        await assert.rejects(
            createReaderServer({ workspaceRoot: dir, initialPath: "not-pdf.pdf", send: async () => "id" }),
            { code: "invalid_pdf" },
        );
        const prompt = translationPrompt({
            document: { name: "paper.pdf" },
            page: 3,
            text: "dendritic cells",
            context: "activated dendritic cells",
        });
        assert.match(prompt, /第|页码：3/);
        assert.match(prompt, /dendritic cells/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
