export const minZoom = 0.5;
export const maxZoom = 3;

export function wheelPixels(event, viewportHeight) {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
    const delta = event.shiftKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX : event.deltaY;
    return delta * unit;
}

export function wheelZoom(current, delta) {
    const factor = Math.exp(Math.max(-0.3, Math.min(0.3, -delta * 0.0015)));
    return Math.max(minZoom, Math.min(maxZoom, current * factor));
}

export function pageAnchor(viewer, clientX, clientY) {
    let closest;
    let distance = Infinity;
    for (const page of viewer.querySelectorAll(".paper-page")) {
        const rect = page.getBoundingClientRect();
        const x = Math.max(rect.left, Math.min(clientX, rect.right));
        const y = Math.max(rect.top, Math.min(clientY, rect.bottom));
        const squared = (clientX - x) ** 2 + (clientY - y) ** 2;
        if (squared < distance) {
            closest = { page, rect, x, y };
            distance = squared;
        }
    }
    if (!closest) return null;
    return {
        number: Number(closest.page.dataset.page),
        x: (closest.x - closest.rect.left) / closest.rect.width,
        y: (closest.y - closest.rect.top) / closest.rect.height,
        clientX,
        clientY,
    };
}

export function restoreAnchor(viewer, anchor) {
    if (!anchor) return;
    const page = viewer.querySelector(`.paper-page[data-page="${anchor.number}"]`);
    if (!page) return;
    const rect = page.getBoundingClientRect();
    viewer.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX;
    viewer.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY;
}
