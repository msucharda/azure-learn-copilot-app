import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
    lstat,
    mkdir,
    open,
    realpath,
    rename,
    rm,
} from "node:fs/promises";
import {
    basename,
    dirname,
    join,
    resolve,
} from "node:path";

export const TELEMETRY_MAX_FILE_BYTES = 256 * 1024;
export const TELEMETRY_MAX_FILES = 4;
const TELEMETRY_FILENAME = "telemetry.ndjson";
const OPERATIONS = new Set([
    "prepare_learn_research",
    "record_learn_evidence",
    "read_learn_evidence_capture",
    "persist_research_draft",
    "validate_research_bundle",
    "publish_research_bundle",
    "get_research_bundle",
    "acknowledge_research_handoff",
    "supersede_research_bundle",
    "learn_mcp_request",
]);
const OUTCOMES = new Set(["success", "failure"]);
const ERROR_KINDS = new Set([
    "adapter",
    "contract",
    "storage",
    "telemetry",
    "unknown",
]);
const CACHE_STATUSES = new Set(["hit", "miss", "bypass", "unknown"]);
const EVENT_KEYS = new Set([
    "operation",
    "outcome",
    "durationMs",
    "resultCount",
    "errorKind",
    "retryCount",
    "cacheStatus",
    "researchIdHash",
]);

export class LocalTelemetryError extends Error {
    constructor(code, message, options) {
        super(message, options);
        this.name = "LocalTelemetryError";
        this.code = code;
    }
}

function telemetryFail(code, message, options) {
    throw new LocalTelemetryError(code, message, options);
}

function boundedInteger(value, key, maximum) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
        telemetryFail("INVALID_EVENT", `${key} is outside its telemetry bound`);
    }
    return value;
}

function normalizeEvent(input, now) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        telemetryFail("INVALID_EVENT", "Telemetry event must be an object");
    }
    for (const key of Object.keys(input)) {
        if (!EVENT_KEYS.has(key)) {
            telemetryFail("INVALID_EVENT", "Telemetry event contains a forbidden field");
        }
    }
    if (!OPERATIONS.has(input.operation) || !OUTCOMES.has(input.outcome)) {
        telemetryFail("INVALID_EVENT", "Telemetry event operation or outcome is invalid");
    }
    const timestamp = now();
    if (
        typeof timestamp !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)
        || !Number.isFinite(Date.parse(timestamp))
    ) {
        telemetryFail("INVALID_EVENT", "Telemetry timestamp is invalid");
    }
    const event = {
        schemaVersion: 1,
        event: "learn_reference_operation",
        timestamp,
        operation: input.operation,
        outcome: input.outcome,
        durationMs: boundedInteger(input.durationMs, "durationMs", 3_600_000),
    };
    if (input.resultCount !== undefined) {
        event.resultCount = boundedInteger(input.resultCount, "resultCount", 1_000_000);
    }
    if (input.errorKind !== undefined) {
        if (!ERROR_KINDS.has(input.errorKind)) {
            telemetryFail("INVALID_EVENT", "errorKind is not allowlisted");
        }
        event.errorKind = input.errorKind;
    }
    if (input.retryCount !== undefined) {
        event.retryCount = boundedInteger(input.retryCount, "retryCount", 100);
    }
    if (input.cacheStatus !== undefined) {
        if (!CACHE_STATUSES.has(input.cacheStatus)) {
            telemetryFail("INVALID_EVENT", "cacheStatus is not allowlisted");
        }
        event.cacheStatus = input.cacheStatus;
    }
    if (input.researchIdHash !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(input.researchIdHash)) {
            telemetryFail("INVALID_EVENT", "researchIdHash must be an opaque SHA-256 digest");
        }
        event.researchIdHash = input.researchIdHash;
    }
    return event;
}

async function prepareRoot(configuredRoot) {
    if (typeof configuredRoot !== "string" || !configuredRoot.trim()) {
        telemetryFail("INVALID_ROOT", "Telemetry root must be a non-empty path");
    }
    const missing = [];
    let current = resolve(configuredRoot);
    while (true) {
        try {
            const metadata = await lstat(current);
            if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
                telemetryFail("UNSAFE_PATH", "Telemetry paths must be real directories");
            }
            const canonical = await realpath(current);
            if (canonical !== current) {
                telemetryFail("UNSAFE_PATH", "Telemetry paths cannot traverse symbolic links");
            }
            current = canonical;
            break;
        } catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
            const parent = dirname(current);
            if (parent === current) {
                throw error;
            }
            missing.unshift(basename(current));
            current = parent;
        }
    }
    for (const segment of missing) {
        if (!segment || segment === "." || segment === "..") {
            telemetryFail("UNSAFE_PATH", "Telemetry root contains an unsafe segment");
        }
        current = join(current, segment);
        await mkdir(current, { mode: 0o700 }).catch((error) => {
            if (error?.code !== "EEXIST") {
                throw error;
            }
        });
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            telemetryFail("UNSAFE_PATH", "Telemetry paths cannot traverse symbolic links");
        }
    }
    return realpath(current);
}

