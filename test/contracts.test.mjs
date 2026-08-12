import assert from "node:assert/strict";
import test from "node:test";
import {
    appendBoundedRecord,
    isLearnTool,
    normalizeEvidenceRecord,
    sha256,
    summarizeFailedHook,
    summarizeSuccessfulHook,
} from "../.github/extensions/learn-capability-spikes/contracts.mjs";

test("hook summaries hash full data and retain only bounded previews", () => {
    const success = summarizeSuccessfulHook({
        toolName: "microsoft-learn-microsoft_docs_search",
        toolArgs: { query: "x".repeat(2_000) },
        toolResult: {
            textResultForLlm: JSON.stringify({ results: ["y".repeat(1_000)] }),
            resultType: "success",
            structuredContent: { results: [{ title: "Bounded" }] },
        },
    });
    assert.equal(success.kind, "success");
    assert.equal(success.structuredContentVisible, true);
    assert.deepEqual(success.structuredContentKeys, ["results"]);
    assert.equal(success.structuredResultCount, 1);
    assert.deepEqual(success.parsedTextKeys, ["results"]);
    assert.equal(success.args.preview.length, 1_000);

    const failure = summarizeFailedHook({
        toolName: "microsoft-learn-microsoft_docs_fetch",
        toolArgs: { url: "https://example.com" },
        error: "z".repeat(500),
    });
    assert.equal(failure.kind, "failure");
    assert.equal(failure.errorLength, 500);
});

test("fallback evidence contract validates digests and counts", () => {
    const record = normalizeEvidenceRecord({
        toolName: "microsoft_docs_search",
        argsSummary: "query=functions",
        resultSha256: sha256("result"),
        resultCount: 3,
        sources: ["https://learn.microsoft.com/azure/"],
    });
    assert.equal(record.resultCount, 3);
    assert.throws(() => normalizeEvidenceRecord({
        toolName: "microsoft_docs_search",
        argsSummary: "query=functions",
        resultSha256: sha256("result"),
        resultCount: 3,
        sources: ["https://example.com/"],
    }), /learn\.microsoft\.com/);
    assert.throws(() => normalizeEvidenceRecord({
        toolName: "microsoft_docs_search",
        argsSummary: "query=functions",
        resultSha256: "bad",
        resultCount: 3,
    }), /SHA-256/);
});

test("Learn tool matching and record bounds are deterministic", () => {
    assert.equal(isLearnTool("microsoft-learn-microsoft_docs_search"), true);
    assert.equal(isLearnTool("bash"), false);
    const records = [];
    for (let index = 0; index < 25; index += 1) {
        appendBoundedRecord(records, { index });
    }
    assert.equal(records.length, 20);
    assert.equal(records[0].index, 5);
});
