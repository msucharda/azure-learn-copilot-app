import assert from "node:assert/strict";
import test from "node:test";
import {
    LearnMcpAdapter,
    LearnMcpHttpTransport,
    LearnMcpTransportError,
    resolveLearnMcpAdapterOptions,
    resolveLearnMcpHttpOptions,
} from "../.github/extensions/learn-references/lib/index.mjs";

function response(value, {
    status = 200,
    contentType = "application/json",
    sessionId,
    headers: extraHeaders = {},
} = {}) {
    const headers = {
        ...extraHeaders,
        "content-type": contentType,
    };
    if (sessionId) {
        headers["mcp-session-id"] = sessionId;
    }
    return new Response(value === null ? null : (
        typeof value === "string" ? value : JSON.stringify(value)
    ), { status, headers });
}

function toolDefinitions() {
    return [
        {
            name: "opaque-fetch",
            description: "Fetch a documentation page",
            inputSchema: {
                type: "object",
                properties: {
                    address: { type: "string", format: "uri" },
                },
                required: ["address"],
            },
        },
        {
            name: "opaque-search",
            description: "Search documentation",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Search query" },
                },
            },
        },
        {
            name: "opaque-code",
            description: "Search code samples",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Search query" },
                    language: { type: "string", description: "Programming language" },
                },
            },
        },
    ];
}

test("HTTP transport and adapter discover and call opaque runtime tools", async () => {
    const requests = [];
    const fetchImplementation = async (_url, options) => {
        const payload = JSON.parse(options.body);
        requests.push(payload);
        if (payload.method === "initialize") {
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    serverInfo: { name: "fake", version: "1" },
                },
            }, { sessionId: "session-one" });
        }
        if (payload.method === "notifications/initialized") {
            return response(null, { status: 202 });
        }
        if (payload.method === "tools/list") {
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: { tools: toolDefinitions() },
            });
        }
        if (payload.method === "tools/call") {
            assert.equal(payload.params.name, "opaque-search");
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    structuredContent: {
                        results: [{
                            title: "Result",
                            url: "https://learn.microsoft.com/azure/result",
                        }],
                    },
                },
            });
        }
        throw new Error(`Unexpected method ${payload.method}`);
    };
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await transport.connect();
    const adapter = new LearnMcpAdapter({
        listTools: () => transport.listTools(),
        callTool: (name, args) => transport.callTool(name, args),
    });
    await adapter.connect();
    const result = await adapter.execute("docs-search", { prompt: "azure" });
    assert.equal(result.runtimeToolName, "opaque-search");
    assert.equal(result.resultCount, 1);
    assert.deepEqual(
        requests.map((request) => request.method),
        ["initialize", "notifications/initialized", "tools/list", "tools/call"],
    );
});

test("HTTP transport accepts SSE JSON-RPC responses", async () => {
    const fetchImplementation = async (_url, options) => {
        const payload = JSON.parse(options.body);
        if (payload.method === "initialize") {
            const event = `event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                },
            })}\n\n`;
            return response(event, { contentType: "text/event-stream" });
        }
        return response(null, { status: 202 });
    };
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    assert.equal((await transport.connect()).protocolVersion, "2025-06-18");
});

test("HTTP transport rejects JSON-RPC errors", async () => {
    const fetchImplementation = async (_url, options) => {
        const payload = JSON.parse(options.body);
        return response({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: -32602, message: "invalid request" },
        });
    };
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await assert.rejects(
        transport.connect(),
        (error) => error instanceof LearnMcpTransportError && error.code === "JSON_RPC_ERROR",
    );
});

test("HTTP transport rejects mismatched response IDs", async () => {
    const fetchImplementation = async () => response({
        jsonrpc: "2.0",
        id: 999,
        result: {
            protocolVersion: "2025-06-18",
            capabilities: {},
        },
    });
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await assert.rejects(
        transport.connect(),
        (error) => (
            error instanceof LearnMcpTransportError
            && error.code === "MISMATCHED_PROTOCOL_RESPONSE"
        ),
    );
});

test("HTTP transport rejects oversized bodies before buffering", async () => {
    const fetchImplementation = async () => response("x", {
        contentType: "application/json",
        status: 200,
        headers: { "content-length": "1000001" },
    });
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await assert.rejects(
        transport.connect(),
        (error) => (
            error instanceof LearnMcpTransportError
            && error.code === "PROTOCOL_BODY_TOO_LARGE"
        ),
    );
});

