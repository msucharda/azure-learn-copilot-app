import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
    LocalStructuredTelemetry,
    createLearnReferenceTools,
    createLocalTelemetryFromEnv,
} from "../.github/extensions/learn-references/lib/index.mjs";

async function testRoot(t) {
    const root = await mkdtemp(join(
        await realpath(tmpdir()),
        "learn-reference-telemetry-",
    ));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

test("telemetry is disabled unless explicitly opted in", async (t) => {
    const root = await testRoot(t);
    assert.equal(await createLocalTelemetryFromEnv({
        env: {},
        defaultRoot: join(root, "disabled"),
    }), undefined);
});

test("strict events never persist forbidden payload sentinel content", async (t) => {
    const root = await testRoot(t);
    const telemetry = await LocalStructuredTelemetry.create({
        root,
        maxFileBytes: 1_024,
        maxFiles: 3,
        now: () => "2026-08-12T21:17:42.979Z",
    });
    const sentinel = "FORBIDDEN_PROMPT_SECRET_URL_BODY_RAW_ERROR";
    await assert.rejects(
        telemetry.record({
            operation: "record_learn_evidence",
            outcome: "failure",
            durationMs: 1,
            rawError: sentinel,
        }),
        (error) => error.code === "INVALID_EVENT",
    );
    await telemetry.record({
        operation: "record_learn_evidence",
        outcome: "failure",
        durationMs: 4,
        resultCount: 0,
        errorKind: "adapter",
        retryCount: 2,
        cacheStatus: "miss",
        researchIdHash: "a".repeat(64),
    });
    const text = await readFile(join(root, "telemetry.ndjson"), "utf8");
    assert.equal(text.includes(sentinel), false);
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
        "cacheStatus",
        "durationMs",
        "errorKind",
        "event",
        "operation",
        "outcome",
        "researchIdHash",
        "resultCount",
        "retryCount",
        "schemaVersion",
        "timestamp",
    ]);
});

test("rotation and retention keep every telemetry file within hard bounds", async (t) => {
    const root = await testRoot(t);
    const maxFileBytes = 700;
    const telemetry = await LocalStructuredTelemetry.create({
        root,
        maxFileBytes,
        maxFiles: 3,
    });
    await Promise.all(Array.from({ length: 80 }, () => telemetry.record({
        operation: "prepare_learn_research",
        outcome: "success",
        durationMs: 3,
        researchIdHash: "b".repeat(64),
    })));
    const entries = await readdir(root);
    assert.ok(entries.length <= 3);
    for (const entry of entries) {
        assert.match(entry, /^telemetry(?:\.[12])?\.ndjson$/);
        assert.ok((await stat(join(root, entry))).size <= maxFileBytes);
    }
});

test("telemetry refuses a pre-existing file beyond its configured bound", async (t) => {
    const root = await testRoot(t);
    const telemetry = await LocalStructuredTelemetry.create({
        root,
        maxFileBytes: 512,
    });
    await writeFile(join(root, "telemetry.ndjson"), "x".repeat(513));
    await assert.rejects(
        telemetry.record({
            operation: "prepare_learn_research",
            outcome: "success",
            durationMs: 1,
        }),
        (error) => error.code === "FILE_TOO_LARGE",
    );
    assert.equal((await stat(join(root, "telemetry.ndjson"))).size, 513);
});

test("telemetry rejects symlinked roots and files without touching targets", async (t) => {
    const root = await testRoot(t);
    const outside = join(root, "outside");
    const linkedRoot = join(root, "linked");
    await mkdir(outside);
    await symlink(outside, linkedRoot);
    await assert.rejects(
        LocalStructuredTelemetry.create({ root: linkedRoot }),
        (error) => error.code === "UNSAFE_PATH",
    );
    await mkdir(join(outside, "existing"));
    await assert.rejects(
        LocalStructuredTelemetry.create({ root: join(linkedRoot, "existing") }),
        (error) => error.code === "UNSAFE_PATH",
    );

    const safeRoot = join(root, "safe");
    const telemetry = await LocalStructuredTelemetry.create({ root: safeRoot });
    const target = join(outside, "target");
    await writeFile(target, "UNCHANGED");
    await symlink(target, join(safeRoot, "telemetry.ndjson"));
    await assert.rejects(
        telemetry.record({
            operation: "get_research_bundle",
            outcome: "success",
            durationMs: 1,
        }),
        (error) => error.code === "UNSAFE_PATH",
    );
    assert.equal(await readFile(target, "utf8"), "UNCHANGED");
});

test("tool telemetry preserves original failures and redacts their payloads", async () => {
    const sentinel = "FORBIDDEN_RAW_ERROR_AND_PROMPT";
    const events = [];
    const tools = createLearnReferenceTools({
        draftStore: {},
        publishedStore: {},
        learnAdapter: { execute() {} },
        telemetry: { record: async (event) => events.push(event) },
    });
    const tool = tools.find(({ name }) => name === "get_research_bundle");
    await assert.rejects(
        tool.handler({ researchId: sentinel }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "failure");
    assert.equal(JSON.stringify(events).includes(sentinel), false);
});

test("telemetry failures are reported without changing tool success", async () => {
    let reports = 0;
    const tools = createLearnReferenceTools({
        draftStore: {},
        publishedStore: {
            getLatest: async () => ({ status: "published" }),
        },
        learnAdapter: { execute() {} },
        telemetry: {
            record() {
                throw new Error("telemetry unavailable");
            },
        },
        reportTelemetryFailure: (code) => {
            assert.equal(code, "UNKNOWN_TELEMETRY_FAILURE");
            reports += 1;
        },
    });
    const result = await tools.find(({ name }) => name === "get_research_bundle").handler({
        researchId: "80000000-0000-4000-8000-000000000001",
    });
    assert.equal(result.resultType, "success");
    assert.equal(reports, 1);
});

test("evidence telemetry records explicit cache bypass state", async () => {
    const events = [];
    const tools = createLearnReferenceTools({
        draftStore: {
            recordCapture: async (capture) => capture,
        },
        publishedStore: {},
        learnAdapter: {
            execute: async () => ({
                runtimeToolName: "opaque-fetch",
                resultSha256: "a".repeat(64),
                resultCount: 0,
                sourceUrls: [],
            }),
        },
        telemetry: { record: async (event) => events.push(event) },
        uuid: () => "90000000-0000-4000-8000-000000000001",
        now: () => "2026-08-12T21:17:42.979Z",
    });
    await tools.find(({ name }) => name === "record_learn_evidence").handler({
        researchId: "80000000-0000-4000-8000-000000000001",
        logicalOperation: "docs-search",
        argumentsJson: "{\"query\":\"sentinel must not be logged\"}",
    });
    assert.equal(events[0].cacheStatus, "bypass");
    assert.equal(JSON.stringify(events).includes("sentinel"), false);
});
