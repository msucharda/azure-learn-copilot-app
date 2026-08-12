import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    ContractValidationError,
    EVIDENCE_STATUSES,
    STATUS_TRANSITIONS,
    assertEvidenceBundleTransition,
    assertHandoffMatchesBundle,
    assertStatusTransition,
    normalizeEvidenceBundle,
    normalizeHandoffEnvelope,
} from "../.github/extensions/learn-references/lib/index.mjs";

const FIXTURE_ROOT = new URL(
    "../.github/extensions/learn-references/fixtures/",
    import.meta.url,
);

async function fixture(name) {
    return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), "utf8"));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function expectContractError(callback, code) {
    assert.throws(callback, (error) => {
        assert.equal(error instanceof ContractValidationError, true);
        assert.equal(error.code, code);
        return true;
    });
}

function handoffFor(bundle) {
    return {
        schemaVersion: 1,
        researchId: bundle.researchId,
        version: bundle.version,
        status: "published",
        parentSessionId: bundle.parentSessionId,
        childSessionId: bundle.childSessionId,
        researcherAgent: bundle.researcherAgent,
        executiveFindings: [
            {
                claimId: "claim-dynamic-discovery",
                text: "Runtime discovery is the supported integration boundary.",
            },
        ],
        unresolvedRisks: [
            {
                id: "risk-failure-shape",
                text: "The production adapter failure payload still needs integration coverage.",
            },
        ],
        contentHash: bundle.contentHash,
        publishedAt: bundle.lifecycle.publishedAt,
    };
}

test("normalizes the minimal, complete, conflicting, and superseded fixtures", async () => {
    const minimal = normalizeEvidenceBundle(await fixture("minimal-valid.json"));
    assert.equal(minimal.status, "draft");
    assert.equal(minimal.lifecycle.createdAt, "2026-08-12T09:00:00.000Z");

    const complete = normalizeEvidenceBundle(await fixture("complete-valid.json"));
    assert.equal(complete.claims.length, 2);
    assert.equal(complete.officialSkill.generatedAt, "2026-08-09");
    assert.equal(complete.sources[0].canonicalUrl, "https://learn.microsoft.com/training/support/mcp");
    assert.equal(Object.isFrozen(complete), true);
    assert.equal(Object.isFrozen(complete.claims), true);

    const conflicting = normalizeEvidenceBundle(await fixture("conflicting.json"));
    assert.equal(conflicting.claims[0].support, "conflicting");

    const superseded = normalizeEvidenceBundle(await fixture("superseded.json"));
    assert.equal(superseded.status, "superseded");
    assert.equal(Object.isFrozen(superseded.lifecycle), true);
});

test("rejects invalid fixture cross-references, hosts, and schema versions explicitly", async () => {
    expectContractError(
        () => normalizeEvidenceBundle(awaited.invalidCrossReference),
        "MISSING_SOURCE_REFERENCE",
    );
    expectContractError(
        () => normalizeEvidenceBundle(awaited.invalidHost),
        "INVALID_LEARN_HOST",
    );
    expectContractError(
        () => normalizeEvidenceBundle(awaited.unknownVersion),
        "UNSUPPORTED_SCHEMA_VERSION",
    );

    const unknownWithFutureProperty = {
        ...clone(awaited.unknownVersion),
        futureField: true,
    };
    expectContractError(
        () => normalizeEvidenceBundle(unknownWithFutureProperty),
        "UNSUPPORTED_SCHEMA_VERSION",
    );
});

const awaited = {
    invalidCrossReference: await fixture("invalid-cross-reference.json"),
    invalidHost: await fixture("invalid-host-url.json"),
    unknownVersion: await fixture("unknown-version.json"),
};

