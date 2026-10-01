import { randomUUID } from "node:crypto";

export function createTranslationTracker({ send, onChange, timeoutMs = 180_000 }) {
    let current = null;
    let timer;
    let submitting = false;
    let buffered = [];
    let candidate = "";

    function finish(status, text = "", error = "") {
        clearTimeout(timer);
        current = { ...current, status, text, error };
        onChange(current);
    }

    function clear() {
        clearTimeout(timer);
        current = null;
        candidate = "";
        buffered = [];
        submitting = false;
        onChange(null);
    }

    function acceptEvent(event) {
        if (!current || current.status !== "pending" || event.agentId || event.data?.parentToolCallId) return;
        if (submitting) {
            if (buffered.length < 64) buffered.push(event);
            return;
        }
        const data = event.data || {};
        if (event.type === "assistant.message" && data.originatingMessageId === current.messageId) {
            const completion = data.toolRequests?.find((tool) => /(^|\.)task_complete$/.test(tool.name));
            const content = completion?.arguments?.summary ?? (!data.toolRequests?.length ? data.content : "");
            if (typeof content === "string" && content.trim() &&
                (completion || !["analysis", "commentary"].includes(data.phase))) {
                candidate = content.trim();
            }
        } else if ((event.type === "assistant.idle" || event.type === "session.idle") && candidate) {
            if (data.aborted) finish("error", "", "翻译已中止，请重新点击翻译。");
            else if (candidate.length > 16_000) finish("error", "", "译文过长；请缩小选区后重新翻译。");
            else finish("ready", candidate);
        } else if (event.type === "session.error" && candidate) {
            finish("error", "", `翻译失败：${data.message}`);
        }
    }

    return {
        get: () => current,
        clear,
        acceptEvent,
        async start(selection, version, prompt) {
            clear();
            const translation = {
                id: randomUUID(), version, status: "pending", text: "", error: "",
                selection, messageId: null,
            };
            current = translation;
            submitting = true;
            onChange(current);
            timer = setTimeout(() => {
                if (current?.id === translation.id) {
                    finish("error", "", "等待译文超时，或客户端未提供可关联的回复；请重新翻译并检查 Copilot 版本。");
                }
            }, timeoutMs);
            timer.unref?.();
            try {
                const messageId = await send({
                    prompt,
                    displayPrompt: `翻译 ${selection.document.name} 第 ${selection.page} 页选区：“${selection.text.slice(0, 80)}”`,
                });
                if (current?.id === translation.id && current.status === "pending") {
                    current = { ...current, messageId };
                    submitting = false;
                    const events = buffered;
                    buffered = [];
                    for (const event of events) acceptEvent(event);
                    onChange(current);
                }
                return { messageId, translationId: translation.id };
            } catch (error) {
                if (current?.id === translation.id) finish("error", "", `发送翻译请求失败：${error.message}`);
                throw error;
            }
        },
    };
}
