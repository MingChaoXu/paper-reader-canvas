import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createNativeSpeech, speechText } from "../native-speech.mjs";
import { createAudioPlayer, createTranslationView } from "../web/speech.mjs";

function wave() {
    const bytes = Buffer.alloc(46);
    bytes.write("RIFF", 0); bytes.write("WAVE", 8);
    return bytes;
}

test("uses native macOS voices, passes text as stdin, caches audio and removes temporary files", async () => {
    const calls = [];
    const speech = createNativeSpeech({
        platform: "darwin",
        execute: async (command, args, options) => {
            calls.push({ command, args, options });
            if (args[1] === "?") return "Samantha           en_US    # Hello\nTingting           zh_CN    # Hello\nBad News           en_US    # Hello\nAlice              it_IT    # Hello\n";
            await writeFile(args[args.indexOf("-o") + 1], wave());
            return "";
        },
    });
    try {
        const voices = await speech.voices();
        assert.deepEqual(voices.map(({ id }) => id), ["Samantha", "Tingting", "Bad News"]);
        const text = 'oscillatory; $(not-a-command) "--file"';
        const bytes = await speech.synthesize({ text, lang: "en", rate: 1.25 });
        assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
        assert.equal(calls[1].options.input, text);
        assert.equal(calls[1].args.includes(text), false);
        assert.equal(calls[1].args[calls[1].args.indexOf("-r") + 1], "225");
        await assert.rejects(access(calls[1].args[calls[1].args.indexOf("-o") + 1]), { code: "ENOENT" });
        await speech.synthesize({ text, lang: "en", rate: 1.25 });
        assert.equal(calls.length, 2);
        await assert.rejects(speech.synthesize({ text, lang: "en", voiceId: "Unknown" }), /没有可用/);
        await assert.rejects(speech.synthesize({ text, lang: "en", rate: 3 }), /无效/);
    } finally { speech.close(); }
});

test("Windows speech uses a fixed script and JSON stdin without interpolating text or voice names", async () => {
    const calls = [];
    const id = 'Chinese "voice"';
    const speech = createNativeSpeech({
        platform: "win32",
        execute: async (command, args, { input }) => {
            const request = JSON.parse(input);
            calls.push({ command, args, request });
            if (request.command === "voices") return JSON.stringify([{ id, name: id, lang: "zh-CN" }]);
            await writeFile(request.path, wave());
            return "";
        },
    });
    try {
        await speech.synthesize({ text: "振荡的\n$notCode", lang: "zh", voiceId: id, rate: 0.5 });
        assert.equal(calls[1].command, "powershell.exe");
        assert.deepEqual(calls[1].args, calls[0].args);
        assert.equal(calls[1].request.rate, -5);
        assert.equal(calls[1].request.text, "振荡的\n$notCode");
        assert.equal(calls[1].request.voice, id);
    } finally { speech.close(); }
});

test("unsupported systems, missing voices, bad WAV and cancellation fail explicitly", async () => {
    await assert.rejects(createNativeSpeech({ platform: "linux" }).voices(), /尚未支持/);
    const empty = createNativeSpeech({ platform: "win32", execute: async () => "[]" });
    await assert.rejects(empty.synthesize({ text: "word", lang: "en" }), /语音包/);
    const speech = createNativeSpeech({
        platform: "darwin",
        execute: async (command, args) => {
            if (args[1] === "?") return "Samantha en_US # Hello";
            await writeFile(args[args.indexOf("-o") + 1], "not audio");
            return "";
        },
    });
    try {
        await assert.rejects(speech.synthesize({ text: "word", lang: "en" }), /有效的 WAV/);
        const controller = new AbortController();
        controller.abort(new Error("cancelled"));
        await assert.rejects(speech.synthesize({ text: "word", lang: "en", signal: controller.signal }), /cancelled/);
    } finally { speech.close(); empty.close(); }
});

test("speech text removes Markdown scaffolding while preserving translated prose", () => {
    assert.equal(speechText("### 翻译\n**振荡的**（oscillatory）。[说明](https://example.test)\n```js\nprivate code\n```"),
        "翻译\n振荡的（oscillatory）。说明");
});

function playerFixture() {
    const handlers = new Map();
    const statuses = [];
    const states = [];
    const requests = [];
    let next = 0;
    const audio = {
        addEventListener: (event, handler) => handlers.set(event, handler),
        pause() {}, removeAttribute() {},
        play: async () => {},
    };
    const player = createAudioPlayer({
        audio,
        urls: { createObjectURL: () => `blob:${++next}`, revokeObjectURL() {} },
        fetchAudio: async (options, signal) => { requests.push({ options, signal }); return new Blob(["audio"]); },
        onState: (state) => states.push(state),
        onStatus: (message, error) => statuses.push({ message, error }),
    });
    return { player, audio, handlers, statuses, states, requests };
}

test("local audio playback supports replay, stop and visible autoplay errors", async () => {
    const { player, audio, handlers, states, statuses, requests } = playerFixture();
    assert.equal(await player.unlock(), true);
    assert.equal(await player.play({ kind: "translation" }, { automatic: true }), true);
    assert.equal(states.at(-1), "playing");
    handlers.get("ended")();
    assert.equal(states.at(-1), "idle");
    assert.equal(await player.play({ kind: "selection" }), true);
    player.stop();
    assert.equal(requests.at(-1).signal.aborted, true);
    audio.play = async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); };
    assert.equal(await player.play({ kind: "translation" }, { automatic: true }), false);
    assert.equal(statuses.at(-1).error, true);
    assert.match(statuses.at(-1).message, /阻止/);
});

test("stopping pending audio prevents a late download from playing", async () => {
    const audio = { addEventListener() {}, pause() {}, removeAttribute() {}, play: async () => {} };
    let resolve;
    const player = createAudioPlayer({
        audio, urls: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
        fetchAudio: () => new Promise((done) => { resolve = done; }), onState() {}, onStatus() {},
    });
    const pending = player.play({}, { automatic: true });
    player.stop();
    resolve(new Blob(["audio"]));
    assert.equal(await pending, false);
});

test("automatic reading only plays fresh live translations, never reconnect snapshots or other PDFs", () => {
    const read = [];
    let enabled = true;
    const view = createTranslationView({ render() {}, stop() {}, read: (translation) => read.push(translation.id), autoRead: () => enabled });
    const ready = { id: "1", version: 2, status: "ready", text: "振荡的" };
    view.update(ready, 2);
    assert.deepEqual(read, []);
    view.update(ready, 2, { live: true });
    view.update(ready, 2, { live: true });
    assert.deepEqual(read, ["1"]);
    view.update({ ...ready, id: "old-pdf", version: 1 }, 2, { live: true });
    assert.equal(view.get(), null);
    enabled = false;
    view.update({ ...ready, id: "off" }, 2, { live: true });
    enabled = true;
    view.update({ ...ready, id: "off" }, 2, { live: true });
    assert.deepEqual(read, ["1"]);
});
