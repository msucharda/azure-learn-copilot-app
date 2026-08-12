import assert from "node:assert/strict";
import {
    mkdtemp,
    rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    DraftEvidenceStore,
    LearnMcpAdapterError,
    PublishedEvidenceStore,
    RECORD_LEARN_EVIDENCE_SCHEMA,
    createLearnReferenceTools,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
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
    const learnAdapter = {
        execute: (operation, args) => execute(operation, args),
    };
    const tools = createLearnReferenceTools({
        draftStore,
        publishedStore,
        learnAdapter,
        now: () => "2026-08-12T09:01:00Z",
        uuid: () => "90000000-0000-4000-8000-000000000001",
    });
    return {
        root,
        draftStore,
        publishedStore,
        setExecute(callback) {
            execute = callback;
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
            "record_learn_evidence",
            "validate_research_bundle",
            "publish_research_bundle",
            "get_research_bundle",
        ],
    );
    for (const tool of tools) {
        assertStrictObjects(tool.parameters);
    }
    assert.equal(RECORD_LEARN_EVIDENCE_SCHEMA.properties.argumentsJson.maxLength, 20_000);
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
