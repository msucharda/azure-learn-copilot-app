import assert from "node:assert/strict";
import {
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { ServerResponse, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    DraftEvidenceStore,
    LEARN_REFERENCES_CANVAS_ID,
    LEARN_REFERENCES_INPUT_SCHEMA,
    PublishedEvidenceStore,
    REFRESH_ACTION_SCHEMA,
    createLearnReferencesCanvas,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    RESEARCH_ID,
    clone,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

class TestCanvasError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function draftFixture(options = {}) {
    const fixture = makePublishedEvidence(options);
    const bundle = clone(fixture.bundle);
    bundle.status = "draft";
    bundle.lifecycle = {
        createdAt: bundle.lifecycle.createdAt,
        updatedAt: bundle.lifecycle.createdAt,
    };
    fixture.bundle = rehash(bundle);
    return fixture;
}

async function harness(t, providerOptions = {}) {
    const root = await mkdtemp(join(tmpdir(), "learn-reference-canvas-"));
    const draftStore = await DraftEvidenceStore.create({ root: join(root, "draft") });
    const publishedStore = await PublishedEvidenceStore.create({
        root: join(root, "published"),
    });
    const provider = createLearnReferencesCanvas({
        CanvasError: TestCanvasError,
        createCanvas: (options) => options,
        draftStore,
        publishedStore,
        ...providerOptions,
    });
    t.after(async () => {
        await provider.closeAll();
        await rm(root, { recursive: true, force: true });
    });
    return {
        ...provider,
        draftStore,
        publishedStore,
        root,
    };
}

function openContext(instanceId, input) {
    return {
        instanceId,
        input,
    };
}

function action(canvas, name) {
    return canvas.actions.find((entry) => entry.name === name);
}

async function state(url) {
    const response = await fetch(new URL("/state", url));
    return {
        body: await response.json(),
        response,
    };
}

async function openSse(url) {
    let request;
    const response = await new Promise((resolve, reject) => {
        request = get(new URL("/events", url), resolve);
        request.on("error", reject);
    });
    return { request, response };
}

function waitForClose(response, timeoutMs = 1_000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for SSE client close.")),
            timeoutMs,
        );
        response.once("close", () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

test("reference canvas declares strict bounded input and action schemas", async (t) => {
    const { canvas } = await harness(t);
    assert.equal(canvas.id, LEARN_REFERENCES_CANVAS_ID);
    assert.equal(LEARN_REFERENCES_INPUT_SCHEMA.additionalProperties, false);
    assert.deepEqual(LEARN_REFERENCES_INPUT_SCHEMA.required, ["researchId", "view"]);
    assert.deepEqual(LEARN_REFERENCES_INPUT_SCHEMA.properties.view.enum, ["draft", "published"]);
    assert.equal(REFRESH_ACTION_SCHEMA.additionalProperties, false);
    assert.deepEqual(canvas.actions.map((entry) => entry.name), ["refresh"]);
});

test("draft view reads explicit and latest validated versions", async (t) => {
    const context = await harness(t);
    const first = draftFixture({ version: 1 });
    const latest = draftFixture({
        version: 2,
        question: "What is the latest draft?",
    });
    await context.draftStore.writeBundle(first.bundle);
    await context.draftStore.writeBundle(latest.bundle);

    const explicitOpen = await context.canvas.open(openContext("draft-explicit", {
        researchId: RESEARCH_ID,
        version: 1,
        view: "draft",
    }));
    const latestOpen = await context.canvas.open(openContext("draft-latest", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    assert.equal((await state(explicitOpen.url)).body.version, 1);
    assert.equal((await state(latestOpen.url)).body.version, 2);
});

test("published view reads explicit and latest committed versions", async (t) => {
    const context = await harness(t);
    const first = makePublishedEvidence({ version: 1 });
    const latest = makePublishedEvidence({
        version: 2,
        question: "What is the latest publication?",
    });
    await context.publishedStore.publish(first.bundle, [first.capture]);
    await context.publishedStore.publish(latest.bundle, [latest.capture]);

    const explicitOpen = await context.canvas.open(openContext("published-explicit", {
        researchId: RESEARCH_ID,
        version: 1,
        view: "published",
    }));
    const latestOpen = await context.canvas.open(openContext("published-latest", {
        researchId: RESEARCH_ID,
        view: "published",
    }));
    assert.equal((await state(explicitOpen.url)).body.version, 1);
    assert.equal((await state(latestOpen.url)).body.version, 2);
});

test("missing, incomplete, and tampered records fail visibly without a server", async (t) => {
    const context = await harness(t);
    await assert.rejects(
        context.canvas.open(openContext("missing", {
            researchId: RESEARCH_ID,
            view: "draft",
        })),
        (error) => error.code === "latest_draft_not_found"
            && !error.message.includes(context.root),
    );

    const partial = makePublishedEvidence();
    const partialPaths = await context.publishedStore.paths(RESEARCH_ID, 1);
    await writeFile(partialPaths.payload, JSON.stringify(partial.bundle));
    await assert.rejects(
        context.canvas.open(openContext("partial", {
            researchId: RESEARCH_ID,
            version: 1,
            view: "published",
        })),
        (error) => error.code === "incomplete_publication",
    );
    await rm(join(context.root, "published"), { recursive: true, force: true });

    const replacement = await PublishedEvidenceStore.create({
        root: join(context.root, "published"),
    });
    const tampered = makePublishedEvidence();
    await replacement.publish(tampered.bundle, [tampered.capture]);
    const paths = await replacement.paths(RESEARCH_ID, 1, {
        createDirectories: false,
    });
    const payload = JSON.parse(await readFile(paths.payload, "utf8"));
    payload.question.original = "tampered";
    await writeFile(paths.payload, JSON.stringify(payload));
    const tamperedProvider = createLearnReferencesCanvas({
        CanvasError: TestCanvasError,
        createCanvas: (options) => options,
        draftStore: context.draftStore,
        publishedStore: replacement,
    });
    t.after(() => tamperedProvider.closeAll());
    await assert.rejects(
        tamperedProvider.canvas.open(openContext("tampered", {
            researchId: RESEARCH_ID,
            version: 1,
            view: "published",
        })),
        (error) => error.code === "content_hash_mismatch",
    );
    assert.equal(context.instanceCount(), 0);
});

test("same-instance reopen reuses one loopback server", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const input = {
        researchId: RESEARCH_ID,
        version: 1,
        view: "draft",
    };
    const first = await context.canvas.open(openContext("same-instance", input));
    const reopened = await context.canvas.open(openContext("same-instance", input));
    assert.equal(reopened.url, first.url);
    assert.equal(context.instanceCount(), 1);
});

test("concurrent same-instance opens share one server and close releases its port", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const input = {
        researchId: RESEARCH_ID,
        version: 1,
        view: "draft",
    };
    const [first, second] = await Promise.all([
        context.canvas.open(openContext("concurrent-instance", input)),
        context.canvas.open(openContext("concurrent-instance", input)),
    ]);
    assert.equal(first.url, second.url);
    assert.equal(context.instanceCount(), 1);
    assert.equal((await fetch(first.url)).status, 200);

    await context.canvas.onClose({ instanceId: "concurrent-instance" });
    await assert.rejects(fetch(first.url));
    await assert.rejects(fetch(second.url));
});

test("two instances share the same bounded reference projection", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const input = { researchId: RESEARCH_ID, view: "draft" };
    const first = await context.canvas.open(openContext("first-instance", input));
    const second = await context.canvas.open(openContext("second-instance", input));
    assert.notEqual(first.url, second.url);
    assert.deepEqual((await state(first.url)).body, (await state(second.url)).body);
});

test("refresh action validates input and pushes a bounded SSE repaint event", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("refresh-instance", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    const { request, response } = await openSse(opened.url);
    response.setEncoding("utf8");
    let body = "";
    const sse = new Promise((resolve) => {
        response.on("data", (chunk) => {
            body += chunk;
            if (body.includes("event: refresh")) {
                resolve(body);
            }
        });
    });
    const refreshed = await action(context.canvas, "refresh").handler({
        instanceId: "refresh-instance",
        input: {},
    });
    assert.equal(refreshed.revision, 1);
    assert.match(await sse, /event: refresh/);
    request.destroy();
    await assert.rejects(
        action(context.canvas, "refresh").handler({
            instanceId: "refresh-instance",
            input: { unexpected: true },
        }),
        (error) => error.code === "invalid_refresh_input",
    );
});

test("refresh broadcast evicts an SSE client immediately on backpressure", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("broadcast-pressure", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    const { request, response } = await openSse(opened.url);
    const closed = waitForClose(response);
    const originalWrite = ServerResponse.prototype.write;
    let pressuredWrites = 0;
    ServerResponse.prototype.write = function patchedWrite(chunk, ...args) {
        if (String(chunk).startsWith("event: refresh")) {
            pressuredWrites += 1;
            return false;
        }
        return originalWrite.call(this, chunk, ...args);
    };
    try {
        await action(context.canvas, "refresh").handler({
            instanceId: "broadcast-pressure",
            input: {},
        });
        await closed;
        await action(context.canvas, "refresh").handler({
            instanceId: "broadcast-pressure",
            input: {},
        });
        assert.equal(pressuredWrites, 1);
    } finally {
        ServerResponse.prototype.write = originalWrite;
        request.destroy();
    }
});

test("heartbeat evicts an SSE client immediately on backpressure", async (t) => {
    const context = await harness(t, { heartbeatMs: 20 });
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("heartbeat-pressure", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    const { request, response } = await openSse(opened.url);
    const closed = waitForClose(response);
    const originalWrite = ServerResponse.prototype.write;
    let pressuredWrites = 0;
    ServerResponse.prototype.write = function patchedWrite(chunk, ...args) {
        if (String(chunk) === ": heartbeat\n\n") {
            pressuredWrites += 1;
            return false;
        }
        return originalWrite.call(this, chunk, ...args);
    };
    try {
        await closed;
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(pressuredWrites, 1);
    } finally {
        ServerResponse.prototype.write = originalWrite;
        request.destroy();
    }
});

test("close releases SSE clients and the unpredictable loopback port", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("close-instance", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const eventRequest = get(new URL("/events", opened.url));
    await new Promise((resolve) => eventRequest.once("response", resolve));
    await context.canvas.onClose({ instanceId: "close-instance" });
    assert.equal(context.instanceCount(), 0);
    await assert.rejects(fetch(opened.url));
    eventRequest.destroy();
});

test("renderer uses text-only DOM APIs, safe Learn links, and strict CSP", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture();
    fixture.bundle.sources[0].title = "<img src=x onerror=alert(1)>";
    fixture.bundle = rehash(fixture.bundle);
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("security-instance", {
        researchId: RESEARCH_ID,
        view: "draft",
    }));
    const html = await fetch(opened.url);
    const htmlBody = await html.text();
    const script = await (await fetch(new URL("/app.js", opened.url))).text();
    const canvasState = await state(opened.url);
    assert.match(html.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(html.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(htmlBody.includes(fixture.bundle.question.original), false);
    assert.equal(script.includes("innerHTML"), false);
    assert.match(script, /textContent/);
    assert.match(script, /noopener noreferrer/);
    assert.equal(canvasState.body.sources[0].title, fixture.bundle.sources[0].title);
    assert.equal(canvasState.body.sources[0].canonicalUrl, "https://learn.microsoft.com/azure/example");
    for (const excluded of [
        "claims",
        "contentHash",
        "lifecycle",
        "officialSkill",
        "question",
        "scope",
        "summary",
        "unresolvedItems",
    ]) {
        assert.equal(Object.hasOwn(canvasState.body, excluded), false);
    }
    assert.equal(JSON.stringify(canvasState.body).includes(fixture.markdown), false);
});

test("invalid identifiers, traversal, versions, views, and unknown input fail before serving", async (t) => {
    const context = await harness(t);
    const invalidInputs = [
        { researchId: "../outside", view: "draft" },
        { researchId: RESEARCH_ID, version: 0, view: "draft" },
        { researchId: RESEARCH_ID, version: 1.5, view: "draft" },
        { researchId: RESEARCH_ID, view: "other" },
        { researchId: RESEARCH_ID, view: "draft", path: "../../secret" },
    ];
    for (const [index, input] of invalidInputs.entries()) {
        await assert.rejects(
            context.canvas.open(openContext(`invalid-${index}`, input)),
            (error) => error.code === "invalid_reference_input",
        );
    }
    assert.equal(context.instanceCount(), 0);
});

test("source cards expose bounded evidence fields and never fetched page content", async (t) => {
    const context = await harness(t);
    const fixture = draftFixture({
        markdown: "FULL_PAGE_SENTINEL\n\nTool schemas are discovered at runtime.\n\nRemaining page.",
    });
    await context.draftStore.writeBundle(fixture.bundle);
    const opened = await context.canvas.open(openContext("bounded-instance", {
        researchId: RESEARCH_ID,
        version: 1,
        view: "draft",
    }));
    const canvasState = (await state(opened.url)).body;
    assert.deepEqual(Object.keys(canvasState).sort(), [
        "researchId",
        "sources",
        "status",
        "version",
        "view",
    ]);
    assert.deepEqual(Object.keys(canvasState.sources[0]).sort(), [
        "canonicalUrl",
        "exactExcerpt",
        "id",
        "sectionHeading",
        "title",
    ]);
    assert.equal(JSON.stringify(canvasState).includes("FULL_PAGE_SENTINEL"), false);
});
