export function pageNumber(value, count) {
    if (!Number.isInteger(count) || count < 1) throw new Error("请先打开 PDF。");
    const text = String(value).trim();
    const number = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || number > count) {
        throw new Error(`请输入 1～${count} 之间的整数页码。`);
    }
    return number;
}

export function visiblePageNumber(viewer, inset = 0) {
    const pages = [...viewer.querySelectorAll(".paper-page")];
    if (!pages.length) return null;
    if (viewer.scrollHeight > viewer.clientHeight &&
        viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 1) {
        return Number(pages.at(-1).dataset.page);
    }
    const top = viewer.getBoundingClientRect().top + viewer.clientTop;
    const line = top + Math.min(viewer.clientHeight / 2, inset + 1);
    let closest = null;
    let distance = Infinity;
    for (const page of pages) {
        const rect = page.getBoundingClientRect();
        const nextDistance = Math.max(rect.top - line, line - rect.bottom, 0);
        if (nextDistance < distance) {
            closest = Number(page.dataset.page);
            distance = nextDistance;
        }
    }
    return closest;
}

export function scrollToPage(viewer, number, inset = 0) {
    const page = viewer.querySelector(`.paper-page[data-page="${number}"]`);
    if (!page) throw new Error("页面尚未准备好，请稍后再试。");
    viewer.scrollTop += page.getBoundingClientRect().top - viewer.getBoundingClientRect().top - viewer.clientTop - inset;
}

export function createPageNavigation({
    viewer, form, input, total, previous, next, submit, onJump, onError,
    topInset = () => 0, requestFrame = requestAnimationFrame,
}) {
    let count = 0;
    let current = 1;
    let ready = false;
    let draft = false;
    let editing = false;
    let frame;

    function refresh() {
        if (ready) current = visiblePageNumber(viewer, topInset()) ?? current;
        if (!draft && !editing) input.value = count ? String(current) : "";
        total.textContent = `/ ${count}`;
        input.max = String(count);
        input.disabled = !ready;
        submit.disabled = !ready;
        previous.disabled = !ready || current <= 1;
        next.disabled = !ready || current >= count;
    }

    function go(value) {
        try {
            const number = pageNumber(value, count);
            if (!ready) throw new Error("页面尚未准备好，请稍后再试。");
            scrollToPage(viewer, number, topInset());
            current = number;
            draft = false;
            input.value = String(number);
            input.removeAttribute("aria-invalid");
            refresh();
            onJump(number);
        } catch (error) {
            input.setAttribute("aria-invalid", "true");
            onError(error.message);
        }
    }

    viewer.addEventListener("scroll", () => {
        if (frame) return;
        frame = requestFrame(() => { frame = undefined; refresh(); });
    }, { passive: true });
    form.addEventListener("submit", (event) => { event.preventDefault(); go(input.value); });
    previous.addEventListener("click", () => go((visiblePageNumber(viewer, topInset()) ?? current) - 1));
    next.addEventListener("click", () => go((visiblePageNumber(viewer, topInset()) ?? current) + 1));
    input.addEventListener("input", () => { draft = true; input.removeAttribute("aria-invalid"); });
    input.addEventListener("focus", () => { editing = true; input.select(); });
    input.addEventListener("blur", () => { editing = false; refresh(); });

    refresh();
    return {
        refresh,
        loading() { ready = false; refresh(); },
        setDocument(pages) {
            count = pages;
            ready = pages > 0;
            if (!pages) {
                current = 1;
                draft = false;
                editing = false;
                input.removeAttribute("aria-invalid");
            }
            refresh();
        },
    };
}