test("rejects duplicate stable IDs and absent source references", async () => {
    const complete = await fixture("complete-valid.json");

    const duplicateSource = clone(complete);
    duplicateSource.sources.push(clone(duplicateSource.sources[0]));
    expectContractError(
        () => normalizeEvidenceBundle(duplicateSource),
        "DUPLICATE_ID",
    );

    const duplicateClaim = clone(complete);
    duplicateClaim.claims.push(clone(duplicateClaim.claims[0]));
    expectContractError(
        () => normalizeEvidenceBundle(duplicateClaim),
        "DUPLICATE_ID",
    );

    const missingSource = clone(complete);
    missingSource.claims[0].sourceIds = ["source-does-not-exist"];
    expectContractError(
        () => normalizeEvidenceBundle(missingSource),
        "MISSING_SOURCE_REFERENCE",
    );
});

test("rejects malformed hashes, IDs, URLs, and lifecycle timestamps", async () => {
    const minimal = await fixture("minimal-valid.json");

    const invalidBundleHash = clone(minimal);
    invalidBundleHash.contentHash = "not-a-hash";
    expectContractError(
        () => normalizeEvidenceBundle(invalidBundleHash),
        "INVALID_LENGTH",
    );

    const complete = await fixture("complete-valid.json");
    const invalidSourceHash = clone(complete);
    invalidSourceHash.sources[0].contentHash = "g".repeat(64);
    expectContractError(
        () => normalizeEvidenceBundle(invalidSourceHash),
        "INVALID_FORMAT",
    );

    const invalidId = clone(minimal);
    invalidId.researcherAgent = "Learn Researcher";
    expectContractError(
        () => normalizeEvidenceBundle(invalidId),
        "INVALID_FORMAT",
    );

    const insecureUrl = clone(complete);
    insecureUrl.sources[0].canonicalUrl = "http://learn.microsoft.com/training/support/mcp";
    expectContractError(
        () => normalizeEvidenceBundle(insecureUrl),
        "INVALID_URL",
    );

    const nonCanonicalUrl = clone(complete);
    nonCanonicalUrl.sources[0].canonicalUrl =
        "https://learn.microsoft.com/training/support/mcp?view=current";
    expectContractError(
        () => normalizeEvidenceBundle(nonCanonicalUrl),
        "INVALID_CANONICAL_URL",
    );

    const normalizedPortUrl = clone(complete);
    normalizedPortUrl.sources[0].canonicalUrl =
        "https://learn.microsoft.com:443/training/support/mcp";
    expectContractError(
        () => normalizeEvidenceBundle(normalizedPortUrl),
        "INVALID_CANONICAL_URL",
    );

    const normalizedHostUrl = clone(complete);
    normalizedHostUrl.sources[0].canonicalUrl =
        "HTTPS://LEARN.MICROSOFT.COM/training/support/mcp";
    expectContractError(
        () => normalizeEvidenceBundle(normalizedHostUrl),
        "INVALID_CANONICAL_URL",
    );

    const reversedLifecycle = clone(complete);
    reversedLifecycle.lifecycle.validatedAt = "2026-08-12T09:04:00Z";
    expectContractError(
        () => normalizeEvidenceBundle(reversedLifecycle),
        "INVALID_LIFECYCLE_ORDER",
    );

    const invalidCalendarDate = clone(minimal);
    invalidCalendarDate.lifecycle.createdAt = "2026-02-31T09:00:00Z";
    expectContractError(
        () => normalizeEvidenceBundle(invalidCalendarDate),
        "INVALID_TIMESTAMP",
    );
});

test("rejects unknown properties at strict object boundaries", async () => {
    const minimal = await fixture("minimal-valid.json");

    const topLevel = { ...clone(minimal), storagePointer: "not-v1" };
    expectContractError(
        () => normalizeEvidenceBundle(topLevel),
        "UNKNOWN_PROPERTY",
    );

    const nested = clone(minimal);
    nested.question.language = "en";
    expectContractError(
        () => normalizeEvidenceBundle(nested),
        "UNKNOWN_PROPERTY",
    );
});

