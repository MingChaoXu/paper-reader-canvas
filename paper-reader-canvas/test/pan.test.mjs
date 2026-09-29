import assert from "node:assert/strict";
import { test } from "node:test";
import { enableRightDragPan } from "../web/pan.mjs";

function reader() {
    const viewer = new EventTarget();
    const captured = new Set();
    const classes = new Set();
    viewer.scrollLeft = 40;
    viewer.scrollTop = 200;
    viewer.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
    viewer.setPointerCapture = (id) => captured.add(id);
    viewer.releasePointerCapture = (id) => captured.delete(id);
    viewer.hasPointerCapture = (id) => captured.has(id);
    function emit(type, options = {}) {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, options);
        viewer.dispatchEvent(event);
        return event.defaultPrevented;
    }
    return { viewer, emit };
}

test("right-button drag pans both axes and releases capture on pointerup", () => {
    const { viewer, emit } = reader();
    enableRightDragPan(viewer, () => true);
    assert.equal(emit("pointerdown", { button: 2, pointerId: 7, clientX: 150, clientY: 150 }), true);
    assert.equal(viewer.hasPointerCapture(7), true);
    emit("pointermove", { pointerId: 7, buttons: 2, clientX: 148, clientY: 150 });
    assert.equal(viewer.scrollLeft, 40);
    assert.equal(viewer.classList.contains("panning"), false);
    assert.equal(emit("pointermove", { pointerId: 7, buttons: 2, clientX: 80, clientY: 100 }), true);
    assert.equal(viewer.scrollLeft, 110);
    assert.equal(viewer.scrollTop, 250);
    assert.equal(viewer.classList.contains("panning"), true);
    emit("pointerup", { pointerId: 7, button: 2 });
    assert.equal(viewer.hasPointerCapture(7), false);
    assert.equal(viewer.classList.contains("panning"), false);
});

test("left selection is untouched and pan cancels if the right button is released", () => {
    const { viewer, emit } = reader();
    enableRightDragPan(viewer, () => true);
    assert.equal(emit("pointerdown", { button: 0, pointerId: 1, clientX: 150, clientY: 150 }), false);
    emit("pointermove", { pointerId: 1, buttons: 1, clientX: 70, clientY: 80 });
    assert.equal(viewer.scrollTop, 200);
    emit("pointerdown", { button: 2, pointerId: 2, clientX: 150, clientY: 150 });
    emit("pointermove", { pointerId: 2, buttons: 0, clientX: 70, clientY: 80 });
    assert.equal(viewer.hasPointerCapture(2), false);
    assert.equal(viewer.scrollTop, 200);
});

test("context menu is suppressed only while a PDF is open", () => {
    const { viewer, emit } = reader();
    let open = false;
    enableRightDragPan(viewer, () => open);
    assert.equal(emit("contextmenu"), false);
    assert.equal(emit("pointerdown", { button: 2, pointerId: 1, clientX: 0, clientY: 0 }), false);
    open = true;
    assert.equal(emit("contextmenu"), true);
    emit("pointerdown", { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
    emit("pointercancel", { pointerId: 1 });
    assert.equal(viewer.hasPointerCapture(1), false);
});
