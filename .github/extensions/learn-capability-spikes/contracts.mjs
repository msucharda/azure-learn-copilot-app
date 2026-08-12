import { createHash } from "node:crypto";

const MAX_HOOK_RECORDS = 20;

export function sha256(value) {
    return createHash("sha256").update(String(value)).digest("hex");
}

function requireBoundedString(value, field, maxLength) {
    if (typeof value !== "string") {
        throw new TypeError(`${field} must be a string`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        throw new RangeError(`${field} must contain 1-${maxLength} characters`);
    }
    return normalized;
}

function learnUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "learn.microsoft.com") {
        throw new RangeError("sources must use https://learn.microsoft.com");
    }
    return url.toString();
}

function boundedJson(value, maxLength = 1_000) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        serialized = JSON.stringify({ unserializable: true });
    }
    const text = serialized ?? "null";
    return {
        length: text.length,
        sha256: sha256(text),
        preview: text.slice(0, maxLength),
        truncated: text.length > maxLength,
    };
}

export function isLearnTool(toolName) {
    return typeof toolName === "string"
        && /microsoft(?:-learn|_docs|_code_sample|.*docs|.*code.*sample)/i.test(toolName);
}

export function summarizeSuccessfulHook(input) {
    const result = input.toolResult ?? {};
    const text = typeof result.textResultForLlm === "string"
        ? result.textResultForLlm
        : "";
    const structured = result.structuredContent;
    const structuredJson = structured === undefined
        ? ""
        : JSON.stringify(structured);
    let parsedKeys = [];
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsedKeys = Object.keys(parsed).slice(0, 20);
        }
    } catch {
        parsedKeys = [];
    }

    return {
        kind: "success",
        toolName: String(input.toolName),
        args: boundedJson(input.toolArgs),
        toolResultKeys: Object.keys(result).sort(),
        resultType: result.resultType,
        textLength: text.length,
        textSha256: sha256(text),
        parsedTextKeys: parsedKeys,
        structuredContentVisible: Object.hasOwn(result, "structuredContent"),
        structuredContentKeys: structured && typeof structured === "object"
            ? Object.keys(structured).sort()
            : [],
        structuredContentLength: structuredJson.length,
        structuredContentSha256: structuredJson ? sha256(structuredJson) : null,
        structuredResultCount: Array.isArray(structured?.results)
            ? structured.results.length
            : null,
    };
}

export function summarizeFailedHook(input) {
    const error = typeof input.error === "string" ? input.error : String(input.error);
    return {
        kind: "failure",
        toolName: String(input.toolName),
        args: boundedJson(input.toolArgs),
        errorLength: error.length,
        errorSha256: sha256(error),
    };
}

export function normalizeEvidenceRecord(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("evidence must be an object");
    }
    const resultSha256 = requireBoundedString(input.resultSha256, "resultSha256", 64);
    if (!/^[a-f0-9]{64}$/i.test(resultSha256)) {
        throw new RangeError("resultSha256 must be a SHA-256 hex digest");
    }
    const resultCount = input.resultCount;
    if (!Number.isInteger(resultCount) || resultCount < 0 || resultCount > 100) {
        throw new RangeError("resultCount must be an integer from 0 through 100");
    }

    return {
        kind: "fallback-record",
        toolName: requireBoundedString(input.toolName, "toolName", 160),
        argsSummary: requireBoundedString(input.argsSummary, "argsSummary", 500),
        resultSha256: resultSha256.toLowerCase(),
        resultCount,
        sources: (input.sources ?? []).map(learnUrl),
    };
}

export function appendBoundedRecord(records, record) {
    records.push(record);
    if (records.length > MAX_HOOK_RECORDS) {
        records.splice(0, records.length - MAX_HOOK_RECORDS);
    }
}
