import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { createReaderServer, translationPrompt } from "../server.mjs";
import * as pdfjs from "../vendor/pdf.min.mjs";
import { textContentFor } from "../web/text-content.mjs";
import { glyphRunsFor, wordSegments } from "../web/selection.mjs";
import "../web/polyfills.mjs";

const workerParts = [
    new URL("../vendor/pdf.worker.min.mjs.part1", import.meta.url),
    new URL("../vendor/pdf.worker.min.mjs.part2", import.meta.url),
];
pdfjs.GlobalWorkerOptions.workerSrc = `data:text/javascript;base64,${Buffer.concat(
    await Promise.all(workerParts.map(async (url) => readFile(url))),
).toString("base64")}`;

function samplePdf(text, spacing = "") {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        null,
    ];
    const stream = `BT /F1 16 Tf ${spacing} 72 700 Td (${text}) Tj ET`;
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
        const content = await textContentFor(await pdf.getPage(1));
        assert.ok(content.items.some((item) => item.str === "neural prosthesis"));
    } finally {
        await task.destroy();
    }
});

test("text layer reads a stream without an async iterator (WebKit)", async () => {
    let index = 0;
    let released = false;
    const chunks = [
        { lang: "en", styles: { F1: { fontFamily: "serif" } }, items: [{ str: "neural" }] },
        { styles: { F2: { fontFamily: "sans-serif" } }, items: [{ str: " prosthesis" }] },
    ];
    const page = {
        streamTextContent: () => ({
            getReader: () => ({
                read: async () => index < chunks.length
                    ? { done: false, value: chunks[index++] }
                    : { done: true },
                releaseLock: () => { released = true; },
            }),
        }),
    };
    const content = await textContentFor(page);
    assert.deepEqual(content.items.map(({ str }) => str), ["neural", " prosthesis"]);
    assert.deepEqual(Object.keys(content.styles), ["F1", "F2"]);
    assert.equal(content.lang, "en");
    assert.equal(released, true);
});

