export function enableRightDragPan(viewer, canPan) {
    let drag;

    function finish(event) {
        if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
        viewer.classList.remove("panning");
        drag = null;
    }

    viewer.addEventListener("pointerdown", (event) => {
        if (event.button !== 2 || !canPan() || drag) return;
        drag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: viewer.scrollLeft,
            top: viewer.scrollTop,
            moved: false,
        };
        event.preventDefault();
    });

    viewer.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!(event.buttons & 2)) {
            finish(event);
            return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        viewer.classList.add("panning");
        viewer.scrollLeft = drag.left - dx;
        viewer.scrollTop = drag.top - dy;
        event.preventDefault();
    });

    viewer.addEventListener("pointerup", finish);
    viewer.addEventListener("pointercancel", finish);
    viewer.addEventListener("pointerleave", finish);
    viewer.ownerDocument.defaultView.addEventListener("blur", () => finish());
    viewer.addEventListener("contextmenu", (event) => {
        if (canPan()) event.preventDefault();
    });
}
