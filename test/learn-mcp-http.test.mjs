import assert from "node:assert/strict";
import test from "node:test";
import {
    LearnMcpAdapter,
    LearnMcpHttpTransport,
    LearnMcpTransportError,
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
    const fetchImplementation = async (_url, options) => {
        redirectMode = options.redirect;
        return {
            redirected: true,
            status: 307,
        };
    };
    const transport = new LearnMcpHttpTransport({ fetchImplementation });
    await assert.rejects(
        transport.connect(),
        (error) => (
            error instanceof LearnMcpTransportError
            && error.code === "UNSAFE_PROTOCOL_REDIRECT"
        ),
    );
    assert.equal(redirectMode, "error");
});

test("HTTP transport rejects non-Learn endpoints", () => {
    assert.throws(
        () => new LearnMcpHttpTransport({ endpoint: "https://example.com/mcp" }),
        /exact learn\.microsoft\.com host/,
    );
});
