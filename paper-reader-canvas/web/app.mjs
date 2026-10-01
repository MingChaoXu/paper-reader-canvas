import * as pdfjs from "./vendor/pdf.min.mjs";
import { textContentFor } from "./text-content.mjs";
import { enableRightDragPan } from "./pan.mjs";
import { monitorConnection } from "./connection.mjs";
import { attachGlyphRuns, correctSelectionRange, glyphRunsFor } from "./selection.mjs";
import { maxZoom, minZoom, pageAnchor, restoreAnchor, wheelPixels, wheelZoom } from "./zoom.mjs";
import { createAudioPlayer, createTranslationView } from "./speech.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

const $ = (selector) => document.querySelector(selector);
const viewer = $("#viewer");
const translateButton = $("#translate");
const assetUrl = (directory) => new URL(`./vendor/${directory}/`, import.meta.url).href;
const pdfOptions = {
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("standard_fonts"),
    wasmUrl: assetUrl("wasm"),
};

let loadingTask;
let pdf;
let activeSource;
let generation = 0;
let zoom = 1;
let zoomFrame;
let lastZoomAnchor;
const pageMetrics = new Map();
let observer;
let selectionUpdate = Promise.resolve();
let selectionReady = false;
let selectionFrame;
let documentVersion = 0;
let englishAvailable = false;
let chineseAvailable = false;
let speechBusy = false;

function speechStatus(message, error = false) {
    $("#speech-status").textContent = message;
    $("#speech-status").classList.toggle("error", error);
}

function updateSpeechButtons() {
    $("#speak-selection").disabled = !englishAvailable || !selectionReady;
    $("#speak-translation").disabled = !chineseAvailable || translations.get()?.status !== "ready";
    $("#stop-speech").disabled = !speechBusy;
}

const speaker = createAudioPlayer({
    audio: $("#speech-audio"),
    fetchAudio: async (options, signal) => {
        const response = await fetch("./speech", {
            method: "POST", signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options),
        });
        if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
        return response.blob();
    },
    onState: (state) => {
        speechBusy = state !== "idle";
        updateSpeechButtons();
    },
    onStatus: speechStatus,
});

function read(kind, automatic = false) {
    const translation = translations.get();
    return speaker.play({
        kind, version: documentVersion,
        ...(kind === "translation" ? { translationId: translation?.id } : {}),
        rate: Number($("#speech-rate").value),
        voiceId: $(kind === "selection" ? "#english-voice" : "#chinese-voice").value || undefined,
    }, { automatic });
}

const translations = createTranslationView({
    stop: () => speaker.stop(),
    autoRead: () => $("#auto-read").checked && chineseAvailable,
    read: () => read("translation", true),
    render: (translation) => {
        $("#translation-panel").hidden = !translation;
        if (translation) {
            const selection = translation.selection;
            $("#translation-label").textContent = `第 ${selection.page} 页 · ${selection.text.slice(0, 40)} · ${
                translation.status === "pending" ? "等待译文…" : translation.status === "error" ? "翻译失败" : "译文"}`;
            $("#translation-text").textContent = translation.status === "error" ? translation.error : translation.text;
            if (translation.status === "error") speechStatus(translation.error, true);
        } else {
            $("#translation-text").textContent = "";
        }
        $("#speak-translation").disabled = !chineseAvailable || translation?.status !== "ready";
    },
});

