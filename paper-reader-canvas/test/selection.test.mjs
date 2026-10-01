import assert from "node:assert/strict";
import { test } from "node:test";
import { attachGlyphRuns, glyphRunsFor, nearestGlyphOffset, wordSegments } from "../web/selection.mjs";

const line = "BCIs) have emerged";
const advances = [
    6, 6, 3, 4, 3, 2,
    5, 4, 5, 4, 2,
    4, 8, 4, 3, 4, 4, 4,
];

test("extracts original glyph advances from PDF text operators", () => {
    const runs = glyphRunsFor({
        fnArray: [44, 45, 44, 99],
        argsArray: [
            [[{ unicode: "a", width: 400 }, { unicode: "b", width: 600 }, { unicode: " ", width: 200 }]],
            [[{ unicode: "c", width: 500 }, 50, { unicode: "d", width: 500 }]],
            [[
                { unicode: " ", width: 200 },
                { unicode: "seizure", width: 3000 },
                { unicode: " ", width: 200 },
                { unicode: "detection", width: 3900 },
            ]],
            [[{ unicode: "ignored", width: 1 }]],
        ],
    }, { showText: 44, showSpacedText: 45 });

    assert.deepEqual(runs, [
        { text: "ab", advances: [400, 600] },
        { text: "cd", advances: [450, 500] },
        { text: "seizure detection", advances: [
            ...Array(7).fill(3000 / 7), 200, ...Array(9).fill(3900 / 9),
        ] },
    ]);
});

test("maps a visual position to the nearest original glyph boundary", () => {
    assert.equal(nearestGlyphOffset([100, 300, 100], 0), 0);
    assert.equal(nearestGlyphOffset([100, 300, 100], 0.18), 1);
    assert.equal(nearestGlyphOffset([100, 300, 100], 0.75), 2);
    assert.equal(nearestGlyphOffset([100, 300, 100], 1), 3);
});

test("matches normalized scientific symbols and spaces without losing glyph widths", () => {
    const ops = { showText: 44 };
    const runs = glyphRunsFor({
        fnArray: [ops.showText],
        argsArray: [[[
            { unicode: "\u00b5", width: 512 },
            { unicode: "\u00a0", width: 227 },
            { unicode: "\ufb01", width: 560 },
        ]]],
    }, ops, { normalizeText: (text) => text.normalize("NFKC") });
    assert.deepEqual(runs, [{ text: "\u03bc fi", advances: [512, 227, 280, 280] }]);
});

test("includes PDF justification and character spacing before positioning kernel", () => {
    const ops = { setFont: 37, setWordSpacing: 34, setCharSpacing: 33, showText: 44 };
    const text = "64-sample kernel";
    const widths = [480, 480, 356, 373, 430, 800, 517, 253, 425, 227, 487.1, 425, 376.9, 543, 421, 253];
    const glyphs = [...text].map((unicode, index) => ({ unicode, width: widths[index], isSpace: unicode === " " }));
    const [run] = glyphRunsFor({
        fnArray: [ops.setFont, ops.setWordSpacing, ops.setCharSpacing, ops.showText],
        argsArray: [["F1", 1], [0.102], [0.01], [glyphs]],
    }, ops);
    const expected = widths.map((width, index) => width + 10 + (index === 9 ? 102 : 0));
    expected[expected.length - 1] -= 10;
    assert.deepEqual(run.advances, expected);
    const pdfWidth = expected.reduce((sum, width) => sum + width, 0) * 0.009;
    const segments = wordSegments(run.text, run.advances, pdfWidth);
    assert.equal(segments[2].text, "kernel");
    assert.ok(Math.abs(segments[2].left - expected.slice(0, 10).reduce((sum, width) => sum + width, 0) * 0.009) < 1e-10);
    assert.ok(Math.abs(segments[2].width - expected.slice(10).reduce((sum, width) => sum + width, 0) * 0.009) < 1e-10);
});

test("restores text spacing and font state across saved graphics and form objects", () => {
    const ops = { setFont: 37, setGState: 9, setWordSpacing: 34, setCharSpacing: 33,
        showText: 44, save: 10, restore: 11, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
    const glyphs = [{ unicode: "a", width: 400 }, { unicode: " ", width: 200, isSpace: true }, { unicode: "b", width: 500 }];
    const runs = glyphRunsFor({
        fnArray: [ops.setFont, ops.setWordSpacing, ops.save, ops.setFont, ops.setWordSpacing, ops.showText,
            ops.restore, ops.showText, ops.paintFormXObjectBegin, ops.setGState, ops.setCharSpacing,
            ops.showText, ops.paintFormXObjectEnd, ops.showText],
        argsArray: [["F1", 2], [0.2], [], ["F2", 4], [0.4], [glyphs],
            [], [glyphs], [], [[["Font", ["F2", 4]]]], [0.08],
            [glyphs], [], [glyphs]],
    }, ops, { fontMatrixFor: (name) => name === "F2" ? 0.002 : 0.001 });
    assert.deepEqual(runs.map(({ advances }) => advances), [
        [400, 250, 500], [400, 300, 500], [410, 235, 500], [400, 300, 500],
    ]);
});

test("positions words using the PDF's rendered line width, not the browser's font width", () => {
    const pdfLineWidth = 797;
    const browserNaturalWidth = 963;
    const segments = wordSegments(line, advances, pdfLineWidth);
    assert.deepEqual(segments.map(({ text }) => text), ["BCIs)", " ", "have", " ", "emerged"]);
    const haveLeft = 24 / 75 * pdfLineWidth;
    assert.ok(Math.abs(segments[2].left - haveLeft) < 0.03);
    assert.ok(Math.abs(segments[2].left - 24 / 75 * browserNaturalWidth) > 50);
    assert.equal(segments.at(-1).left + segments.at(-1).width, pdfLineWidth);
});

test("attaches word spans at the PDF width even when the DOM line is wider", () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    globalThis.Node = { TEXT_NODE: 3 };
    globalThis.document = {
        createElement: () => ({
            style: {},
            set textContent(value) {
                this.firstChild = { nodeType: 3, textContent: value };
                this.naturalWidth = value.length * 16;
            },
            get offsetWidth() { return this.naturalWidth; },
        }),
    };
    const div = {
        dir: "ltr",
        firstChild: { nodeType: 3, textContent: line },
        offsetWidth: 963,
        offsetHeight: 20,
        style: { setProperty() {} },
        replaceChildren() { this.children = []; },
        append(span) { this.children.push(span); },
    };
    try {
        const attached = attachGlyphRuns(
            { textDivs: [div], textContentItemsStr: [line] },
            [{ text: line, advances }],
            [{ str: line, width: 398.5 }],
            2,
        );
        assert.equal(attached, 1);
        assert.equal(div.style.width, "797px");
        assert.deepEqual(div.children.map((span) => span.firstChild.textContent), ["BCIs)", " ", "have", " ", "emerged"]);
        assert.ok(Math.abs(parseFloat(div.children[2].style.left) - 24 / 75 * 797) < 0.03);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousNode === undefined) delete globalThis.Node;
        else globalThis.Node = previousNode;
    }
});

test("keeps the complete last word inside the PDF item width", () => {
    const text = "seizure detection";
    const advances = [...Array(7).fill(430), 200, ...Array(9).fill(435)];
    const segments = wordSegments(text, advances, 122);
    assert.deepEqual(segments.map(({ text }) => text), ["seizure", " ", "detection"]);
    assert.equal(segments[2].left + segments[2].width, 122);
    assert.equal(nearestGlyphOffset(segments[2].advances, 1), "detection".length);
});
