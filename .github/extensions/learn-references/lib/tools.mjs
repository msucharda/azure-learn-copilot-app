import { randomUUID } from "node:crypto";
import {
    canonicalJson,
    sha256Hex,
} from "./canonical-json.mjs";
import {
    assertEvidenceContentHash,
} from "./content-hash.mjs";
import {
    normalizeEvidenceCapture,
    validateResearchBundle,
    validateResearchBundleWithRetention,
} from "./evidence-validation.mjs";
import {
    GET_RESEARCH_BUNDLE_SCHEMA,
    PUBLISH_RESEARCH_BUNDLE_SCHEMA,
    READ_LEARN_EVIDENCE_CAPTURE_SCHEMA,
    RECORD_LEARN_EVIDENCE_SCHEMA,
    VALIDATE_RESEARCH_BUNDLE_SCHEMA,
} from "./tool-schemas.mjs";
import {
    fail,
    normalizeResearchId,
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
    return [
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
                const captures = await draftStore.listCaptures(object.bundle?.researchId);
                const {
                    bundle: validated,
                } = validateResearchBundleWithRetention(object.bundle, captures);
                assertEvidenceContentHash(validated);
                const bundle = await publishedStore.publish(
                    validated,
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
    ];
}
