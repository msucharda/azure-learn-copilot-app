import { randomUUID } from "node:crypto";
import {
    canonicalJson,
    sha256Hex,
} from "./canonical-json.mjs";
import {
    assertEvidenceContentHash,
    immutableEvidenceContent,
} from "./content-hash.mjs";
import {
    assertEvidenceBundleTransition,
} from "./evidence-bundle.mjs";
import {
    normalizeEvidenceCapture,
    validateResearchBundle,
    validateResearchBundleWithRetention,
} from "./evidence-validation.mjs";
import {
    ACKNOWLEDGE_RESEARCH_HANDOFF_SCHEMA,
    GET_RESEARCH_BUNDLE_SCHEMA,
    PERSIST_RESEARCH_DRAFT_SCHEMA,
    PREPARE_LEARN_RESEARCH_SCHEMA,
    PUBLISH_RESEARCH_BUNDLE_SCHEMA,
    READ_LEARN_EVIDENCE_CAPTURE_SCHEMA,
    RECORD_LEARN_EVIDENCE_SCHEMA,
    SUPERSEDE_RESEARCH_BUNDLE_SCHEMA,
    VALIDATE_RESEARCH_BUNDLE_SCHEMA,
} from "./tool-schemas.mjs";
import {
    deepResearchKickoff,
    normalizeResearchStart,
} from "./nested-research.mjs";
import {
    fail,
    normalizeResearchId,
    normalizeSessionId,
    requireObject,
} from "./validation.mjs";

function successResult(value) {
    return {
        resultType: "success",
        structuredContent: value,
        textResultForLlm: JSON.stringify(value),
    };
}

function normalizeArgumentsJson(value) {
    if (typeof value !== "string") {
        fail("INVALID_TYPE", "$.argumentsJson", "must be a string");
    }
    if (value.length < 2 || value.length > 20_000) {
        fail("INVALID_LENGTH", "$.argumentsJson", "must contain 2 through 20000 characters");
    }
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        fail("MALFORMED_JSON", "$.argumentsJson", "must contain valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("INVALID_TYPE", "$.argumentsJson", "must encode an object");
    }
    const prototype = Object.getPrototypeOf(parsed);
    if (prototype !== Object.prototype && prototype !== null) {
        fail("INVALID_TYPE", "$.argumentsJson", "must encode a plain object");
    }
    return parsed;
}

function summarizeArguments(args) {
    const serialized = canonicalJson(args);
    return [
        `sha256=${sha256Hex(serialized)}`,
        `keys=${Object.keys(args).sort().join(",") || "none"}`,
    ].join(";").slice(0, 500);
}

async function normalizeRecordInput(input, { now, uuid, learnAdapter }) {
    const object = requireObject(input, "$", [
        "researchId",
        "logicalOperation",
        "argumentsJson",
    ], [
        "researchId",
        "logicalOperation",
        "argumentsJson",
    ]);
    const operation = object.logicalOperation;
    if (
        !["docs-search", "docs-fetch", "code-sample-search"].includes(operation)
    ) {
        fail("INVALID_LEARN_OPERATION", "$.logicalOperation", "is not a supported operation");
    }
    const args = normalizeArgumentsJson(object.argumentsJson);
    const adapted = await learnAdapter.execute(operation, args);
    if (
        !adapted
        || typeof adapted !== "object"
        || typeof adapted.runtimeToolName !== "string"
    ) {
        fail(
            "INVALID_ADAPTER_RESULT",
            "$",
            "trusted Learn adapter returned an invalid normalized result",
        );
    }
    const fetch = operation === "docs-fetch";

    return normalizeEvidenceCapture({
        schemaVersion: 1,
        captureId: uuid(),
        researchId: normalizeResearchId(object.researchId),
        logicalOperation: operation,
        runtimeToolName: adapted.runtimeToolName,
        argsSummary: summarizeArguments(args),
        resultSha256: adapted.resultSha256,
        resultCount: adapted.resultCount,
        sourceUrls: adapted.sourceUrls,
        observedAt: now(),
        ...(fetch ? {
            canonicalUrl: adapted.canonicalUrl,
            retrievalUrl: adapted.retrievalUrl,
            fetchedMarkdown: adapted.markdown,
        } : {}),
    });
}

