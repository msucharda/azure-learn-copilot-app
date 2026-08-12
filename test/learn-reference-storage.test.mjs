import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    DraftEvidenceStore,
    LearnReferenceStorageError,
    PublishedEvidenceStore,
    assertHandoffContentBounded,
    canonicalJson,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    RESEARCH_ID,
    acknowledgementFor,
    clone,
    handoffFor,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

async function stores(t) {
    const root = await mkdtemp(join(tmpdir(), "learn-reference-storage-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    return {
        root,
        draft: await DraftEvidenceStore.create({ root: join(root, "draft") }),
        published: await PublishedEvidenceStore.create({ root: join(root, "published") }),
    };
}

function expectStorageCode(code) {
    return (error) => {
        assert.equal(error instanceof LearnReferenceStorageError, true);
        assert.equal(error.code, code);
        return true;
    };
}

test("draft captures are isolated by configured workspace root", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "learn-draft-isolation-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await DraftEvidenceStore.create({ root: join(root, "first") });
    const second = await DraftEvidenceStore.create({ root: join(root, "second") });
    const fixture = makePublishedEvidence();
    await first.recordCapture(fixture.capture);
    assert.equal((await first.listCaptures(RESEARCH_ID)).length, 1);
    assert.equal((await second.listCaptures(RESEARCH_ID)).length, 0);
});

test("draft storage rejects traversal and symlink escapes", async (t) => {
    const { root, draft } = await stores(t);
    await assert.rejects(
        draft.listCaptures("../outside"),
        (error) => error.code === "INVALID_LENGTH" || error.code === "INVALID_FORMAT",
    );

    const outside = join(root, "outside");
    await mkdir(outside);
    await mkdir(join(root, "draft", "captures"), { recursive: true });
    await symlink(outside, join(root, "draft", "captures", RESEARCH_ID));
    await assert.rejects(
        draft.listCaptures(RESEARCH_ID),
        expectStorageCode("SYMLINK_ESCAPE"),
    );

    const linkedRoot = join(root, "linked-root");
    await symlink(outside, linkedRoot);
    await assert.rejects(
        DraftEvidenceStore.create({ root: linkedRoot }),
        expectStorageCode("UNSAFE_STORAGE_ROOT"),
    );
});

test("concurrent identical publication is idempotent", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    const results = await Promise.all(
        Array.from({ length: 8 }, () => published.publish(
            fixture.bundle,
            [fixture.capture],
        )),
    );
    assert.equal(results.every((bundle) => bundle.contentHash === fixture.bundle.contentHash), true);
    assert.equal((await published.get(RESEARCH_ID, 1)).status, "published");
});

test("publication fails closed on an abandoned cross-process lock", async (t) => {
    const { root, published } = await stores(t);
    const lockRoot = join(root, "published", ".write-lock");
    await mkdir(lockRoot);
    await writeFile(join(lockRoot, "owner.json"), canonicalJson({
        schemaVersion: 1,
        pid: 2_147_483_647,
        token: "90000000-0000-4000-8000-000000000099",
        createdAt: "2026-08-12T09:00:00.000Z",
    }));
    const fixture = makePublishedEvidence();
    await assert.rejects(
        published.publish(fixture.bundle, [fixture.capture]),
        expectStorageCode("ABANDONED_STORAGE_LOCK"),
    );
});

test("same evidence key with different immutable content conflicts", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);

    const changed = clone(fixture.bundle);
    changed.question.normalized = "A different immutable question.";
    await assert.rejects(
        published.publish(rehash(changed), [fixture.capture]),
        expectStorageCode("PUBLICATION_CONFLICT"),
    );
});

test("publication rejects a capture whose retrieval URL does not match its canonical URL", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    const mismatchedCapture = {
        ...fixture.capture,
        retrievalUrl: "https://learn.microsoft.com/azure/other?view=current",
        sourceUrls: ["https://learn.microsoft.com/azure/other?view=current"],
    };
    await assert.rejects(
        published.publish(fixture.bundle, [mismatchedCapture]),
        (error) => error.code === "FETCH_URL_MISMATCH",
    );
});

