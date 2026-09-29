export const reconnectingMessage = "连接暂时中断，正在自动重连…";
export const reconnectTimeoutMessage = "连接尚未恢复；请重新打开 Canvas，或等待自动重连。";
export const connectionClosedMessage = "连接已关闭；请重新打开 Canvas。";

export function monitorConnection(source, { onDocument, onReconnect, onStatus }, {
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    timeout = 20_000,
} = {}) {
    let disconnected = false;
    let timer;

    source.addEventListener("document", onDocument);
    source.addEventListener("error", () => {
        disconnected = true;
        if (timer) clearTimer(timer);
        if (source.readyState === 2) {
            onStatus(connectionClosedMessage, true);
            return;
        }
        onStatus(reconnectingMessage, false);
        timer = setTimer(() => {
            timer = undefined;
            if (disconnected && source.readyState !== 1) {
                onStatus(reconnectTimeoutMessage, true);
            }
        }, timeout);
    });
    source.addEventListener("open", () => {
        if (!disconnected) return;
        disconnected = false;
        if (timer) clearTimer(timer);
        timer = undefined;
        onReconnect();
    });
}
