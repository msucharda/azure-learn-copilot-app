import assert from "node:assert/strict";
import {
    mkdtemp,
    rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    ACKNOWLEDGE_RESEARCH_HANDOFF_SCHEMA,
    DraftEvidenceStore,
    LearnMcpAdapterError,
    PERSIST_RESEARCH_DRAFT_SCHEMA,
    PREPARE_LEARN_RESEARCH_SCHEMA,
    PublishedEvidenceStore,
    READ_LEARN_EVIDENCE_CAPTURE_SCHEMA,
    RECORD_LEARN_EVIDENCE_SCHEMA,
    SUPERSEDE_RESEARCH_BUNDLE_SCHEMA,
    createLearnReferenceTools,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    PARENT_SESSION_ID,
    RESEARCH_ID,
    clone,
    handoffFor,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

async function harness(t) {
    const root = await mkdtemp(join(tmpdir(), "learn-reference-tools-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const draftStore = await DraftEvidenceStore.create({ root: join(root, "draft") });
    const publishedStore = await PublishedEvidenceStore.create({
        root: join(root, "published"),
    });
    let execute = async () => trustedFetchResult(makePublishedEvidence());
    let currentTime = "2026-08-12T09:01:00Z";
    const learnAdapter = {
        execute: (operation, args) => execute(operation, args),
    };
    const tools = createLearnReferenceTools({
        draftStore,
        publishedStore,
        learnAdapter,
        now: () => currentTime,
        uuid: () => "90000000-0000-4000-8000-000000000001",
    });
    return {
        root,
        draftStore,
        publishedStore,
        setExecute(callback) {
            execute = callback;
        },
        setNow(value) {
            currentTime = value;
        },
        tool(name) {
            return tools.find((entry) => entry.name === name);
        },
        tools,
    };
}

function trustedFetchResult(fixture) {
    return {
        logicalOperation: "docs-fetch",
        runtimeToolName: "opaque-runtime-tool",
        markdown: fixture.markdown,
        resultSha256: fixture.capture.resultSha256,
        resultCount: 1,
        sourceUrls: [fixture.capture.retrievalUrl],
        canonicalUrl: fixture.capture.canonicalUrl,
        retrievalUrl: fixture.capture.retrievalUrl,
        preview: fixture.markdown.slice(0, 1_000),
        truncated: false,
    };
}

function recordInput(fixture) {
    return {
        researchId: fixture.bundle.researchId,
        logicalOperation: "docs-fetch",
        argumentsJson: JSON.stringify({
            address: fixture.capture.retrievalUrl,
        }),
    };
}

function assertStrictObjects(schema) {
    if (!schema || typeof schema !== "object") {
        return;
    }
    if (schema.type === "object") {
        assert.equal(schema.additionalProperties, false);
    }
    for (const value of Object.values(schema)) {
        if (value && typeof value === "object") {
            if (Array.isArray(value)) {
                value.forEach(assertStrictObjects);
            } else {
                assertStrictObjects(value);
            }
        }
    }
}

test("production extension exposes exactly the required strict tools", async (t) => {
    const { tools } = await harness(t);
    assert.deepEqual(
        tools.map((tool) => tool.name),
        [
            "prepare_learn_research",
            "record_learn_evidence",
            "read_learn_evidence_capture",
            "persist_research_draft",
            "validate_research_bundle",
            "publish_research_bundle",
            "get_research_bundle",
            "acknowledge_research_handoff",
            "supersede_research_bundle",
        ],
    );
    for (const tool of tools) {
        assertStrictObjects(tool.parameters);
    }
    assert.equal(RECORD_LEARN_EVIDENCE_SCHEMA.properties.argumentsJson.maxLength, 20_000);
    assert.equal(READ_LEARN_EVIDENCE_CAPTURE_SCHEMA.properties.length.maximum, 4_096);
    for (const schema of [
        PREPARE_LEARN_RESEARCH_SCHEMA,
        PERSIST_RESEARCH_DRAFT_SCHEMA,
        ACKNOWLEDGE_RESEARCH_HANDOFF_SCHEMA,
        SUPERSEDE_RESEARCH_BUNDLE_SCHEMA,
    ]) {
        assertStrictObjects(schema);
    }
});

function researchStartInput(choice, researchId) {
    return {
        choice,
        ...(researchId === undefined ? {} : { researchId }),
        question: "How should nested research work?",
        normalizedQuestion: "Verify nested Microsoft Learn research.",
        scope: {
            product: "Microsoft Foundry",
            version: "current",
            platform: "Copilot CLI",
            taskIntent: "Produce bounded verified evidence.",
        },
        constraints: ["Use one official skill."],
        parentSessionId: PARENT_SESSION_ID,
        evidenceSeed: [{
            summary: "A prior quick pass identified the relevant overview.",
            sourceUrls: ["https://learn.microsoft.com/azure/ai-foundry/"],
        }],
        unresolvedQuestions: ["Which current API contract is authoritative?"],
    };
}

test("quick refinement promotes to a standalone deep kickoff with one stable researchId", async (t) => {
    const context = await harness(t);
    const quick = await context.tool("prepare_learn_research").handler(
        researchStartInput("refine-here"),
    );
    assert.equal(quick.structuredContent.kickoff, undefined);
    const researchId = quick.structuredContent.state.researchId;
    const deep = await context.tool("prepare_learn_research").handler(
        researchStartInput("open-deep-research-session", researchId),
    );
    assert.equal(deep.structuredContent.state.researchId, researchId);
    assert.match(deep.structuredContent.kickoff, new RegExp(researchId));
    assert.match(deep.structuredContent.kickoff, /re-fetch and record every source/i);
    assert.match(deep.structuredContent.kickoff, /instanceId "learn-draft-panel"/);
    assert.match(deep.structuredContent.kickoff, /Publish only after an explicit user publish turn/i);
    assert.equal(deep.structuredContent.kickoff.includes("fetchedMarkdown"), false);
});

test("record tool stores normalized fetch evidence and no full body in its result", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    const result = await context.tool("record_learn_evidence").handler(recordInput(fixture));
    assert.equal(result.resultType, "success");
    assert.equal(result.textResultForLlm.includes(fixture.markdown), false);
    assert.equal(result.structuredContent.observedAt, "2026-08-12T09:01:00.000Z");
    const captures = await context.draftStore.listCaptures(RESEARCH_ID);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].fetchedMarkdown, fixture.markdown);
});