test("publication retains every fetch capture hash, including zero-overlap captures", async (t) => {
    const { root, published } = await stores(t);
    const declared = makePublishedEvidence();
    const undeclared = makePublishedEvidence({
        version: 2,
        markdown: "^".repeat(100),
        exactExcerpt: "^".repeat(10),
        canonicalUrl: "https://learn.microsoft.com/azure/zero-overlap",
        retrievalUrl: "https://learn.microsoft.com/azure/zero-overlap?view=current",
    });
    await published.publish(declared.bundle, [
        declared.capture,
        undeclared.capture,
    ]);
    const retention = JSON.parse(await readFile(join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        "retention.json",
    ), "utf8"));
    assert.deepEqual(retention.contentHashes, [
        declared.capture.resultSha256,
        undeclared.capture.resultSha256,
    ].sort());
});

test("valid no-evidence bundles publish with an empty retention index", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    const noEvidence = clone(fixture.bundle);
    noEvidence.claims[0].support = "unsupported";
    noEvidence.claims[0].sourceIds = [];
    noEvidence.sources = [];
    const bundle = rehash(noEvidence);
    assert.equal((await published.publish(bundle, [])).contentHash, bundle.contentHash);
    const retention = JSON.parse(await readFile(join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        "retention.json",
    ), "utf8"));
    assert.deepEqual(retention.contentHashes, []);
});

test("readers reject partial publication", async (t) => {
    const { root, published } = await stores(t);
    const { bundle } = makePublishedEvidence();
    const versionRoot = join(root, "published", "evidence", RESEARCH_ID, "1");
    await mkdir(versionRoot, { recursive: true });
    const {
        status: _status,
        lifecycle: _lifecycle,
        ...payload
    } = bundle;
    await writeFile(join(versionRoot, "payload.json"), canonicalJson(payload));
    await assert.rejects(
        published.get(RESEARCH_ID, 1),
        expectStorageCode("INCOMPLETE_PUBLICATION"),
    );
});

test("missing reads do not create persistent version directories", async (t) => {
    const { root, published } = await stores(t);
    await assert.rejects(
        published.get(RESEARCH_ID, 999),
        expectStorageCode("PUBLISHED_NOT_FOUND"),
    );
    await assert.rejects(
        readdir(join(root, "published", "evidence", RESEARCH_ID, "999")),
        (error) => error?.code === "ENOENT",
    );
});

test("published reads detect immutable payload tampering", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const payloadPath = join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        "payload.json",
    );
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    payload.question.normalized = "Tampered on disk.";
    await writeFile(payloadPath, JSON.stringify(payload));
    await assert.rejects(
        published.get(RESEARCH_ID, 1),
        (error) => error.code === "CONTENT_HASH_MISMATCH",
    );
});

test("published reads detect initial lifecycle tampering", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const lifecyclePath = join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        "lifecycle.json",
    );
    const lifecycle = JSON.parse(await readFile(lifecyclePath, "utf8"));
    lifecycle.lifecycle.createdAt = "2026-08-12T08:59:00.000Z";
    await writeFile(lifecyclePath, JSON.stringify(lifecycle));
    await assert.rejects(
        published.get(RESEARCH_ID, 1),
        expectStorageCode("PUBLICATION_COMMIT_MISMATCH"),
    );
});

test("published reads accept legacy v1 retention metadata", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const budgetPath = join(
        root,
        "published",
        "retention",
        fixture.capture.resultSha256,
        "budget.json",
    );
    const legacy = JSON.parse(await readFile(budgetPath, "utf8"));
    legacy.intervals = [{
        start: 0,
        end: legacy.contentLength - 1,
        segmentHash: "0".repeat(64),
    }];
    legacy.totalChars = legacy.contentLength - 1;
    legacy.decoratedFragments = [];
    await writeFile(budgetPath, canonicalJson(legacy));
    assert.equal(
        (await published.get(RESEARCH_ID, 1)).contentHash,
        fixture.bundle.contentHash,
    );
});