function filePath(root, generation = 0) {
    return join(
        root,
        generation === 0 ? TELEMETRY_FILENAME : `telemetry.${generation}.ndjson`,
    );
}

async function inspectFile(path, maxFileBytes) {
    try {
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            telemetryFail("UNSAFE_PATH", "Telemetry entries must be regular files");
        }
        if (maxFileBytes !== undefined && metadata.size > maxFileBytes) {
            telemetryFail("FILE_TOO_LARGE", "Telemetry file exceeds its configured bound");
        }
        return metadata;
    } catch (error) {
        if (error?.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

async function rotate(root, maxFiles, maxFileBytes) {
    const oldest = filePath(root, maxFiles - 1);
    if (await inspectFile(oldest, maxFileBytes)) {
        await rm(oldest);
    }
    for (let generation = maxFiles - 2; generation >= 0; generation -= 1) {
        const source = filePath(root, generation);
        if (await inspectFile(source, maxFileBytes)) {
            await rename(source, filePath(root, generation + 1));
        }
    }
}

export class LocalStructuredTelemetry {
    #root;
    #maxFileBytes;
    #maxFiles;
    #now;
    #pending = Promise.resolve();

    static async create({
        root,
        maxFileBytes = TELEMETRY_MAX_FILE_BYTES,
        maxFiles = TELEMETRY_MAX_FILES,
        now = () => new Date().toISOString(),
    }) {
        boundedInteger(maxFileBytes, "maxFileBytes", 8_000_000);
        boundedInteger(maxFiles, "maxFiles", 10);
        if (maxFileBytes < 512 || maxFiles < 1) {
            telemetryFail("INVALID_LIMIT", "Telemetry limits are below their safe minimum");
        }
        return new LocalStructuredTelemetry(
            await prepareRoot(root),
            maxFileBytes,
            maxFiles,
            now,
        );
    }

    constructor(root, maxFileBytes, maxFiles, now) {
        this.#root = root;
        this.#maxFileBytes = maxFileBytes;
        this.#maxFiles = maxFiles;
        this.#now = now;
    }

    record(input) {
        const operation = async () => {
            const text = `${JSON.stringify(normalizeEvent(input, this.#now))}\n`;
            const bytes = Buffer.byteLength(text);
            if (bytes > this.#maxFileBytes) {
                telemetryFail("EVENT_TOO_LARGE", "Telemetry event exceeds the file bound");
            }
            const current = filePath(this.#root);
            const metadata = await inspectFile(current, this.#maxFileBytes);
            if (metadata && metadata.size + bytes > this.#maxFileBytes) {
                await rotate(this.#root, this.#maxFiles, this.#maxFileBytes);
            }
            const handle = await open(
                current,
                constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY
                    | constants.O_NOFOLLOW,
                0o600,
            ).catch((error) => {
                if (error?.code === "ELOOP") {
                    telemetryFail("UNSAFE_PATH", "Telemetry files cannot be symbolic links");
                }
                throw error;
            });
            try {
                const metadataAfterOpen = await handle.stat();
                if (!metadataAfterOpen.isFile()) {
                    telemetryFail("UNSAFE_PATH", "Telemetry entry is not a regular file");
                }
                await handle.writeFile(text, "utf8");
            } finally {
                await handle.close();
            }
        };
        const result = this.#pending.then(operation, operation);
        this.#pending = result.catch(() => {});
        return result;
    }
}

export function opaqueTelemetryHash(value) {
    if (typeof value !== "string" || value.length > 200) {
        return undefined;
    }
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export function telemetryErrorKind(error) {
    if (error?.name === "LearnMcpAdapterError" || error?.name === "LearnMcpTransportError") {
        return "adapter";
    }
    if (error?.name === "LearnReferenceStorageError") {
        return "storage";
    }
    if (error?.name === "ContractValidationError") {
        return "contract";
    }
    if (error?.name === "LocalTelemetryError") {
        return "telemetry";
    }
    return "unknown";
}

export async function createLocalTelemetryFromEnv({
    env = process.env,
    defaultRoot,
} = {}) {
    if (env.COPILOT_LEARN_REFERENCES_TELEMETRY !== "1") {
        return undefined;
    }
    return LocalStructuredTelemetry.create({
        root: env.COPILOT_LEARN_REFERENCES_TELEMETRY_ROOT || defaultRoot,
    });
}
