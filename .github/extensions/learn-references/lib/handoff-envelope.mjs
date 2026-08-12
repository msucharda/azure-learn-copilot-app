import {
    assertUnique,
    fail,
    normalizeArray,
    normalizeHash,
    normalizePositiveInteger,
    normalizeResearchId,
    normalizeSessionId,
    normalizeStableId,
    normalizeString,
    normalizeTimestamp,
    requireObject,
    requireVersionedObject,
} from "./validation.mjs";
import { normalizeEvidenceBundle } from "./evidence-bundle.mjs";

const HANDOFF_KEYS = Object.freeze([
    "schemaVersion",
    "researchId",
    "version",
    "status",
    "parentSessionId",
    "childSessionId",
    "researcherAgent",
    "executiveFindings",
    "unresolvedRisks",
    "contentHash",
    "publishedAt",
]);

function normalizeExecutiveFinding(value, path) {
    const object = requireObject(value, path, ["claimId", "text"]);
    return {
        claimId: normalizeStableId(object.claimId, `${path}.claimId`, "claim"),
        text: normalizeString(object.text, `${path}.text`, { max: 1_000 }),
    };
}

function normalizeUnresolvedRisk(value, path) {
    const object = requireObject(value, path, ["id", "text"]);
    return {
        id: normalizeStableId(object.id, `${path}.id`, "risk"),
        text: normalizeString(object.text, `${path}.text`, { max: 1_000 }),
    };
}

export function normalizeHandoffEnvelope(input) {
    const object = requireVersionedObject(input, "$", HANDOFF_KEYS, [
        "schemaVersion",
        "researchId",
        "version",
        "status",
        "parentSessionId",
        "researcherAgent",
        "executiveFindings",
        "unresolvedRisks",
        "contentHash",
        "publishedAt",
    ]);
    if (object.status !== "published") {
        fail("INVALID_HANDOFF_STATUS", "$.status", 'must be "published"');
    }

    const executiveFindings = normalizeArray(
        object.executiveFindings,
        "$.executiveFindings",
        {
            min: 1,
            max: 20,
            item: normalizeExecutiveFinding,
        },
    );
    const unresolvedRisks = normalizeArray(object.unresolvedRisks, "$.unresolvedRisks", {
        max: 20,
        item: normalizeUnresolvedRisk,
    });
    assertUnique(
        executiveFindings.map((finding) => finding.claimId),
        "$.executiveFindings",
        "claim ID",
    );
    assertUnique(
        unresolvedRisks.map((risk) => risk.id),
        "$.unresolvedRisks",
        "risk ID",
    );

    const normalized = {
        schemaVersion: 1,
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        status: "published",
        parentSessionId: normalizeSessionId(object.parentSessionId, "$.parentSessionId"),
        researcherAgent: normalizeStableId(object.researcherAgent, "$.researcherAgent"),
        executiveFindings,
        unresolvedRisks,
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
        publishedAt: normalizeTimestamp(object.publishedAt, "$.publishedAt"),
    };
    if (object.childSessionId !== undefined) {
        normalized.childSessionId = normalizeSessionId(
            object.childSessionId,
            "$.childSessionId",
        );
    }
    return normalized;
}

export function assertHandoffMatchesBundle(envelopeInput, bundleInput) {
    const envelope = normalizeHandoffEnvelope(envelopeInput);
    const bundle = normalizeEvidenceBundle(bundleInput);
    if (bundle.status !== "published") {
        fail("INVALID_HANDOFF_BUNDLE_STATUS", "$.status", "handoff requires a published bundle");
    }

    for (const field of [
        "researchId",
        "version",
        "parentSessionId",
        "researcherAgent",
        "contentHash",
    ]) {
        if (envelope[field] !== bundle[field]) {
            fail("HANDOFF_MISMATCH", `$.${field}`, "must match the published evidence bundle");
        }
    }
    if ((envelope.childSessionId ?? null) !== (bundle.childSessionId ?? null)) {
        fail("HANDOFF_MISMATCH", "$.childSessionId", "must match the published evidence bundle");
    }
    if (envelope.publishedAt !== bundle.lifecycle.publishedAt) {
        fail("HANDOFF_MISMATCH", "$.publishedAt", "must match lifecycle.publishedAt");
    }

    const claimIds = new Set(bundle.claims.map((claim) => claim.id));
    for (const finding of envelope.executiveFindings) {
        if (!claimIds.has(finding.claimId)) {
            fail(
                "MISSING_CLAIM_REFERENCE",
                "$.executiveFindings",
                `references absent claim "${finding.claimId}"`,
            );
        }
    }
    return true;
}