test("latest selection never regresses under out-of-order publication", async (t) => {
    const { published } = await stores(t);
    const first = makePublishedEvidence({
        version: 1,
        question: "Version one?",
        markdown: [
            "Version one fetched page.",
            "Tool schemas are discovered at runtime.",
            "Additional unique content for the first version.",
        ].join("\n"),
    });
    const second = makePublishedEvidence({
        version: 2,
        question: "Version two?",
        markdown: [
            "Version two fetched page.",
            "Tool schemas are discovered at runtime.",
            "Additional unique content for the second version.",
        ].join("\n"),
    });
    await published.publish(second.bundle, [second.capture]);
    await published.publish(first.bundle, [first.capture]);
    assert.equal((await published.getLatest(RESEARCH_ID)).version, 2);
    assert.equal((await published.get(RESEARCH_ID, 1)).version, 1);
    assert.equal((await published.get(RESEARCH_ID, 2)).version, 2);
});

test("durable retention prevents new page fragments across evidence versions", async (t) => {
    const { published } = await stores(t);
    const markdown = [
        "UNIQUE-FIRST-FRAGMENT",
        "middle content that is intentionally much longer than either quote",
        "UNIQUE-SECOND-FRAGMENT",
    ].join("\n");
    const first = makePublishedEvidence({
        version: 1,
        markdown,
        exactExcerpt: "UNIQUE-FIRST-FRAGMENT",
    });
    const second = makePublishedEvidence({
        version: 2,
        markdown,
        exactExcerpt: "UNIQUE-SECOND-FRAGMENT",
    });
    await published.publish(first.bundle, [first.capture]);
    await assert.rejects(
        published.publish(second.bundle, [second.capture]),
        expectStorageCode("RETENTION_BUDGET_CONFLICT"),
    );
    await assert.rejects(
        published.get(RESEARCH_ID, 2),
        expectStorageCode("PUBLISHED_NOT_FOUND"),
    );
    const corrected = makePublishedEvidence({
        version: 2,
        markdown,
        exactExcerpt: "UNIQUE-FIRST-FRAGMENT",
    });
    assert.equal(
        (await published.publish(corrected.bundle, [corrected.capture])).version,
        2,
    );
});

test("key conflicts are rejected before reserving new fetched content", async (t) => {
    const { published } = await stores(t);
    const original = makePublishedEvidence({ version: 1 });
    await published.publish(original.bundle, [original.capture]);

    const otherMarkdown = [
        "UNIQUE-FIRST-FRAGMENT",
        "middle content that is intentionally much longer than either quote",
        "UNIQUE-SECOND-FRAGMENT",
    ].join("\n");
    const conflicting = makePublishedEvidence({
        version: 1,
        markdown: otherMarkdown,
        exactExcerpt: "UNIQUE-FIRST-FRAGMENT",
    });
    await assert.rejects(
        published.publish(conflicting.bundle, [conflicting.capture]),
        expectStorageCode("PUBLICATION_CONFLICT"),
    );

    const legitimate = makePublishedEvidence({
        version: 2,
        markdown: otherMarkdown,
        exactExcerpt: "UNIQUE-SECOND-FRAGMENT",
    });
    assert.equal(
        (await published.publish(legitimate.bundle, [legitimate.capture])).version,
        2,
    );
});