test("HTTP transport rejects repeated pagination cursors", async () => {
    const fetchImplementation = async (_url, options) => {
        const payload = JSON.parse(options.body);
        if (payload.method === "initialize") {
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                },
            });
        }
        if (payload.method === "notifications/initialized") {
            return response(null, { status: 202 });
        }
        return response({
            jsonrpc: "2.0",
            id: payload.id,
            result: { tools: [], nextCursor: "same" },
        });
    };
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await transport.connect();
    await assert.rejects(
        transport.listTools(),
        (error) => (
            error instanceof LearnMcpTransportError
            && error.code === "REPEATED_TOOLS_CURSOR"
        ),
    );
});

test("HTTP transport disables and rejects redirects", async () => {
    let redirectMode;
    let calls = 0;
    const delays = [];
    const fetchImplementation = async (_url, options) => {
        calls += 1;
        redirectMode = options.redirect;
        return {
            redirected: false,
            status: 302,
            headers: new Headers({ location: "https://learn.microsoft.com/redirected" }),
        };
    };
    const transport = new LearnMcpHttpTransport({
        fetchImplementation,
        sleep: async (delay) => delays.push(delay),
    });
    await assert.rejects(
        transport.connect(),
        (error) => (
            error instanceof LearnMcpTransportError
            && error.code === "UNSAFE_PROTOCOL_REDIRECT"
        ),
    );
    assert.equal(redirectMode, "manual");
    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
});

test("HTTP transport rejects non-Learn endpoints", () => {
    assert.throws(
        () => new LearnMcpHttpTransport({ endpoint: "https://example.com/mcp" }),
        /exact learn\.microsoft\.com host/,
    );
});

test("HTTP transport retries bounded 429 and honors bounded Retry-After", async () => {
    const delays = [];
    const retries = [];
    let calls = 0;
    const transport = new LearnMcpHttpTransport({
        fetchImplementation: async (_url, options) => {
            calls += 1;
            const payload = JSON.parse(options.body);
            if (calls === 1) {
                return response({ error: "slow down" }, {
                    status: 429,
                    headers: { "retry-after": "0.2" },
                });

                test("HTTP transport clamps Retry-After to the common per-delay cap", async () => {
                    const delays = [];
                    let calls = 0;
                    const transport = new LearnMcpHttpTransport({
                        fetchImplementation: async (_url, options) => {
                            calls += 1;
                            const payload = JSON.parse(options.body);
                            if (calls === 1) {
                                return response("rate limited", {
                                    status: 429,
                                    headers: { "retry-after": "8" },
                                });
                            }
                            return response({
                                jsonrpc: "2.0",
                                id: payload.id,
                                result: {
                                    protocolVersion: "2025-06-18",
                                    capabilities: {},
                                },
                            });
                        },
                        retryPolicy: {
                            maxAttempts: 2,
                            baseDelayMs: 100,
                            maxDelayMs: 1_000,
                            maxTotalDelayMs: 2_000,
                            maxRetryAfterMs: 10_000,
                            jitterRatio: 0,
                        },
                        sleep: async (delay) => delays.push(delay),
                    });
                    await transport.connect();
                    assert.deepEqual(delays, [1_000]);
                });
            }
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                },
            });
        },
        sleep: async (delay) => delays.push(delay),
        random: () => 0.5,
        onRetry: (event) => retries.push(event),
    });
    await transport.connect();
    assert.equal(calls, 3);
    assert.deepEqual(delays, [200]);
    assert.deepEqual(retries, [{
        attempt: 1,
        delayMs: 200,
        reason: "HTTP_429",
        requestId: 1,
    }]);
});

test("HTTP transport retries transient network and 5xx failures with deterministic jitter", async () => {
    const delays = [];
    let calls = 0;
    const transport = new LearnMcpHttpTransport({
        fetchImplementation: async (_url, options) => {
            calls += 1;
            if (calls === 1) {
                throw new TypeError("temporary network failure");
            }
            const payload = JSON.parse(options.body);
            if (calls === 2) {
                return response("unavailable", { status: 503 });
            }
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                },
            });
        },
        sleep: async (delay) => delays.push(delay),
        random: () => 1,
    });
    await transport.connect();
    assert.deepEqual(delays, [125, 250]);
});

test("HTTP transport retries a bounded timeout failure", async () => {
    const delays = [];
    let calls = 0;
    const transport = new LearnMcpHttpTransport({
        fetchImplementation: async (_url, options) => {
            calls += 1;
            if (calls === 1) {
                throw new DOMException("request timed out", "TimeoutError");
            }
            const payload = JSON.parse(options.body);
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                },
            });
        },
        sleep: async (delay) => delays.push(delay),
        random: () => 0.5,
    });
    await transport.connect();
    assert.deepEqual(delays, [100]);
});