test("capture reader returns an exact bounded fetch chunk and provenance", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    const recorded = await context.tool("record_learn_evidence").handler(recordInput(fixture));
    const result = await context.tool("read_learn_evidence_capture").handler({
        researchId: RESEARCH_ID,
        captureId: recorded.structuredContent.captureId,
        offset: 5,
        length: 37,
    });
    assert.equal(result.structuredContent.markdownChunk, fixture.markdown.slice(5, 42));
    assert.equal(result.structuredContent.totalLength, fixture.markdown.length);
    assert.equal(result.structuredContent.resultSha256, fixture.capture.resultSha256);
    assert.equal(result.structuredContent.canonicalUrl, fixture.capture.canonicalUrl);
    assert.equal(result.structuredContent.retrievalUrl, fixture.capture.retrievalUrl);
    assert.equal(result.structuredContent.observedAt, "2026-08-12T09:01:00.000Z");
    assert.equal(result.textResultForLlm.includes(fixture.markdown), false);
});

test("capture reader rejects cross-research and search/code captures", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.draftStore.recordCapture(fixture.capture);
    await assert.rejects(
        context.tool("read_learn_evidence_capture").handler({
            researchId: "80000000-0000-4000-8000-000000000001",
            captureId: fixture.capture.captureId,
            offset: 0,
            length: 1,
        }),
        (error) => error.code === "CAPTURE_NOT_FOUND",
    );

    for (const [operation, captureId] of [
        ["docs-search", "70000000-0000-4000-8000-000000000001"],
        ["code-sample-search", "70000000-0000-4000-8000-000000000002"],
    ]) {
        const discoveryCapture = clone(fixture.capture);
        discoveryCapture.captureId = captureId;
        discoveryCapture.logicalOperation = operation;
        delete discoveryCapture.canonicalUrl;
        delete discoveryCapture.retrievalUrl;
        delete discoveryCapture.fetchedMarkdown;
        await context.draftStore.recordCapture(discoveryCapture);
        await assert.rejects(
            context.tool("read_learn_evidence_capture").handler({
                researchId: RESEARCH_ID,
                captureId,
                offset: 0,
                length: 1,
            }),
            (error) => error.code === "NON_FETCH_CAPTURE",
        );
    }
});

test("capture reader rejects out-of-range and complete-body reads", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });
    await context.draftStore.recordCapture(fixture.capture);
    await assert.rejects(
        context.tool("read_learn_evidence_capture").handler({
            researchId: RESEARCH_ID,
            captureId: fixture.capture.captureId,
            offset: 10,
            length: 1,
        }),
        (error) => error.code === "CAPTURE_OFFSET_OUT_OF_RANGE",
    );
    await assert.rejects(
        context.tool("read_learn_evidence_capture").handler({
            researchId: RESEARCH_ID,
            captureId: fixture.capture.captureId,
            offset: 0,
            length: 10,
        }),
        (error) => error.code === "FULL_CAPTURE_READ",
    );
});

