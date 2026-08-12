const DEFAULT_ENDPOINT = "https://learn.microsoft.com/api/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const MAX_PROTOCOL_BODY_LENGTH = 1_000_000;
const MAX_DISCOVERED_TOOLS = 100;
const MAX_TOOLS_LIST_PAGES = 20;

export class LearnMcpTransportError extends Error {
    constructor(code, message, { cause, status, details } = {}) {
        super(message, { cause });
        this.name = "LearnMcpTransportError";
        this.code = code;
        if (status !== undefined) {
            this.status = status;
        }
        if (details !== undefined) {
            this.details = details;
        }
    }
}

function transportFail(code, message, options) {
    throw new LearnMcpTransportError(code, message, options);
}

function parseJson(text, context) {
    try {
        return JSON.parse(text);
    } catch (cause) {
        transportFail("MALFORMED_PROTOCOL_JSON", `${context} is not valid JSON`, {
            cause,
            details: { preview: text.slice(0, 300) },
        });
    }
}

function parseEventStream(text, requestId) {
    const messages = [];
    for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
        if (data) {
            messages.push(parseJson(data, "MCP event data"));
        }
    }
    const response = messages.find((message) => message?.id === requestId);
    if (!response) {
        transportFail(
            "MISSING_PROTOCOL_RESPONSE",
            `MCP event stream has no response for request ${requestId}`,
        );
    }
    return response;
}

function protocolResponse(text, contentType, requestId) {
    if (contentType.includes("text/event-stream")) {
        return parseEventStream(text, requestId);
    }
    const value = parseJson(text, "MCP response");
    if (Array.isArray(value)) {
        const response = value.find((entry) => entry?.id === requestId);
        if (!response) {
            transportFail(
                "MISSING_PROTOCOL_RESPONSE",
                `MCP batch response has no response for request ${requestId}`,
            );
        }
        return response;
    }
    return value;
}

