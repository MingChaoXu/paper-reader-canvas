const glyphAdvancesByNode = new WeakMap();

function glyphRun(values, state, normalizeText) {
    const text = [];
    const advances = [];
    const widthScale = state.fontSize * state.fontMatrix;
    for (const value of values.flat(Infinity)) {
        if (typeof value === "number") {
            if (advances.length) advances[advances.length - 1] -= value / (1000 * state.fontMatrix);
            continue;
        }
        if (!value || typeof value.unicode !== "string") continue;
        const unicode = normalizeText(value.unicode);
        const spacing = state.charSpacing + (value.isSpace ? state.wordSpacing : 0);
        const width = (Number(value.width) || 0) + spacing / widthScale;
        const unitWidth = width / Math.max(unicode.length, 1);
        for (let index = 0; index < unicode.length; index++) {
            text.push(unicode[index]);
            advances.push(unitWidth);
        }
    }
    const joined = text.join("");
    const leading = joined.length - joined.trimStart().length;
    const trimmed = joined.trim();
    const trimmedAdvances = advances.slice(leading, leading + trimmed.length);
    if (trimmedAdvances.length) trimmedAdvances[trimmedAdvances.length - 1] -= state.charSpacing / widthScale;
    return { text: trimmed, advances: trimmedAdvances };
}

export function glyphRunsFor(operatorList, ops, {
    normalizeText = (text) => text,
    fontMatrixFor = () => 0.001,
} = {}) {
    const runs = [];
    const stack = [];
    let state = { fontSize: 1, fontMatrix: 0.001, charSpacing: 0, wordSpacing: 0 };
    function setFont([name, size]) {
        state.fontSize = size;
        state.fontMatrix = fontMatrixFor(name);
    }
    for (let index = 0; index < operatorList.fnArray.length; index++) {
        const operation = operatorList.fnArray[index];
        const args = operatorList.argsArray[index] || [];
        if (operation === ops.save || operation === ops.paintFormXObjectBegin) {
            stack.push({ ...state });
        } else if (operation === ops.restore || operation === ops.paintFormXObjectEnd) {
            if (stack.length) state = stack.pop();
        } else if (operation === ops.setFont) {
            setFont(args);
        } else if (operation === ops.setGState) {
            for (const [name, value] of args[0]) {
                if (name === "Font") setFont(value);
            }
        } else if (operation === ops.setCharSpacing) {
            state.charSpacing = args[0];
        } else if (operation === ops.setWordSpacing) {
            state.wordSpacing = args[0];
        }
        if (operation !== ops.showText && operation !== ops.showSpacedText) continue;
        if (!state.fontSize || !state.fontMatrix) continue;
        const run = glyphRun(args, state, normalizeText);
        if (run.text) runs.push(run);
    }
    return runs;
}

export function nearestGlyphOffset(advances, fraction) {
    const total = advances.reduce((sum, width) => sum + width, 0);
    if (!(total > 0)) return 0;
    const target = Math.max(0, Math.min(1, fraction)) * total;
    let offset = 0;
    let position = 0;
    let distance = Math.abs(target);
    for (let index = 0; index < advances.length; index++) {
        position += advances[index];
        const nextDistance = Math.abs(target - position);
        if (nextDistance < distance) {
            distance = nextDistance;
            offset = index + 1;
        }
    }
    return offset;
}

export function wordSegments(text, advances, width) {
    if (!Number.isFinite(width) || width <= 0 || advances.length !== text.length) return [];
    const total = advances.reduce((sum, advance) => sum + advance, 0);
    if (!(total > 0)) return [];
    let offset = 0;
    let position = 0;
    return (text.match(/\S+|\s+/g) || []).map((value) => {
        const segmentAdvances = advances.slice(offset, offset + value.length);
        const advance = segmentAdvances.reduce((sum, amount) => sum + amount, 0);
        const segment = { text: value, left: position / total * width, width: advance / total * width, advances: segmentAdvances };
        offset += value.length;
        position += advance;
        return segment;
    });
}

export function attachGlyphRuns(textLayer, runs, items, scale) {
    const queues = new Map();
    const textItems = items.filter((item) => typeof item.str === "string");
    let attached = 0;
    for (const run of runs) {
        let queue = queues.get(run.text);
        if (!queue) queues.set(run.text, queue = []);
        queue.push(run.advances);
    }
    for (let index = 0; index < textLayer.textDivs.length; index++) {
        const text = textLayer.textContentItemsStr[index];
        const queue = queues.get(text);
        const div = textLayer.textDivs[index];
        const node = div?.firstChild;
        if (!queue?.length || node?.nodeType !== Node.TEXT_NODE) continue;
        const advances = queue.shift();
        const item = textItems[index];
        if (div.dir !== "rtl" && text.includes(" ") && item?.str === text) {
            segmentTextDiv(div, text, advances, item.width * scale);
        } else {
            glyphAdvancesByNode.set(node, advances);
        }
        attached++;
    }
    return attached;
}

function segmentTextDiv(div, text, advances, width) {
    const segments = wordSegments(text, advances, width);
    const height = div.offsetHeight;
    if (!height || !segments.length) {
        glyphAdvancesByNode.set(div.firstChild, advances);
        return;
    }

    div.replaceChildren();
    const entries = [];
    for (const segment of segments) {
        const span = document.createElement("span");
        span.textContent = segment.text;
        span.dir = div.dir;
        span.style.position = "static";
        span.style.display = "inline-block";
        div.append(span);
        entries.push({ span, segment, naturalWidth: span.offsetWidth });
    }

    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
    div.style.display = "block";
    div.style.setProperty("--scale-x", "1");
    for (const entry of entries) {
        entry.span.style.position = "absolute";
        entry.span.style.display = "block";
        entry.span.style.left = `${entry.segment.left}px`;
        entry.span.style.top = "0";
        if (entry.naturalWidth > 0) {
            entry.span.style.transform = `scaleX(${entry.segment.width / entry.naturalWidth})`;
        }
        glyphAdvancesByNode.set(entry.span.firstChild, entry.segment.advances);
    }
}

function boundaryX(node, offset) {
    const probe = document.createRange();
    if (offset < node.length) {
        probe.setStart(node, offset);
        probe.setEnd(node, offset + 1);
        return probe.getBoundingClientRect().left;
    }
    if (offset > 0) {
        probe.setStart(node, offset - 1);
        probe.setEnd(node, offset);
        return probe.getBoundingClientRect().right;
    }
    return node.parentElement.getBoundingClientRect().left;
}

function correctedOffset(node, offset) {
    if (node?.nodeType !== Node.TEXT_NODE) return offset;
    const advances = glyphAdvancesByNode.get(node);
    const rect = node.parentElement?.getBoundingClientRect();
    if (!advances || !rect?.width) return offset;
    let fraction = (boundaryX(node, offset) - rect.left) / rect.width;
    if (node.parentElement.dir === "rtl") fraction = 1 - fraction;
    return nearestGlyphOffset(advances, fraction);
}

export function correctSelectionRange(range) {
    const corrected = range.cloneRange();
    corrected.setStart(range.startContainer, correctedOffset(range.startContainer, range.startOffset));
    corrected.setEnd(range.endContainer, correctedOffset(range.endContainer, range.endOffset));
    return corrected;
}
