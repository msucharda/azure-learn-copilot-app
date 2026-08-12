const DEFAULT_ENDPOINT = "https://learn.microsoft.com/api/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const MAX_PROTOCOL_BODY_LENGTH = 1_000_000;
const MAX_DISCOVERED_TOOLS = 100;
const MAX_TOOLS_LIST_PAGES = 20;
const DEFAULT_RETRY_POLICY = Object.freeze({
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    maxTotalDelayMs: 2_000,
    maxRetryAfterMs: 2_000,
    jitterRatio: 0.25,
});

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

function retryAfterMs(response, now, maximum) {
    const value = response.headers.get("retry-after");
    if (value === null) {
        return undefined;
    }
    const seconds = Number(value);
    let delay;
    if (Number.isFinite(seconds) && seconds >= 0) {
        delay = seconds * 1_000;
    } else {
        const date = Date.parse(value);
        delay = Number.isFinite(date) ? Math.max(0, date - now()) : Number.NaN;
    }
    return Number.isFinite(delay) && delay <= maximum
        ? Math.ceil(delay)
        : undefined;
}

function normalizeRetryPolicy(value = {}) {
    const policy = { ...DEFAULT_RETRY_POLICY, ...value };
    for (const key of [
        "maxAttempts",
        "baseDelayMs",
        "maxDelayMs",
        "maxTotalDelayMs",
        "maxRetryAfterMs",
    ]) {
        if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
            throw new TypeError(`retryPolicy.${key} must be a non-negative safe integer`);
        }
    }
    if (policy.maxAttempts < 1 || policy.maxAttempts > 5) {
        throw new TypeError("retryPolicy.maxAttempts must be from 1 through 5");
    }
    if (
        policy.baseDelayMs > 5_000
        || policy.maxDelayMs > 5_000
        || policy.maxTotalDelayMs > 10_000
        || policy.maxRetryAfterMs > 10_000
    ) {
        throw new TypeError("retryPolicy delay bounds exceed the production safety caps");
    }
    if (
        typeof policy.jitterRatio !== "number"
        || policy.jitterRatio < 0
        || policy.jitterRatio > 0.5
    ) {
        throw new TypeError("retryPolicy.jitterRatio must be from 0 through 0.5");
    }
    return Object.freeze(policy);
}

function optionalInteger(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
        return fallback;
    }
    if (!/^\d+$/.test(raw)) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }
    return Number(raw);
}

function optionalNumber(env, name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`);
    }
    return value;
}

export function resolveLearnMcpHttpOptions(env = process.env) {
    const timeoutMs = optionalInteger(env, "COPILOT_LEARN_TIMEOUT_MS", 30_000);
    if (timeoutMs < 1_000 || timeoutMs > 120_000) {
        throw new TypeError("COPILOT_LEARN_TIMEOUT_MS must be from 1000 through 120000");
    }
    return {
        endpoint: env.COPILOT_LEARN_MCP_ENDPOINT,
        timeoutMs,
        retryPolicy: normalizeRetryPolicy({
            maxAttempts: optionalInteger(
                env,
                "COPILOT_LEARN_RETRY_MAX_ATTEMPTS",
                DEFAULT_RETRY_POLICY.maxAttempts,
            ),
            baseDelayMs: optionalInteger(
                env,
                "COPILOT_LEARN_RETRY_BASE_DELAY_MS",
                DEFAULT_RETRY_POLICY.baseDelayMs,
            ),
            maxDelayMs: optionalInteger(
                env,
                "COPILOT_LEARN_RETRY_MAX_DELAY_MS",
                DEFAULT_RETRY_POLICY.maxDelayMs,
            ),
            maxTotalDelayMs: optionalInteger(
                env,
                "COPILOT_LEARN_RETRY_MAX_TOTAL_DELAY_MS",
                DEFAULT_RETRY_POLICY.maxTotalDelayMs,
            ),
            maxRetryAfterMs: optionalInteger(
                env,
                "COPILOT_LEARN_RETRY_MAX_RETRY_AFTER_MS",
                DEFAULT_RETRY_POLICY.maxRetryAfterMs,
            ),
            jitterRatio: optionalNumber(
                env,
                "COPILOT_LEARN_RETRY_JITTER_RATIO",
                DEFAULT_RETRY_POLICY.jitterRatio,
            ),
        }),
    };
}

function retryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}

function backoffDelay(attempt, policy, random) {
    const exponential = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)),
    );
    const jitter = exponential * policy.jitterRatio * ((random() * 2) - 1);
    return Math.max(0, Math.min(policy.maxDelayMs, Math.round(exponential + jitter)));
}

function assertSafeResponse(response, endpoint) {
    if (
        response.redirected
        || (response.status >= 300 && response.status <= 399)
    ) {
        transportFail(
            "UNSAFE_PROTOCOL_REDIRECT",
            "Microsoft Learn MCP responses cannot be redirected",
            { status: response.status },
        );
    }
    if (response.url) {
        const responseUrl = new URL(response.url);
        const endpointUrl = new URL(endpoint);
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
}

export class LearnMcpHttpTransport {
    constructor({
        endpoint = DEFAULT_ENDPOINT,
        fetchImplementation = globalThis.fetch,
        timeoutMs = 30_000,
        retryPolicy,
        sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
        random = Math.random,
        clock = Date.now,
        onRetry = () => {},
    } = {}) {
        if (typeof fetchImplementation !== "function") {
            throw new TypeError("LearnMcpHttpTransport requires a fetch implementation");
        }
        if (typeof sleep !== "function" || typeof random !== "function" || typeof clock !== "function") {
            throw new TypeError("LearnMcpHttpTransport retry dependencies must be functions");
        }
        if (typeof onRetry !== "function") {
            throw new TypeError("LearnMcpHttpTransport onRetry must be a function");
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
        this.retryPolicy = normalizeRetryPolicy(retryPolicy);
        this.sleep = sleep;
        this.random = random;
        this.clock = clock;
        this.onRetry = onRetry;
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
        const body = JSON.stringify(payload);
        let response;
        let lastFailure;
        let totalDelayMs = 0;
        let attempts = 0;
        for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
            attempts = attempt;
            try {
                response = await this.fetchImplementation(this.endpoint, {
                    method: "POST",
                    headers: this.headers(),
                    body,
                    redirect: "manual",
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
                assertSafeResponse(response, this.endpoint);
                lastFailure = undefined;
            } catch (cause) {
                if (cause instanceof LearnMcpTransportError) {
                    throw cause;
                }
                lastFailure = cause;
                response = undefined;
            }
            const retryable = response
                ? retryableStatus(response.status)
                : true;
            if (!retryable || attempt === this.retryPolicy.maxAttempts) {
                break;
            }
            const advised = response
                ? retryAfterMs(response, this.clock, this.retryPolicy.maxRetryAfterMs)
                : undefined;
            const delayMs = Math.min(
                this.retryPolicy.maxDelayMs,
                advised ?? backoffDelay(attempt, this.retryPolicy, this.random),
            );
            if (totalDelayMs + delayMs > this.retryPolicy.maxTotalDelayMs) {
                break;
            }
            totalDelayMs += delayMs;
            await this.onRetry(Object.freeze({
                attempt,
                delayMs,
                reason: response ? `HTTP_${response.status}` : "NETWORK_FAILURE",
                requestId: payload.id ?? null,
            }));
            await this.sleep(delayMs);
        }
        if (!response) {
            transportFail("PROTOCOL_FAILURE", "Microsoft Learn MCP request failed", {
                cause: lastFailure,
                details: {
                    attempts,
                    totalDelayMs,
                },
            });
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