async function loadVoices() {
    try {
        const { voices } = await request("speech/voices");
        for (const [language, selector] of [["en", "#english-voice"], ["zh", "#chinese-voice"]]) {
            const matching = voices.filter(({ lang }) => lang.toLowerCase().startsWith(language));
            const select = $(selector);
            select.replaceChildren(new Option("自动选择（本机）", ""));
            for (const voice of matching) select.append(new Option(`${voice.name} · ${voice.lang}`, voice.id));
            select.disabled = matching.length === 0;
            if (language === "en") englishAvailable = matching.length > 0;
            else chineseAvailable = matching.length > 0;
        }
        $("#auto-read").disabled = !chineseAvailable;
        updateSpeechButtons();
        if (!englishAvailable || !chineseAvailable) {
            speechStatus(`缺少${!englishAvailable ? "英文" : ""}${!englishAvailable && !chineseAvailable ? "及" : ""}${!chineseAvailable ? "中文" : ""}系统声音；请安装相应语音包后重新打开阅读器。`, true);
        } else {
            speechStatus("本机语音已就绪；可播放英文选区或开启译文自动朗读。");
        }
    } catch (error) {
        speechStatus(`本地朗读不可用：${error.message}`, true);
    }
}

function status(message, error = false) {
    $("#status").textContent = message;
    $("#status").classList.toggle("error", error);
}

