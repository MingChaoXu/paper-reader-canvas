import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageNavigation, pageNumber, scrollToPage, visiblePageNumber } from "../web/navigation.mjs";

function fixture(count = 5, heights = Array(count).fill(1000)) {
    const frames = [];
    const control = () => ({
        disabled: false, value: "", attributes: new Map(), handlers: new Map(),
        addEventListener(event, handler) { this.handlers.set(event, handler); },
        emit(event) { this.handlers.get(event)?.({ preventDefault() {} }); },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        select() { this.selected = true; },
    });
    const viewer = {
        ...control(), scrollTop: 0, scrollLeft: 200, clientTop: 2, clientHeight: 600,
        scrollHeight: heights.reduce((sum, height) => sum + height + 20, 36),
        getBoundingClientRect: () => ({ top: 100 }),
        querySelectorAll: () => pages,
        querySelector: (selector) => pages.find((page) => selector === `.paper-page[data-page="${page.dataset.page}"]`),
    };
    let top = 120;
    const pages = heights.map((height, index) => {
        const pageTop = top;
        top += height + 20;
        return { dataset: { page: String(index + 1) }, getBoundingClientRect: () => ({
            top: pageTop - viewer.scrollTop, bottom: pageTop + height - viewer.scrollTop, height,
        }) };
    });
    const options = {
        viewer, form: control(), input: control(), total: {}, previous: control(), next: control(), submit: control(),
        topInset: () => 18, requestFrame: (callback) => { frames.push(callback); return frames.length; },
        jumps: [], errors: [],
    };
    options.onJump = (number) => options.jumps.push(number);
    options.onError = (message) => options.errors.push(message);
    const navigation = createPageNavigation(options);
    const submit = (value) => {
        options.input.value = value;
        options.input.emit("input");
        options.form.emit("submit");
    };
    const flush = () => { for (const frame of frames.splice(0)) frame(); };
    return { ...options, navigation, submitPage: submit, flush, pages };
}

test("accepts whole PDF page numbers and reports invalid or out-of-range input", () => {
    assert.equal(pageNumber(" 4 ", 12), 4);
    assert.equal(pageNumber("004", 12), 4);
    assert.equal(pageNumber(12, 12), 12);
    for (const value of ["", "0", "-1", "13", "1.5", "1e1", "NaN", "page4", "4.0"]) {
        assert.throws(() => pageNumber(value, 12), /1～12/);
    }
    assert.throws(() => pageNumber("1", 0), /打开 PDF/);
});

test("jumps to page 4 at the reading-area inset without resetting horizontal pan", () => {
    const { viewer, pages } = fixture();
    scrollToPage(viewer, 4, 18);
    assert.equal(pages[3].getBoundingClientRect().top, 120);
    assert.equal(viewer.scrollLeft, 200);
    assert.equal(visiblePageNumber(viewer, 18), 4);
    assert.throws(() => scrollToPage(viewer, 7, 18), /尚未准备好/);
});

test("tracks the top reading position and identifies a short last page at the bottom", () => {
    const { viewer } = fixture(3, [1000, 1000, 150]);
    assert.equal(visiblePageNumber(viewer, 18), 1);
    viewer.scrollTop = 1040;
    assert.equal(visiblePageNumber(viewer, 18), 2);
    viewer.scrollTop = viewer.scrollHeight - viewer.clientHeight;
    assert.equal(visiblePageNumber(viewer, 18), 3);
    viewer.querySelectorAll = () => [];
    assert.equal(visiblePageNumber(viewer, 18), null);
});

test("enables controls only for a ready PDF and disables previous/next at boundaries", () => {
    const f = fixture();
    assert.equal(f.input.disabled, true);
    assert.equal(f.previous.disabled, true);
    assert.equal(f.next.disabled, true);
    f.navigation.setDocument(5);
    assert.equal(f.total.textContent, "/ 5");
    assert.equal(f.input.value, "1");
    assert.equal(f.previous.disabled, true);
    f.submitPage("4");
    assert.deepEqual(f.jumps, [4]);
    f.next.emit("click");
    assert.equal(f.input.value, "5");
    assert.equal(f.next.disabled, true);
    f.previous.emit("click");
    assert.equal(f.input.value, "4");
    f.navigation.loading();
    assert.equal(f.submit.disabled, true);
    f.navigation.setDocument(0);
    assert.equal(f.input.value, "");
    assert.equal(f.total.textContent, "/ 0");
    assert.equal(f.next.disabled, true);
});

test("does not replace a page number while editing or before clicking jump", () => {
    const f = fixture();
    f.navigation.setDocument(5);
    f.input.emit("focus");
    assert.equal(f.input.selected, true);
    f.input.value = "4";
    f.input.emit("input");
    f.viewer.scrollTop = 1050;
    f.viewer.emit("scroll");
    f.flush();
    assert.equal(f.input.value, "4");
    f.input.emit("blur");
    assert.equal(f.input.value, "4");
    f.form.emit("submit");
    assert.equal(f.jumps.at(-1), 4);
    f.viewer.scrollTop = 1050;
    f.viewer.emit("scroll");
    f.flush();
    assert.equal(f.input.value, "2");
});

test("invalid entries show errors without moving the reader or silently clamping", () => {
    const f = fixture();
    f.navigation.setDocument(5);
    f.submitPage("6");
    assert.equal(f.viewer.scrollTop, 0);
    assert.match(f.errors.at(-1), /1～5/);
    assert.equal(f.input.attributes.get("aria-invalid"), "true");
    f.submitPage("3");
    assert.deepEqual(f.jumps, [3]);
    assert.equal(f.input.attributes.has("aria-invalid"), false);
});
