import {
    assertUnique,
    deepFreeze,
    fail,
    normalizeArray,
    normalizeDateOrTimestamp,
    normalizeEnum,
    normalizeHash,
    normalizeLearnUrl,
    normalizeOptionalString,
    normalizePositiveInteger,
    normalizeResearchId,
    normalizeStableId,
    normalizeString,
    normalizeTimestamp,
    requireObject,
    requireVersionedObject,
} from "./validation.mjs";
import {
    assertStatusTransition,
    normalizeLifecycle,
    normalizeStatus,
} from "./lifecycle.mjs";

export const CLAIM_SUPPORT = Object.freeze([
    "supported",
    "partially-supported",
    "unsupported",
    "conflicting",
]);

export const SOURCE_VERIFICATION_STATES = Object.freeze([
    "unverified",
    "verified",
    "stale",
    "rejected",
]);

const TOP_LEVEL_KEYS = Object.freeze([
    "schemaVersion",
    "researchId",
    "version",
    "status",
    "parentSessionId",
    "childSessionId",
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

function normalizeQuestion(value, path) {
    const object = requireObject(value, path, ["original", "normalized"]);
    return {
        original: normalizeString(object.original, `${path}.original`, { max: 4_000 }),
        normalized: normalizeString(object.normalized, `${path}.normalized`, { max: 2_000 }),
    };
}

function normalizeScope(value, path) {
    const object = requireObject(value, path, [
        "product",
        "version",
        "platform",
        "taskIntent",
    ]);
    return {
        product: normalizeString(object.product, `${path}.product`, { max: 200 }),
        version: normalizeString(object.version, `${path}.version`, { max: 120 }),
        platform: normalizeString(object.platform, `${path}.platform`, { max: 120 }),
        taskIntent: normalizeString(object.taskIntent, `${path}.taskIntent`, { max: 500 }),
    };
}

function normalizeOfficialSkill(value, path) {
    const object = requireObject(
        value,
        path,
        ["skillName", "pluginName", "pluginVersion", "generatedAt"],
        ["skillName", "pluginName", "pluginVersion"],
    );
    const normalized = {
        skillName: normalizeStableId(object.skillName, `${path}.skillName`),
        pluginName: normalizeStableId(object.pluginName, `${path}.pluginName`),
        pluginVersion: normalizeString(object.pluginVersion, `${path}.pluginVersion`, { max: 80 }),
    };
    if (object.generatedAt !== undefined) {
        normalized.generatedAt = normalizeDateOrTimestamp(
            object.generatedAt,
            `${path}.generatedAt`,
        );
    }
    return normalized;
}

function normalizeClaim(value, path) {
    const object = requireObject(value, path, ["id", "text", "sourceIds", "support"]);
    const support = normalizeEnum(object.support, `${path}.support`, CLAIM_SUPPORT);
    const sourceIds = normalizeArray(object.sourceIds, `${path}.sourceIds`, {
        min: support === "unsupported" ? 0 : 1,
        max: 50,
        item: (entry, itemPath) => normalizeStableId(entry, itemPath, "source"),
    });
    assertUnique(sourceIds, `${path}.sourceIds`, "source ID");
    return {
        id: normalizeStableId(object.id, `${path}.id`, "claim"),
        text: normalizeString(object.text, `${path}.text`, { max: 4_000 }),
        sourceIds,
        support,
    };
}

function normalizeSource(value, path) {
    const object = requireObject(
        value,
        path,
        [
            "id",
            "title",
            "canonicalUrl",
            "retrievalUrl",
            "sectionHeading",
            "exactExcerpt",
            "whyItMatters",
            "retrievalMethod",
            "retrievedAt",
            "contentHash",
            "verificationState",
        ],
        [
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
        ],
    );
    const normalized = {
        id: normalizeStableId(object.id, `${path}.id`, "source"),
        title: normalizeString(object.title, `${path}.title`, { max: 500 }),
        canonicalUrl: normalizeLearnUrl(object.canonicalUrl, `${path}.canonicalUrl`, {
            canonical: true,
        }),
        sectionHeading: normalizeString(object.sectionHeading, `${path}.sectionHeading`, {
            max: 500,
        }),
        exactExcerpt: normalizeString(object.exactExcerpt, `${path}.exactExcerpt`, {
            max: 6_000,
        }),
        whyItMatters: normalizeString(object.whyItMatters, `${path}.whyItMatters`, {
            max: 2_000,
        }),
        retrievalMethod: normalizeString(object.retrievalMethod, `${path}.retrievalMethod`, {
            max: 160,
        }),
        retrievedAt: normalizeTimestamp(object.retrievedAt, `${path}.retrievedAt`),
        contentHash: normalizeHash(object.contentHash, `${path}.contentHash`),
        verificationState: normalizeEnum(
            object.verificationState,
            `${path}.verificationState`,
            SOURCE_VERIFICATION_STATES,
        ),
    };
    if (object.retrievalUrl !== undefined) {
        normalized.retrievalUrl = normalizeLearnUrl(
            object.retrievalUrl,
            `${path}.retrievalUrl`,
        );
    }
    return normalized;
}

function normalizeUnresolvedItem(value, path) {
    const object = requireObject(value, path, ["id", "text"]);
    return {
        id: normalizeStableId(object.id, `${path}.id`, "unresolved"),
        text: normalizeString(object.text, `${path}.text`, { max: 2_000 }),
    };
}

function immutablePayload(bundle) {
    const {
        status: _status,
        lifecycle: _lifecycle,
        ...payload
    } = bundle;
    return JSON.stringify(payload);
}

export function normalizeEvidenceBundle(input) {
    const object = requireVersionedObject(input, "$", TOP_LEVEL_KEYS, [
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
    const status = normalizeStatus(object.status);
    const sources = normalizeArray(object.sources, "$.sources", {
        max: 200,
        item: normalizeSource,
    });
    const claims = normalizeArray(object.claims, "$.claims", {
        max: 200,
        item: normalizeClaim,
    });
    const unresolvedItems = normalizeArray(object.unresolvedItems, "$.unresolvedItems", {
        max: 50,
        item: normalizeUnresolvedItem,
    });

    assertUnique(sources.map((source) => source.id), "$.sources", "source ID");
    assertUnique(claims.map((claim) => claim.id), "$.claims", "claim ID");
    assertUnique(
        unresolvedItems.map((item) => item.id),
        "$.unresolvedItems",
        "unresolved item ID",
    );

    const sourceIds = new Set(sources.map((source) => source.id));
    for (const claim of claims) {
        for (const sourceId of claim.sourceIds) {
            if (!sourceIds.has(sourceId)) {
                fail(
                    "MISSING_SOURCE_REFERENCE",
                    `$.claims.${claim.id}.sourceIds`,
                    `references absent source "${sourceId}"`,
                );
            }
        }
    }

    const normalized = {
        schemaVersion: 1,
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        status,
        parentSessionId: normalizeStableId(object.parentSessionId, "$.parentSessionId", "session"),
        researcherAgent: normalizeStableId(object.researcherAgent, "$.researcherAgent"),
        question: normalizeQuestion(object.question, "$.question"),
        scope: normalizeScope(object.scope, "$.scope"),
        officialSkill: normalizeOfficialSkill(object.officialSkill, "$.officialSkill"),
        claims,
        sources,
        unresolvedItems,
        lifecycle: normalizeLifecycle(object.lifecycle, status),
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
    };
    if (object.childSessionId !== undefined) {
        normalized.childSessionId = normalizeStableId(
            object.childSessionId,
            "$.childSessionId",
            "session",
        );
    }

    return status === "published" || status === "superseded"
        ? deepFreeze(normalized)
        : normalized;
}

export function assertEvidenceBundleTransition(previousInput, nextInput) {
    const previous = normalizeEvidenceBundle(previousInput);
    const next = normalizeEvidenceBundle(nextInput);
    assertStatusTransition(previous.status, next.status);

    if (previous.researchId !== next.researchId || previous.version !== next.version) {
        fail(
            "INVALID_VERSION_TRANSITION",
            "$.version",
            "status transitions must preserve researchId and version",
        );
    }
    if (Date.parse(next.lifecycle.updatedAt) < Date.parse(previous.lifecycle.updatedAt)) {
        fail(
            "INVALID_LIFECYCLE_ORDER",
            "$.lifecycle.updatedAt",
            "must not move backwards during a status transition",
        );
    }
    if (previous.status === "published" && immutablePayload(previous) !== immutablePayload(next)) {
        fail(
            "IMMUTABLE_PUBLISHED_VERSION",
            "$",
            "published evidence content cannot change when it is superseded",
        );
    }
    return true;
}