test("allows exactly the documented lifecycle transitions", () => {
    for (const from of EVIDENCE_STATUSES) {
        for (const to of EVIDENCE_STATUSES) {
            if (STATUS_TRANSITIONS[from].includes(to)) {
                assert.equal(assertStatusTransition(from, to), true);
            } else {
                expectContractError(
                    () => assertStatusTransition(from, to),
                    "INVALID_STATUS_TRANSITION",
                );
            }
        }
    }
});

test("validates the rejected lifecycle branch", async () => {
    const draft = await fixture("minimal-valid.json");
    const validating = clone(draft);
    validating.status = "validating";
    validating.lifecycle.updatedAt = "2026-08-12T09:05:00Z";
    validating.lifecycle.validatingAt = "2026-08-12T09:05:00Z";

    const rejected = clone(validating);
    rejected.status = "rejected";
    rejected.lifecycle.updatedAt = "2026-08-12T09:10:00Z";
    rejected.lifecycle.rejectedAt = "2026-08-12T09:10:00Z";

    assert.equal(normalizeEvidenceBundle(rejected).status, "rejected");
    assert.equal(assertEvidenceBundleTransition(validating, rejected), true);

    const invalidRejected = clone(rejected);
    invalidRejected.lifecycle.validatedAt = "2026-08-12T09:08:00Z";
    expectContractError(
        () => normalizeEvidenceBundle(invalidRejected),
        "INVALID_LIFECYCLE",
    );
});

test("preserves published content when transitioning to superseded", async () => {
    const published = await fixture("complete-valid.json");
    const superseded = clone(published);
    superseded.status = "superseded";
    superseded.lifecycle.updatedAt = "2026-08-12T09:20:00Z";
    superseded.lifecycle.supersededAt = "2026-08-12T09:20:00Z";
    assert.equal(assertEvidenceBundleTransition(published, superseded), true);

    const changed = clone(superseded);
    changed.question.normalized = "Changed after publication.";
    expectContractError(
        () => assertEvidenceBundleTransition(published, changed),
        "IMMUTABLE_PUBLISHED_VERSION",
    );

    const changedVersion = clone(superseded);
    changedVersion.version += 1;
    expectContractError(
        () => assertEvidenceBundleTransition(published, changedVersion),
        "INVALID_VERSION_TRANSITION",
    );
});

test("validates bounded handoff envelopes against their published bundle", async () => {
    const bundle = normalizeEvidenceBundle(await fixture("complete-valid.json"));
    const handoff = handoffFor(bundle);
    const normalized = normalizeHandoffEnvelope(handoff);
    assert.equal(normalized.executiveFindings.length, 1);
    assert.equal(assertHandoffMatchesBundle(handoff, bundle), true);

    const mismatchedHash = clone(handoff);
    mismatchedHash.contentHash = "0".repeat(64);
    expectContractError(
        () => assertHandoffMatchesBundle(mismatchedHash, bundle),
        "HANDOFF_MISMATCH",
    );

    const missingClaim = clone(handoff);
    missingClaim.executiveFindings[0].claimId = "claim-absent";
    expectContractError(
        () => assertHandoffMatchesBundle(missingClaim, bundle),
        "MISSING_CLAIM_REFERENCE",
    );

    const unknownProperty = { ...clone(handoff), evidence: bundle };
    expectContractError(
        () => normalizeHandoffEnvelope(unknownProperty),
        "UNKNOWN_PROPERTY",
    );

    const unbounded = clone(handoff);
    unbounded.unresolvedRisks = Array.from({ length: 21 }, (_, index) => ({
        id: `risk-number-${index}`,
        text: "Bounded risk.",
    }));
    expectContractError(
        () => normalizeHandoffEnvelope(unbounded),
        "INVALID_LENGTH",
    );

    const unknownVersion = clone(handoff);
    unknownVersion.schemaVersion = 2;
    expectContractError(
        () => normalizeHandoffEnvelope(unknownVersion),
        "UNSUPPORTED_SCHEMA_VERSION",
    );
});