test("multi-page retention conflicts leave no earlier reservation", async (t) => {
    const { published } = await stores(t);
    const pageA = [
        "PAGE-A-FIRST",
        "long middle content separates the excerpts for page A",
        "PAGE-A-SECOND",
    ].join("\n");
    const pageB = [
        "PAGE-B-FIRST",
        "long middle content separates the excerpts for page B",
        "PAGE-B-SECOND",
    ].join("\n");
    const baseline = makePublishedEvidence({
        version: 1,
        markdown: pageB,
        exactExcerpt: "PAGE-B-FIRST",
        canonicalUrl: "https://learn.microsoft.com/azure/page-b",
        retrievalUrl: "https://learn.microsoft.com/azure/page-b?view=current",
    });
    await published.publish(baseline.bundle, [baseline.capture]);

    const firstPage = makePublishedEvidence({
        version: 2,
        markdown: pageA,
        exactExcerpt: "PAGE-A-FIRST",
        canonicalUrl: "https://learn.microsoft.com/azure/page-a",
        retrievalUrl: "https://learn.microsoft.com/azure/page-a?view=current",
    });
    const conflictingPage = makePublishedEvidence({
        version: 3,
        markdown: pageB,
        exactExcerpt: "PAGE-B-SECOND",
        canonicalUrl: "https://learn.microsoft.com/azure/page-b",
        retrievalUrl: "https://learn.microsoft.com/azure/page-b?view=current",
    });
    const combined = clone(firstPage.bundle);
    combined.sources.push({
        ...clone(conflictingPage.bundle.sources[0]),
        id: "source-page-b",
    });
    combined.claims[0].sourceIds.push("source-page-b");
    await assert.rejects(
        published.publish(rehash(combined), [
            firstPage.capture,
            conflictingPage.capture,
        ]),
        expectStorageCode("RETENTION_BUDGET_CONFLICT"),
    );

    const later = makePublishedEvidence({
        version: 3,
        markdown: pageA,
        exactExcerpt: "PAGE-A-SECOND",
        canonicalUrl: "https://learn.microsoft.com/azure/page-a",
        retrievalUrl: "https://learn.microsoft.com/azure/page-a?view=current",
    });
    assert.equal((await published.publish(later.bundle, [later.capture])).version, 3);
});

test("later versions may quote a subrange of already approved content", async (t) => {
    const { published } = await stores(t);
    const markdown = [
        "UNIQUE-FIRST-FRAGMENT-LONG",
        "middle content that keeps the page larger than its excerpts",
    ].join("\n");
    const first = makePublishedEvidence({
        version: 1,
        markdown,
        exactExcerpt: "UNIQUE-FIRST-FRAGMENT-LONG",
    });
    const second = makePublishedEvidence({
        version: 2,
        markdown,
        exactExcerpt: "FIRST-FRAGMENT",
    });
    await published.publish(first.bundle, [first.capture]);
    assert.equal(
        (await published.publish(second.bundle, [second.capture])).version,
        2,
    );
});

test("extension-owned temporary files do not break concurrent directory readers", async (t) => {
    const { root, draft, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await draft.recordCapture(fixture.capture);
    const temporaryName = ".record.json.123.90000000-0000-4000-8000-000000000099.tmp";
    await writeFile(join(
        root,
        "draft",
        "captures",
        RESEARCH_ID,
        temporaryName,
    ), "temporary");
    assert.equal((await draft.listCaptures(RESEARCH_ID)).length, 1);

    await published.publish(fixture.bundle, [fixture.capture]);
    await writeFile(join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        temporaryName,
    ), "temporary");
    assert.equal((await published.getLatest(RESEARCH_ID)).version, 1);
});

test("handoffs persist separately and conflicting duplicates fail", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    await published.storeHandoff(handoff, [fixture.capture]);
    assert.deepEqual(await published.storeHandoff(handoff), handoff);
    assert.equal(
        (await published.getHandoff(
            fixture.bundle.parentSessionId,
            RESEARCH_ID,
            1,
        )).contentHash,
        fixture.bundle.contentHash,
    );
    const handoffText = await readFile(join(
        root,
        "published",
        "handoffs",
        fixture.bundle.parentSessionId,
        RESEARCH_ID,
        "1.json",
    ), "utf8");
    assert.equal(handoffText.includes("fetchedMarkdown"), false);
    const reservationDirectory = join(
        root,
        "published",
        "retention",
        fixture.capture.resultSha256,
        "handoffs",
    );
    const reservationNames = await readdir(reservationDirectory);
    const reservation = JSON.parse(await readFile(
        join(reservationDirectory, reservationNames[0]),
        "utf8",
    ));
    assert.equal(Object.hasOwn(reservation, "textChars"), false);
    assert.equal(Array.isArray(reservation.intervals), true);

    const conflict = clone(handoff);
    conflict.executiveFindings[0].text = "Conflicting duplicate.";
    await assert.rejects(
        published.storeHandoff(conflict),
        expectStorageCode("HANDOFF_CONFLICT"),
    );
});