test("record tool rejects success-shaped failures without writing capture records", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    context.setExecute(async () => {
        throw new LearnMcpAdapterError(
            "FAILURE_SHAPED_TEXT",
            "Learn MCP returned failure text as a successful result",
        );
    });
    await assert.rejects(
        context.tool("record_learn_evidence").handler(recordInput(fixture)),
        (error) => error.code === "FAILURE_SHAPED_TEXT",
    );
    assert.equal((await context.draftStore.listCaptures(RESEARCH_ID)).length, 0);
});

test("record tool rejects unknown properties before writing", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await assert.rejects(
        context.tool("record_learn_evidence").handler({
            ...recordInput(fixture),
            resultBody: fixture.markdown,
        }),
        (error) => error.code === "UNKNOWN_PROPERTY",
    );
    assert.equal((await context.draftStore.listCaptures(RESEARCH_ID)).length, 0);
});

test("validate tool persists only a bundle whose quote occurs in fetched Markdown", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.tool("record_learn_evidence").handler(recordInput(fixture));
    const result = await context.tool("validate_research_bundle").handler({
        bundle: fixture.bundle,
    });
    assert.equal(result.structuredContent.valid, true);

    const absent = clone(fixture.bundle);
    absent.sources[0].exactExcerpt = "This quote is absent.";
    await assert.rejects(
        context.tool("validate_research_bundle").handler({
            bundle: rehash(absent),
        }),
        (error) => error.code === "EXACT_EXCERPT_MISMATCH",
    );
});

test("persist draft validates before making it available to the draft canvas store", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.tool("record_learn_evidence").handler(recordInput(fixture));
    const draft = clone(fixture.bundle);
    draft.status = "draft";
    draft.lifecycle = {
        createdAt: draft.lifecycle.createdAt,
        updatedAt: draft.lifecycle.createdAt,
    };
    const bundle = rehash(draft);
    const result = await context.tool("persist_research_draft").handler({ bundle });
    assert.equal(result.structuredContent.persisted, true);
    assert.equal(
        (await context.draftStore.readBundle(RESEARCH_ID, 1)).contentHash,
        bundle.contentHash,
    );

    const invalid = clone(bundle);
    invalid.sources[0].exactExcerpt = "Absent excerpt.";
    await assert.rejects(
        context.tool("persist_research_draft").handler({ bundle: rehash(invalid) }),
        (error) => error.code === "EXACT_EXCERPT_MISMATCH",
    );
    assert.equal(
        (await context.draftStore.readBundle(RESEARCH_ID, 1)).contentHash,
        bundle.contentHash,
    );
});

test("publish tool validates before writing and stores a separate handoff", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.tool("record_learn_evidence").handler(recordInput(fixture));
    const result = await context.tool("publish_research_bundle").handler({
        bundle: fixture.bundle,
        handoff: handoffFor(fixture.bundle),
    });
    assert.equal(result.structuredContent.published, true);
    assert.equal(result.structuredContent.handoffStored, true);
    assert.equal((await context.publishedStore.get(RESEARCH_ID, 1)).contentHash, fixture.bundle.contentHash);
});

test("invalid publication does not create a published record", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.draftStore.recordCapture(fixture.capture);
    const invalid = clone(fixture.bundle);
    invalid.sources[0].retrievalMethod = "docs-search";
    await assert.rejects(
        context.tool("publish_research_bundle").handler({
            bundle: rehash(invalid),
        }),
        (error) => error.code === "NON_FETCH_SOURCE",
    );
    await assert.rejects(
        context.publishedStore.get(RESEARCH_ID, 1),
        (error) => error.code === "PUBLISHED_NOT_FOUND",
    );
});

test("invalid handoff content fails before publishing evidence", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });
    await context.draftStore.recordCapture(fixture.capture);
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = fixture.markdown;
    await assert.rejects(
        context.tool("publish_research_bundle").handler({
            bundle: fixture.bundle,
            handoff,
        }),
        (error) => error.code === "HANDOFF_FULL_FETCH_CONTENT",
    );
    await assert.rejects(
        context.publishedStore.get(RESEARCH_ID, 1),
        (error) => error.code === "PUBLISHED_NOT_FOUND",
    );
});

test("get tool reads explicit and latest versions through hash verification", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    await context.draftStore.recordCapture(fixture.capture);
    await context.publishedStore.publish(fixture.bundle, [fixture.capture]);
    const explicit = await context.tool("get_research_bundle").handler({
        researchId: RESEARCH_ID,
        version: 1,
    });
    const latest = await context.tool("get_research_bundle").handler({
        researchId: RESEARCH_ID,
    });
    assert.equal(explicit.structuredContent.bundle.contentHash, fixture.bundle.contentHash);
    assert.equal(latest.structuredContent.bundle.version, 1);
});

