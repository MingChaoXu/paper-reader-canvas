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

test("positions words using the PDF's rendered line width, not the browser's font width", () => {
    const pdfLineWidth = 797;
    const browserNaturalWidth = 963;
    const segments = wordSegments(line, advances, pdfLineWidth);
    assert.deepEqual(segments.map(({ text }) => text), ["BCIs) ", "have ", "emerged"]);
    const haveLeft = 24 / 75 * pdfLineWidth;
    assert.ok(Math.abs(segments[1].left - haveLeft) < 0.03);
    assert.ok(Math.abs(segments[1].left - 24 / 75 * browserNaturalWidth) > 50);
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
        assert.deepEqual(div.children.map((span) => span.firstChild.textContent), ["BCIs) ", "have ", "emerged"]);
        assert.ok(Math.abs(parseFloat(div.children[1].style.left) - 24 / 75 * 797) < 0.03);
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
    assert.deepEqual(segments.map(({ text }) => text), ["seizure ", "detection"]);
    assert.equal(segments[1].left + segments[1].width, 122);
    assert.equal(nearestGlyphOffset(segments[1].advances, 1), "detection".length);
});
