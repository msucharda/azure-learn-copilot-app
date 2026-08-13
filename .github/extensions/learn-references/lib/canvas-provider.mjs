import { createServer } from "node:http";
import { assertEvidenceContentHash } from "./content-hash.mjs";
import {
    REFERENCE_CANVAS_CSS,
    REFERENCE_CANVAS_HTML,
    REFERENCE_CANVAS_JS,
} from "./canvas-renderer.mjs";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_STATE_BYTES = 4_000_000;
const MAX_SSE_CLIENTS = 8;
const HEARTBEAT_MS = 25_000;
const MAX_REQUEST_BODY_BYTES = 256;

export const LEARN_REFERENCES_CANVAS_ID = "learn-references";

export const LEARN_REFERENCES_INPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        researchId: {
            type: "string",
            minLength: 36,
            maxLength: 36,
            pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        },
        version: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
        },
        view: {
            type: "string",
            enum: ["draft", "published"],
        },
    },
    required: ["researchId", "view"],
};

export const REFRESH_ACTION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {},
};

function fail(CanvasError, code, message) {
    throw new CanvasError(code, message);
}

function validateSelector(input, CanvasError) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        fail(CanvasError, "invalid_reference_input", "Reference input must be an object.");
    }
    const keys = Object.keys(input);
    if (keys.some((key) => !["researchId", "version", "view"].includes(key))) {
        fail(CanvasError, "invalid_reference_input", "Reference input contains an unknown property.");
    }
    if (typeof input.researchId !== "string" || !UUID_V4.test(input.researchId)) {
        fail(CanvasError, "invalid_reference_input", "researchId must be a lowercase UUID v4.");
    }
    if (
        input.version !== undefined
        && (!Number.isSafeInteger(input.version) || input.version < 1)
    ) {
        fail(CanvasError, "invalid_reference_input", "version must be a positive safe integer.");
    }
    if (!["draft", "published"].includes(input.view)) {
        fail(CanvasError, "invalid_reference_input", "view must be draft or published.");
    }
    return {
        researchId: input.researchId,
        ...(input.version === undefined ? {} : { version: input.version }),
        view: input.view,
    };
}

function safeLearnUrl(value) {
    const parsed = new URL(value);
    if (
        parsed.protocol !== "https:"
        || parsed.hostname !== "learn.microsoft.com"
        || parsed.username
        || parsed.password
        || parsed.port
    ) {
        throw new Error("Unsafe Microsoft Learn URL");
    }
    return parsed.href;
}

function projectBundle(bundle, view) {
    const sources = bundle.sources.map((source) => ({
        id: source.id,
        title: source.title,
        canonicalUrl: safeLearnUrl(source.canonicalUrl),
        sectionHeading: source.sectionHeading,
        exactExcerpt: source.exactExcerpt,
    }));
    const projected = {
        researchId: bundle.researchId,
        version: bundle.version,
        view,
        status: bundle.status,
        sources,
    };
    if (Buffer.byteLength(JSON.stringify(projected)) > MAX_STATE_BYTES) {
        throw new Error("Canvas evidence exceeds the bounded display size.");
    }
    return projected;
}

function publicError(error) {
    const code = (
        error
        && typeof error === "object"
        && typeof error.code === "string"
        && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ) ? error.code : "REFERENCE_UNAVAILABLE";
    return {
        code,
        message: "The requested evidence record is missing, incomplete, or failed integrity validation.",
    };
}

function sendJson(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
    });
    res.end(body);
}

function sendAsset(res, contentType, body, csp) {
    res.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-security-policy": csp,
        "content-type": contentType,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
    });
    res.end(body);
}

