import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { createReaderServer, ReaderError } from "./server.mjs";

const panels = new Map();
let session;

function panel(instanceId) {
    const entry = panels.get(instanceId);
    if (!entry) throw new CanvasError("reader_not_open", "Open the Paper Reader canvas first.");
    return entry;
}

function asCanvasError(error) {
    if (error instanceof ReaderError) return new CanvasError(error.code, error.message);
    return error;
}

session = await joinSession({
    canvases: [
        createCanvas({
            id: "paper-reader",
            displayName: "Paper Reader",
            description: "Read a local PDF in a canvas; use get_selection to translate or explain text highlighted by the user.",
            inputSchema: {
                anyOf: [
                    {
                        type: "object",
                        properties: { path: { type: "string", description: "Optional local PDF path, relative to the current project or absolute." } },
                        additionalProperties: false,
                    },
                    { type: "null" },
                ],
            },
            actions: [
                {
                    name: "open_document",
                    description: "Open a PDF on this computer, relative to the current project or by absolute path.",
                    inputSchema: {
                        type: "object",
                        properties: { path: { type: "string" } },
                        required: ["path"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        try {
                            return await panel(ctx.instanceId).openDocument(ctx.input.path);
                        } catch (error) {
                            throw asCanvasError(error);
                        }
                    },
                },
                {
                    name: "get_selection",
                    description: "Read the user's latest highlighted PDF text, its page and nearby context; use when asked to translate or explain the selection.",
                    handler: (ctx) => {
                        const selection = panel(ctx.instanceId).getSelection();
                        if (!selection) throw new CanvasError("no_selection", "Select text in the Paper Reader first.");
                        return selection;
                    },
                },
            ],
            open: async (ctx) => {
                let entry = panels.get(ctx.instanceId);
                try {
                    if (!entry) {
                        entry = await createReaderServer({
                            workspaceRoot: process.cwd(),
                            initialPath: ctx.input?.path,
                            send: (options) => session.send(options),
                        });
                        panels.set(ctx.instanceId, entry);
                    } else if (ctx.input?.path) {
                        await entry.openDocument(ctx.input.path);
                    }
                } catch (error) {
                    throw asCanvasError(error);
                }
                return { title: "Paper Reader", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = panels.get(ctx.instanceId);
                if (!entry) return;
                panels.delete(ctx.instanceId);
                await entry.close();
            },
        }),
    ],
});