test("new handoffs require fresh fetch captures", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    await assert.rejects(
        published.storeHandoff(handoffFor(fixture.bundle)),
        expectStorageCode("MISSING_HANDOFF_FETCH_EVIDENCE"),
    );
});

test("unrelated handoff prose consumes no fetched-content budget", async (t) => {
    const { published } = await stores(t);
    const markdown = [
        "Azure routing evaluates health, priority, and capacity before selecting an origin. ",
        "Diagnostic logs explain which rule produced each routing decision. ",
        "Caching at edge locations reduces repeated work for stable responses.",
    ].join("");
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 48),
    });
    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = [
        "The implementation remains intentionally bounded and deterministic. ",
        "Operators receive explicit failures rather than ambiguous fallback records. ",
        "Atomic writes keep incomplete state invisible to concurrent readers.",
    ].join("");
    assert.deepEqual(
        await published.storeHandoff(handoff, [fixture.capture]),
        handoff,
    );
});

test("verified handoff spans enforce the cumulative excerpt budget", async (t) => {
    const { published } = await stores(t);
    const markdown = Array.from({ length: 240 }, (_, index) => (
        `Routing section ${String(index).padStart(3, "0")} evaluates health probes, `
        + "origin priority, regional capacity, cache state, and diagnostic policy "
        + `before selecting endpoint ${String(index).padStart(3, "0")}.\n`
    )).join("");
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    });
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = markdown.slice(500, 1_500);
    handoff.unresolvedRisks = Array.from({ length: 12 }, (_, index) => ({
        id: `risk-retained-span-${index + 1}`,
        text: markdown.slice(1_500 + index * 1_000, 2_500 + index * 1_000),
    }));
    await assert.rejects(
        published.publish(fixture.bundle, [fixture.capture], handoff),
        expectStorageCode("HANDOFF_RETENTION_LIMIT"),
    );
});

test("legacy handoff reservations are reconstructed from stored envelopes", async (t) => {
    const { root, published } = await stores(t);
    const markdown = Array.from(
        { length: 160 },
        (_, index) => String.fromCodePoint(0xe000 + index),
    ).join("");
    const first = makePublishedEvidence({
        markdown,
        exactExcerpt: markdown.slice(0, 10),
    });
    const firstHandoff = handoffFor(first.bundle);
    firstHandoff.executiveFindings[0].text = markdown.slice(10, 70);
    await published.publish(first.bundle, [first.capture], firstHandoff);

    const reservationDirectory = join(
        root,
        "published",
        "retention",
        first.capture.resultSha256,
        "handoffs",
    );
    const [reservationName] = await readdir(reservationDirectory);
    const reservationPath = join(reservationDirectory, reservationName);
    const reservation = JSON.parse(await readFile(reservationPath, "utf8"));
    await writeFile(reservationPath, canonicalJson({
        schemaVersion: 1,
        reservationId: reservation.reservationId,
        contentHash: reservation.contentHash,
        parentSessionId: reservation.parentSessionId,
        researchId: reservation.researchId,
        version: reservation.version,
        handoffHash: reservation.handoffHash,
        textChars: 1,
    }));

    const second = makePublishedEvidence({
        researchId: "87654321-4321-4321-8321-cba987654321",
        markdown,
        exactExcerpt: markdown.slice(0, 10),
    });
    const secondHandoff = handoffFor(second.bundle);
    secondHandoff.executiveFindings[0].text = markdown.slice(70, 144);
    await assert.rejects(
        published.publish(second.bundle, [second.capture], secondHandoff),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
});

test("handoffs reject a complete fetched page", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });

    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = fixture.markdown;
    await assert.rejects(
        published.storeHandoff(handoff, [fixture.capture]),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
});

test("handoffs cannot partition a complete fetched page across fields", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence({
        markdown: "abcdefghij",
        exactExcerpt: "abc",
    });

    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = "abcde";
    handoff.unresolvedRisks.push({
        id: "risk-page-partition",
        text: "fghij",
    });
    await assert.rejects(
        published.storeHandoff(handoff, [fixture.capture]),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
});