async function readBoundedResponse(response) {
    const declaredLength = Number.parseInt(
        response.headers.get("content-length") ?? "",
        10,
    );
    if (
        Number.isFinite(declaredLength)
        && declaredLength > MAX_PROTOCOL_BODY_LENGTH
    ) {
        transportFail(
            "PROTOCOL_BODY_TOO_LARGE",
            `Microsoft Learn MCP response exceeds ${MAX_PROTOCOL_BODY_LENGTH} bytes`,
            { status: response.status },
        );
    }
    if (!response.body) {
        return "";
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        size += value.byteLength;
        if (size > MAX_PROTOCOL_BODY_LENGTH) {
            await reader.cancel();
            transportFail(
                "PROTOCOL_BODY_TOO_LARGE",
                `Microsoft Learn MCP response exceeds ${MAX_PROTOCOL_BODY_LENGTH} bytes`,
                { status: response.status },
            );
        }
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
}

export class LearnMcpHttpTransport {
    constructor({
        endpoint = DEFAULT_ENDPOINT,
        fetchImplementation = globalThis.fetch,
        timeoutMs = 30_000,
    } = {}) {
        if (typeof fetchImplementation !== "function") {
            throw new TypeError("LearnMcpHttpTransport requires a fetch implementation");
        }
        const url = new URL(endpoint);
        if (
            url.protocol !== "https:"
            || url.hostname !== "learn.microsoft.com"
            || url.username
            || url.password
            || url.port
        ) {
            throw new TypeError(
                "Learn MCP endpoint must use HTTPS on the exact learn.microsoft.com host",
            );
        }
        this.endpoint = url.toString();
        this.fetchImplementation = fetchImplementation;
        this.timeoutMs = timeoutMs;
        this.requestId = 0;
        this.sessionId = null;
        this.connected = false;
    }

    headers() {
        const headers = {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": PROTOCOL_VERSION,
        };
        if (this.sessionId) {
            headers["mcp-session-id"] = this.sessionId;
        }
        return headers;
    }

    async post(payload, { notification = false } = {}) {
        let response;
        try {
            response = await this.fetchImplementation(this.endpoint, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(payload),
                redirect: "error",
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (cause) {
            transportFail("PROTOCOL_FAILURE", "Microsoft Learn MCP request failed", {
                cause,
            });
        }
        if (response.redirected) {
            transportFail(
                "UNSAFE_PROTOCOL_REDIRECT",
                "Microsoft Learn MCP responses cannot be redirected",
                { status: response.status },
            );
        }
        if (response.url) {
            const responseUrl = new URL(response.url);
            const endpointUrl = new URL(this.endpoint);
            if (
                responseUrl.protocol !== endpointUrl.protocol
                || responseUrl.hostname !== endpointUrl.hostname
                || responseUrl.port !== endpointUrl.port
            ) {
                transportFail(
                    "UNSAFE_PROTOCOL_REDIRECT",
                    "Microsoft Learn MCP response resolved outside the configured origin",
                    { status: response.status },
                );
            }
        }
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) {
            this.sessionId = sessionId;
        }
        let text;
        try {
            text = await readBoundedResponse(response);
        } catch (cause) {
            if (cause instanceof LearnMcpTransportError) {
                throw cause;
            }
            transportFail("PROTOCOL_FAILURE", "Microsoft Learn MCP response stream failed", {
                cause,
                status: response.status,
            });
        }
        if (!response.ok) {
            transportFail(
                "PROTOCOL_HTTP_ERROR",
                `Microsoft Learn MCP returned HTTP ${response.status}`,
                {
                    status: response.status,
                    details: { preview: text.slice(0, 300) },
                },
            );
        }
        if (notification && !text) {
            return undefined;
        }
        if (!text) {
            transportFail("EMPTY_PROTOCOL_RESPONSE", "Microsoft Learn MCP returned an empty body");
        }
        const message = protocolResponse(
            text,
            response.headers.get("content-type") ?? "",
            payload.id,
        );
        if (message?.jsonrpc !== "2.0" || message?.id !== payload.id) {
            transportFail(
                "MISMATCHED_PROTOCOL_RESPONSE",
                `Microsoft Learn MCP response does not match request ${payload.id}`,
                {
                    details: {
                        responseId: message?.id,
                        jsonrpc: message?.jsonrpc,
                    },
                },
            );
        }
        if (message?.error !== undefined) {
            transportFail("JSON_RPC_ERROR", "Microsoft Learn MCP returned a JSON-RPC error", {
                details: message.error,
            });
        }
        if (!Object.hasOwn(message ?? {}, "result")) {
            transportFail(
                "MALFORMED_PROTOCOL_RESPONSE",
                "Microsoft Learn MCP response does not contain a result",
            );
        }
        return message.result;
    }

    async request(method, params = {}) {
        this.requestId += 1;
        return this.post({
            jsonrpc: "2.0",
            id: this.requestId,
            method,
            params,
        });
    }

    async notify(method, params = {}) {
        return this.post({
            jsonrpc: "2.0",
            method,
            params,
        }, { notification: true });
    }

    async connect() {
        const initialization = await this.request("initialize", {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: "learn-references-extension",
                version: "1.0.0",
            },
        });
        if (
            !initialization
            || typeof initialization !== "object"
            || typeof initialization.protocolVersion !== "string"
        ) {
            transportFail(
                "INVALID_INITIALIZATION",
                "Microsoft Learn MCP returned invalid initialization metadata",
            );
        }
        await this.notify("notifications/initialized");
        this.connected = true;
        return initialization;
    }

    assertConnected() {
        if (!this.connected) {
            transportFail("NOT_CONNECTED", "Microsoft Learn MCP transport is not connected");
        }
    }

    async listTools() {
        this.assertConnected();
        const tools = [];
        const seenCursors = new Set();
        let pages = 0;
        let cursor;
        do {
            pages += 1;
            if (pages > MAX_TOOLS_LIST_PAGES) {
                transportFail(
                    "TOO_MANY_TOOL_PAGES",
                    `Microsoft Learn MCP tools/list exceeded ${MAX_TOOLS_LIST_PAGES} pages`,
                );
            }
            if (cursor !== undefined) {
                if (seenCursors.has(cursor)) {
                    transportFail(
                        "REPEATED_TOOLS_CURSOR",
                        "Microsoft Learn MCP repeated a tools/list cursor",
                    );
                }
                seenCursors.add(cursor);
            }
            const result = await this.request("tools/list", cursor ? { cursor } : {});
            if (!result || typeof result !== "object" || !Array.isArray(result.tools)) {
                transportFail(
                    "INVALID_TOOLS_LIST",
                    "Microsoft Learn MCP tools/list result is malformed",
                );
            }
            tools.push(...result.tools);
            if (tools.length > MAX_DISCOVERED_TOOLS) {
                transportFail(
                    "TOO_MANY_TOOLS",
                    `Microsoft Learn MCP advertised more than ${MAX_DISCOVERED_TOOLS} tools`,
                );
            }
            cursor = result.nextCursor ?? undefined;
            if (cursor !== undefined && typeof cursor !== "string") {
                transportFail(
                    "INVALID_TOOLS_CURSOR",
                    "Microsoft Learn MCP returned an invalid tools/list cursor",
                );
            }
        } while (cursor);
        return { tools };
    }

    async callTool(name, args) {
        this.assertConnected();
        if (typeof name !== "string" || !name) {
            throw new TypeError("Learn MCP tool name must be a non-empty string");
        }
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
            throw new TypeError("Learn MCP tool arguments must be an object");
        }
        return this.request("tools/call", {
            name,
            arguments: args,
        });
    }
}

export function createLearnMcpHttpAdapterTransport(options) {
    const transport = new LearnMcpHttpTransport(options);
    return {
        transport,
        async connect() {
            return transport.connect();
        },
        listTools: () => transport.listTools(),
        callTool: (name, args) => transport.callTool(name, args),
    };
}
