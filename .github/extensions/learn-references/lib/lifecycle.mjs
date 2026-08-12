import {
    fail,
    normalizeEnum,
    normalizeTimestamp,
    requireObject,
} from "./validation.mjs";

export const EVIDENCE_STATUSES = Object.freeze([
    "draft",
    "validating",
    "validated",
    "published",
    "superseded",
    "rejected",
]);

export const STATUS_TRANSITIONS = Object.freeze({
    draft: Object.freeze(["validating"]),
    validating: Object.freeze(["validated", "rejected"]),
    validated: Object.freeze(["published"]),
    published: Object.freeze(["superseded"]),
    superseded: Object.freeze([]),
    rejected: Object.freeze([]),
});

const LIFECYCLE_KEYS = Object.freeze([
    "createdAt",
    "updatedAt",
    "validatingAt",
    "validatedAt",
    "rejectedAt",
    "publishedAt",
    "supersededAt",
]);

const REQUIRED_BY_STATUS = Object.freeze({
    draft: ["createdAt", "updatedAt"],
    validating: ["createdAt", "updatedAt", "validatingAt"],
    validated: ["createdAt", "updatedAt", "validatingAt", "validatedAt"],
    rejected: ["createdAt", "updatedAt", "validatingAt", "rejectedAt"],
    published: ["createdAt", "updatedAt", "validatingAt", "validatedAt", "publishedAt"],
    superseded: [
        "createdAt",
        "updatedAt",
        "validatingAt",
        "validatedAt",
        "publishedAt",
        "supersededAt",
    ],
});

const ORDER_BY_STATUS = Object.freeze({
    draft: ["createdAt", "updatedAt"],
    validating: ["createdAt", "validatingAt", "updatedAt"],
    validated: ["createdAt", "validatingAt", "validatedAt", "updatedAt"],
    rejected: ["createdAt", "validatingAt", "rejectedAt", "updatedAt"],
    published: ["createdAt", "validatingAt", "validatedAt", "publishedAt", "updatedAt"],
    superseded: [
        "createdAt",
        "validatingAt",
        "validatedAt",
        "publishedAt",
        "supersededAt",
        "updatedAt",
    ],
});

export function normalizeStatus(value, path = "$.status") {
    return normalizeEnum(value, path, EVIDENCE_STATUSES);
}

export function normalizeLifecycle(value, status, path = "$.lifecycle") {
    const required = REQUIRED_BY_STATUS[status];
    const object = requireObject(value, path, LIFECYCLE_KEYS, required);
    for (const key of LIFECYCLE_KEYS) {
        if (Object.hasOwn(object, key) && !required.includes(key)) {
            fail("INVALID_LIFECYCLE", `${path}.${key}`, `is not valid while status is "${status}"`);
        }
    }

    const normalized = {};
    for (const key of required) {
        normalized[key] = normalizeTimestamp(object[key], `${path}.${key}`);
    }

    const ordered = ORDER_BY_STATUS[status];
    for (let index = 1; index < ordered.length; index += 1) {
        const previous = normalized[ordered[index - 1]];
        const current = normalized[ordered[index]];
        if (Date.parse(current) < Date.parse(previous)) {
            fail(
                "INVALID_LIFECYCLE_ORDER",
                `${path}.${ordered[index]}`,
                `must not be earlier than ${ordered[index - 1]}`,
            );
        }
    }
    return normalized;
}

export function assertStatusTransition(from, to) {
    const normalizedFrom = normalizeStatus(from, "$.fromStatus");
    const normalizedTo = normalizeStatus(to, "$.toStatus");
    if (!STATUS_TRANSITIONS[normalizedFrom].includes(normalizedTo)) {
        fail(
            "INVALID_STATUS_TRANSITION",
            "$.status",
            `cannot transition from "${normalizedFrom}" to "${normalizedTo}"`,
        );
    }
    return true;
}
