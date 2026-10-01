import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslationTracker } from "../translation.mjs";

const selection = { document: { name: "paper.pdf" }, text: "oscillatory", page: 4 };
const message = (origin, content, extra = {}) => ({
    type: "assistant.message", data: { originatingMessageId: origin, content, ...extra },
});
const idle = { type: "assistant.idle", data: {} };

test("only delivers the matching root translation when its reply completes", async () => {
    const changes = [];
    const tracker = createTranslationTracker({ send: async () => "request-1", onChange: (value) => changes.push(value) });
    try {
        await tracker.start(selection, 2, "translate");
        tracker.acceptEvent(message("unrelated", "secret unrelated reply"));
        tracker.acceptEvent({ ...message("request-1", "subagent"), agentId: "child" });
        tracker.acceptEvent(message("request-1", "analysis", { phase: "analysis" }));
        tracker.acceptEvent(message("request-1", "preamble", { phase: "commentary" }));
        tracker.acceptEvent(idle);
        assert.equal(tracker.get().status, "pending");
        tracker.acceptEvent(message("request-1", "**振荡的**，指振荡周期。"));
        assert.equal(tracker.get().status, "pending");
        tracker.acceptEvent(idle);
        assert.equal(tracker.get().status, "ready");
        assert.equal(tracker.get().text, "**振荡的**，指振荡周期。");
        tracker.acceptEvent(message("request-1", "duplicate"));
        assert.equal(tracker.get().text, "**振荡的**，指振荡周期。");
        assert.ok(!changes.some((value) => value?.text?.includes("secret")));
    } finally { tracker.clear(); }
});

test("accepts task_complete summary and handles a reply arriving before send resolves", async () => {
    let tracker;
    tracker = createTranslationTracker({
        onChange() {},
        send: async () => {
            tracker.acceptEvent(message("fast", "", { phase: "commentary", toolRequests: [
                { name: "functions.task_complete", arguments: { summary: "振荡的" } },
            ] }));
            tracker.acceptEvent(idle);
            return "fast";
        },
    });
    try {
        await tracker.start(selection, 1, "translate");
        assert.equal(tracker.get().text, "振荡的");
        assert.equal(tracker.get().status, "ready");
    } finally { tracker.clear(); }
});

test("ignores replaced requests and clears translation on document changes", async () => {
    let count = 0;
    const tracker = createTranslationTracker({ send: async () => `request-${++count}`, onChange() {} });
    try {
        await tracker.start(selection, 1, "first");
        await tracker.start({ ...selection, text: "kernel" }, 1, "second");
        tracker.acceptEvent(message("request-1", "old translation"));
        tracker.acceptEvent(idle);
        assert.equal(tracker.get().status, "pending");
        tracker.acceptEvent(message("request-2", "卷积核"));
        tracker.acceptEvent(idle);
        assert.equal(tracker.get().text, "卷积核");
        tracker.clear();
        tracker.acceptEvent(message("request-2", "late reply"));
        assert.equal(tracker.get(), null);
    } finally { tracker.clear(); }
});

test("reports send failure, timeout, aborted replies and excessive response size", async () => {
    const failed = createTranslationTracker({ send: async () => { throw new Error("offline"); }, onChange() {} });
    await assert.rejects(failed.start(selection, 1, "translate"), /offline/);
    assert.equal(failed.get().status, "error");
    failed.clear();
    const timed = createTranslationTracker({ send: async () => "slow", onChange() {}, timeoutMs: 10 });
    await timed.start(selection, 1, "translate");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.match(timed.get().error, /超时/);
    timed.clear();
    const tracker = createTranslationTracker({ send: async () => "id", onChange() {} });
    try {
        await tracker.start(selection, 1, "translate");
        tracker.acceptEvent(message("id", "partial"));
        tracker.acceptEvent({ ...idle, data: { aborted: true } });
        assert.match(tracker.get().error, /中止/);
        await tracker.start(selection, 1, "translate");
        tracker.acceptEvent(message("id", "a".repeat(16_001)));
        tracker.acceptEvent(idle);
        assert.match(tracker.get().error, /过长/);
    } finally { tracker.clear(); }
});
