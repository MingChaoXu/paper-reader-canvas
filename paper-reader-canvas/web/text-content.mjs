export async function textContentFor(page) {
    const reader = page.streamTextContent().getReader();
    const content = { items: [], styles: Object.create(null), lang: null };
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            content.lang ??= value.lang;
            Object.assign(content.styles, value.styles);
            content.items.push(...value.items);
        }
    } finally {
        reader.releaseLock();
    }
    return content;
}