test("HTTP transport does not retry caller, redirect, or schema failures", async () => {
    for (const status of [400, 401, 404]) {
        let calls = 0;
        const transport = new LearnMcpHttpTransport({
            fetchImplementation: async () => {
                calls += 1;
                return response("caller error", { status });
            },
            sleep: async () => assert.fail("must not sleep"),
        });
        await assert.rejects(
            transport.connect(),
            (error) => error.code === "PROTOCOL_HTTP_ERROR" && error.status === status,
        );
        assert.equal(calls, 1);
    }

    let schemaCalls = 0;
    const schemaTransport = new LearnMcpHttpTransport({
        fetchImplementation: async (_url, options) => {
            schemaCalls += 1;
            const payload = JSON.parse(options.body);
            return response({
                jsonrpc: "2.0",
                id: payload.id,
                result: {},
            });
        },
    });
    await assert.rejects(
        schemaTransport.connect(),
        (error) => error.code === "INVALID_INITIALIZATION",
    );
    assert.equal(schemaCalls, 1);
});

test("HTTP transport stops retrying before exceeding the total delay cap", async () => {
    const delays = [];
    let calls = 0;
    const transport = new LearnMcpHttpTransport({
        fetchImplementation: async () => {
            calls += 1;
            return response("unavailable", { status: 503 });
        },
        retryPolicy: {
            maxAttempts: 5,
            baseDelayMs: 100,
            maxDelayMs: 1_000,
            maxTotalDelayMs: 250,
            maxRetryAfterMs: 2_000,
            jitterRatio: 0,
        },
        sleep: async (delay) => delays.push(delay),
    });
    await assert.rejects(
        transport.connect(),
        (error) => error.code === "PROTOCOL_HTTP_ERROR" && error.status === 503,
    );
    assert.deepEqual(delays, [100]);
    assert.equal(calls, 2);
});

test("HTTP transport environment configuration is bounded and deterministic", () => {
    assert.deepEqual(resolveLearnMcpHttpOptions({
        COPILOT_LEARN_MCP_ENDPOINT: "https://learn.microsoft.com/api/mcp",
        COPILOT_LEARN_TIMEOUT_MS: "5000",
        COPILOT_LEARN_RETRY_MAX_ATTEMPTS: "2",
        COPILOT_LEARN_RETRY_BASE_DELAY_MS: "20",
        COPILOT_LEARN_RETRY_MAX_DELAY_MS: "40",
        COPILOT_LEARN_RETRY_MAX_TOTAL_DELAY_MS: "60",
        COPILOT_LEARN_RETRY_MAX_RETRY_AFTER_MS: "50",
        COPILOT_LEARN_RETRY_JITTER_RATIO: "0",
    }), {
        endpoint: "https://learn.microsoft.com/api/mcp",
        timeoutMs: 5_000,
        retryPolicy: {
            maxAttempts: 2,
            baseDelayMs: 20,
            maxDelayMs: 40,
            maxTotalDelayMs: 60,
            maxRetryAfterMs: 50,
            jitterRatio: 0,
        },
    });

    assert.throws(
        () => resolveLearnMcpHttpOptions({
            COPILOT_LEARN_RETRY_MAX_TOTAL_DELAY_MS: "10001",
        }),
        /safety caps/,
    );
    assert.throws(
        () => resolveLearnMcpHttpOptions({
            COPILOT_LEARN_TIMEOUT_MS: "999",
        }),
        /1000 through 120000/,
    );
});

test("adapter caches only validated tool metadata and refreshes it after TTL expiry", async () => {
    let now = 0;
    let listCalls = 0;
    const adapter = new LearnMcpAdapter({
        listTools: async () => {
            listCalls += 1;
            return { tools: toolDefinitions() };
        },
        callTool: async () => ({ results: [] }),
        metadataCacheTtlMs: 1_000,
        clock: () => now,
    });
    await adapter.connect();
    await adapter.execute("docs-search", { prompt: "first" });
    assert.equal(listCalls, 1);
    now = 999;
    await adapter.execute("docs-search", { prompt: "hit" });
    assert.equal(listCalls, 1);
    now = 1_000;
    await adapter.execute("docs-search", { prompt: "expired" });
    assert.equal(listCalls, 2);
    assert.deepEqual(resolveLearnMcpAdapterOptions({}), {
        metadataCacheTtlMs: 300_000,
    });
    assert.throws(
        () => resolveLearnMcpAdapterOptions({
            COPILOT_LEARN_METADATA_CACHE_TTL_MS: "999",
        }),
        /1000 through 3600000/,
    );
});
