import assert from "node:assert/strict";
import { test } from "node:test";
import {
    connectionClosedMessage,
    monitorConnection,
    reconnectingMessage,
    reconnectTimeoutMessage,
} from "../web/connection.mjs";

test("transient SSE error retries, clears its warning and resyncs on reopen", () => {
    const source = new EventTarget();
    source.readyState = 1;
    const statuses = [];
    const timers = new Map();
    let nextTimer = 0;
    let documents = 0;
    let reconnects = 0;
    monitorConnection(source, {
        onDocument: () => documents++,
        onReconnect: () => reconnects++,
        onStatus: (message, error) => statuses.push({ message, error }),
    }, {
        setTimer: (callback) => {
            const id = ++nextTimer;
            timers.set(id, () => {
                timers.delete(id);
                callback();
            });
            return id;
        },
        clearTimer: (id) => timers.delete(id),
    });

    source.dispatchEvent(new Event("open"));
    assert.equal(reconnects, 0);
    source.dispatchEvent(new Event("document"));
    assert.equal(documents, 1);

    source.readyState = 0;
    source.dispatchEvent(new Event("error"));
    assert.deepEqual(statuses.at(-1), { message: reconnectingMessage, error: false });
    assert.equal(timers.size, 1);
    const timeout = [...timers.values()][0];
    timeout();
    assert.deepEqual(statuses.at(-1), { message: reconnectTimeoutMessage, error: true });

    source.readyState = 1;
    source.dispatchEvent(new Event("open"));
    assert.equal(reconnects, 1);
    assert.equal(timers.size, 0);
    source.readyState = 0;
    source.dispatchEvent(new Event("error"));
    source.readyState = 1;
    source.dispatchEvent(new Event("open"));
    assert.equal(reconnects, 2);
    assert.equal(timers.size, 0);
});

test("a permanently closed stream reports a real error", () => {
    const source = new EventTarget();
    source.readyState = 2;
    const statuses = [];
    monitorConnection(source, {
        onDocument: () => {},
        onReconnect: () => {},
        onStatus: (message, error) => statuses.push({ message, error }),
    });
    source.dispatchEvent(new Event("error"));
    assert.deepEqual(statuses, [{ message: connectionClosedMessage, error: true }]);
});
