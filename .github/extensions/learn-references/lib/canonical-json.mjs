import { createHash } from "node:crypto";

export class CanonicalJsonError extends TypeError {
    constructor(path, message) {
        super(`${path}: ${message}`);
        this.name = "CanonicalJsonError";
        this.code = "INVALID_CANONICAL_JSON";
        this.path = path;
    }
}

function serialize(value, path, ancestors) {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new CanonicalJsonError(path, "numbers must be finite");
        }
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        throw new CanonicalJsonError(path, `unsupported value type "${typeof value}"`);
    }
    if (ancestors.has(value)) {
        throw new CanonicalJsonError(path, "cyclic values are not supported");
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            const entries = [];
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.hasOwn(value, index)) {
                    throw new CanonicalJsonError(`${path}[${index}]`, "sparse arrays are not supported");
                }
                entries.push(serialize(value[index], `${path}[${index}]`, ancestors));
            }
            return `[${entries.join(",")}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new CanonicalJsonError(path, "objects must use a plain or null prototype");
        }
        const entries = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, ancestors)}`);
        return `{${entries.join(",")}}`;
    } finally {
        ancestors.delete(value);
    }
}

export function canonicalJson(value) {
    return serialize(value, "$", new Set());
}

export function sha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeLineEndings(value) {
    if (typeof value !== "string") {
        throw new TypeError("fetched Markdown must be a string");
    }
    return value.replace(/\r\n?/g, "\n");
}

export function hashFetchedMarkdown(markdown) {
    return sha256Hex(canonicalizeLineEndings(markdown));
}
