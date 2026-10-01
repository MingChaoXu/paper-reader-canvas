import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const windowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Speech
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        if ($request.command -eq 'voices') {
            $voices = @($speech.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
                @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; lang = $_.VoiceInfo.Culture.Name }
            })
            ConvertTo-Json -InputObject $voices -Compress
        } else {
            $speech.SelectVoice([string]$request.voice)
            $speech.Rate = [int]$request.rate
            $speech.SetOutputToWaveFile([string]$request.path)
            $speech.Speak([string]$request.text)
        }
    } finally { $speech.Dispose() }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}`;

function run(command, args, { input = "", signal, timeout = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, signal, stdio: ["pipe", "pipe", "pipe"] });
        const output = [];
        const errors = [];
        let bytes = 0;
        let failure;
        const timer = setTimeout(() => {
            failure = new Error("系统语音生成超时，请缩短文字后重试。");
            child.kill();
        }, timeout);
        child.stdout.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 1_000_000) {
                failure = new Error("系统语音引擎返回的数据过大。");
                child.kill();
            } else output.push(chunk);
        });
        child.stderr.on("data", (chunk) => {
            if (errors.reduce((size, value) => size + value.length, 0) < 16_000) errors.push(chunk);
        });
        child.once("error", (error) => { failure = error; });
        child.once("close", (code) => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0) reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `系统语音进程退出：${code}`));
            else resolve(Buffer.concat(output).toString("utf8"));
        });
        child.stdin.on("error", (error) => {
            if (error.code !== "EPIPE") {
                failure = error;
                child.kill();
            }
        });
        child.stdin.end(input);
    });
}

export function speechText(markdown) {
    return markdown
        .replace(/```[\s\S]*?```/g, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
        .replace(/[*_`$]/g, "")
        .trim();
}

export function createNativeSpeech({ platform = process.platform, execute = run } = {}) {
    let voicesPromise;
    let cache;
    const requests = new Set();
    let closed = false;

    async function voices() {
        voicesPromise ??= (async () => {
            let installed;
            if (platform === "darwin") {
                const output = await execute("/usr/bin/say", ["-v", "?"]);
                installed = output.split("\n").flatMap((line) => {
                    const match = /^(.*?)\s+([a-z]{2,3}_[A-Z]{2})\s+#/.exec(line);
                    return match ? [{ id: match[1].trim(), name: match[1].trim(), lang: match[2].replace("_", "-") }] : [];
                });
            } else if (platform === "win32") {
                installed = JSON.parse(await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript], {
                    input: JSON.stringify({ command: "voices" }),
                }));
                if (!Array.isArray(installed)) installed = [installed];
            } else {
                throw new Error("本地朗读目前支持 macOS 和 Windows；此系统尚未支持。");
            }
            return installed.filter((voice) => typeof voice.id === "string" && typeof voice.lang === "string" && /^(en|zh)(-|$)/i.test(voice.lang));
        })().catch((error) => {
            voicesPromise = undefined;
            throw error;
        });
        return voicesPromise;
    }

    return {
        voices,
        async synthesize({ text, lang, voiceId, rate = 1, signal }) {
            if (closed) throw new Error("朗读服务已关闭。");
            if (typeof text !== "string" || !text.trim() || text.length > 16_000) throw new Error("朗读文字须为 1 至 16,000 个字符。");
            if (!["en", "zh"].includes(lang) || !Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error("朗读语言或语速无效。");
            const installed = (await voices()).filter((voice) => voice.lang.toLowerCase().startsWith(lang));
            const preferred = lang === "zh" ? "Tingting" : "Samantha";
            const voice = voiceId ? installed.find(({ id }) => id === voiceId)
                : installed.find(({ id }) => id === preferred)
                    ?? installed.find(({ lang: locale }) => locale.toLowerCase() === (lang === "zh" ? "zh-cn" : "en-us"))
                    ?? installed[0];
            if (!voice) throw new Error(`没有可用的${lang === "zh" ? "中文" : "英文"}系统声音；请在系统设置中安装相应的语音包。`);
            const key = JSON.stringify([text, voice.id, rate]);
            if (signal?.aborted) throw signal.reason;
            if (cache?.key === key) return cache.bytes;
            const controller = new AbortController();
            const abort = () => controller.abort(signal.reason);
            signal?.addEventListener("abort", abort, { once: true });
            requests.add(controller);
            let dir;
            try {
                dir = await mkdtemp(join(tmpdir(), "paper-reader-speech-"));
                controller.signal.throwIfAborted();
                const path = join(dir, "speech.wav");
                if (platform === "darwin") {
                    await execute("/usr/bin/say", ["-v", voice.id, "-r", String(Math.round(180 * rate)),
                        "--file-format=WAVE", "--data-format=LEI16@22050", "-o", path], {
                        input: text, signal: controller.signal,
                    });
                } else {
                    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript], {
                        input: JSON.stringify({ command: "synthesize", voice: voice.id,
                            text, path, rate: Math.round(Math.log2(rate) * 5) }),
                        signal: controller.signal,
                    });
                }
                const bytes = await readFile(path);
                if (bytes.length > 32_000_000 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
                    throw new Error("系统语音引擎未生成有效的 WAV 音频，或音频过大。");
                }
                if (!closed && !controller.signal.aborted) cache = { key, bytes };
                return bytes;
            } finally {
                requests.delete(controller);
                signal?.removeEventListener("abort", abort);
                if (dir) await rm(dir, { recursive: true, force: true });
            }
        },
        close() {
            closed = true;
            cache = undefined;
            for (const request of requests) request.abort();
        },
    };
}