async function request(route, method = "GET", body) {
    const response = await fetch(`./${route}`, {
        method,
        ...(body === undefined ? {} : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
    });
    if (!response.ok) {
        const details = await response.json();
        throw new Error(details.error || `HTTP ${response.status}`);
    }
    return response.json();
}

function clearSelection() {
    selectionReady = false;
    translateButton.disabled = true;
    $("#selection-label").textContent = "尚未选中文字";
    $("#selection-preview").textContent = "划选论文中的英文单词、句子或段落。";
    updateSpeechButtons();
}

function showDocument(name, pages) {
    $("#document-name").textContent = name;
    $("#page-count").textContent = `${pages} 页`;
    clearSelection();
    status("划词后可点击翻译，或在会话里说“翻译刚选中的文字”。");
}

async function stopDocument() {
    speaker.stop();
    translations.update(null, documentVersion);
    generation++;
    if (zoomFrame) cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
    lastZoomAnchor = null;
    pageMetrics.clear();
    observer?.disconnect();
    observer = undefined;
    const previous = loadingTask;
    loadingTask = undefined;
    pdf = undefined;
    if (previous) await previous.destroy();
}

async function displayDocument(source, label) {
    await stopDocument();
    const run = generation;
    const task = pdfjs.getDocument({ ...pdfOptions, ...source });
    loadingTask = task;
    try {
        const document = await task.promise;
        if (run !== generation) return;
        pdf = document;
        showDocument(label, document.numPages);
        await renderPages();
    } catch (error) {
        if (run !== generation) return;
        activeSource = undefined;
        viewer.replaceChildren();
        status(`无法打开 PDF：${error.message}`, true);
    }
}

function centerAnchor() {
    const rect = viewer.getBoundingClientRect();
    return pageAnchor(viewer, rect.left + viewer.clientWidth / 2, rect.top + viewer.clientHeight / 2)
        ?? lastZoomAnchor;
}

function scheduleZoomRender(anchor) {
    if (anchor) lastZoomAnchor = anchor;
    if (zoomFrame) return;
    zoomFrame = requestAnimationFrame(() => {
        zoomFrame = undefined;
        renderPages(lastZoomAnchor).catch((error) => status(`缩放失败：${error.message}`, true));
    });
}

async function renderPages(anchor = centerAnchor()) {
    if (!pdf) return;
    const run = ++generation;
    observer?.disconnect();
    viewer.replaceChildren();
    const first = await pdf.getPage(1);
    if (run !== generation) return;
    const base = first.getViewport({ scale: 1 });
    pageMetrics.set(1, { width: base.width, height: base.height });
    const fit = (viewer.clientWidth - 40) / base.width;
    const scale = Math.max(0.3, Math.min(fit, 2) * zoom);
    const queue = [];
    let inFlight = 0;

    async function draw(pageElement) {
        const pageNumber = Number(pageElement.dataset.page);
        let stage = "load page";
        try {
            const page = await pdf.getPage(pageNumber);
            if (run !== generation) return;
            stage = "prepare viewport";
            const viewport = page.getViewport({ scale });
            pageMetrics.set(pageNumber, { width: viewport.width / scale, height: viewport.height / scale });
            pageElement.style.width = `${viewport.width}px`;
            pageElement.style.height = `${viewport.height}px`;
            if (anchor && pageNumber === anchor.number) restoreAnchor(viewer, anchor);
            pageElement.replaceChildren();
            const canvas = document.createElement("canvas");
            const ratio = Math.min(devicePixelRatio || 1, 2);
            canvas.width = Math.ceil(viewport.width * ratio);
            canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            pageElement.append(canvas);
            stage = "render page image";
            await page.render({
                canvasContext: canvas.getContext("2d"),
                viewport,
                transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
            }).promise;
            if (run !== generation) return;
            const layer = document.createElement("div");
            layer.className = "textLayer";
            layer.style.setProperty("--scale-factor", scale);
            layer.style.setProperty("--total-scale-factor", scale);
            pageElement.append(layer);
            stage = "get text";
            const textContent = await textContentFor(page);
            stage = "render text layer";
            const textLayer = new pdfjs.TextLayer({
                textContentSource: textContent,
                container: layer,
                viewport,
            });
            await textLayer.render();
            try {
                const operatorList = await page.getOperatorList();
                if (run !== generation) return;
                const runs = glyphRunsFor(operatorList, pdfjs.OPS, {
                    normalizeText: pdfjs.normalizeUnicode,
                    fontMatrixFor: (name) => page.commonObjs.get(name).fontMatrix?.[0] ?? 0.001,
                });
                layer.dataset.selectionRuns = `${attachGlyphRuns(textLayer, runs, textContent.items, viewport.scale * viewport.userUnit)}/${runs.length}`;
            } catch (error) {
                if (run !== generation) return;
                layer.dataset.selectionError = error.message;
                status(`第 ${pageNumber} 页选区校准失败：${error.message}`, true);
            }
        } catch (error) {
            if (run !== generation) return;
            pageElement.textContent = `第 ${pageNumber} 页渲染失败（${stage}）：${error.message}`;
            status(`第 ${pageNumber} 页渲染失败（${stage}）：${error.message}`, true);
        }
    }

    function pump() {
        while (inFlight < 2 && queue.length) {
            const element = queue.shift();
            inFlight++;
            draw(element).finally(() => { inFlight--; pump(); });
        }
    }

    observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            queue.push(entry.target);
        }
        pump();
    }, { root: viewer, rootMargin: "700px" });

    const fragment = document.createDocumentFragment();
    for (let page = 1; page <= pdf.numPages; page++) {
        const element = document.createElement("section");
        element.className = "paper-page";
        element.dataset.page = String(page);
        element.setAttribute("aria-label", `第 ${page} 页`);
        const size = pageMetrics.get(page) ?? pageMetrics.get(1);
        element.style.width = `${size.width * scale}px`;
        element.style.height = `${size.height * scale}px`;
        const placeholder = document.createElement("div");
        placeholder.className = "page-placeholder";
        placeholder.textContent = `第 ${page} 页`;
        element.append(placeholder);
        fragment.append(element);
    }
    viewer.append(fragment);
    restoreAnchor(viewer, anchor);
    for (const element of viewer.querySelectorAll(".paper-page")) observer.observe(element);
}

async function refreshDocument() {
    const { document: source, workspaceRoot, version, translation } = await request("state");
    $("#path").placeholder = `${workspaceRoot}/paper.pdf`;
    if (source?.kind === "browser") {
        if (activeSource === `browser:${source.name}` && pdf && documentVersion === version) {
            translations.update(translation, version);
            return;
        }
        if (pdf) {
            await stopDocument();
            viewer.replaceChildren();
        }
        const reset = await request("reset-browser-file", "POST", {});
        documentVersion = reset.version;
        activeSource = undefined;
        clearSelection();
        status("本机文件选择在页面刷新后失效，请重新选择 PDF。");
        return;
    }
    const changed = documentVersion !== version;
    documentVersion = version;
    if (source?.kind === "path" && (activeSource !== source.path || changed)) {
        activeSource = source.path;
        $("#path").value = source.path;
        await displayDocument({ url: new URL("./pdf", import.meta.url).href }, source.name);
    }
    translations.update(translation, version);
}