async function readSmallJson(req) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_REQUEST_BODY_BYTES) {
            throw new Error("Request body is too large.");
        }
        chunks.push(chunk);
    }
    if (length === 0) {
        return {};
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateRefreshInput(input) {
    if (
        !input
        || typeof input !== "object"
        || Array.isArray(input)
        || Object.keys(input).length !== 0
    ) {
        throw new Error("Invalid refresh input.");
    }
}

function writeSse(entry, client, message) {
    if (client.destroyed || client.writableEnded) {
        entry.clients.delete(client);
        return false;
    }
    try {
        if (client.write(message)) {
            return true;
        }
    } catch {
        // The client is evicted below.
    }
    entry.clients.delete(client);
    client.destroy();
    return false;
}

export function createLearnReferencesCanvas({
    createCanvas,
    CanvasError,
    draftStore,
    publishedStore,
    heartbeatMs = HEARTBEAT_MS,
}) {
    const instances = new Map();
    const instanceLocks = new Map();

    async function withInstanceLock(instanceId, callback) {
        const previous = instanceLocks.get(instanceId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        instanceLocks.set(instanceId, current);
        await previous;
        try {
            return await callback();
        } finally {
            release();
            if (instanceLocks.get(instanceId) === current) {
                instanceLocks.delete(instanceId);
            }
        }
    }

    async function load(entry) {
        const { researchId, version, view } = entry.selector;
        let bundle;
        if (view === "draft") {
            bundle = version === undefined
                ? await draftStore.getLatest(researchId)
                : await draftStore.readBundle(researchId, version);
            bundle = assertEvidenceContentHash(bundle);
            if (bundle.status === "published" || bundle.status === "superseded") {
                throw new Error("Published evidence cannot be served as a draft.");
            }
        } else {
            bundle = version === undefined
                ? await publishedStore.getLatest(researchId)
                : await publishedStore.get(researchId, version);
            if (bundle.status !== "published" && bundle.status !== "superseded") {
                throw new Error("Only committed evidence can be served as published.");
            }
        }
        return projectBundle(bundle, view);
    }

    function broadcast(entry) {
        entry.revision += 1;
        const message = `event: refresh\ndata: ${JSON.stringify({ revision: entry.revision })}\n\n`;
        for (const client of entry.clients) {
            writeSse(entry, client, message);
        }
    }

    async function startServer(instanceId, selector) {
        const sockets = new Set();
        const entry = {
            clients: new Set(),
            heartbeat: undefined,
            instanceId,
            revision: 0,
            selector,
            server: undefined,
            sockets,
            url: undefined,
        };
        const csp = [
            "default-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            "connect-src 'self'",
            "img-src 'none'",
            "font-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
        ].join("; ");
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url ?? "/", "http://127.0.0.1");
                if (req.method === "GET" && url.pathname === "/") {
                    sendAsset(res, "text/html; charset=utf-8", REFERENCE_CANVAS_HTML, csp);
                    return;
                }
                if (req.method === "GET" && url.pathname === "/app.css") {
                    sendAsset(res, "text/css; charset=utf-8", REFERENCE_CANVAS_CSS, csp);
                    return;
                }
                if (req.method === "GET" && url.pathname === "/app.js") {
                    sendAsset(res, "text/javascript; charset=utf-8", REFERENCE_CANVAS_JS, csp);
                    return;
                }
                if (req.method === "GET" && url.pathname === "/state") {
                    sendJson(res, 200, await load(entry));
                    return;
                }
                if (req.method === "GET" && url.pathname === "/events") {
                    if (entry.clients.size >= MAX_SSE_CLIENTS) {
                        sendJson(res, 503, { error: { code: "SSE_LIMIT", message: "Refresh client limit reached." } });
                        return;
                    }
                    res.writeHead(200, {
                        "cache-control": "no-cache, no-store",
                        "connection": "keep-alive",
                        "content-type": "text/event-stream; charset=utf-8",
                        "x-accel-buffering": "no",
                        "x-content-type-options": "nosniff",
                    });
                    entry.clients.add(res);
                    writeSse(
                        entry,
                        res,
                        `event: ready\ndata: ${JSON.stringify({ revision: entry.revision })}\n\n`,
                    );
                    req.on("close", () => entry.clients.delete(res));
                    return;
                }
                if (req.method === "POST" && url.pathname === "/refresh") {
                    validateRefreshInput(await readSmallJson(req));
                    await load(entry);
                    broadcast(entry);
                    sendJson(res, 200, { refreshed: true, revision: entry.revision });
                    return;
                }
                sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Canvas route not found." } });
            } catch (error) {
                sendJson(res, 422, { error: publicError(error) });
            }
        });
        server.on("connection", (socket) => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
        });
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            await new Promise((resolve) => server.close(resolve));
            throw new Error("Canvas server did not receive a loopback port.");
        }
        entry.server = server;
        entry.url = `http://127.0.0.1:${address.port}/`;
        entry.heartbeat = setInterval(() => {
            for (const client of entry.clients) {
                writeSse(entry, client, ": heartbeat\n\n");
            }
        }, heartbeatMs);
        entry.heartbeat.unref();
        return entry;
    }

    async function closeEntry(entry) {
        clearInterval(entry.heartbeat);
        for (const client of entry.clients) {
            client.end();
        }
        entry.clients.clear();
        await new Promise((resolve) => {
            entry.server.close(() => resolve());
            for (const socket of entry.sockets) {
                socket.destroy();
            }
        });
    }

    const canvas = createCanvas({
        id: LEARN_REFERENCES_CANVAS_ID,
        displayName: "Microsoft Learn references",
        description: "Inspect bounded Microsoft Learn source excerpts for a research answer.",
        inputSchema: LEARN_REFERENCES_INPUT_SCHEMA,
        actions: [
            {
                name: "refresh",
                description: "Reload the current evidence record and repaint the open reference",
                inputSchema: REFRESH_ACTION_SCHEMA,
                handler: async (ctx) => {
                    const entry = instances.get(ctx.instanceId);
                    if (!entry) {
                        fail(CanvasError, "reference_instance_not_open", "The reference canvas instance is not open.");
                    }
                    try {
                        validateRefreshInput(ctx.input);
                        const state = await load(entry);
                        broadcast(entry);
                        return {
                            researchId: state.researchId,
                            version: state.version,
                            view: state.view,
                            status: state.status,
                            revision: entry.revision,
                        };
                    } catch (error) {
                        if (error instanceof Error && error.message === "Invalid refresh input.") {
                            fail(CanvasError, "invalid_refresh_input", "Refresh input must be an empty object.");
                        }
                        const visible = publicError(error);
                        fail(CanvasError, visible.code.toLowerCase(), visible.message);
                    }
                },
            },
        ],
        open: async (ctx) => withInstanceLock(ctx.instanceId, async () => {
            const selector = validateSelector(ctx.input, CanvasError);
            let entry = instances.get(ctx.instanceId);
            try {
                if (entry) {
                    const previousSelector = entry.selector;
                    entry.selector = selector;
                    try {
                        await load(entry);
                    } catch (error) {
                        entry.selector = previousSelector;
                        throw error;
                    }
                    broadcast(entry);
                } else {
                    const pending = { selector };
                    await load(pending);
                    entry = await startServer(ctx.instanceId, selector);
                    instances.set(ctx.instanceId, entry);
                }
                const state = await load(entry);
                return {
                    title: `Microsoft Learn references · v${state.version}`,
                    status: `${state.view} · ${state.status}`,
                    url: entry.url,
                };
            } catch (error) {
                const visible = publicError(error);
                fail(CanvasError, visible.code.toLowerCase(), visible.message);
            }
        }),
        onClose: async (ctx) => withInstanceLock(ctx.instanceId, async () => {
            const entry = instances.get(ctx.instanceId);
            if (!entry) {
                return;
            }
            instances.delete(ctx.instanceId);
            await closeEntry(entry);
        }),
    });

    return {
        canvas,
        closeAll: async () => {
            const entries = [...instances.values()];
            instances.clear();
            await Promise.all(entries.map(closeEntry));
        },
        instanceCount: () => instances.size,
    };
}
