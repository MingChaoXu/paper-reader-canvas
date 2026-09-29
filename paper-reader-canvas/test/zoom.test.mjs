import assert from "node:assert/strict";
import { test } from "node:test";
import { maxZoom, minZoom, pageAnchor, restoreAnchor, wheelPixels, wheelZoom } from "../web/zoom.mjs";

test("wheel zoom has smooth increments, limits, and Shift scroll support", () => {
    assert.ok(wheelZoom(1, -120) > 1.19 && wheelZoom(1, -120) < 1.21);
    assert.ok(wheelZoom(1, 120) < 1);
    assert.equal(wheelZoom(maxZoom, -120), maxZoom);
    assert.equal(wheelZoom(minZoom, 120), minZoom);
    assert.equal(wheelPixels({ deltaY: -3, deltaX: 0, deltaMode: 1, shiftKey: false }, 800), -48);
    assert.equal(wheelPixels({ deltaY: 1, deltaX: 0, deltaMode: 2, shiftKey: false }, 800), 800);
    assert.equal(wheelPixels({ deltaY: 0, deltaX: 45, deltaMode: 0, shiftKey: true }, 800), 45);
});

test("reflow keeps the selected page coordinates below the pointer", () => {
    const viewer = {
        scrollLeft: 150,
        scrollTop: 540,
        pageWidth: 740,
        pageHeight: 1000,
        querySelectorAll: () => [page],
        querySelector: (selector) => selector === '.paper-page[data-page="2"]' ? page : null,
    };
    const page = {
        dataset: { page: "2" },
        getBoundingClientRect: () => ({
            left: 18 - viewer.scrollLeft,
            top: 1100 - viewer.scrollTop,
            right: 18 - viewer.scrollLeft + viewer.pageWidth,
            bottom: 1100 - viewer.scrollTop + viewer.pageHeight,
            width: viewer.pageWidth,
            height: viewer.pageHeight,
        }),
    };
    const cursor = { x: 415, y: 760 };
    const anchor = pageAnchor(viewer, cursor.x, cursor.y);
    assert.equal(anchor.number, 2);
    viewer.pageWidth *= 1.7;
    viewer.pageHeight *= 1.7;
    restoreAnchor(viewer, anchor);
    const rect = page.getBoundingClientRect();
    assert.ok(Math.abs(rect.left + anchor.x * rect.width - cursor.x) < 1e-6);
    assert.ok(Math.abs(rect.top + anchor.y * rect.height - cursor.y) < 1e-6);
});

test("an empty viewer has no zoom anchor", () => {
    assert.equal(pageAnchor({ querySelectorAll: () => [] }, 10, 20), null);
});
