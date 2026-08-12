import assert from "node:assert/strict";
import test from "node:test";
import {
    ContractValidationError,
    LearnMcpAdapter,
    LearnMcpAdapterError,
    adaptLearnMcpResult,
    assertEvidenceContentHash,
    canonicalJson,
    computeEvidenceContentHash,
    discoverLearnOperations,
    hashFetchedMarkdown,
    validateResearchBundle,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    clone,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

function expectCode(callback, errorClass, code) {
    assert.throws(callback, (error) => {
        assert.equal(error instanceof errorClass, true);
        assert.equal(error.code, code);
        return true;
    });
}

test("canonical JSON sorts object keys and preserves array order", () => {
    assert.equal(
        canonicalJson({ z: 1, a: { d: 4, b: 2 }, list: [3, 1] }),
        '{"a":{"b":2,"d":4},"list":[3,1],"z":1}',
    );
    assert.equal(canonicalJson({ value: -0 }), '{"value":0}');
});

test("evidence hashes exclude status, lifecycle, and contentHash", () => {
    const { bundle } = makePublishedEvidence();
    const superseded = {
        ...clone(bundle),
        status: "superseded",
        lifecycle: {
            ...bundle.lifecycle,
            supersededAt: "2026-08-12T09:10:00Z",
            updatedAt: "2026-08-12T09:10:00Z",
        },
        contentHash: "f".repeat(64),
    };
    assert.equal(computeEvidenceContentHash(bundle), computeEvidenceContentHash(superseded));
    assert.equal(assertEvidenceContentHash(bundle).contentHash, bundle.contentHash);
});

test("content hash validation detects immutable evidence tampering", () => {
    const { bundle } = makePublishedEvidence();
    const tampered = clone(bundle);
    tampered.question.normalized = "Tampered after hashing.";
    expectCode(
        () => assertEvidenceContentHash(tampered),
        ContractValidationError,
        "CONTENT_HASH_MISMATCH",
    );
});

test("exact excerpts may normalize line endings only", () => {
    const fixture = makePublishedEvidence({
        markdown: "# Heading\r\n\r\nExact  spacing.\r\n",
        exactExcerpt: "Exact  spacing.",
    });
    assert.equal(
        validateResearchBundle(fixture.bundle, [fixture.capture]).sources.length,
        1,
    );

    const mismatch = clone(fixture.bundle);
    mismatch.sources[0].exactExcerpt = "Exact spacing.";
    expectCode(
        () => validateResearchBundle(rehash(mismatch), [fixture.capture]),
        ContractValidationError,
        "EXACT_EXCERPT_MISMATCH",
    );

    const leadingWhitespace = makePublishedEvidence({
        markdown: "# Heading\n\n  indented quote  \n",
        exactExcerpt: "  indented quote  ",
    });
    assert.equal(
        validateResearchBundle(
            leadingWhitespace.bundle,
            [leadingWhitespace.capture],
        ).sources[0].exactExcerpt,
        "  indented quote  ",
    );
});

test("search discovery cannot authorize a publishable article source", () => {
    const fixture = makePublishedEvidence();
    const nonFetch = clone(fixture.bundle);
    nonFetch.sources[0].retrievalMethod = "docs-search";
    expectCode(
        () => validateResearchBundle(rehash(nonFetch), [fixture.capture]),
        ContractValidationError,
        "NON_FETCH_SOURCE",
    );
    expectCode(
        () => validateResearchBundle(fixture.bundle, []),
        ContractValidationError,
        "FETCH_EVIDENCE_MISSING",
    );
});

test("published excerpts cannot reconstruct a complete fetched page", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abcde",
    });
    const partitioned = clone(fixture.bundle);
    partitioned.sources.push({
        ...partitioned.sources[0],
        id: "source-runtime-part-two",
        exactExcerpt: "fghij",
    });
    expectCode(
        () => validateResearchBundle(rehash(partitioned), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("claim prose cannot contain a complete fetched page", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });
    const copied = clone(fixture.bundle);
    copied.claims[0].text = fixture.markdown;
    expectCode(
        () => validateResearchBundle(rehash(copied), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("decorated source fragments are included in full-page accounting", () => {
    const fixture = makePublishedEvidence({
        markdown: "0123456789",
        exactExcerpt: "0",
    });

    const decorated = clone(fixture.bundle);
    decorated.sources[0].title = "01234!";
    decorated.sources[0].sectionHeading = "56789!";
    expectCode(
        () => validateResearchBundle(rehash(decorated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("dense decoration cannot hide a complete fetched page in prose", () => {
    const markdown = "0123456789".repeat(300);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 40),
    });
    const decorated = clone(fixture.bundle);
    decorated.claims[0].text = markdown.match(/.{1,63}/g).join("|");
    expectCode(
        () => validateResearchBundle(rehash(decorated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("decorated page fragments cannot be split across persisted fields", () => {
    const markdown = Array.from(
        { length: 500 },
        (_value, index) => String.fromCharCode(33 + (index % 90)),
    ).join("");
    const decorate = (text) => text.match(/./g).join("|");
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 5),
    });
    const split = clone(fixture.bundle);
    split.claims[0].text = decorate(markdown.slice(250));
    split.sources[0].title = decorate(markdown.slice(0, 250));
    expectCode(
        () => validateResearchBundle(rehash(split), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("repeated excerpts account for distinct fetched-content occurrences", () => {
    const fixture = makePublishedEvidence({
        markdown: "aaaaaa",
        exactExcerpt: "aaa",
    });
    const repeated = clone(fixture.bundle);
    repeated.sources[0].whyItMatters = "aaa";
    expectCode(
        () => validateResearchBundle(rehash(repeated), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("exact and decorated prose share one occurrence allocation", () => {
    const fixture = makePublishedEvidence({
        markdown: "abcabd",
        exactExcerpt: "ab",
        question: "c",
    });
    const mixed = clone(fixture.bundle);
    mixed.claims[0].text = "a|b|d";
    expectCode(
        () => validateResearchBundle(rehash(mixed), [fixture.capture]),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("undeclared fetch captures are still scanned for copied page content", () => {
    const declared = makePublishedEvidence();
    const undeclared = makePublishedEvidence({
        version: 2,
        markdown: "Z".repeat(500),
        exactExcerpt: "Z".repeat(20),
    });
    const copied = clone(declared.bundle);
    copied.claims[0].text = undeclared.markdown;
    expectCode(
        () => validateResearchBundle(
            rehash(copied),
            [declared.capture, undeclared.capture],
        ),
        ContractValidationError,
        "FULL_FETCH_CONTENT",
    );
});

test("source retrieval time must come from the trusted fetch capture", () => {
    const fixture = makePublishedEvidence();
    const forgedTime = clone(fixture.bundle);
    forgedTime.sources[0].retrievedAt = "2099-01-01T00:00:00Z";
    expectCode(
        () => validateResearchBundle(rehash(forgedTime), [fixture.capture]),
        ContractValidationError,
        "RETRIEVAL_TIME_MISMATCH",
    );
});

test("repeated identical fetches match the declared observed timestamp", () => {
    const fixture = makePublishedEvidence();
    const secondCapture = {
        ...fixture.capture,
        captureId: "10000000-0000-4000-8000-000000000099",
        observedAt: "2026-08-12T09:02:00Z",
    };
    const later = clone(fixture.bundle);
    later.sources[0].retrievedAt = "2026-08-12T09:02:00Z";
    assert.equal(
        validateResearchBundle(
            rehash(later),
            [fixture.capture, secondCapture],
        ).sources[0].retrievedAt,
        "2026-08-12T09:02:00.000Z",
    );
});

test("source URL policy remains exact-host HTTPS", () => {
    const fixture = makePublishedEvidence();
    const invalid = clone(fixture.bundle);
    invalid.sources[0].canonicalUrl = "https://learn.microsoft.com.example/azure/example";
    expectCode(
        () => validateResearchBundle(invalid, [fixture.capture]),
        ContractValidationError,
        "INVALID_LEARN_HOST",
    );
});

test("adapter normalizes raw arrays and results objects", () => {
    const array = adaptLearnMcpResult("docs-search", [{
        title: "A",
        url: "https://learn.microsoft.com/azure/a",
    }]);
    const object = adaptLearnMcpResult("docs-search", {
        results: [{
            title: "A",
            url: "https://learn.microsoft.com/azure/a",
        }],
    });
    assert.equal(array.resultCount, 1);
    assert.equal(array.resultSha256, object.resultSha256);
    assert.deepEqual(array.sourceUrls, ["https://learn.microsoft.com/azure/a"]);
});

test("adapter normalizes structured content, MCP text blocks, and wrapper envelopes", () => {
    const expected = [{ title: "A" }];
    const structured = adaptLearnMcpResult("docs-search", {
        structuredContent: { results: expected },
        resultType: "success",
    });
    const blocks = adaptLearnMcpResult("docs-search", {
        content: [{ type: "text", text: JSON.stringify({ results: expected }) }],
    });
    const wrapper = adaptLearnMcpResult("docs-search", {
        resultType: "success",
        textResultForLlm: JSON.stringify({ results: expected }),
        contents: [{ type: "text", text: "ignored because textResultForLlm follows blocks" }],
    });
    assert.equal(structured.resultSha256, blocks.resultSha256);
    assert.equal(wrapper.resultCount, 1);
});

test("adapter normalizes fetched Markdown without persisting it in summaries", () => {
    const markdown = "# Heading\r\n\nExact quote.\r\n";
    const result = adaptLearnMcpResult("docs-fetch", {
        resultType: "success",
        contents: [{ type: "text", text: markdown }],
    }, {
        canonicalUrl: "https://learn.microsoft.com/azure/example",
        retrievalUrl: "https://learn.microsoft.com/azure/example?view=current",
    });
    assert.equal(result.resultSha256, hashFetchedMarkdown(markdown));
    assert.equal(result.preview.includes("Exact quote."), true);
    assert.equal(result.truncated, false);
});

test("adapter rejects malformed JSON and unknown result shapes", () => {
    expectCode(
        () => adaptLearnMcpResult("docs-search", "{not json"),
        LearnMcpAdapterError,
        "MALFORMED_JSON",
    );
    expectCode(
        () => adaptLearnMcpResult("docs-search", { payload: 1 }),
        LearnMcpAdapterError,
        "UNKNOWN_RESULT_SHAPE",
    );
});

test("adapter rejects protocol, tool, and success-shaped domain failures", () => {
    for (const [value, code] of [
        [{ jsonrpc: "2.0", error: { code: -32602, message: "bad input" } }, "MCP_ERROR"],
        [{ isError: true, content: [{ type: "text", text: "failed" }] }, "TOOL_RESULT_FAILED"],
        [{ resultType: "success", textResultForLlm: "Unable to fetch the requested page." }, "FAILURE_SHAPED_TEXT"],
        [{
            resultType: "success",
            textResultForLlm: "The provided URL points to a page that could not be retrieved. Verify the URL and try again.",
        }, "FAILURE_SHAPED_TEXT"],
        [{
            content: [
                { type: "text", text: "Result:" },
                { type: "text", text: '{"result":{"isError":true,"error":"not found"}}' },
            ],
        }, "MCP_ERROR"],
    ]) {
        expectCode(
            () => adaptLearnMcpResult("docs-fetch", value, {
                canonicalUrl: "https://learn.microsoft.com/azure/example",
                retrievalUrl: "https://learn.microsoft.com/azure/example",
            }),
            LearnMcpAdapterError,
            code,
        );
    }
    expectCode(
        () => adaptLearnMcpResult(
            "docs-fetch",
            JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32602, message: "bad input" },
            }),
            {
                canonicalUrl: "https://learn.microsoft.com/azure/example",
                retrievalUrl: "https://learn.microsoft.com/azure/example",
            },
        ),
        LearnMcpAdapterError,
        "MCP_ERROR",
    );
});

test("dynamic discovery maps arbitrary runtime names and argument spellings", () => {
    const tools = discoverLearnOperations({
        tools: [
            {
                name: "opaque-a",
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
                name: "opaque-b",
                description: "Search documentation",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                    },
                    required: ["prompt"],
                },
            },
            {
                name: "opaque-c",
                description: "Search code examples",
                inputSchema: {
                    type: "object",
                    properties: {
                        keywords: { type: "string", description: "Search keywords" },
                        dialect: { type: "string", description: "Programming language" },
                    },
                    required: ["keywords"],
                },
            },
        ],
    });
    assert.equal(tools["docs-fetch"].runtimeName, "opaque-a");
    assert.equal(tools["docs-fetch"].argumentKeys.resource, "address");
    assert.equal(tools["code-sample-search"].runtimeName, "opaque-c");
});

test("dynamic discovery fails explicitly on schema drift", () => {
    expectCode(
        () => discoverLearnOperations([{
            name: "opaque",
            inputSchema: {
                type: "object",
                properties: { value: { type: "number" } },
                required: ["value"],
            },
        }]),
        LearnMcpAdapterError,
        "SCHEMA_DRIFT",
    );
});

test("dynamic discovery accepts optional query properties from current schemas", () => {
    const tools = discoverLearnOperations([
        {
            name: "fetch-runtime",
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
            name: "search-runtime",
            description: "Search documentation",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Search query",
                        default: null,
                    },
                },
            },
        },
        {
            name: "code-runtime",
            description: "Search code samples",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Search query",
                        default: null,
                    },
                    language: {
                        type: "string",
                        description: "Programming language",
                    },
                },
            },
        },
    ]);
    assert.equal(tools["docs-search"].argumentKeys.query, "prompt");
    assert.equal(tools["code-sample-search"].argumentKeys.language, "language");
});

test("adapter connection surfaces list and call protocol failures", async () => {
    const listFailure = new LearnMcpAdapter({
        listTools: async () => {
            throw new Error("offline");
        },
        callTool: async () => [],
    });

    await assert.rejects(listFailure.connect(), (error) => (
        error instanceof LearnMcpAdapterError && error.code === "PROTOCOL_FAILURE"
    ));

    const definitions = [
        {
            name: "fetch",
            description: "Fetch a page",
            inputSchema: {
                type: "object",
                properties: { address: { type: "string", format: "uri" } },
                required: ["address"],
            },
        },
        {
            name: "search",
            description: "Search docs",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string", description: "Search query" } },
                required: ["prompt"],
            },
        },
        {
            name: "code",
            description: "Search code",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Search query" },
                    language: { type: "string", description: "Programming language" },
                },
                required: ["prompt"],
            },
        },
    ];
    const callFailure = new LearnMcpAdapter({
        listTools: async () => definitions,
        callTool: async () => {
            throw new Error("transport reset");
        },
    });
    await callFailure.connect();
    await assert.rejects(
        callFailure.execute("docs-search", { prompt: "azure" }),
        (error) => error instanceof LearnMcpAdapterError && error.code === "PROTOCOL_FAILURE",
    );
});

test("fetch arguments are host-validated before invoking the runtime tool", async () => {
    let calls = 0;
    const adapter = new LearnMcpAdapter({
        listTools: async () => [
            {
                name: "fetch",
                description: "Fetch a page",
                inputSchema: {
                    type: "object",
                    properties: { address: { type: "string", format: "uri" } },
                    required: ["address"],
                },
            },
            {
                name: "search",
                description: "Search documentation",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                    },
                },
            },
            {
                name: "code",
                description: "Search code",
                inputSchema: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "Search query" },
                        language: { type: "string", description: "Programming language" },
                    },
                },
            },
        ],
        callTool: async () => {
            calls += 1;
            return "should not run";
        },
    });
    await adapter.connect();
    await assert.rejects(
        adapter.execute("docs-fetch", { address: "https://example.com/private" }),
        (error) => error.code === "INVALID_LEARN_HOST",
    );
    assert.equal(calls, 0);
});
