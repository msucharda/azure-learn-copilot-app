const UUID_V4 = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const STABLE_ID = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
const SHA256 = "^[0-9a-fA-F]{64}$";
const TIMESTAMP = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$";

const stringSchema = (maxLength, extra = {}) => ({
    type: "string",
    minLength: 1,
    maxLength,
    ...extra,
});

const strictObject = (properties, required = Object.keys(properties)) => ({
    type: "object",
    additionalProperties: false,
    properties,
    required,
});

const lifecycleSchema = strictObject({
    createdAt: stringSchema(24, { pattern: TIMESTAMP }),
    updatedAt: stringSchema(24, { pattern: TIMESTAMP }),
    validatingAt: stringSchema(24, { pattern: TIMESTAMP }),
    validatedAt: stringSchema(24, { pattern: TIMESTAMP }),
    rejectedAt: stringSchema(24, { pattern: TIMESTAMP }),
    publishedAt: stringSchema(24, { pattern: TIMESTAMP }),
    supersededAt: stringSchema(24, { pattern: TIMESTAMP }),
}, ["createdAt", "updatedAt"]);

const claimSchema = strictObject({
    id: stringSchema(80, { pattern: "^claim-[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    text: stringSchema(4_000),
    sourceIds: {
        type: "array",
        maxItems: 50,
        uniqueItems: true,
        items: stringSchema(80, {
            pattern: "^source-[a-z0-9]+(?:-[a-z0-9]+)*$",
        }),
    },
    support: {
        type: "string",
        enum: ["supported", "partially-supported", "unsupported", "conflicting"],
    },
});

const sourceSchema = strictObject({
    id: stringSchema(80, { pattern: "^source-[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    title: stringSchema(500),
    canonicalUrl: stringSchema(2_048, { format: "uri" }),
    retrievalUrl: stringSchema(2_048, { format: "uri" }),
    sectionHeading: stringSchema(500),
    exactExcerpt: stringSchema(6_000),
    whyItMatters: stringSchema(2_000),
    retrievalMethod: stringSchema(160),
    retrievedAt: stringSchema(24, { pattern: TIMESTAMP }),
    contentHash: stringSchema(64, { pattern: SHA256 }),
    verificationState: {
        type: "string",
        enum: ["unverified", "verified", "stale", "rejected"],
    },
}, [
    "id",
    "title",
    "canonicalUrl",
    "sectionHeading",
    "exactExcerpt",
    "whyItMatters",
    "retrievalMethod",
    "retrievedAt",
    "contentHash",
    "verificationState",
]);

export const EVIDENCE_BUNDLE_SCHEMA = strictObject({
    schemaVersion: { const: 1 },
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    version: { type: "integer", minimum: 1 },
    status: {
        type: "string",
        enum: ["draft", "validating", "validated", "published", "superseded", "rejected"],
    },
    parentSessionId: stringSchema(36, { pattern: UUID_V4 }),
    childSessionId: stringSchema(36, { pattern: UUID_V4 }),
    researcherAgent: stringSchema(80, { pattern: STABLE_ID }),
    question: strictObject({
        original: stringSchema(4_000),
        normalized: stringSchema(2_000),
    }),
    scope: strictObject({
        product: stringSchema(200),
        version: stringSchema(120),
        platform: stringSchema(120),
        taskIntent: stringSchema(500),
    }),
    officialSkill: strictObject({
        skillName: stringSchema(80, { pattern: STABLE_ID }),
        pluginName: stringSchema(80, { pattern: STABLE_ID }),
        pluginVersion: stringSchema(80),
        generatedAt: stringSchema(24),
    }, ["skillName", "pluginName", "pluginVersion"]),
    claims: {
        type: "array",
        maxItems: 200,
        items: claimSchema,
    },
    sources: {
        type: "array",
        maxItems: 200,
        items: sourceSchema,
    },
    unresolvedItems: {
        type: "array",
        maxItems: 50,
        items: strictObject({
            id: stringSchema(80, {
                pattern: "^unresolved-[a-z0-9]+(?:-[a-z0-9]+)*$",
            }),
            text: stringSchema(2_000),
        }),
    },
    lifecycle: lifecycleSchema,
    contentHash: stringSchema(64, { pattern: SHA256 }),
}, [
    "schemaVersion",
    "researchId",
    "version",
    "status",
    "parentSessionId",
    "researcherAgent",
    "question",
    "scope",
    "officialSkill",
    "claims",
    "sources",
    "unresolvedItems",
    "lifecycle",
    "contentHash",
]);

export const HANDOFF_ENVELOPE_SCHEMA = strictObject({
    schemaVersion: { const: 1 },
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    version: { type: "integer", minimum: 1 },
    status: { const: "published" },
    parentSessionId: stringSchema(36, { pattern: UUID_V4 }),
    childSessionId: stringSchema(36, { pattern: UUID_V4 }),
    researcherAgent: stringSchema(80, { pattern: STABLE_ID }),
    executiveFindings: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: strictObject({
            claimId: stringSchema(80, {
                pattern: "^claim-[a-z0-9]+(?:-[a-z0-9]+)*$",
            }),
            text: stringSchema(1_000),
        }),
    },
    unresolvedRisks: {
        type: "array",
        maxItems: 20,
        items: strictObject({
            id: stringSchema(80, {
                pattern: "^risk-[a-z0-9]+(?:-[a-z0-9]+)*$",
            }),
            text: stringSchema(1_000),
        }),
    },
    contentHash: stringSchema(64, { pattern: SHA256 }),
    publishedAt: stringSchema(24, { pattern: TIMESTAMP }),
}, [
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

export const RECORD_LEARN_EVIDENCE_SCHEMA = strictObject({
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    logicalOperation: {
        type: "string",
        enum: ["docs-search", "docs-fetch", "code-sample-search"],
    },
    argumentsJson: stringSchema(20_000),
}, [
    "researchId",
    "logicalOperation",
    "argumentsJson",
]);

export const READ_LEARN_EVIDENCE_CAPTURE_SCHEMA = strictObject({
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    captureId: stringSchema(36, { pattern: UUID_V4 }),
    offset: { type: "integer", minimum: 0, maximum: 262_143 },
    length: { type: "integer", minimum: 1, maximum: 4_096 },
});

export const VALIDATE_RESEARCH_BUNDLE_SCHEMA = strictObject({
    bundle: EVIDENCE_BUNDLE_SCHEMA,
});

export const PERSIST_RESEARCH_DRAFT_SCHEMA = strictObject({
    bundle: EVIDENCE_BUNDLE_SCHEMA,
});

export const PUBLISH_RESEARCH_BUNDLE_SCHEMA = strictObject({
    bundle: EVIDENCE_BUNDLE_SCHEMA,
    handoff: HANDOFF_ENVELOPE_SCHEMA,
}, ["bundle"]);

export const GET_RESEARCH_BUNDLE_SCHEMA = strictObject({
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    version: { type: "integer", minimum: 1 },
}, ["researchId"]);

const evidenceSeedSchema = strictObject({
    summary: stringSchema(1_000),
    sourceUrls: {
        type: "array",
        maxItems: 5,
        items: stringSchema(2_048, { format: "uri" }),
    },
});

export const PREPARE_LEARN_RESEARCH_SCHEMA = strictObject({
    choice: {
        type: "string",
        enum: ["refine-here", "open-deep-research-session"],
    },
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    question: stringSchema(4_000),
    normalizedQuestion: stringSchema(2_000),
    scope: strictObject({
        product: stringSchema(200),
        version: stringSchema(120),
        platform: stringSchema(120),
        taskIntent: stringSchema(500),
    }),
    constraints: {
        type: "array",
        maxItems: 20,
        items: stringSchema(500),
    },
    parentSessionId: stringSchema(36, { pattern: UUID_V4 }),
    evidenceSeed: {
        type: "array",
        maxItems: 20,
        items: evidenceSeedSchema,
    },
    unresolvedQuestions: {
        type: "array",
        maxItems: 20,
        items: stringSchema(1_000),
    },
}, [
    "choice",
    "question",
    "normalizedQuestion",
    "scope",
    "constraints",
    "parentSessionId",
    "evidenceSeed",
    "unresolvedQuestions",
]);

export const ACKNOWLEDGE_RESEARCH_HANDOFF_SCHEMA = strictObject({
    parentSessionId: stringSchema(36, { pattern: UUID_V4 }),
    handoff: HANDOFF_ENVELOPE_SCHEMA,
});

export const SUPERSEDE_RESEARCH_BUNDLE_SCHEMA = strictObject({
    researchId: stringSchema(36, { pattern: UUID_V4 }),
    version: { type: "integer", minimum: 1 },
    supersedingVersion: { type: "integer", minimum: 1 },
    supersededAt: stringSchema(24, { pattern: TIMESTAMP }),
});