test("published handoff acknowledgement is verified, idempotent, and no-regression", async (t) => {
    const context = await harness(t);
    const first = makePublishedEvidence({ version: 1 });
    const second = makePublishedEvidence({
        version: 2,
        question: "What changed in version two?",
    });
    for (const fixture of [first, second]) {
        await context.draftStore.recordCapture(fixture.capture);
        await context.tool("publish_research_bundle").handler({
            bundle: fixture.bundle,
            handoff: handoffFor(fixture.bundle),
        });
    }
    context.setNow("2026-08-12T09:05:00Z");
    const acknowledged = await context.tool("acknowledge_research_handoff").handler({
        parentSessionId: PARENT_SESSION_ID,
        handoff: handoffFor(second.bundle),
    });
    assert.equal(acknowledged.structuredContent.outcome, "acknowledged");
    const duplicate = await context.tool("acknowledge_research_handoff").handler({
        parentSessionId: PARENT_SESSION_ID,
        handoff: handoffFor(second.bundle),
    });
    assert.equal(duplicate.structuredContent.outcome, "duplicate");
    const stale = await context.tool("acknowledge_research_handoff").handler({
        parentSessionId: PARENT_SESSION_ID,
        handoff: handoffFor(first.bundle),
    });
    assert.equal(stale.structuredContent.outcome, "stale");
    assert.equal(stale.structuredContent.acknowledgement.version, 2);
    await assert.rejects(
        context.publishedStore.getAcknowledgement(PARENT_SESSION_ID, RESEARCH_ID, 1),
        (error) => error.code === "ACKNOWLEDGEMENT_NOT_FOUND",
    );
});

test("conflicting or misbound deliveries fail without making the handoff unretryable", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    const handoff = handoffFor(fixture.bundle);
    await context.draftStore.recordCapture(fixture.capture);
    await context.tool("publish_research_bundle").handler({
        bundle: fixture.bundle,
        handoff,
    });
    const conflicting = clone(handoff);
    conflicting.executiveFindings[0].text = "Different delivery prose.";
    await assert.rejects(
        context.tool("acknowledge_research_handoff").handler({
            parentSessionId: PARENT_SESSION_ID,
            handoff: conflicting,
        }),
        (error) => error.code === "HANDOFF_DELIVERY_CONFLICT",
    );
    const wrongHash = clone(handoff);
    wrongHash.contentHash = "f".repeat(64);
    await assert.rejects(
        context.tool("acknowledge_research_handoff").handler({
            parentSessionId: PARENT_SESSION_ID,
            handoff: wrongHash,
        }),
        (error) => error.code === "HANDOFF_DELIVERY_CONFLICT",
    );
    await assert.rejects(
        context.tool("acknowledge_research_handoff").handler({
            parentSessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            handoff,
        }),
        (error) => error.code === "HANDOFF_PARENT_MISMATCH",
    );
    context.setNow("2026-08-12T09:05:00Z");
    const retried = await context.tool("acknowledge_research_handoff").handler({
        parentSessionId: PARENT_SESSION_ID,
        handoff,
    });
    assert.equal(retried.structuredContent.outcome, "acknowledged");
});

test("later publication can supersede v1 without changing its immutable payload", async (t) => {
    const context = await harness(t);
    const first = makePublishedEvidence({ version: 1 });
    const second = makePublishedEvidence({
        version: 2,
        question: "What changed in version two?",
    });
    await context.publishedStore.publish(first.bundle, [first.capture]);
    await context.publishedStore.publish(second.bundle, [second.capture]);
    const originalHash = (await context.publishedStore.get(RESEARCH_ID, 1)).contentHash;
    const result = await context.tool("supersede_research_bundle").handler({
        researchId: RESEARCH_ID,
        version: 1,
        supersedingVersion: 2,
        supersededAt: "2026-08-12T09:10:00Z",
    });
    assert.equal(result.structuredContent.status, "superseded");
    assert.equal((await context.publishedStore.get(RESEARCH_ID, 1)).contentHash, originalHash);
    assert.equal((await context.publishedStore.getLatest(RESEARCH_ID)).version, 2);
});

test("publish read-back and handoff remain bounded and exclude fetched pages", async (t) => {
    const context = await harness(t);
    const fixture = makePublishedEvidence();
    const handoff = handoffFor(fixture.bundle);
    await context.draftStore.recordCapture(fixture.capture);
    await context.tool("validate_research_bundle").handler({ bundle: fixture.bundle });
    await context.tool("publish_research_bundle").handler({
        bundle: fixture.bundle,
        handoff,
    });
    const readBack = await context.tool("get_research_bundle").handler({
        researchId: RESEARCH_ID,
        version: 1,
    });
    assert.equal(readBack.structuredContent.bundle.contentHash, handoff.contentHash);
    assert.equal(JSON.stringify(handoff).includes(fixture.markdown), false);
    assert.equal(JSON.stringify(handoff).includes("fetchedMarkdown"), false);
});