test("bundle and handoff prose cannot jointly reconstruct a fetched page", async (t) => {
    const { published } = await stores(t);
    const markdown = "A".repeat(100);
    const fixture = makePublishedEvidence({
        markdown,
        exactExcerpt: "A".repeat(40),
    });
    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    handoff.executiveFindings[0].text = "A".repeat(60);
    await assert.rejects(
        published.storeHandoff(handoff, [fixture.capture]),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
});

test("handoff retention is cumulative across evidence keys", async (t) => {
    const { published } = await stores(t);
    const markdown = "A".repeat(100);
    const first = makePublishedEvidence({
        researchId: RESEARCH_ID,
        markdown,
        exactExcerpt: "A".repeat(10),
    });
    const second = makePublishedEvidence({
        researchId: "87654321-4321-4321-8321-cba987654321",
        markdown,
        exactExcerpt: "A".repeat(10),
    });
    const firstHandoff = handoffFor(first.bundle);
    firstHandoff.executiveFindings[0].text = "A".repeat(40);
    await published.publish(first.bundle, [first.capture], firstHandoff);

    const secondHandoff = handoffFor(second.bundle);
    secondHandoff.executiveFindings[0].text = "A".repeat(50);
    await assert.rejects(
        published.publish(second.bundle, [second.capture], secondHandoff),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
    await assert.rejects(
        published.get(second.bundle.researchId, 1),
        expectStorageCode("PUBLISHED_NOT_FOUND"),
    );
    assert.equal(
        (await published.publish(second.bundle, [second.capture])).researchId,
        second.bundle.researchId,
    );
});

test("overlapping handoff reservations remain valid for later handoffs", async (t) => {
    const { published } = await stores(t);
    const markdown = Array.from({ length: 30 }, (_, index) => (
        `Unique routing paragraph ${String(index).padStart(2, "0")} records health, `
        + "capacity, priority, and diagnostics for one endpoint.\n"
    )).join("");
    const researchIds = [
        RESEARCH_ID,
        "87654321-4321-4321-8321-cba987654321",
        "11111111-2222-4333-8444-555555555555",
    ];
    const fixtures = researchIds.map((researchId) => makePublishedEvidence({
        researchId,
        markdown,
        exactExcerpt: markdown.slice(0, 80),
    }));

    const firstHandoff = handoffFor(fixtures[0].bundle);
    firstHandoff.executiveFindings[0].text = markdown.slice(300, 500);
    await published.publish(
        fixtures[0].bundle,
        [fixtures[0].capture],
        firstHandoff,
    );

    const secondHandoff = handoffFor(fixtures[1].bundle);
    secondHandoff.executiveFindings[0].text = markdown.slice(400, 600);
    await published.publish(
        fixtures[1].bundle,
        [fixtures[1].capture],
        secondHandoff,
    );

    await published.publish(fixtures[2].bundle, [fixtures[2].capture]);
    const thirdHandoff = handoffFor(fixtures[2].bundle);
    thirdHandoff.executiveFindings[0].text = (
        "This independent operational conclusion contains no copied page prose."
    );
    assert.deepEqual(
        await published.storeHandoff(thirdHandoff, [fixtures[2].capture]),
        thirdHandoff,
    );
    assert.equal(
        (await published.publish(
            fixtures[0].bundle,
            [fixtures[0].capture],
            firstHandoff,
        )).contentHash,
        fixtures[0].bundle.contentHash,
    );
});

test("aggregate reservation intervals use union coverage, not record limits", () => {
    const fixture = makePublishedEvidence();
    const handoff = handoffFor(fixture.bundle);
    const contentHash = fixture.capture.resultSha256;
    const contentLength = fixture.markdown.length;
    const segmentHash = "0".repeat(64);
    assert.equal(assertHandoffContentBounded(
        handoff,
        fixture.bundle,
        [{
            schemaVersion: 1,
            contentHash,
            contentLength,
            totalChars: 10,
            intervals: [{ start: 0, end: 10, segmentHash }],
        }],
        [{
            schemaVersion: 1,
            contentHash,
            contentLength,
            totalChars: 0,
            intervals: [],
        }],
        {
            reservedIntervalsByHash: new Map([[
                contentHash,
                Array.from({ length: 12_001 }, () => ({
                    start: 20,
                    end: 30,
                    segmentHash,
                })),
            ]]),
        },
    ), true);
});

test("handoffs are charged against undeclared fetch captures", async (t) => {
    const { published } = await stores(t);
    const declared = makePublishedEvidence();
    const undeclaredMarkdown = "U".repeat(100);
    const undeclared = makePublishedEvidence({
        version: 2,
        markdown: undeclaredMarkdown,
        exactExcerpt: "U".repeat(10),
        canonicalUrl: "https://learn.microsoft.com/azure/undeclared",
        retrievalUrl: "https://learn.microsoft.com/azure/undeclared?view=current",
    });
    const bundle = clone(declared.bundle);
    bundle.claims[0].text = "U".repeat(40);
    const validated = rehash(bundle);
    const handoff = handoffFor(validated);
    handoff.executiveFindings[0].text = "U".repeat(60);
    await assert.rejects(
        published.publish(
            validated,
            [declared.capture, undeclared.capture],
            handoff,
        ),
        expectStorageCode("HANDOFF_FULL_FETCH_CONTENT"),
    );
    await assert.rejects(
        published.get(RESEARCH_ID, 1),
        expectStorageCode("PUBLISHED_NOT_FOUND"),
    );
});

test("acknowledgements are idempotent and conflicting duplicates fail", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const acknowledgement = acknowledgementFor(fixture.bundle);
    assert.deepEqual(
        await published.storeAcknowledgement(acknowledgement),
        acknowledgement,
    );
    assert.deepEqual(
        await published.storeAcknowledgement(acknowledgement),
        acknowledgement,
    );
    assert.deepEqual(
        await published.getAcknowledgement(
            fixture.bundle.parentSessionId,
            RESEARCH_ID,
            1,
        ),
        acknowledgement,
    );

    await assert.rejects(
        published.storeAcknowledgement(
            acknowledgementFor(fixture.bundle, "2026-08-12T09:06:00.000Z"),
        ),
        expectStorageCode("ACKNOWLEDGEMENT_CONFLICT"),
    );
});

test("supersession updates lifecycle without rewriting immutable payload", async (t) => {
    const { root, published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    const handoff = handoffFor(fixture.bundle);
    await published.storeHandoff(handoff, [fixture.capture]);
    const payloadPath = join(
        root,
        "published",
        "evidence",
        RESEARCH_ID,
        "1",
        "payload.json",
    );
    const before = await readFile(payloadPath, "utf8");
    const superseded = await published.supersede(
        RESEARCH_ID,
        1,
        "2026-08-12T09:10:00Z",
    );
    const after = await readFile(payloadPath, "utf8");
    assert.equal(superseded.status, "superseded");
    assert.equal(superseded.contentHash, fixture.bundle.contentHash);
    assert.equal(after, before);
    assert.deepEqual(
        await published.getHandoff(
            fixture.bundle.parentSessionId,
            fixture.bundle.researchId,
            fixture.bundle.version,
        ),
        handoff,
    );
});

test("invalid and conflicting supersession cannot poison a published version", async (t) => {
    const { published } = await stores(t);
    const fixture = makePublishedEvidence();
    await published.publish(fixture.bundle, [fixture.capture]);
    await assert.rejects(
        published.supersede(RESEARCH_ID, 1, "2026-08-12T08:00:00Z"),
        (error) => error.code === "INVALID_LIFECYCLE_ORDER",
    );
    assert.equal((await published.get(RESEARCH_ID, 1)).status, "published");

    await published.supersede(RESEARCH_ID, 1, "2026-08-12T09:10:00Z");
    await assert.rejects(
        published.supersede(RESEARCH_ID, 1, "2026-08-12T09:11:00Z"),
        expectStorageCode("SUPERSESSION_CONFLICT"),
    );
    assert.equal(
        (await published.get(RESEARCH_ID, 1)).lifecycle.supersededAt,
        "2026-08-12T09:10:00.000Z",
    );
});
