function silentAudio() {
    const sampleBytes = 4410;
    const bytes = new Uint8Array(44 + sampleBytes);
    const view = new DataView(bytes.buffer);
    const write = (offset, value) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
    write(0, "RIFF"); view.setUint32(4, 36 + sampleBytes, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 22050, true); view.setUint32(28, 44100, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, sampleBytes, true);
    return new Blob([bytes], { type: "audio/wav" });
}

export function createAudioPlayer({ audio, fetchAudio, onState, onStatus, urls = URL }) {
    let generation = 0;
    let controller;
    let source;
    let busy = false;
    let playing = false;

    function release() {
        if (source) urls.revokeObjectURL(source);
        source = undefined;
    }

    function stop() {
        generation++;
        controller?.abort();
        controller = undefined;
        audio.pause();
        audio.removeAttribute("src");
        release();
        busy = false;
        playing = false;
        onState("idle");
    }

    audio.addEventListener("ended", () => {
        if (!playing) return;
        busy = false;
        playing = false;
        onState("idle");
        onStatus("朗读结束。");
    });
    audio.addEventListener("error", () => {
        if (!busy || !audio.error) return;
        const details = audio.error.message || `错误 ${audio.error.code}`;
        stop();
        onStatus(`音频播放失败：${details}。请重试或检查系统声音设置。`, true);
    });

    return {
        stop,
        async unlock() {
            stop();
            source = urls.createObjectURL(silentAudio());
            audio.src = source;
            try {
                await audio.play();
                return true;
            } catch (error) {
                onStatus(`无法开启自动朗读：${error.message}。请点击“朗读译文”手动播放。`, true);
                return false;
            }
        },
        async play(options, { automatic = false } = {}) {
            stop();
            const run = generation;
            controller = new AbortController();
            const signal = controller.signal;
            busy = true;
            onState("preparing");
            onStatus("正在生成本地语音…");
            let unlocked;
            if (!automatic) {
                source = urls.createObjectURL(silentAudio());
                audio.src = source;
                unlocked = audio.play();
            }
            try {
                if (unlocked) await unlocked;
                const blob = await fetchAudio(options, signal);
                if (run !== generation) return false;
                audio.pause();
                release();
                source = urls.createObjectURL(blob);
                audio.src = source;
                await audio.play();
                if (run !== generation) return false;
                playing = true;
                onState("playing");
                onStatus("正在朗读…");
                return true;
            } catch (error) {
                if (run !== generation) return false;
                stop();
                onStatus(error.name === "NotAllowedError"
                    ? "浏览器阻止了自动播放，请点击“朗读译文”。"
                    : `朗读失败：${error.message}`, true);
                return false;
            }
        },
    };
}

export function createTranslationView({ render, read, stop, autoRead }) {
    let latest;
    const heard = new Set();
    return {
        update(translation, version, { live = false } = {}) {
            if (translation?.version !== version) translation = null;
            if (latest?.id !== translation?.id) stop();
            latest = translation;
            render(translation);
            if (live && translation?.status === "ready" && !heard.has(translation.id)) {
                heard.add(translation.id);
                if (heard.size > 100) heard.delete(heard.values().next().value);
                if (autoRead()) read(translation);
            }
        },
        get: () => latest,
    };
}
