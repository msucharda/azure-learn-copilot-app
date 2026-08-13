import {
    fail,
    normalizeArray,
    normalizeResearchId,
    normalizeSessionId,
    normalizeString,
    requireObject,
} from "./validation.mjs";

const CHOICES = new Set([
    "refine-here",
    "open-deep-research-session",
]);

function normalizeLearnUrl(value, path) {
    const text = normalizeString(value, path, { max: 2_048 });
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        fail("INVALID_LEARN_URL", path, "must be a valid URL");
    }
    if (
        parsed.protocol !== "https:"
        || parsed.hostname !== "learn.microsoft.com"
        || parsed.username
        || parsed.password
        || parsed.port
    ) {
        fail("INVALID_LEARN_URL", path, "must be an HTTPS learn.microsoft.com URL");
    }
    return parsed.href;
}

function normalizeEvidenceSeed(value, path) {
    const object = requireObject(value, path, ["summary", "sourceUrls"]);
    return {
        summary: normalizeString(object.summary, `${path}.summary`, { max: 1_000 }),
        sourceUrls: normalizeArray(object.sourceUrls, `${path}.sourceUrls`, {
            max: 5,
            item: normalizeLearnUrl,
        }),
    };
}

export function normalizeResearchStart(input, uuid) {
    const object = requireObject(input, "$", [
        "choice",
        "researchId",
        "question",
        "normalizedQuestion",
        "scope",
        "constraints",
        "parentSessionId",
        "evidenceSeed",
        "unresolvedQuestions",
    ], [
        "choice",
        "question",
        "normalizedQuestion",
        "scope",
        "constraints",
        "parentSessionId",
        "evidenceSeed",
        "unresolvedQuestions",
    ]);
    if (!CHOICES.has(object.choice)) {
        fail("INVALID_RESEARCH_CHOICE", "$.choice", "is not a supported research workflow");
    }
    const scope = requireObject(object.scope, "$.scope", [
        "product",
        "version",
        "platform",
        "taskIntent",
    ]);
    const generatedResearchId = object.researchId ?? uuid();
    return {
        schemaVersion: 1,
        choice: object.choice,
        researchId: normalizeResearchId(generatedResearchId),
        question: normalizeString(object.question, "$.question", { max: 4_000 }),
        normalizedQuestion: normalizeString(
            object.normalizedQuestion,
            "$.normalizedQuestion",
            { max: 2_000 },
        ),
        scope: {
            product: normalizeString(scope.product, "$.scope.product", { max: 200 }),
            version: normalizeString(scope.version, "$.scope.version", { max: 120 }),
            platform: normalizeString(scope.platform, "$.scope.platform", { max: 120 }),
            taskIntent: normalizeString(scope.taskIntent, "$.scope.taskIntent", { max: 500 }),
        },
        constraints: normalizeArray(object.constraints, "$.constraints", {
            max: 20,
            item: (value, path) => normalizeString(value, path, { max: 500 }),
        }),
        parentSessionId: normalizeSessionId(object.parentSessionId, "$.parentSessionId"),
        evidenceSeed: normalizeArray(object.evidenceSeed, "$.evidenceSeed", {
            max: 20,
            item: normalizeEvidenceSeed,
        }),
        unresolvedQuestions: normalizeArray(
            object.unresolvedQuestions,
            "$.unresolvedQuestions",
            {
                max: 20,
                item: (value, path) => normalizeString(value, path, { max: 1_000 }),
            },
        ),
    };
}

export function deepResearchKickoff(state) {
    if (state.choice !== "open-deep-research-session") {
        return undefined;
    }
    const runtimeState = {
        schemaVersion: state.schemaVersion,
        researchId: state.researchId,
        question: state.question,
        normalizedQuestion: state.normalizedQuestion,
        scope: state.scope,
        constraints: state.constraints,
        parentSessionId: state.parentSessionId,
        evidenceSeed: state.evidenceSeed,
        unresolvedQuestions: state.unresolvedQuestions,
    };
    return [
        "Run isolated Microsoft Learn research for the bounded runtime state below.",
        JSON.stringify(runtimeState),
        "",
        "Use the learn-researcher agent and read project-azure-learn-skill-router first.",
        "Route to at most one exact official skill. Treat the evidence seed as discovery context only:",
        "re-fetch and record every source needed for validation under the same researchId.",
        "Persist the current bounded bundle with persist_research_draft, then open learn-references",
        'in draft view with instanceId "learn-draft-panel" (the panel ID is not the researchId).',
        "Return the complete research synthesis in chat with claim-adjacent links using only persisted",
        "canonical URLs backed by successful docs-fetch captures. Keep exact source excerpts in the",
        "reference-only canvas; do not put the answer, claim matrix, provenance, or lifecycle there.",
        "Refine only in this child session. Run citation-critic for consequential claims before validation.",
        "Never send draft evidence to the parent. Publish only after an explicit user publish turn by",
        "invoking publish-research-draft; that workflow validates, publishes, reads back, and sends only",
        "the stored schema-v1 handoff envelope to parentSessionId with immediate delivery.",
    ].join("\n");
}
