import { constants } from "node:fs";
import {
    link,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    rename,
    rmdir,
    unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    canonicalJson,
    sha256Hex,
} from "./canonical-json.mjs";
import { assertEvidenceContentHash } from "./content-hash.mjs";
import {
    assertEvidenceBundleTransition,
    normalizeEvidenceBundle,
} from "./evidence-bundle.mjs";
import {
    assertHandoffMatchesBundle,
    normalizeHandoffEnvelope,
} from "./handoff-envelope.mjs";
import {
    MAX_EVIDENCE_CAPTURES,
    MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH,
    normalizeCaptureId,
    normalizeEvidenceCapture,
    retentionManifestsForProse,
    validateResearchBundleWithRetention,
} from "./evidence-validation.mjs";
import {
    ContractValidationError,
    normalizeHash,
    normalizePositiveInteger,
    normalizeResearchId,
    normalizeSessionId,
    normalizeTimestamp,
    requireObject,
    requireSchemaVersion,
} from "./validation.mjs";

export const MAX_STORAGE_RECORD_BYTES = 8_000_000;
const STORAGE_LOCK_TIMEOUT_MS = 30_000;
const STORAGE_LOCK_RETRY_MS = 20;
const INCOMPLETE_LOCK_GRACE_MS = 5_000;
const MAX_HANDOFF_RESERVATIONS_PER_FETCH = 1_000;
const NEAR_FULL_CONTENT_NUMERATOR = 9;
const NEAR_FULL_CONTENT_DENOMINATOR = 10;

export class LearnReferenceStorageError extends Error {
    constructor(code, message, { path, cause } = {}) {
        super(message, { cause });
        this.name = "LearnReferenceStorageError";
        this.code = code;
        if (path !== undefined) {
            this.path = path;
        }
    }
}

function storageFail(code, message, options) {
    throw new LearnReferenceStorageError(code, message, options);
}

function validateSegment(value, label) {
    if (
        typeof value !== "string"
        || !value
        || value === "."
        || value === ".."
        || value.includes("\0")
        || value.includes("/")
        || value.includes("\\")
    ) {
        storageFail("INVALID_PATH_SEGMENT", `${label} is not a safe path segment`);
    }
    return value;
}

function assertUnderRoot(root, target) {
    const pathFromRoot = relative(root, target);
    if (
        pathFromRoot === ".."
        || pathFromRoot.startsWith(`..${sep}`)
        || isAbsolute(pathFromRoot)
    ) {
        storageFail("PATH_ESCAPE", "Resolved path escapes its configured storage root", {
            path: target,
        });
    }
}

async function prepareRoot(configuredRoot) {
    if (typeof configuredRoot !== "string" || !configuredRoot.trim()) {
        storageFail("INVALID_STORAGE_ROOT", "Storage root must be a non-empty path");
    }
    const absolute = resolve(configuredRoot);
    const missingSegments = [];
    let current = absolute;
    let metadata;
    while (metadata === undefined) {
        try {
            metadata = await lstat(current);
        } catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
            const parent = dirname(current);
            if (parent === current) {
                throw error;
            }
            missingSegments.unshift(basename(current));
            current = parent;
        }
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        storageFail(
            "UNSAFE_STORAGE_ROOT",
            "Configured storage roots and their existing parents must be real directories",
            { path: current },
        );
    }
    current = await realpath(current);
    for (const [index, segment] of missingSegments.entries()) {
        validateSegment(segment, `storage root segment ${index}`);
        const next = join(current, segment);
        let created = false;
        try {
            await mkdir(next, { mode: 0o700 });
            created = true;
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }
        }
        const nextMetadata = await lstat(next);
        if (nextMetadata.isSymbolicLink() || !nextMetadata.isDirectory()) {
            storageFail(
                "UNSAFE_STORAGE_ROOT",
                "Configured storage roots cannot traverse symbolic links",
                { path: next },
            );
        }
        if (created) {
            await syncDirectory(current);
        }
        current = next;
    }
    const rootMetadata = await lstat(current);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
        storageFail(
            "UNSAFE_STORAGE_ROOT",
            "Configured storage roots must be real directories",
            { path: current },
        );
    }
    return realpath(current);
}

async function ensureDirectory(root, segments) {
    let current = root;
    for (const [index, rawSegment] of segments.entries()) {
        const segment = validateSegment(rawSegment, `path segment ${index}`);
        current = join(current, segment);
        assertUnderRoot(root, current);
        let created = false;
        try {
            await mkdir(current, { mode: 0o700 });
            created = true;
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw error;
            }
        }
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            storageFail("SYMLINK_ESCAPE", "Storage directories cannot be symbolic links", {
                path: current,
            });
        }
        assertUnderRoot(root, await realpath(current));
        if (created) {
            await syncDirectory(dirname(current));
        }
    }
    return current;
}

async function inspectDirectory(root, segments) {
    let current = root;
    let exists = true;
    for (const [index, rawSegment] of segments.entries()) {
        const segment = validateSegment(rawSegment, `path segment ${index}`);
        current = join(current, segment);
        assertUnderRoot(root, current);
        if (!exists) {
            continue;
        }
        let metadata;
        try {
            metadata = await lstat(current);
        } catch (error) {
            if (error?.code === "ENOENT") {
                exists = false;
                continue;
            }
            throw error;
        }
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            storageFail("SYMLINK_ESCAPE", "Storage directories cannot be symbolic links", {
                path: current,
            });
        }
        assertUnderRoot(root, await realpath(current));
    }
    return { path: current, exists };
}

async function safeFilePath(
    root,
    directorySegments,
    filename,
    { createDirectories = true } = {},
) {
    const inspected = createDirectories
        ? { path: await ensureDirectory(root, directorySegments), exists: true }
        : await inspectDirectory(root, directorySegments);
    const directory = inspected.path;
    const path = join(directory, validateSegment(filename, "filename"));
    assertUnderRoot(root, path);
    if (!inspected.exists) {
        return path;
    }
    try {
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            storageFail("UNSAFE_STORAGE_ENTRY", "Storage files must be regular files", { path });
        }
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
    return path;
}

function isTemporaryFilename(filename) {
    return /^\..+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(filename);
}

function serializeStorageJson(value, path) {
    const text = `${canonicalJson(value)}\n`;
    const size = Buffer.byteLength(text, "utf8");
    if (size > MAX_STORAGE_RECORD_BYTES) {
        storageFail(
            "STORAGE_RECORD_TOO_LARGE",
            `Storage record exceeds the ${MAX_STORAGE_RECORD_BYTES}-byte limit`,
            { path },
        );
    }
    return text;
}

async function readJson(path, { missing = "error" } = {}) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        if (error?.code === "ENOENT" && missing === "undefined") {
            return undefined;
        }
        if (error?.code === "ELOOP") {
            storageFail("SYMLINK_ESCAPE", "Storage files cannot be symbolic links", { path });
        }
        throw error;
    }
    try {
        const metadata = await handle.stat();
        if (!metadata.isFile()) {
            storageFail("UNSAFE_STORAGE_ENTRY", "Storage entry is not a regular file", { path });
        }
        if (metadata.size > MAX_STORAGE_RECORD_BYTES) {
            storageFail("STORAGE_RECORD_TOO_LARGE", "Storage record exceeds its size limit", {
                path,
            });
        }
        const text = await handle.readFile("utf8");
        try {
            return JSON.parse(text);
        } catch (cause) {
            storageFail("MALFORMED_STORAGE_RECORD", "Storage record is not valid JSON", {
                path,
                cause,
            });
        }
    } finally {
        await handle.close();
    }
}

