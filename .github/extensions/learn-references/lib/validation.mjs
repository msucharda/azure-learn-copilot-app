const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class ContractValidationError extends TypeError {
    constructor(code, path, message) {
        super(`${path}: ${message}`);
        this.name = "ContractValidationError";
        this.code = code;
        this.path = path;
    }
}

export function fail(code, path, message) {
    throw new ContractValidationError(code, path, message);
}

export function requireObject(value, path, allowedKeys, requiredKeys = allowedKeys) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("INVALID_TYPE", path, "must be an object");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        fail("INVALID_TYPE", path, "must be a plain object");
    }

    for (const key of Object.keys(value)) {
        if (!allowedKeys.includes(key)) {
            fail("UNKNOWN_PROPERTY", `${path}.${key}`, "is not allowed by schema version 1");
        }
    }
    for (const key of requiredKeys) {
        if (!Object.hasOwn(value, key)) {
            fail("MISSING_PROPERTY", `${path}.${key}`, "is required");
        }
    }
    return value;
}

export function requireSchemaVersion(value, path = "$.schemaVersion") {
    if (value !== 1) {
        fail("UNSUPPORTED_SCHEMA_VERSION", path, `unsupported schema version ${JSON.stringify(value)}; expected 1`);
    }
    return value;
}

export function requireVersionedObject(value, path, allowedKeys, requiredKeys) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("INVALID_TYPE", path, "must be an object");
    }
    if (!Object.hasOwn(value, "schemaVersion")) {
        fail("MISSING_PROPERTY", `${path}.schemaVersion`, "is required");
    }
    requireSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
    return requireObject(value, path, allowedKeys, requiredKeys);
}

export function normalizeString(value, path, { min = 1, max, pattern } = {}) {
    if (typeof value !== "string") {
        fail("INVALID_TYPE", path, "must be a string");
    }
    const normalized = value.trim();
    if (normalized.length < min || (max !== undefined && normalized.length > max)) {
        const upper = max === undefined ? "or more" : `through ${max}`;
        fail("INVALID_LENGTH", path, `must contain ${min} ${upper} characters`);
    }
    if (pattern && !pattern.test(normalized)) {
        fail("INVALID_FORMAT", path, "has an invalid format");
    }
    return normalized;
}

export function normalizeOptionalString(value, path, options) {
    return value === undefined ? undefined : normalizeString(value, path, options);
}

export function normalizeStableId(value, path, prefix) {
    const normalized = normalizeString(value, path, {
        min: 3,
        max: 80,
        pattern: STABLE_ID_PATTERN,
    });
    if (prefix && !normalized.startsWith(`${prefix}-`)) {
        fail("INVALID_STABLE_ID", path, `must start with "${prefix}-"`);
    }
    return normalized;
}

export function normalizeResearchId(value, path = "$.researchId") {
    const normalized = normalizeString(value, path, {
        min: 36,
        max: 36,
        pattern: UUID_V4_PATTERN,
    });
    return normalized.toLowerCase();
}

export function normalizeSessionId(value, path) {
    const normalized = normalizeString(value, path, {
        min: 36,
        max: 36,
        pattern: UUID_V4_PATTERN,
    });
    return normalized.toLowerCase();
}

export function normalizePositiveInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 1) {
        fail("INVALID_INTEGER", path, "must be a positive safe integer");
    }
    return value;
}

export function normalizeEnum(value, path, allowed) {
    if (!allowed.includes(value)) {
        fail("INVALID_ENUM", path, `must be one of: ${allowed.join(", ")}`);
    }
    return value;
}

export function normalizeHash(value, path) {
    const normalized = normalizeString(value, path, {
        min: 64,
        max: 64,
        pattern: SHA256_PATTERN,
    });
    return normalized.toLowerCase();
}

export function normalizeTimestamp(value, path) {
    const normalized = normalizeString(value, path, {
        min: 20,
        max: 24,
        pattern: UTC_TIMESTAMP_PATTERN,
    });
    const milliseconds = Date.parse(normalized);
    if (!Number.isFinite(milliseconds)) {
        fail("INVALID_TIMESTAMP", path, "must be a valid UTC timestamp");
    }
    const canonicalInput = normalized.replace(
        /(?:\.(\d{1,3}))?Z$/,
        (_match, fraction = "") => `.${fraction.padEnd(3, "0")}Z`,
    );
    const canonicalTimestamp = new Date(milliseconds).toISOString();
    if (canonicalTimestamp !== canonicalInput) {
        fail("INVALID_TIMESTAMP", path, "must use valid calendar and clock values");
    }
    return canonicalTimestamp;
}

export function normalizeDateOrTimestamp(value, path) {
    if (typeof value === "string" && DATE_PATTERN.test(value.trim())) {
        const normalized = value.trim();
        const timestamp = Date.parse(`${normalized}T00:00:00Z`);
        if (
            !Number.isFinite(timestamp)
            || new Date(timestamp).toISOString().slice(0, 10) !== normalized
        ) {
            fail("INVALID_TIMESTAMP", path, "must use a valid calendar date");
        }
        return normalized;
    }
    return normalizeTimestamp(value, path);
}

export function normalizeArray(value, path, { min = 0, max, item }) {
    if (!Array.isArray(value)) {
        fail("INVALID_TYPE", path, "must be an array");
    }
    if (value.length < min || (max !== undefined && value.length > max)) {
        const upper = max === undefined ? "or more" : `through ${max}`;
        fail("INVALID_LENGTH", path, `must contain ${min} ${upper} items`);
    }
    return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

export function assertUnique(values, path, label = "value") {
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value)) {
            fail("DUPLICATE_ID", path, `contains duplicate ${label} "${value}"`);
        }
        seen.add(value);
    }
}

export function normalizeLearnUrl(value, path, { canonical = false } = {}) {
    const text = normalizeString(value, path, { min: 1, max: 2_048 });
    let url;
    try {
        url = new URL(text);
    } catch (error) {
        if (error instanceof TypeError) {
            fail("INVALID_URL", path, "must be an absolute URL");
        }
        throw error;
    }
    if (url.protocol !== "https:") {
        fail("INVALID_URL", path, "must use HTTPS");
    }
    if (url.hostname !== "learn.microsoft.com") {
        fail("INVALID_LEARN_HOST", path, "must use the canonical learn.microsoft.com host");
    }
    if (url.username || url.password || url.port) {
        fail("INVALID_URL", path, "must not include credentials or a custom port");
    }
    if (canonical && (url.search || url.hash)) {
        fail("INVALID_CANONICAL_URL", path, "must not include a query string or fragment");
    }
    const normalized = url.toString();
    if (canonical && text !== normalized) {
        fail("INVALID_CANONICAL_URL", path, "must already be in canonical URL form");
    }
    return normalized;
}

export function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
    }
    return value;
}