export function createLearnReferenceTools({
    draftStore,
    publishedStore,
    learnAdapter,
    now = () => new Date().toISOString(),
    uuid = randomUUID,
}) {
    if (!draftStore || !publishedStore || typeof learnAdapter?.execute !== "function") {
        throw new TypeError(
            "createLearnReferenceTools requires draft/published stores and a trusted Learn adapter",
        );
    }
    const tools = [
        {
            name: "prepare_learn_research",
            description: "Prepare bounded quick or nested Microsoft Learn research state",
            parameters: PREPARE_LEARN_RESEARCH_SCHEMA,
            handler: async (input) => {
                const state = normalizeResearchStart(input, uuid);
                return successResult({
                    state,
                    ...(state.choice === "open-deep-research-session"
                        ? { kickoff: deepResearchKickoff(state) }
                        : {}),
                });
            },
        },
        {
            name: "record_learn_evidence",
            description: "Record bounded Microsoft Learn result evidence in this workspace",
            parameters: RECORD_LEARN_EVIDENCE_SCHEMA,
            handler: async (input) => {
                const capture = await normalizeRecordInput(input, {
                    now,
                    uuid,
                    learnAdapter,
                });
                const stored = await draftStore.recordCapture(capture);
                return successResult({
                    recorded: true,
                    captureId: stored.captureId,
                    researchId: stored.researchId,
                    logicalOperation: stored.logicalOperation,
                    resultSha256: stored.resultSha256,
                    resultCount: stored.resultCount,
                    sourceUrls: stored.sourceUrls,
                    observedAt: stored.observedAt,
                });
            },
        },
        {
            name: "read_learn_evidence_capture",
            description: "Read one exact bounded Markdown chunk from a recorded Learn fetch",
            parameters: READ_LEARN_EVIDENCE_CAPTURE_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", [
                    "researchId",
                    "captureId",
                    "offset",
                    "length",
                ]);
                const researchId = normalizeResearchId(object.researchId);
                if (!Number.isInteger(object.offset) || object.offset < 0 || object.offset > 262_143) {
                    fail("INVALID_CAPTURE_OFFSET", "$.offset", "must be an integer from 0 through 262143");
                }
                if (!Number.isInteger(object.length) || object.length < 1 || object.length > 4_096) {
                    fail("INVALID_CAPTURE_LENGTH", "$.length", "must be an integer from 1 through 4096");
                }
                const capture = await draftStore.readCapture(researchId, object.captureId);
                if (capture.logicalOperation !== "docs-fetch") {
                    fail(
                        "NON_FETCH_CAPTURE",
                        "$.captureId",
                        "must identify a docs-fetch capture",
                    );
                }
                const totalLength = capture.fetchedMarkdown.length;
                if (object.offset >= totalLength) {
                    fail(
                        "CAPTURE_OFFSET_OUT_OF_RANGE",
                        "$.offset",
                        "must be less than the fetched Markdown length",
                    );
                }
                const end = Math.min(totalLength, object.offset + object.length);
                if (object.offset === 0 && end === totalLength) {
                    fail(
                        "FULL_CAPTURE_READ",
                        "$",
                        "bounded reads cannot return the complete fetched Markdown body",
                    );
                }
                const markdownChunk = capture.fetchedMarkdown.slice(object.offset, end);
                return successResult({
                    researchId: capture.researchId,
                    captureId: capture.captureId,
                    canonicalUrl: capture.canonicalUrl,
                    retrievalUrl: capture.retrievalUrl,
                    observedAt: capture.observedAt,
                    resultSha256: capture.resultSha256,
                    totalLength,
                    offset: object.offset,
                    length: markdownChunk.length,
                    markdownChunk,
                });
            },
        },
        {
            name: "persist_research_draft",
            description: "Validate and persist a bounded non-published research draft for its canvas",
            parameters: PERSIST_RESEARCH_DRAFT_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", ["bundle"]);
                const captures = await draftStore.listCaptures(object.bundle?.researchId);
                const bundle = validateResearchBundle(object.bundle, captures);
                if (!["draft", "validating", "validated"].includes(bundle.status)) {
                    fail(
                        "INVALID_DRAFT_STATUS",
                        "$.bundle.status",
                        "must be draft, validating, or validated",
                    );
                }
                const stored = await draftStore.writeBundle(bundle);
                return successResult({
                    persisted: true,
                    researchId: stored.researchId,
                    version: stored.version,
                    status: stored.status,
                    contentHash: stored.contentHash,
                });
            },
        },
        {
            name: "validate_research_bundle",
            description: "Validate a research bundle, its digest, and exact fetched Learn excerpts",
            parameters: VALIDATE_RESEARCH_BUNDLE_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", ["bundle"]);
                const captures = await draftStore.listCaptures(object.bundle?.researchId);
                const bundle = validateResearchBundle(object.bundle, captures);
                return successResult({
                    valid: true,
                    researchId: bundle.researchId,
                    version: bundle.version,
                    status: bundle.status,
                    contentHash: bundle.contentHash,
                    claims: bundle.claims.length,
                    sources: bundle.sources.length,
                });
            },
        },
        {
            name: "publish_research_bundle",
            description: "Atomically publish an immutable, validated Microsoft Learn evidence version",
            parameters: PUBLISH_RESEARCH_BUNDLE_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", ["bundle", "handoff"], ["bundle"]);
                const persisted = assertEvidenceContentHash(
                    await draftStore.readBundle(
                        object.bundle?.researchId,
                        object.bundle?.version,
                    ),
                );
                if (persisted.status !== "validated") {
                    fail(
                        "AUTHORITATIVE_DRAFT_NOT_VALIDATED",
                        "$.bundle.status",
                        "persisted draft must have validated status before publication",
                    );
                }
                const captures = await draftStore.listCaptures(object.bundle?.researchId);
                const {
                    bundle: requestedPublication,
                } = validateResearchBundleWithRetention(object.bundle, captures);
                assertEvidenceContentHash(requestedPublication);
                assertEvidenceBundleTransition(persisted, requestedPublication);
                if (
                    persisted.contentHash !== requestedPublication.contentHash
                    || canonicalJson(immutableEvidenceContent(persisted))
                        !== canonicalJson(immutableEvidenceContent(requestedPublication))
                ) {
                    fail(
                        "AUTHORITATIVE_DRAFT_MISMATCH",
                        "$.bundle",
                        "publication content must exactly match the persisted validated draft",
                    );
                }
                const authoritativePublication = assertEvidenceContentHash({
                    ...immutableEvidenceContent(persisted),
                    status: requestedPublication.status,
                    lifecycle: requestedPublication.lifecycle,
                    contentHash: persisted.contentHash,
                });
                assertEvidenceBundleTransition(persisted, authoritativePublication);
                const bundle = await publishedStore.publish(
                    authoritativePublication,
                    captures,
                    object.handoff,
                );
                return successResult({
                    published: true,
                    researchId: bundle.researchId,
                    version: bundle.version,
                    status: bundle.status,
                    contentHash: bundle.contentHash,
                    handoffStored: object.handoff !== undefined,
                });
            },
        },
        {
            name: "get_research_bundle",
            description: "Read and hash-verify a published Microsoft Learn evidence version",
            parameters: GET_RESEARCH_BUNDLE_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", ["researchId", "version"], [
                    "researchId",
                ]);
                const researchId = normalizeResearchId(object.researchId);
                const bundle = object.version === undefined
                    ? await publishedStore.getLatest(researchId)
                    : await publishedStore.get(researchId, object.version);
                return successResult({ bundle });
            },
        },
        {
            name: "acknowledge_research_handoff",
            description: "Verify and idempotently acknowledge one stored published research handoff",
            parameters: ACKNOWLEDGE_RESEARCH_HANDOFF_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", [
                    "parentSessionId",
                    "handoff",
                ]);
                const result = await publishedStore.acknowledgeHandoff(
                    object.handoff,
                    normalizeSessionId(object.parentSessionId, "$.parentSessionId"),
                    now(),
                );
                return successResult(result);
            },
        },
        {
            name: "supersede_research_bundle",
            description: "Append supersession metadata after a newer published version exists",
            parameters: SUPERSEDE_RESEARCH_BUNDLE_SCHEMA,
            handler: async (input) => {
                const object = requireObject(input, "$", [
                    "researchId",
                    "version",
                    "supersedingVersion",
                    "supersededAt",
                ]);
                const researchId = normalizeResearchId(object.researchId);
                if (
                    !Number.isSafeInteger(object.version)
                    || !Number.isSafeInteger(object.supersedingVersion)
                    || object.version < 1
                    || object.supersedingVersion <= object.version
                ) {
                    fail(
                        "INVALID_SUPERSESSION_VERSION",
                        "$.supersedingVersion",
                        "must be a safe integer greater than version",
                    );
                }
                const latest = await publishedStore.getLatest(researchId);
                if (
                    latest.version !== object.supersedingVersion
                    || latest.status !== "published"
                ) {
                    fail(
                        "SUPERSESSION_NOT_LATEST",
                        "$.supersedingVersion",
                        "must identify the latest active published version",
                    );
                }
                const superseded = await publishedStore.supersede(
                    researchId,
                    object.version,
                    object.supersededAt,
                );
                return successResult({
                    superseded: true,
                    researchId: superseded.researchId,
                    version: superseded.version,
                    status: superseded.status,
                    contentHash: superseded.contentHash,
                    supersedingVersion: latest.version,
                });
            },
        },
    ];
    return tools;
}