async function writeTemporary(path, text) {
    const temporary = join(
        dirname(path),
        `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
    );
    let closed = false;
    try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
        await handle.close();
        closed = true;
        return temporary;
    } catch (error) {
        if (!closed) {
            await handle.close();
        }
        await unlink(temporary).catch((unlinkError) => {
            if (unlinkError?.code !== "ENOENT") {
                throw unlinkError;
            }
        });
        throw error;
    }
}

async function syncDirectory(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function removeTemporary(path) {
    let removed = false;
    await unlink(path).then(() => {
        removed = true;
    }).catch((error) => {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    });
    if (removed) {
        await syncDirectory(dirname(path));
    }
}

async function atomicCreateJson(path, value) {
    const temporary = await writeTemporary(path, serializeStorageJson(value, path));
    try {
        await link(temporary, path);
        await syncDirectory(dirname(path));
    } catch (error) {
        if (error?.code === "EEXIST") {
            storageFail("STORAGE_CONFLICT", "Immutable storage record already exists", { path });
        }
        throw error;
    } finally {
        await removeTemporary(temporary);
    }
}

async function atomicReplaceJson(path, value) {
    const temporary = await writeTemporary(path, serializeStorageJson(value, path));
    try {
        await rename(temporary, path);
        await syncDirectory(dirname(path));
    } catch (error) {
        await removeTemporary(temporary);
        throw error;
    }
}

async function createOrCompare(path, value, {
    normalize = (entry) => entry,
    equivalent = (left, right) => canonicalJson(left) === canonicalJson(right),
    conflictCode,
    conflictMessage,
}) {
    try {
        await atomicCreateJson(path, value);
        return normalize(value);
    } catch (error) {
        if (!(error instanceof LearnReferenceStorageError) || error.code !== "STORAGE_CONFLICT") {
            throw error;
        }
    }
    const existing = normalize(await readJson(path));
    const intended = normalize(value);
    if (!equivalent(existing, intended)) {
        storageFail(conflictCode, conflictMessage, { path });
    }
    return existing;
}

async function assertCreateCompatible(path, value, {
    normalize = (entry) => entry,
    equivalent = (left, right) => canonicalJson(left) === canonicalJson(right),
    conflictCode,
    conflictMessage,
}) {
    const existingValue = await readJson(path, { missing: "undefined" });
    if (existingValue === undefined) {
        return;
    }
    const existing = normalize(existingValue);
    const intended = normalize(value);
    if (!equivalent(existing, intended)) {
        storageFail(conflictCode, conflictMessage, { path });
    }
}

function normalizeLockOwner(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "pid",
        "token",
        "createdAt",
    ]);
    requireSchemaVersion(object.schemaVersion);
    if (!Number.isSafeInteger(object.pid) || object.pid < 1) {
        storageFail("INVALID_STORAGE_LOCK", "Storage lock owner PID is invalid");
    }
    if (
        typeof object.token !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            object.token,
        )
    ) {
        storageFail("INVALID_STORAGE_LOCK", "Storage lock owner token is invalid");
    }
    return {
        schemaVersion: 1,
        pid: object.pid,
        token: object.token.toLowerCase(),
        createdAt: normalizeTimestamp(object.createdAt, "$.createdAt"),
    };
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === "ESRCH") {
            return false;
        }
        if (error?.code === "EPERM") {
            return true;
        }
        throw error;
    }
}

async function removeLockDirectory(root, lockPath) {
    const entries = await readdir(lockPath, { withFileTypes: true });
    for (const entry of entries) {
        if (
            !entry.isFile()
            || entry.isSymbolicLink()
            || (entry.name !== "owner.json" && !isTemporaryFilename(entry.name))
        ) {
            storageFail(
                "UNSAFE_STORAGE_LOCK",
                "Storage lock directories contain an unexpected entry",
                { path: join(lockPath, entry.name) },
            );
        }
        await unlink(join(lockPath, entry.name));
    }
    await syncDirectory(lockPath);
    await rmdir(lockPath);
    await syncDirectory(root);
}

async function assertLockIsLive(lockPath) {
    let metadata;
    try {
        metadata = await lstat(lockPath);
    } catch (error) {
        if (error?.code === "ENOENT") {
            return;
        }
        throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        storageFail("UNSAFE_STORAGE_LOCK", "Storage lock must be a real directory", {
            path: lockPath,
        });
    }
    const ownerPath = join(lockPath, "owner.json");
    const ownerValue = await readJson(ownerPath, { missing: "undefined" });
    if (ownerValue === undefined) {
        if (Date.now() - metadata.mtimeMs < INCOMPLETE_LOCK_GRACE_MS) {
            return;
        }
        storageFail(
            "ABANDONED_STORAGE_LOCK",
            "Published storage has an incomplete abandoned lock; remove it after confirming no writer is active",
            { path: lockPath },
        );
    }
    const owner = normalizeLockOwner(ownerValue);
    if (!processIsAlive(owner.pid)) {
        storageFail(
            "ABANDONED_STORAGE_LOCK",
            "Published storage has an abandoned lock; remove it after confirming no writer is active",
            { path: lockPath },
        );
    }
}

async function acquireStorageLock(root) {
    const lockPath = join(root, ".write-lock");
    const startedAt = Date.now();
    while (Date.now() - startedAt < STORAGE_LOCK_TIMEOUT_MS) {
        let created = false;
        try {
            await mkdir(lockPath, { mode: 0o700 });
            created = true;
            await syncDirectory(root);
            const owner = {
                schemaVersion: 1,
                pid: process.pid,
                token: randomUUID(),
                createdAt: new Date().toISOString(),
            };
            await atomicCreateJson(join(lockPath, "owner.json"), owner);
            return async () => {
                const stored = normalizeLockOwner(await readJson(join(lockPath, "owner.json")));
                if (stored.token !== owner.token) {
                    storageFail(
                        "STORAGE_LOCK_OWNERSHIP_LOST",
                        "Storage lock ownership changed before release",
                        { path: lockPath },
                    );
                }
                await removeLockDirectory(root, lockPath);
            };
        } catch (error) {
            if (created) {
                await removeLockDirectory(root, lockPath);
            }
            if (error?.code !== "EEXIST") {
                throw error;
            }
        }
        await assertLockIsLive(lockPath);
        await delay(STORAGE_LOCK_RETRY_MS);
    }
    storageFail("STORAGE_LOCK_TIMEOUT", "Timed out waiting for the published store lock", {
        path: lockPath,
    });
}

async function withStorageLock(root, operation) {
    const release = await acquireStorageLock(root);
    try {
        return await operation();
    } finally {
        await release();
    }
}

function immutableStoredPayload(bundle) {
    const {
        status: _status,
        lifecycle: _lifecycle,
        ...payload
    } = bundle;
    return payload;
}

function lifecycleRecord(bundle) {
    return {
        schemaVersion: 1,
        researchId: bundle.researchId,
        version: bundle.version,
        status: bundle.status,
        lifecycle: bundle.lifecycle,
    };
}

function publicationRetentionRecord(bundle, manifests) {
    return normalizePublicationRetentionRecord({
        schemaVersion: 1,
        researchId: bundle.researchId,
        version: bundle.version,
        contentHashes: [...new Set(
            manifests.map((manifest) => manifest.contentHash),
        )].sort(),
    });
}

function normalizeKey(researchId, version) {
    return {
        researchId: normalizeResearchId(researchId),
        version: normalizePositiveInteger(version, "$.version"),
    };
}

function assertStoredKey(value, expectedResearchId, expectedVersion, path) {
    if (value.researchId !== expectedResearchId || value.version !== expectedVersion) {
        storageFail("STORAGE_KEY_MISMATCH", "Stored record does not match its path key", { path });
    }
}

function normalizeBoundedInteger(value, path, { minimum = 0, maximum } = {}) {
    if (
        !Number.isSafeInteger(value)
        || value < minimum
        || (maximum !== undefined && value > maximum)
    ) {
        storageFail("INVALID_STORAGE_INTEGER", `${path} is outside its allowed range`);
    }
    return value;
}

function normalizeRetentionIntervals(
    intervalInputs,
    contentLength,
    path = "$.intervals",
    { requireDisjoint = true } = {},
) {
    if (
        !Array.isArray(intervalInputs)
        || (
            requireDisjoint
            && intervalInputs.length > MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH
        )
    ) {
        storageFail("INVALID_RETENTION_RECORD", "Retention intervals must be a bounded array");
    }
    const intervals = intervalInputs.map((entry, index) => {
        const intervalPath = `${path}[${index}]`;
        const interval = requireObject(entry, intervalPath, [
            "start",
            "end",
            "segmentHash",
        ]);
        const start = normalizeBoundedInteger(
            interval.start,
            `${intervalPath}.start`,
            { maximum: contentLength - 1 },
        );
        const end = normalizeBoundedInteger(
            interval.end,
            `${intervalPath}.end`,
            { minimum: start + 1, maximum: contentLength },
        );
        return {
            start,
            end,
            segmentHash: normalizeHash(
                interval.segmentHash,
                `${intervalPath}.segmentHash`,
            ),
        };
    });
    if (requireDisjoint) {
        for (let index = 1; index < intervals.length; index += 1) {
            if (intervals[index].start >= intervals[index - 1].end) {
                continue;
            }
            storageFail(
                "INVALID_RETENTION_RECORD",
                "Retention intervals must be sorted and non-overlapping",
            );
        }
    }
    return intervals;
}

function normalizeLegacyDecoratedFragments(value) {
    if (!Array.isArray(value) || value.length > 1_100) {
        storageFail(
            "INVALID_RETENTION_RECORD",
            "Legacy decorated retention fragments must be a bounded array",
        );
    }
    const normalized = value.map((entry, index) => {
        const fragment = requireObject(entry, `$.decoratedFragments[${index}]`, [
            "fragmentHash",
            "chars",
        ]);
        return {
            fragmentHash: normalizeHash(
                fragment.fragmentHash,
                `$.decoratedFragments[${index}].fragmentHash`,
            ),
            chars: normalizeBoundedInteger(
                fragment.chars,
                `$.decoratedFragments[${index}].chars`,
                { minimum: 1, maximum: 6_000 },
            ),
        };
    });
    if (
        new Set(normalized.map((entry) => entry.fragmentHash)).size !== normalized.length
        || normalized.some((
            entry,
            index,
        ) => index > 0 && entry.fragmentHash <= normalized[index - 1].fragmentHash)
    ) {
        storageFail(
            "INVALID_RETENTION_RECORD",
            "Legacy decorated retention fragments must be unique and sorted",
        );
    }
    return normalized;
}

function normalizeRetentionRecord(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "contentHash",
        "contentLength",
        "totalChars",
        "intervals",
        "decoratedFragments",
    ], [
        "schemaVersion",
        "contentHash",
        "contentLength",
        "totalChars",
        "intervals",
    ]);
    requireSchemaVersion(object.schemaVersion);
    const contentLength = normalizeBoundedInteger(object.contentLength, "$.contentLength", {
        minimum: 1,
        maximum: 262_144,
    });
    const intervals = normalizeRetentionIntervals(object.intervals, contentLength);
    const totalChars = normalizeBoundedInteger(object.totalChars, "$.totalChars", {
        maximum: MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH,
    });
    const computedTotal = intervals.reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
    );
    const legacyDecoratedFragments = object.decoratedFragments === undefined
        ? undefined
        : normalizeLegacyDecoratedFragments(object.decoratedFragments);
    if (
        computedTotal !== totalChars
        || totalChars >= contentLength
        || (
            legacyDecoratedFragments === undefined
            &&
            totalChars * NEAR_FULL_CONTENT_DENOMINATOR
            >= contentLength * NEAR_FULL_CONTENT_NUMERATOR
        )
    ) {
        storageFail(
            "INVALID_RETENTION_RECORD",
            "Retention totals must match intervals and remain below the fetched-content limits",
        );
    }
    const normalized = {
        schemaVersion: 1,
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
        contentLength,
        totalChars,
        intervals,
    };
    if (legacyDecoratedFragments !== undefined) {
        normalized.decoratedFragments = legacyDecoratedFragments;
    }
    return normalized;
}

function normalizePublicationRetentionRecord(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "researchId",
        "version",
        "contentHashes",
    ]);
    requireSchemaVersion(object.schemaVersion);
    if (
        !Array.isArray(object.contentHashes)
        || object.contentHashes.length > MAX_EVIDENCE_CAPTURES
    ) {
        storageFail(
            "INVALID_PUBLICATION_RETENTION",
            "Publication retention hashes must be a bounded array",
        );
    }
    const contentHashes = object.contentHashes.map((hash, index) => (
        normalizeHash(hash, `$.contentHashes[${index}]`)
    ));
    if (
        new Set(contentHashes).size !== contentHashes.length
        || contentHashes.some((hash, index) => index > 0 && hash <= contentHashes[index - 1])
    ) {
        storageFail(
            "INVALID_PUBLICATION_RETENTION",
            "Publication retention hashes must be unique and sorted",
        );
    }
    return {
        schemaVersion: 1,
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        contentHashes,
    };
}

function normalizeHandoffReservation(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "reservationId",
        "contentHash",
        "parentSessionId",
        "researchId",
        "version",
        "handoffHash",
        "textChars",
        "contentLength",
        "totalChars",
        "intervals",
    ], [
        "schemaVersion",
        "reservationId",
        "contentHash",
        "parentSessionId",
        "researchId",
        "version",
        "handoffHash",
    ]);
    requireSchemaVersion(object.schemaVersion);
    const metadata = {
        schemaVersion: 1,
        reservationId: normalizeHash(object.reservationId, "$.reservationId"),
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
        parentSessionId: normalizeSessionId(object.parentSessionId, "$.parentSessionId"),
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        handoffHash: normalizeHash(object.handoffHash, "$.handoffHash"),
    };
    const legacy = object.textChars !== undefined;
    const intervalRecord = (
        object.contentLength !== undefined
        || object.totalChars !== undefined
        || object.intervals !== undefined
    );
    if (legacy === intervalRecord) {
        storageFail(
            "INVALID_HANDOFF_RETENTION",
            "Handoff retention must use exactly one supported reservation format",
        );
    }
    if (legacy) {
        return {
            ...metadata,
            textChars: normalizeBoundedInteger(object.textChars, "$.textChars", {
                minimum: 1,
                maximum: 40_000,
            }),
        };
    }
    const retention = normalizeRetentionRecord({
        schemaVersion: 1,
        contentHash: metadata.contentHash,
        contentLength: object.contentLength,
        totalChars: object.totalChars,
        intervals: object.intervals,
    });
    return {
        ...metadata,
        contentLength: retention.contentLength,
        totalChars: retention.totalChars,
        intervals: retention.intervals,
    };
}

function normalizeSupersessionRecord(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "researchId",
        "version",
        "status",
        "supersededAt",
        "updatedAt",
    ]);
    requireSchemaVersion(object.schemaVersion);
    if (object.status !== "superseded") {
        storageFail("INVALID_SUPERSESSION", 'Supersession status must be "superseded"');
    }
    const supersededAt = normalizeTimestamp(object.supersededAt, "$.supersededAt");
    const updatedAt = normalizeTimestamp(object.updatedAt, "$.updatedAt");
    if (supersededAt !== updatedAt) {
        storageFail(
            "INVALID_SUPERSESSION",
            "Supersession updatedAt must equal supersededAt",
        );
    }
    return {
        schemaVersion: 1,
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        status: "superseded",
        supersededAt,
        updatedAt,
    };
}

function normalizeCommitRecord(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "researchId",
        "version",
        "contentHash",
        "lifecycleHash",
        "retentionHash",
        "committedAt",
    ]);
    requireSchemaVersion(object.schemaVersion);
    return {
        schemaVersion: 1,
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
        lifecycleHash: normalizeHash(object.lifecycleHash, "$.lifecycleHash"),
        retentionHash: normalizeHash(object.retentionHash, "$.retentionHash"),
        committedAt: normalizeTimestamp(object.committedAt, "$.committedAt"),
    };
}

function normalizeAcknowledgement(input) {
    const object = requireObject(input, "$", [
        "schemaVersion",
        "parentSessionId",
        "researchId",
        "version",
        "status",
        "contentHash",
        "acknowledgedAt",
    ]);
    requireSchemaVersion(object.schemaVersion);
    if (object.status !== "acknowledged") {
        storageFail("INVALID_ACKNOWLEDGEMENT", 'Acknowledgement status must be "acknowledged"');
    }
    return {
        schemaVersion: 1,
        parentSessionId: normalizeSessionId(object.parentSessionId, "$.parentSessionId"),
        researchId: normalizeResearchId(object.researchId),
        version: normalizePositiveInteger(object.version, "$.version"),
        status: "acknowledged",
        contentHash: normalizeHash(object.contentHash, "$.contentHash"),
        acknowledgedAt: normalizeTimestamp(object.acknowledgedAt, "$.acknowledgedAt"),
    };
}

function defaultDraftRoot({ cwd, env }) {
    const workspaceDigest = sha256Hex(resolve(cwd)).slice(0, 32);
    const copilotHome = env.COPILOT_HOME || join(homedir(), ".copilot");
    return join(copilotHome, "learn-references", "drafts", workspaceDigest);
}

function defaultPublishedRoot({ env }) {
    return join(env.COPILOT_HOME || join(homedir(), ".copilot"), "learn-references", "published");
}

export function resolveLearnReferenceStorageRoots({
    cwd = process.cwd(),
    env = process.env,
} = {}) {
    return {
        draftRoot: resolve(env.COPILOT_LEARN_DRAFT_ROOT || defaultDraftRoot({ cwd, env })),
        publishedRoot: resolve(
            env.COPILOT_LEARN_PUBLISHED_ROOT || defaultPublishedRoot({ env }),
        ),
    };
}

function handoffProse(envelope) {
    return [
        ...envelope.executiveFindings.map((finding, index) => ({
            path: `$.executiveFindings[${index}].text`,
            text: finding.text,
        })),
        ...envelope.unresolvedRisks.map((risk, index) => ({
            path: `$.unresolvedRisks[${index}].text`,
            text: risk.text,
        })),
    ];
}

function mergedIntervalCoverage(intervals) {
    const sorted = intervals
        .map(({ start, end }) => ({ start, end }))
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const interval of sorted) {
        const previous = merged.at(-1);
        if (previous && interval.start <= previous.end) {
            previous.end = Math.max(previous.end, interval.end);
        } else {
            merged.push(interval);
        }
    }
    return merged.reduce((total, interval) => total + interval.end - interval.start, 0);
}

export function assertHandoffContentBounded(
    envelopeInput,
    bundleInput,
    bundleRetentionInputs,
    handoffRetentionInputs,
    {
        reservedIntervalsByHash = new Map(),
    } = {},
) {
    const envelope = normalizeHandoffEnvelope(envelopeInput);
    const bundle = normalizeEvidenceBundle(bundleInput);
    assertHandoffMatchesBundle(envelope, bundle);
    if (
        !Array.isArray(bundleRetentionInputs)
        || !Array.isArray(handoffRetentionInputs)
        || !(reservedIntervalsByHash instanceof Map)
    ) {
        storageFail(
            "MISSING_RETENTION_MANIFEST",
            "Handoff validation requires bundle, handoff, and reserved retention intervals",
        );
    }
    const bundleManifests = bundleRetentionInputs.map(normalizeRetentionRecord);
    const handoffManifests = handoffRetentionInputs.map(normalizeRetentionRecord);
    const bundleByHash = new Map(
        bundleManifests.map((manifest) => [manifest.contentHash, manifest]),
    );
    const handoffByHash = new Map(
        handoffManifests.map((manifest) => [manifest.contentHash, manifest]),
    );
    for (const source of bundle.sources) {
        if (!bundleByHash.has(source.contentHash)) {
            storageFail(
                "MISSING_RETENTION_MANIFEST",
                `No retention manifest exists for declared source ${source.id}`,
            );
        }
    }
    if (
        handoffByHash.size !== bundleByHash.size
        || [...handoffByHash.keys()].some((hash) => !bundleByHash.has(hash))
    ) {
        storageFail(
            "MISSING_RETENTION_MANIFEST",
            "Handoff retention must cover exactly the fetched bundle content",
        );
    }
    for (const [contentHash, bundleManifest] of bundleByHash) {
        const handoffManifest = handoffByHash.get(contentHash);
        if (
            handoffManifest === undefined
            || handoffManifest.contentLength !== bundleManifest.contentLength
        ) {
            storageFail(
                "MISSING_RETENTION_MANIFEST",
                `No retention manifest exists for fetched content ${contentHash}`,
            );
        }
        const reservedIntervals = normalizeRetentionIntervals(
            reservedIntervalsByHash.get(contentHash) ?? [],
            bundleManifest.contentLength,
            `$.reservedIntervalsByHash[${contentHash}]`,
            { requireDisjoint: false },
        );
        const verifiedChars = mergedIntervalCoverage([
            ...bundleManifest.intervals,
            ...reservedIntervals,
            ...handoffManifest.intervals,
        ]);
        const retainedChars = verifiedChars;
        if (
            retainedChars >= bundleManifest.contentLength
            || (
                retainedChars * NEAR_FULL_CONTENT_DENOMINATOR
                >= bundleManifest.contentLength * NEAR_FULL_CONTENT_NUMERATOR
            )
        ) {
            storageFail(
                "HANDOFF_FULL_FETCH_CONTENT",
                "Cumulative bundle and handoff spans cannot reconstruct fetched content",
            );
        }
        if (retainedChars > MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH) {
            storageFail(
                "HANDOFF_RETENTION_LIMIT",
                `Cumulative bundle and handoff spans cannot exceed ${MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH} characters`,
            );
        }
    }
    return true;
}

function verifiedProseRetentionManifests(
    bundle,
    captureInputs,
    prose,
    initialIntervalsByHash,
) {
    try {
        return retentionManifestsForProse(
            bundle,
            captureInputs,
            prose,
            { initialIntervalsByHash },
        );
    } catch (error) {
        if (error instanceof ContractValidationError && error.code === "FULL_FETCH_CONTENT") {
            storageFail(
                "HANDOFF_FULL_FETCH_CONTENT",
                "Handoff text cannot reconstruct fetched content",
                { cause: error },
            );
        }
        if (
            error instanceof ContractValidationError
            && error.code === "EXCERPT_BUDGET_EXCEEDED"
        ) {
            storageFail(
                "HANDOFF_RETENTION_LIMIT",
                `Cumulative bundle and handoff spans cannot exceed ${MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH} characters`,
                { cause: error },
            );
        }
        throw error;
    }
}

function verifiedHandoffRetentionManifests(
    bundle,
    captureInputs,
    envelope,
    initialIntervalsByHash,
) {
    return verifiedProseRetentionManifests(
        bundle,
        captureInputs,
        handoffProse(envelope),
        initialIntervalsByHash,
    );
}

export class DraftEvidenceStore {
    static async create({ root }) {
        return new DraftEvidenceStore(await prepareRoot(root));
    }

    constructor(root) {
        this.root = root;
    }

    async writeBundle(bundleInput) {
        const bundle = normalizeEvidenceBundle(bundleInput);
        if (bundle.status === "published" || bundle.status === "superseded") {
            storageFail(
                "INVALID_DRAFT_STATUS",
                "Published and superseded bundles belong in the published store",
            );
        }
        const path = await safeFilePath(
            this.root,
            ["bundles", bundle.researchId],
            `${bundle.version}.json`,
        );
        await atomicReplaceJson(path, bundle);
        return bundle;
    }

    async readBundle(researchIdInput, versionInput) {
        const { researchId, version } = normalizeKey(researchIdInput, versionInput);
        const path = await safeFilePath(
            this.root,
            ["bundles", researchId],
            `${version}.json`,
            { createDirectories: false },
        );
        const value = await readJson(path, { missing: "undefined" });
        if (value === undefined) {
            storageFail("DRAFT_NOT_FOUND", "Draft evidence bundle was not found", { path });
        }
        const bundle = normalizeEvidenceBundle(value);
        assertStoredKey(bundle, researchId, version, path);
        return bundle;
    }

    async recordCapture(captureInput) {
        const capture = normalizeEvidenceCapture(captureInput);
        const path = await safeFilePath(
            this.root,
            ["captures", capture.researchId],
            `${capture.captureId}.json`,
        );
        return createOrCompare(path, capture, {
            normalize: normalizeEvidenceCapture,
            conflictCode: "CAPTURE_CONFLICT",
            conflictMessage: "Capture ID already exists with different evidence",
        });
    }

    async readCapture(researchIdInput, captureIdInput) {
        const researchId = normalizeResearchId(researchIdInput);
        const captureId = normalizeCaptureId(captureIdInput);
        const path = await safeFilePath(
            this.root,
            ["captures", researchId],
            `${captureId}.json`,
            { createDirectories: false },
        );
        const value = await readJson(path, { missing: "undefined" });
        if (value === undefined) {
            storageFail("CAPTURE_NOT_FOUND", "Draft evidence capture was not found", { path });
        }
        const capture = normalizeEvidenceCapture(value);
        if (capture.researchId !== researchId || capture.captureId !== captureId) {
            storageFail("STORAGE_KEY_MISMATCH", "Capture identity does not match its path", {
                path,
            });
        }
        return capture;
    }

    async listCaptures(researchIdInput) {
        const researchId = normalizeResearchId(researchIdInput);
        const inspected = await inspectDirectory(this.root, ["captures", researchId]);
        if (!inspected.exists) {
            return [];
        }
        const directory = inspected.path;
        const entries = await readdir(directory, { withFileTypes: true });
        const persistentEntryCount = entries.filter((entry) => (
            !(entry.isFile() && isTemporaryFilename(entry.name))
        )).length;
        if (persistentEntryCount > MAX_EVIDENCE_CAPTURES) {
            storageFail(
                "TOO_MANY_CAPTURES",
                `Capture storage cannot exceed ${MAX_EVIDENCE_CAPTURES} records per research ID`,
                { path: directory },
            );
        }
        const captures = [];
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (entry.isFile() && isTemporaryFilename(entry.name)) {
                continue;
            }
            if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
                storageFail(
                    "UNSAFE_STORAGE_ENTRY",
                    "Capture directories may contain only regular JSON files",
                    { path: join(directory, entry.name) },
                );
            }
            const path = await safeFilePath(
                this.root,
                ["captures", researchId],
                entry.name,
            );
            const capture = normalizeEvidenceCapture(await readJson(path));
            if (capture.researchId !== researchId) {
                storageFail("STORAGE_KEY_MISMATCH", "Capture researchId does not match its path", {
                    path,
                });
            }
            captures.push(capture);
        }
        return captures;
    }
}

export class PublishedEvidenceStore {
    static async create({ root }) {
        return new PublishedEvidenceStore(await prepareRoot(root));
    }

    constructor(root) {
        this.root = root;
    }

    async paths(
        researchIdInput,
        versionInput,
        { createDirectories = true } = {},
    ) {
        const { researchId, version } = normalizeKey(researchIdInput, versionInput);
        const versionSegments = ["evidence", researchId, String(version)];
        const fileOptions = { createDirectories };
        return {
            researchId,
            version,
            payload: await safeFilePath(this.root, versionSegments, "payload.json", fileOptions),
            lifecycle: await safeFilePath(
                this.root,
                versionSegments,
                "lifecycle.json",
                fileOptions,
            ),
            retention: await safeFilePath(
                this.root,
                versionSegments,
                "retention.json",
                fileOptions,
            ),
            supersession: await safeFilePath(
                this.root,
                versionSegments,
                "supersession.json",
                fileOptions,
            ),
            commit: await safeFilePath(this.root, versionSegments, "commit.json", fileOptions),
        };
    }

    async publish(bundleInput, captureInputs, handoffInput) {
        const { bundle, retentionManifests } = validateResearchBundleWithRetention(
            bundleInput,
            captureInputs,
        );
        if (bundle.status !== "published") {
            storageFail("INVALID_PUBLISH_STATUS", 'Published storage requires status "published"');
        }
        const handoff = handoffInput === undefined
            ? undefined
            : normalizeHandoffEnvelope(handoffInput);
        if (handoff !== undefined) {
            assertHandoffMatchesBundle(handoff, bundle);
        }
        return withStorageLock(this.root, async () => (
            this.publishLocked(bundle, retentionManifests, handoff, captureInputs)
        ));
    }

    async publishLocked(bundle, retentionManifests, handoff, captureInputs) {
        const paths = await this.paths(bundle.researchId, bundle.version);
        const payload = immutableStoredPayload(bundle);
        const lifecycle = lifecycleRecord(bundle);
        const publicationRetention = publicationRetentionRecord(bundle, retentionManifests);
        const commit = {
            schemaVersion: 1,
            researchId: bundle.researchId,
            version: bundle.version,
            contentHash: bundle.contentHash,
            lifecycleHash: sha256Hex(canonicalJson(lifecycle)),
            retentionHash: sha256Hex(canonicalJson(publicationRetention)),
            committedAt: bundle.lifecycle.updatedAt,
        };
        await assertCreateCompatible(paths.payload, payload, {
            conflictCode: "PUBLICATION_CONFLICT",
            conflictMessage: "Evidence key already exists with different immutable content",
        });
        await assertCreateCompatible(paths.lifecycle, lifecycle, {
            conflictCode: "PUBLICATION_LIFECYCLE_CONFLICT",
            conflictMessage: "Evidence key already exists with different initial lifecycle",
        });
        await assertCreateCompatible(paths.retention, publicationRetention, {
            normalize: normalizePublicationRetentionRecord,
            conflictCode: "PUBLICATION_RETENTION_CONFLICT",
            conflictMessage: "Evidence key already exists with different fetch retention metadata",
        });
        await assertCreateCompatible(paths.commit, commit, {
            normalize: normalizeCommitRecord,
            conflictCode: "PUBLICATION_COMMIT_CONFLICT",
            conflictMessage: "Publication commit marker conflicts with immutable evidence",
        });
        const preparedRetention = await this.prepareRetention(retentionManifests);
        const preparedHandoff = handoff === undefined
            ? undefined
            : await this.prepareHandoff(
                handoff,
                bundle,
                preparedRetention.map(({ existing, manifest }) => existing ?? manifest),
                captureInputs,
            );

        const storedPayload = await createOrCompare(paths.payload, payload, {
            conflictCode: "PUBLICATION_CONFLICT",
            conflictMessage: "Evidence key already exists with different immutable content",
        });
        await createOrCompare(paths.lifecycle, lifecycle, {
            conflictCode: "PUBLICATION_LIFECYCLE_CONFLICT",
            conflictMessage: "Evidence key already exists with different initial lifecycle",
        });
        const storedLifecycle = await readJson(paths.lifecycle);
        assertStoredKey(storedPayload, paths.researchId, paths.version, paths.payload);
        assertStoredKey(storedLifecycle, paths.researchId, paths.version, paths.lifecycle);
        const storedBundle = assertEvidenceContentHash({
            ...storedPayload,
            status: storedLifecycle.status,
            lifecycle: storedLifecycle.lifecycle,
        });
        if (storedBundle.status !== "published") {
            storageFail(
                "INVALID_PUBLISHED_STATUS",
                "Initial lifecycle metadata must remain published",
            );
        }

        await this.reserveRetention(preparedRetention);
        await createOrCompare(paths.retention, publicationRetention, {
            normalize: normalizePublicationRetentionRecord,
            conflictCode: "PUBLICATION_RETENTION_CONFLICT",
            conflictMessage: "Evidence key already exists with different fetch retention metadata",
        });
        if (preparedHandoff !== undefined) {
            await this.writePreparedHandoff(preparedHandoff);
        }
        await createOrCompare(paths.commit, commit, {
            normalize: normalizeCommitRecord,
            conflictCode: "PUBLICATION_COMMIT_CONFLICT",
            conflictMessage: "Publication commit marker conflicts with immutable evidence",
        });
        return this.get(bundle.researchId, bundle.version);
    }

    async prepareRetention(manifests) {
        const prepared = [];
        for (const manifestInput of manifests) {
            const manifest = normalizeRetentionRecord(manifestInput);
            const path = await safeFilePath(
                this.root,
                ["retention", manifest.contentHash],
                "budget.json",
            );
            const existingValue = await readJson(path, { missing: "undefined" });
            const compatible = (existing, intended) => (
                existing.contentHash === intended.contentHash
                && existing.contentLength === intended.contentLength
                && intended.intervals.every((interval) => (
                    existing.intervals.some((approved) => (
                        approved.start <= interval.start
                        && approved.end >= interval.end
                    ))
                ))
            );
            let existing;
            if (existingValue !== undefined) {
                existing = normalizeRetentionRecord(existingValue);
                if (!compatible(existing, manifest)) {
                    storageFail(
                        "RETENTION_BUDGET_CONFLICT",
                        "Publication would expand persisted content for a fetched page",
                        { path },
                    );
                }
            }
            prepared.push({ path, manifest, existing, compatible });
        }
        return prepared;
    }

    async reserveRetention(prepared) {
        for (const { path, manifest, compatible } of prepared) {
            await createOrCompare(path, manifest, {
                normalize: normalizeRetentionRecord,
                equivalent: compatible,
                conflictCode: "RETENTION_BUDGET_CONFLICT",
                conflictMessage: "Publication would expand persisted content for a fetched page",
            });
        }
    }

    async prepareHandoff(
        envelopeInput,
        bundleInput,
        retentionManifestInputs,
        captureInputs,
    ) {
        const envelope = normalizeHandoffEnvelope(envelopeInput);
        const bundle = normalizeEvidenceBundle(bundleInput);
        assertHandoffMatchesBundle(envelope, bundle);
        const path = await safeFilePath(
            this.root,
            ["handoffs", envelope.parentSessionId, envelope.researchId],
            `${envelope.version}.json`,
        );
        await assertCreateCompatible(path, envelope, {
            normalize: normalizeHandoffEnvelope,
            conflictCode: "HANDOFF_CONFLICT",
            conflictMessage: "Handoff key already exists with different data",
        });

        const manifests = retentionManifestInputs.map(normalizeRetentionRecord);
        const manifestByHash = new Map(
            manifests.map((manifest) => [manifest.contentHash, manifest]),
        );
        const contentHashes = [...manifestByHash.keys()];
        const reservationId = sha256Hex(canonicalJson({
            parentSessionId: envelope.parentSessionId,
            researchId: envelope.researchId,
            version: envelope.version,
        }));
        const handoffHash = sha256Hex(canonicalJson(envelope));
        const initialIntervalsByHash = new Map();
        const reservedIntervalsByHash = new Map();
        const legacyReservations = new Map();
        const contexts = [];

        for (const contentHash of contentHashes) {
            const manifest = manifestByHash.get(contentHash);
            if (!manifest) {
                storageFail(
                    "MISSING_RETENTION_MANIFEST",
                    `No retention manifest exists for fetched content ${contentHash}`,
                );
            }
            const directory = await ensureDirectory(
                this.root,
                ["retention", contentHash, "handoffs"],
            );
            const entries = await readdir(directory, { withFileTypes: true });
            const reservedIntervals = [];
            let permanentEntries = 0;
            let currentReservation;
            for (const entry of entries) {
                if (entry.isFile() && isTemporaryFilename(entry.name)) {
                    continue;
                }
                permanentEntries += 1;
                if (
                    !entry.isFile()
                    || entry.isSymbolicLink()
                    || !/^[0-9a-f]{64}\.json$/.test(entry.name)
                ) {
                    storageFail(
                        "UNSAFE_STORAGE_ENTRY",
                        "Handoff retention directories may contain only hashed JSON records",
                        { path: join(directory, entry.name) },
                    );
                }
                const reservationPath = await safeFilePath(
                    this.root,
                    ["retention", contentHash, "handoffs"],
                    entry.name,
                );
                const reservation = normalizeHandoffReservation(
                    await readJson(reservationPath),
                );
                if (
                    reservation.contentHash !== contentHash
                    || `${reservation.reservationId}.json` !== entry.name
                ) {
                    storageFail(
                        "STORAGE_KEY_MISMATCH",
                        "Handoff retention reservation does not match its storage path",
                        { path: reservationPath },
                    );
                }
                if (reservation.reservationId === reservationId) {
                    currentReservation = reservation;
                } else if (reservation.textChars !== undefined) {
                    const existingLegacy = legacyReservations.get(
                        reservation.reservationId,
                    );
                    if (
                        existingLegacy !== undefined
                        && (
                            existingLegacy.parentSessionId
                                !== reservation.parentSessionId
                            || existingLegacy.researchId !== reservation.researchId
                            || existingLegacy.version !== reservation.version
                            || existingLegacy.handoffHash !== reservation.handoffHash
                        )
                    ) {
                        storageFail(
                            "HANDOFF_RETENTION_CONFLICT",
                            "Legacy handoff reservations disagree across fetched pages",
                            { path: reservationPath },
                        );
                    }
                    legacyReservations.set(reservation.reservationId, reservation);
                } else {
                    if (reservation.contentLength !== manifest.contentLength) {
                        storageFail(
                            "HANDOFF_RETENTION_CONFLICT",
                            "Handoff retention content length conflicts with its fetched page",
                            { path: reservationPath },
                        );
                    }
                    reservedIntervals.push(...reservation.intervals);
                }
            }
            if (
                permanentEntries > MAX_HANDOFF_RESERVATIONS_PER_FETCH
                || (
                    currentReservation === undefined
                    && permanentEntries >= MAX_HANDOFF_RESERVATIONS_PER_FETCH
                )
            ) {
                storageFail(
                    "HANDOFF_RETENTION_LIMIT",
                    "Fetched content has too many persisted handoff reservations",
                    { path: directory },
                );
            }
            const reservationPath = await safeFilePath(
                this.root,
                ["retention", contentHash, "handoffs"],
                `${reservationId}.json`,
            );
            if (
                currentReservation !== undefined
                && (
                    currentReservation.contentHash !== contentHash
                    || currentReservation.parentSessionId !== envelope.parentSessionId
                    || currentReservation.researchId !== envelope.researchId
                    || currentReservation.version !== envelope.version
                    || currentReservation.handoffHash !== handoffHash
                )
            ) {
                storageFail(
                    "HANDOFF_RETENTION_CONFLICT",
                    "Handoff retention reservation conflicts with stored data",
                    { path: reservationPath },
                );
            }
            initialIntervalsByHash.set(contentHash, [
                ...manifest.intervals,
                ...reservedIntervals,
            ]);
            reservedIntervalsByHash.set(contentHash, reservedIntervals);
            contexts.push({
                contentHash,
                manifest,
                reservedIntervals,
                reservationPath,
                currentReservation,
            });
        }

        if (
            contexts.length > 0
            && contexts.every((context) => context.currentReservation !== undefined)
        ) {
            return {
                path,
                envelope,
                reservations: contexts.map((context) => ({
                    path: context.reservationPath,
                    reservation: context.currentReservation,
                })),
            };
        }

        if (legacyReservations.size > 0) {
            const legacyProse = [];
            for (const reservation of legacyReservations.values()) {
                const legacyPath = await safeFilePath(
                    this.root,
                    [
                        "handoffs",
                        reservation.parentSessionId,
                        reservation.researchId,
                    ],
                    `${reservation.version}.json`,
                    { createDirectories: false },
                );
                const legacyValue = await readJson(legacyPath, { missing: "undefined" });
                if (legacyValue === undefined) {
                    storageFail(
                        "LEGACY_HANDOFF_RETENTION_UNVERIFIABLE",
                        "Legacy handoff retention requires its stored envelope",
                        { path: legacyPath },
                    );
                }
                const legacyEnvelope = normalizeHandoffEnvelope(legacyValue);
                if (
                    legacyEnvelope.parentSessionId !== reservation.parentSessionId
                    || legacyEnvelope.researchId !== reservation.researchId
                    || legacyEnvelope.version !== reservation.version
                    || sha256Hex(canonicalJson(legacyEnvelope)) !== reservation.handoffHash
                ) {
                    storageFail(
                        "LEGACY_HANDOFF_RETENTION_UNVERIFIABLE",
                        "Legacy handoff envelope does not match its retention reservation",
                        { path: legacyPath },
                    );
                }
                legacyProse.push(...handoffProse(legacyEnvelope));
            }
            const reconstructed = verifiedProseRetentionManifests(
                bundle,
                captureInputs,
                legacyProse,
                initialIntervalsByHash,
            );
            const reconstructedByHash = new Map(
                reconstructed.map((manifest) => [manifest.contentHash, manifest]),
            );
            for (const context of contexts) {
                const legacyManifest = reconstructedByHash.get(context.contentHash);
                if (legacyManifest === undefined) {
                    storageFail(
                        "MISSING_HANDOFF_FETCH_EVIDENCE",
                        `No fresh fetch capture exists for legacy handoff content ${context.contentHash}`,
                    );
                }
                context.reservedIntervals.push(...legacyManifest.intervals);
                initialIntervalsByHash.set(context.contentHash, [
                    ...context.manifest.intervals,
                    ...context.reservedIntervals,
                ]);
            }
        }

        const generatedManifests = verifiedHandoffRetentionManifests(
            bundle,
            captureInputs,
            envelope,
            initialIntervalsByHash,
        );
        const generatedByHash = new Map(
            generatedManifests.map((manifest) => [manifest.contentHash, manifest]),
        );
        if (
            generatedByHash.size !== manifestByHash.size
            || [...generatedByHash.keys()].some((hash) => !manifestByHash.has(hash))
        ) {
            storageFail(
                "MISSING_HANDOFF_FETCH_EVIDENCE",
                "Handoff captures must exactly match the fetched content retained by publication",
            );
        }
        const handoffManifests = [];
        const reservations = [];
        for (const context of contexts) {
            const generated = generatedByHash.get(context.contentHash);
            if (generated === undefined) {
                storageFail(
                    "MISSING_RETENTION_MANIFEST",
                    `No fresh fetch capture exists for handoff content ${context.contentHash}`,
                );
            }
            let manifest = generated;
            let reservation = context.currentReservation;
            if (reservation !== undefined && reservation.textChars === undefined) {
                manifest = {
                    schemaVersion: 1,
                    contentHash: reservation.contentHash,
                    contentLength: reservation.contentLength,
                    totalChars: reservation.totalChars,
                    intervals: reservation.intervals,
                };
            } else {
                reservation = {
                    schemaVersion: 1,
                    reservationId,
                    contentHash: context.contentHash,
                    parentSessionId: envelope.parentSessionId,
                    researchId: envelope.researchId,
                    version: envelope.version,
                    handoffHash,
                    contentLength: generated.contentLength,
                    totalChars: generated.totalChars,
                    intervals: generated.intervals,
                };
            }
            handoffManifests.push(manifest);
            reservations.push({ path: context.reservationPath, reservation });
        }
        assertHandoffContentBounded(envelope, bundle, manifests, handoffManifests, {
            reservedIntervalsByHash,
        });
        return { path, envelope, reservations };
    }

    async writePreparedHandoff(prepared) {
        for (const { path, reservation } of prepared.reservations) {
            await createOrCompare(path, reservation, {
                normalize: normalizeHandoffReservation,
                conflictCode: "HANDOFF_RETENTION_CONFLICT",
                conflictMessage: "Handoff retention reservation conflicts with stored data",
            });
        }
        return createOrCompare(prepared.path, prepared.envelope, {
            normalize: normalizeHandoffEnvelope,
            conflictCode: "HANDOFF_CONFLICT",
            conflictMessage: "Handoff key already exists with different data",
        });
    }

    async readRetentionManifests(paths, publicationRetentionInput) {
        const publicationRetention = normalizePublicationRetentionRecord(
            publicationRetentionInput,
        );
        assertStoredKey(
            publicationRetention,
            paths.researchId,
            paths.version,
            paths.retention,
        );
        const manifests = await Promise.all(
            publicationRetention.contentHashes.map(async (contentHash) => {
                const path = await safeFilePath(
                    this.root,
                    ["retention", contentHash],
                    "budget.json",
                    { createDirectories: false },
                );
                const value = await readJson(path, { missing: "undefined" });
                if (value === undefined) {
                    storageFail(
                        "MISSING_RETENTION_MANIFEST",
                        `No retention manifest exists for fetched content ${contentHash}`,
                        { path },
                    );
                }
                const manifest = normalizeRetentionRecord(value);
                if (manifest.contentHash !== contentHash) {
                    storageFail(
                        "STORAGE_KEY_MISMATCH",
                        "Retention manifest does not match its storage path",
                        { path },
                    );
                }
                return manifest;
            }),
        );
        return { publicationRetention, manifests };
    }

    async get(researchIdInput, versionInput) {
        const paths = await this.paths(researchIdInput, versionInput, {
            createDirectories: false,
        });
        const [payload, lifecycle, retention, supersession, commit] = await Promise.all([
            readJson(paths.payload, { missing: "undefined" }),
            readJson(paths.lifecycle, { missing: "undefined" }),
            readJson(paths.retention, { missing: "undefined" }),
            readJson(paths.supersession, { missing: "undefined" }),
            readJson(paths.commit, { missing: "undefined" }),
        ]);
        if (
            payload === undefined
            && lifecycle === undefined
            && retention === undefined
            && supersession === undefined
            && commit === undefined
        ) {
            storageFail("PUBLISHED_NOT_FOUND", "Published evidence bundle was not found");
        }
        if (
            payload === undefined
            || lifecycle === undefined
            || retention === undefined
            || commit === undefined
        ) {
            storageFail(
                "INCOMPLETE_PUBLICATION",
                "Published evidence is incomplete and cannot be read",
            );
        }
        assertStoredKey(payload, paths.researchId, paths.version, paths.payload);
        assertStoredKey(lifecycle, paths.researchId, paths.version, paths.lifecycle);
        const published = assertEvidenceContentHash({
            ...payload,
            status: lifecycle.status,
            lifecycle: lifecycle.lifecycle,
        });
        if (published.status !== "published") {
            storageFail(
                "INVALID_PUBLISHED_STATUS",
                "Initial lifecycle metadata must remain published",
            );
        }
        const {
            publicationRetention,
        } = await this.readRetentionManifests(paths, retention);
        for (const source of published.sources) {
            if (!publicationRetention.contentHashes.includes(source.contentHash)) {
                storageFail(
                    "PUBLICATION_RETENTION_MISMATCH",
                    `Published source ${source.id} has no committed retention manifest`,
                    { path: paths.retention },
                );
            }
        }
        const committed = normalizeCommitRecord(commit);
        assertStoredKey(committed, paths.researchId, paths.version, paths.commit);
        if (
            committed.contentHash !== published.contentHash
            || committed.lifecycleHash !== sha256Hex(canonicalJson(lifecycle))
            || committed.retentionHash !== sha256Hex(canonicalJson(publicationRetention))
            || committed.committedAt !== published.lifecycle.updatedAt
        ) {
            storageFail(
                "PUBLICATION_COMMIT_MISMATCH",
                "Publication commit marker does not match immutable evidence",
                { path: paths.commit },
            );
        }
        if (supersession === undefined) {
            return published;
        }

        const transition = normalizeSupersessionRecord(supersession);
        assertStoredKey(
            transition,
            paths.researchId,
            paths.version,
            paths.supersession,
        );
        const superseded = {
            ...published,
            status: "superseded",
            lifecycle: {
                ...published.lifecycle,
                updatedAt: transition.updatedAt,
                supersededAt: transition.supersededAt,
            },
        };
        assertEvidenceBundleTransition(published, superseded);
        return assertEvidenceContentHash(superseded);
    }

    async getLatest(researchIdInput) {
        const researchId = normalizeResearchId(researchIdInput);
        const inspected = await inspectDirectory(this.root, ["evidence", researchId]);
        if (!inspected.exists) {
            storageFail("LATEST_NOT_FOUND", "No published evidence versions exist", {
                path: inspected.path,
            });
        }
        const directory = inspected.path;
        const entries = await readdir(directory, { withFileTypes: true });
        const versions = [];
        for (const entry of entries) {
            if (
                !entry.isDirectory()
                || entry.isSymbolicLink()
                || !/^[1-9]\d*$/.test(entry.name)
            ) {
                storageFail(
                    "UNSAFE_STORAGE_ENTRY",
                    "Evidence research directories may contain only positive-version directories",
                    { path: join(directory, entry.name) },
                );
            }
            versions.push(Number.parseInt(entry.name, 10));
        }
        if (versions.length === 0) {
            storageFail("LATEST_NOT_FOUND", "No published evidence versions exist", {
                path: directory,
            });
        }
        for (const version of versions.sort((left, right) => right - left)) {
            try {
                return await this.get(researchId, version);
            } catch (error) {
                if (
                    error instanceof LearnReferenceStorageError
                    && ["INCOMPLETE_PUBLICATION", "PUBLISHED_NOT_FOUND"].includes(error.code)
                ) {
                    continue;
                }
                throw error;
            }
        }
        storageFail("LATEST_NOT_FOUND", "No completely published evidence version exists", {
            path: directory,
        });
    }

    async supersede(researchIdInput, versionInput, supersededAtInput) {
        const paths = await this.paths(researchIdInput, versionInput, {
            createDirectories: false,
        });
        const supersededAt = normalizeTimestamp(supersededAtInput, "$.supersededAt");
        const previous = await this.get(paths.researchId, paths.version);
        if (previous.status === "superseded") {
            if (previous.lifecycle.supersededAt !== supersededAt) {
                storageFail(
                    "SUPERSESSION_CONFLICT",
                    "Evidence version was already superseded at a different time",
                    { path: paths.supersession },
                );
            }
            return previous;
        }
        const record = {
            schemaVersion: 1,
            researchId: previous.researchId,
            version: previous.version,
            status: "superseded",
            supersededAt,
            updatedAt: supersededAt,
        };
        const candidate = {
            ...previous,
            status: "superseded",
            lifecycle: {
                ...previous.lifecycle,
                updatedAt: supersededAt,
                supersededAt,
            },
        };
        assertEvidenceBundleTransition(previous, candidate);
        assertEvidenceContentHash(candidate);
        await createOrCompare(paths.supersession, record, {
            normalize: normalizeSupersessionRecord,
            conflictCode: "SUPERSESSION_CONFLICT",
            conflictMessage: "Supersession already exists with different lifecycle metadata",
        });
        return this.get(paths.researchId, paths.version);
    }

    async originalPublishedProjection(bundle) {
        if (bundle.status === "published") {
            return bundle;
        }
        const paths = await this.paths(bundle.researchId, bundle.version, {
            createDirectories: false,
        });
        const lifecycle = await readJson(paths.lifecycle);
        assertStoredKey(lifecycle, bundle.researchId, bundle.version, paths.lifecycle);
        return assertEvidenceContentHash({
            ...bundle,
            status: lifecycle.status,
            lifecycle: lifecycle.lifecycle,
        });
    }

    async storeHandoff(envelopeInput, captureInputs) {
        const envelope = normalizeHandoffEnvelope(envelopeInput);
        return withStorageLock(this.root, async () => {
            const bundle = await this.get(envelope.researchId, envelope.version);
            const publishedBundle = await this.originalPublishedProjection(bundle);
            assertHandoffMatchesBundle(envelope, publishedBundle);
            const handoffPath = await safeFilePath(
                this.root,
                ["handoffs", envelope.parentSessionId, envelope.researchId],
                `${envelope.version}.json`,
                { createDirectories: false },
            );
            const existingValue = await readJson(handoffPath, { missing: "undefined" });
            if (existingValue !== undefined) {
                const existing = normalizeHandoffEnvelope(existingValue);
                if (canonicalJson(existing) !== canonicalJson(envelope)) {
                    storageFail(
                        "HANDOFF_CONFLICT",
                        "Handoff key already exists with different data",
                        { path: handoffPath },
                    );
                }
                return existing;
            }
            const paths = await this.paths(envelope.researchId, envelope.version, {
                createDirectories: false,
            });
            const retention = await readJson(paths.retention);
            const { manifests } = await this.readRetentionManifests(paths, retention);
            const captures = captureInputs ?? (manifests.length === 0 ? [] : undefined);
            if (!Array.isArray(captures)) {
                storageFail(
                    "MISSING_HANDOFF_FETCH_EVIDENCE",
                    "A new handoff requires the original bounded Learn fetch captures",
                );
            }
            const prepared = await this.prepareHandoff(
                envelope,
                publishedBundle,
                manifests,
                captures,
            );
            return this.writePreparedHandoff(prepared);
        });
    }

    async getHandoff(parentSessionIdInput, researchIdInput, versionInput) {
        const parentSessionId = normalizeSessionId(
            parentSessionIdInput,
            "$.parentSessionId",
        );
        const { researchId, version } = normalizeKey(researchIdInput, versionInput);
        const path = await safeFilePath(
            this.root,
            ["handoffs", parentSessionId, researchId],
            `${version}.json`,
            { createDirectories: false },
        );
        const value = await readJson(path, { missing: "undefined" });
        if (value === undefined) {
            storageFail("HANDOFF_NOT_FOUND", "Research handoff was not found", { path });
        }
        const envelope = normalizeHandoffEnvelope(value);
        if (
            envelope.parentSessionId !== parentSessionId
            || envelope.researchId !== researchId
            || envelope.version !== version
        ) {
            storageFail("STORAGE_KEY_MISMATCH", "Handoff does not match its path key", { path });
        }
        const bundle = await this.get(researchId, version);
        assertHandoffMatchesBundle(
            envelope,
            await this.originalPublishedProjection(bundle),
        );
        return envelope;
    }

    async storeAcknowledgement(input) {
        const acknowledgement = normalizeAcknowledgement(input);
        const bundle = await this.get(acknowledgement.researchId, acknowledgement.version);
        if (
            bundle.parentSessionId !== acknowledgement.parentSessionId
            || bundle.contentHash !== acknowledgement.contentHash
        ) {
            storageFail(
                "ACKNOWLEDGEMENT_MISMATCH",
                "Acknowledgement does not match the published evidence bundle",
            );
        }
        const path = await safeFilePath(
            this.root,
            [
                "acknowledgements",
                acknowledgement.parentSessionId,
                acknowledgement.researchId,
            ],
            `${acknowledgement.version}.json`,
        );
        return createOrCompare(path, acknowledgement, {
            normalize: normalizeAcknowledgement,
            conflictCode: "ACKNOWLEDGEMENT_CONFLICT",
            conflictMessage: "Acknowledgement key already exists with different data",
        });
    }

    async getAcknowledgement(parentSessionIdInput, researchIdInput, versionInput) {
        const parentSessionId = normalizeSessionId(
            parentSessionIdInput,
            "$.parentSessionId",
        );
        const { researchId, version } = normalizeKey(researchIdInput, versionInput);
        const path = await safeFilePath(
            this.root,
            ["acknowledgements", parentSessionId, researchId],
            `${version}.json`,
            { createDirectories: false },
        );
        const value = await readJson(path, { missing: "undefined" });
        if (value === undefined) {
            storageFail("ACKNOWLEDGEMENT_NOT_FOUND", "Acknowledgement was not found", { path });
        }
        const acknowledgement = normalizeAcknowledgement(value);
        if (
            acknowledgement.parentSessionId !== parentSessionId
            || acknowledgement.researchId !== researchId
            || acknowledgement.version !== version
        ) {
            storageFail(
                "STORAGE_KEY_MISMATCH",
                "Acknowledgement does not match its path key",
                { path },
            );
        }
        return acknowledgement;
    }
}