function surroundingText(range, layer, text) {
    const before = document.createRange();
    before.selectNodeContents(layer);
    before.setEnd(range.startContainer, range.startOffset);
    const prefix = before.toString().slice(-350);
    let suffix = "";
    if (layer.contains(range.endContainer)) {
        const after = document.createRange();
        after.selectNodeContents(layer);
        after.setStart(range.endContainer, range.endOffset);
        suffix = after.toString().slice(0, 350);
    }
    return `${prefix}【${text.slice(0, 180)}】${suffix}`;
}

function rejectSelection(message) {
    const version = documentVersion;
    clearSelection();
    selectionUpdate = selectionUpdate.then(() => request("selection", "POST", { text: null, version }))
        .catch((error) => status(`清除选区失败：${error.message}`, true));
    status(message, true);
}

function captureSelection() {
    const selection = window.getSelection();
    const nativeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    let range = nativeRange;
    if (nativeRange) {
        try {
            range = correctSelectionRange(nativeRange);
        } catch (error) {
            rejectSelection(`选区校准失败：${error.message}`);
            return;
        }
    }
    const text = range?.toString().trim() || "";
    const start = range?.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement : range?.startContainer;
    const layer = start?.closest?.(".textLayer");
    if (text && !layer) return;
    const version = documentVersion;
    if (text && layer.dataset.selectionError) {
        rejectSelection(`此页选区校准失败：${layer.dataset.selectionError}`);
        return;
    }
    if (text.length > 12_000) {
        rejectSelection("一次最多划选 12,000 个字符，请缩小选区。");
        return;
    }
    const page = layer?.closest(".paper-page");
    const context = text ? surroundingText(range, layer, text) : "";
    clearSelection();
    selectionUpdate = selectionUpdate.then(async () => {
        const result = await request("selection", "POST", text
            ? { text, page: Number(page.dataset.page), context, version }
            : { text: null, version });
        if (text && result.selection && version === documentVersion) {
            selectionReady = true;
            translateButton.disabled = false;
            updateSpeechButtons();
            $("#selection-label").textContent = `已选中 · 第 ${page.dataset.page} 页`;
            $("#selection-preview").textContent = text;
            status("选区已同步；可直接在会话里提问，或点击翻译。");
        }
    }).catch((error) => status(`同步选区失败：${error.message}`, true));
}

function scheduleSelectionCapture() {
    if (selectionFrame) cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(() => {
        selectionFrame = undefined;
        captureSelection();
    });
}

$("#path-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        status("正在打开 PDF…");
        await request("open", "POST", { path: $("#path").value });
        await refreshDocument();
    } catch (error) {
        status(`打开失败：${error.message}`, true);
    }
});

$("#file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
        status("请选择 PDF 文件。", true);
        return;
    }
    try {
        status("正在读取本机 PDF…");
        const data = new Uint8Array(await file.arrayBuffer());
        if (!new TextDecoder().decode(data.subarray(0, 1024)).includes("%PDF-")) {
            throw new Error("文件不包含 PDF 标识。");
        }
        const opened = await request("browser-file", "POST", { name: file.name });
        documentVersion = opened.version;
        activeSource = `browser:${file.name}`;
        $("#path").value = "";
        await displayDocument({ data }, file.name);
    } catch (error) {
        status(`打开失败：${error.message}`, true);
    } finally {
        event.target.value = "";
    }
});