test("calibrates words using actual PDF font and text spacing operators", async () => {
    const task = pdfjs.getDocument({
        data: new Uint8Array(samplePdf("64-sample kernel", "0.2 Tc 1.5 Tw")),
        useSystemFonts: true,
    });
    try {
        const page = await (await task.promise).getPage(1);
        const content = await textContentFor(page);
        const item = content.items.find(({ str }) => str === "64-sample kernel");
        const operators = await page.getOperatorList();
        const [run] = glyphRunsFor(operators, pdfjs.OPS, {
            normalizeText: pdfjs.normalizeUnicode,
            fontMatrixFor: (name) => page.commonObjs.get(name).fontMatrix?.[0] ?? 0.001,
        });
        assert.equal(run.text, item.str);
        const totalWidth = run.advances.reduce((sum, width) => sum + width, 0) * 0.016;
        assert.ok(Math.abs(totalWidth - item.width) < 1e-8);
        const segments = wordSegments(run.text, run.advances, item.width);
        assert.equal(segments[2].text, "kernel");
        const kernelLeft = run.advances.slice(0, 10).reduce((sum, width) => sum + width, 0) * 0.016;
        assert.ok(Math.abs(segments[2].left - kernelLeft) < 1e-8);
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
        const indexHtml = await (await fetch(base)).text();
        const polyfillScript = indexHtml.indexOf('src="./polyfills.mjs"');
        assert.ok(polyfillScript >= 0 && polyfillScript < indexHtml.indexOf('src="./app.mjs"'));
        for (const asset of ["polyfills.mjs", "selection.mjs", "speech.mjs"]) {
            const response = await fetch(new URL(asset, base));
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type"), /text\/javascript/);
        }
        const servedWorker = Buffer.from(await (await fetch(new URL("vendor/pdf.worker.min.mjs", base))).arrayBuffer());
        const sourceWorker = Buffer.concat(await Promise.all(workerParts.map((url) => readFile(url))));
        assert.deepEqual(servedWorker, sourceWorker);
        const index = JSON.parse(await readFile(new URL("../vendor/cmaps/index.json", import.meta.url), "utf8"));
        const packed = brotliDecompressSync(await readFile(new URL("../vendor/cmaps/packed.br", import.meta.url)));
        const [offset, length] = index["Adobe-GB1-UCS2.bcmap"];
        const map = await fetch(new URL("vendor/cmaps/Adobe-GB1-UCS2.bcmap", base));
        assert.equal(map.status, 200);
        assert.deepEqual(Buffer.from(await map.arrayBuffer()), packed.subarray(offset, offset + length));
        assert.equal((await fetch(new URL("vendor/cmaps/nonexistent.bcmap", base))).status, 404);
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

test("returns correlated translations over SSE and synthesizes only current selection or reply", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-reader-speech-test-"));
    await writeFile(join(dir, "paper.pdf"), samplePdf("oscillatory"));
    const spoken = [];
    let closed = false;
    const wave = Buffer.alloc(46);
    wave.write("RIFF", 0); wave.write("WAVE", 8);
    const reader = await createReaderServer({
        workspaceRoot: dir, initialPath: "paper.pdf", send: async () => "translation-request",
        speech: {
            voices: async () => [{ id: "English", name: "English", lang: "en-US" }],
            synthesize: async (options) => { spoken.push(options); return wave; },
            close: () => { closed = true; },
        },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const base = new URL(reader.url);
        const post = (route, body) => fetch(new URL(route, base), {
            method: "POST", headers: { Origin: base.origin, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const state = await (await fetch(new URL("state", base))).json();
        const version = state.version;
        const voiceResponse = await fetch(new URL("speech/voices", base));
        assert.equal((await voiceResponse.json()).voices[0].id, "English");
        const eventResponse = await fetch(new URL("events", base), { signal: controller.signal });
        const stream = eventResponse.body.getReader();
        await post("selection", { text: "oscillatory", context: "oscillatory cycles", page: 4, version });
        const original = await post("speech", { kind: "selection", rate: 1, version });
        assert.equal(original.headers.get("content-type"), "audio/wav");
        assert.match(original.headers.get("content-security-policy"), /media-src 'self' blob:/);
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), wave);
        assert.equal(spoken[0].text, "oscillatory");
        assert.equal(spoken[0].lang, "en");
        assert.equal((await post("speech", { kind: "arbitrary", text: "not permitted", rate: 1, version })).status, 400);
        assert.equal((await post("speech", { kind: "selection", rate: 4, version })).status, 400);
        const translation = await (await post("translate", { version })).json();
        assert.equal((await post("speech", { kind: "translation", translationId: translation.translationId, rate: 1, version })).status, 409);
        reader.acceptSessionEvent({
            type: "assistant.message",
            data: { originatingMessageId: "other", content: "unrelated private reply" },
        });
        reader.acceptSessionEvent({
            type: "assistant.message",
            data: { originatingMessageId: "translation-request", content: "**振荡的**，指振荡周期。" },
        });
        reader.acceptSessionEvent({ type: "assistant.idle", data: {} });
        let frames = "";
        while (!frames.includes('"status":"ready"')) {
            const { value, done } = await stream.read();
            assert.equal(done, false);
            frames += new TextDecoder().decode(value);
        }
        assert.match(frames, /event: translation/);
        assert.ok(!frames.includes("unrelated private reply"));
        assert.equal(reader.getTranslation().text, "**振荡的**，指振荡周期。");
        const translated = await post("speech", { kind: "translation", translationId: translation.translationId, rate: 1.25, version });
        assert.equal(translated.status, 200);
        await translated.arrayBuffer();
        assert.equal(spoken[1].text, "振荡的，指振荡周期。");
        assert.equal(spoken[1].lang, "zh");
        await reader.openDocument("paper.pdf");
        assert.equal(reader.getTranslation(), null);
        assert.equal((await post("speech", { kind: "selection", rate: 1, version })).status, 409);
    } finally {
        clearTimeout(timeout);
        controller.abort();
        await reader.close();
        assert.equal(closed, true);
        await rm(dir, { recursive: true, force: true });
    }
});

test("SSE keeps document listeners alive and sends retry and heartbeat frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-reader-events-"));
    await writeFile(join(dir, "paper.pdf"), samplePdf("neural prosthesis"));
    const reader = await createReaderServer({
        workspaceRoot: dir,
        send: async () => "id",
        heartbeatMs: 30,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
        const response = await fetch(new URL("events", reader.url), { signal: controller.signal });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /text\/event-stream/);
        const stream = response.body.getReader();
        let frames = "";
        while (!frames.includes(": heartbeat")) {
            const { done, value } = await stream.read();
            assert.equal(done, false);
            frames += new TextDecoder().decode(value);
        }
        assert.match(frames, /retry: 1500/);
        await reader.openDocument("paper.pdf");
        while (!frames.includes("event: document")) {
            const { done, value } = await stream.read();
            assert.equal(done, false);
            frames += new TextDecoder().decode(value);
        }
        assert.match(frames, /event: document\ndata: changed/);
    } finally {
        controller.abort();
        clearTimeout(timeout);
        await reader.close();
        await rm(dir, { recursive: true, force: true });
    }
});