enableRightDragPan(viewer, () => !!pdf);
viewer.addEventListener("pointerup", (event) => {
    if (event.button === 0) scheduleSelectionCapture();
});
viewer.addEventListener("keyup", scheduleSelectionCapture);
viewer.addEventListener("wheel", (event) => {
    if (!pdf || (!event.shiftKey && !event.deltaY)) return;
    event.preventDefault();
    const delta = wheelPixels(event, viewer.clientHeight);
    if (event.shiftKey) {
        viewer.scrollTop += delta;
        return;
    }
    if (!delta) return;
    const next = wheelZoom(zoom, delta);
    if (next === zoom) return;
    const anchor = pageAnchor(viewer, event.clientX, event.clientY) ?? lastZoomAnchor;
    zoom = next;
    $("#zoom-label").textContent = `${Math.round(zoom * 100)}%`;
    scheduleZoomRender(anchor);
}, { passive: false });

translateButton.addEventListener("click", async () => {
    await selectionUpdate;
    if (!selectionReady) return;
    translateButton.disabled = true;
    try {
        const result = await request("translate", "POST", { version: documentVersion });
        status(`已将选中内容送入当前 Copilot 会话（消息 ${result.messageId.slice(0, 8)}）。`);
    } catch (error) {
        status(`发送翻译请求失败：${error.message}`, true);
    } finally {
        translateButton.disabled = !selectionReady;
    }
});

$("#speak-selection").addEventListener("click", () => { if (selectionReady) read("selection"); });
$("#speak-translation").addEventListener("click", () => { if (translations.get()?.status === "ready") read("translation"); });
$("#stop-speech").addEventListener("click", () => {
    speaker.stop();
    speechStatus("朗读已停止。");
});
$("#auto-read").addEventListener("change", async () => {
    if ($("#auto-read").checked) {
        const enabled = await speaker.unlock();
        $("#auto-read").checked = enabled;
        if (enabled) speechStatus("已开启：下次点击翻译后，将自动朗读返回的译文。");
    } else {
        speaker.stop();
        speechStatus("已关闭自动朗读。");
    }
});
window.addEventListener("pagehide", () => speaker.stop());

for (const [id, factor] of [["zoom-in", 1.2], ["zoom-out", 1 / 1.2]]) {
    $(`#${id}`).addEventListener("click", () => {
        const anchor = centerAnchor();
        zoom = Math.max(minZoom, Math.min(maxZoom, zoom * factor));
        $("#zoom-label").textContent = `${Math.round(zoom * 100)}%`;
        scheduleZoomRender(anchor);
    });
}

let viewerWidth = viewer.clientWidth;
new ResizeObserver(() => {
    if (viewer.clientWidth === viewerWidth) return;
    viewerWidth = viewer.clientWidth;
    if (pdf && viewerWidth) {
        clearTimeout(viewer.resizeTimer);
        viewer.resizeTimer = setTimeout(() => renderPages(), 300);
    }
}).observe(viewer);

const events = new EventSource("./events");
events.addEventListener("translation", (event) => {
    try {
        const { translation, version } = JSON.parse(event.data);
        if (version === documentVersion) translations.update(translation, version, { live: true });
    } catch (error) {
        speechStatus(`接收译文失败：${error.message}`, true);
    }
});
let connectionMessage;
monitorConnection(events, {
    onDocument: () => refreshDocument().catch((error) => status(`刷新文档失败：${error.message}`, true)),
    onStatus: (message, error) => {
        connectionMessage = message;
        status(message, error);
    },
    onReconnect: async () => {
        const previous = connectionMessage;
        connectionMessage = null;
        try {
            await refreshDocument();
            if ($("#status").textContent === previous) {
                status(selectionReady ? "选区已同步；可直接在会话里提问，或点击翻译。" : "阅读器已恢复连接。");
            }
        } catch (error) {
            status(`重连后同步失败：${error.message}`, true);
        }
    },
});
refreshDocument().catch((error) => status(`阅读器初始化失败：${error.message}`, true));
loadVoices();
