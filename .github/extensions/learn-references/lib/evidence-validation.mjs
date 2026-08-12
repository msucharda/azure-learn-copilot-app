import {
    canonicalizeLineEndings,
    hashFetchedMarkdown,
    sha256Hex,
} from "./canonical-json.mjs";
import { assertEvidenceContentHash } from "./content-hash.mjs";
import {
    fail,
    normalizeArray,
    normalizeHash,
    normalizeLearnUrl,
    normalizeResearchId,
    normalizeString,
    normalizeTimestamp,
    requireObject,
    requireSchemaVersion,
} from "./validation.mjs";

export const LEARN_OPERATIONS = Object.freeze([
    "docs-search",
    "docs-fetch",
    "code-sample-search",
]);

export const MAX_FETCHED_MARKDOWN_LENGTH = 262_144;
export const MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH = 12_000;
export const MAX_EVIDENCE_CAPTURES = 500;

const CAPTURE_KEYS = Object.freeze([
    "schemaVersion",
    "captureId",
    "researchId",
    "logicalOperation",
    "runtimeToolName",
    "argsSummary",
    "resultSha256",
    "resultCount",
    "sourceUrls",
    "observedAt",
    "canonicalUrl",
    "retrievalUrl",
    "fetchedMarkdown",
]);

function normalizeCaptureId(value, path) {
    const normalized = normalizeString(value, path, {
        min: 36,
        max: 36,
        pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    });
    return normalized.toLowerCase();
}

function normalizeNonNegativeInteger(value, path, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        fail("INVALID_INTEGER", path, `must be a safe integer from 0 through ${maximum}`);
    }
    return value;
}

function normalizeOperation(value, path) {
    if (!LEARN_OPERATIONS.includes(value)) {
        fail("INVALID_LEARN_OPERATION", path, `must be one of: ${LEARN_OPERATIONS.join(", ")}`);
    }
    return value;
}

function normalizeFetchedMarkdown(value, path) {
    if (typeof value !== "string") {
        fail("INVALID_TYPE", path, "must be a string");
    }
    if (value.length < 1 || value.length > MAX_FETCHED_MARKDOWN_LENGTH) {
        fail(
            "INVALID_LENGTH",
            path,
            `must contain 1 through ${MAX_FETCHED_MARKDOWN_LENGTH} characters`,
        );
    }
    const trimmed = value.trim();
    if (
        /^(?:error|failure|failed|invalid (?:url|uri|request)|not found|unable to (?:fetch|retrieve)|could not (?:fetch|retrieve)|the provided url\b.*\bcould not be retrieved)\b/i.test(trimmed)
    ) {
        fail(
            "FAILURE_SHAPED_FETCH",
            path,
            "cannot contain a failure response presented as fetched Markdown",
        );
    }
    if (trimmed.startsWith("{")) {
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            if (/"(?:error|isError|resultType|jsonrpc)"\s*:/.test(trimmed)) {
                fail("MALFORMED_FETCH_RESULT", path, "contains a malformed result envelope");
            }
        }
        if (
            parsed
            && typeof parsed === "object"
            && !Array.isArray(parsed)
            && (
                parsed.error != null
                || parsed.isError === true
                || parsed.success === false
                || parsed.ok === false
                || (
                    typeof parsed.resultType === "string"
                    && parsed.resultType.toLowerCase() !== "success"
                )
                || (
                    typeof parsed.status === "string"
                    && ["error", "failed", "failure"].includes(parsed.status.toLowerCase())
                )
            )
        ) {
            fail(
                "FAILURE_SHAPED_FETCH",
                path,
                "cannot contain a failed result envelope presented as fetched Markdown",
            );
        }
    }
    return value;
}

export function normalizeEvidenceCapture(input) {
    const object = requireObject(input, "$", CAPTURE_KEYS, [
        "schemaVersion",
        "captureId",
        "researchId",
        "logicalOperation",
        "runtimeToolName",
        "argsSummary",
        "resultSha256",
        "resultCount",
        "sourceUrls",
        "observedAt",
    ]);
    requireSchemaVersion(object.schemaVersion);
    const logicalOperation = normalizeOperation(object.logicalOperation, "$.logicalOperation");
    const normalized = {
        schemaVersion: 1,
        captureId: normalizeCaptureId(object.captureId, "$.captureId"),
        researchId: normalizeResearchId(object.researchId),
        logicalOperation,
        runtimeToolName: normalizeString(object.runtimeToolName, "$.runtimeToolName", {
            max: 160,
        }),
        argsSummary: normalizeString(object.argsSummary, "$.argsSummary", { max: 500 }),
        resultSha256: normalizeHash(object.resultSha256, "$.resultSha256"),
        resultCount: normalizeNonNegativeInteger(object.resultCount, "$.resultCount", 100),
        sourceUrls: normalizeArray(object.sourceUrls, "$.sourceUrls", {
            max: 5,
            item: (entry, path) => normalizeLearnUrl(entry, path),
        }),
        observedAt: normalizeTimestamp(object.observedAt, "$.observedAt"),
    };

    const fetchOnlyKeys = ["canonicalUrl", "retrievalUrl", "fetchedMarkdown"];
    if (logicalOperation === "docs-fetch") {
        for (const key of fetchOnlyKeys) {
            if (!Object.hasOwn(object, key)) {
                fail("MISSING_PROPERTY", `$.${key}`, "is required for docs-fetch evidence");
            }
        }
        normalized.canonicalUrl = normalizeLearnUrl(object.canonicalUrl, "$.canonicalUrl", {
            canonical: true,
        });
        normalized.retrievalUrl = normalizeLearnUrl(object.retrievalUrl, "$.retrievalUrl");
        normalized.fetchedMarkdown = normalizeFetchedMarkdown(
            object.fetchedMarkdown,
            "$.fetchedMarkdown",
        );
        const retrievalCanonical = new URL(normalized.retrievalUrl);
        retrievalCanonical.search = "";
        retrievalCanonical.hash = "";
        if (retrievalCanonical.toString() !== normalized.canonicalUrl) {
            fail(
                "FETCH_URL_MISMATCH",
                "$.retrievalUrl",
                "must resolve to canonicalUrl after removing its query string and fragment",
            );
        }
        if (normalized.resultCount !== 1) {
            fail("INVALID_FETCH_RESULT", "$.resultCount", "must be 1 for docs-fetch evidence");
        }
        const fetchedHash = hashFetchedMarkdown(normalized.fetchedMarkdown);
        if (normalized.resultSha256 !== fetchedHash) {
            fail(
                "FETCH_HASH_MISMATCH",
                "$.resultSha256",
                `does not match fetched Markdown; expected ${fetchedHash}`,
            );
        }
        if (!normalized.sourceUrls.includes(normalized.retrievalUrl)) {
            fail(
                "FETCH_URL_MISMATCH",
                "$.sourceUrls",
                "must contain the fetched retrieval URL",
            );
        }
    } else {
        for (const key of fetchOnlyKeys) {
            if (Object.hasOwn(object, key)) {
                fail(
                    "UNEXPECTED_FETCH_CONTENT",
                    `$.${key}`,
                    "is only allowed for docs-fetch evidence",
                );
            }
        }
    }
    return normalized;
}

function sourceFetchEvidence(source, captures) {
    const retrievalUrl = source.retrievalUrl ?? source.canonicalUrl;
    const matching = captures.filter((capture) => (
        capture.logicalOperation === "docs-fetch"
        && capture.canonicalUrl === source.canonicalUrl
        && capture.retrievalUrl === retrievalUrl
        && capture.resultSha256 === source.contentHash
    ));
    return {
        capture: matching.find((capture) => capture.observedAt === source.retrievedAt),
        timeMismatch: matching.length > 0,
    };
}

function persistedProse(bundle) {
    const values = [
        { path: "$.question.original", text: bundle.question.original },
        { path: "$.question.normalized", text: bundle.question.normalized },
        { path: "$.scope.product", text: bundle.scope.product },
        { path: "$.scope.version", text: bundle.scope.version },
        { path: "$.scope.platform", text: bundle.scope.platform },
        { path: "$.scope.taskIntent", text: bundle.scope.taskIntent },
        { path: "$.officialSkill.skillName", text: bundle.officialSkill.skillName },
        { path: "$.officialSkill.pluginName", text: bundle.officialSkill.pluginName },
        { path: "$.officialSkill.pluginVersion", text: bundle.officialSkill.pluginVersion },
    ];
    if (bundle.officialSkill.generatedAt !== undefined) {
        values.push({
            path: "$.officialSkill.generatedAt",
            text: bundle.officialSkill.generatedAt,
        });
    }
    for (const [index, claim] of bundle.claims.entries()) {
        values.push({ path: `$.claims[${index}].text`, text: claim.text });
    }
    for (const [index, source] of bundle.sources.entries()) {
        values.push(
            {
                path: `$.sources[${index}].title`,
                text: source.title,
            },
            {
                path: `$.sources[${index}].sectionHeading`,
                text: source.sectionHeading,
            },
            {
                path: `$.sources[${index}].exactExcerpt`,
                text: source.exactExcerpt,
            },
            { path: `$.sources[${index}].whyItMatters`, text: source.whyItMatters },
        );
    }
    for (const [index, item] of bundle.unresolvedItems.entries()) {
        values.push({ path: `$.unresolvedItems[${index}].text`, text: item.text });
    }
    return values;
}

function mergeIntervals(markdown, intervals) {
    const sorted = intervals.sort((left, right) => (
        left.start - right.start || left.end - right.end
    ));
    const merged = [];
    for (const interval of sorted) {
        const previous = merged.at(-1);
        if (previous && interval.start <= previous.end) {
            previous.end = Math.max(previous.end, interval.end);
        } else {
            merged.push({ ...interval });
        }
    }
    return merged.map(({ start, end }) => ({
        start,
        end,
        segmentHash: sha256Hex(markdown.slice(start, end)),
    }));
}

function isSubsequence(needle, haystack) {
    let matched = 0;
    for (let index = 0; index < haystack.length && matched < needle.length; index += 1) {
        if (haystack[index] === needle[matched]) {
            matched += 1;
        }
    }
    return matched === needle.length;
}

function rollingHashPositions(value, length) {
    const hashes = new Map();
    if (length < 1 || value.length < length) {
        return hashes;
    }
    const base = 16_777_619;
    let leadingFactor = 1;
    for (let index = 1; index < length; index += 1) {
        leadingFactor = Math.imul(leadingFactor, base) >>> 0;
    }
    let hash = 0;
    for (let index = 0; index < length; index += 1) {
        hash = (Math.imul(hash, base) + value.charCodeAt(index)) >>> 0;
    }
    hashes.set(hash, [0]);
    for (let index = length; index < value.length; index += 1) {
        const leading = value.charCodeAt(index - length);
        hash = (hash - Math.imul(leading, leadingFactor)) >>> 0;
        hash = (Math.imul(hash, base) + value.charCodeAt(index)) >>> 0;
        const positions = hashes.get(hash) ?? [];
        positions.push(index - length + 1);
        hashes.set(hash, positions);
    }
    return hashes;
}

function allocateOccurrence(stateByKey, key, positions, span, covered) {
    const state = stateByKey.get(key) ?? {
        cursorIndex: 0,
        nextStart: 0,
        used: new Set(),
    };
    let position;
    if (span === 1) {
        while (
            state.cursorIndex < positions.length
            && (
                covered[positions[state.cursorIndex]] !== 0
                || state.used.has(positions[state.cursorIndex])
            )
        ) {
            state.cursorIndex += 1;
        }
        if (state.cursorIndex < positions.length) {
            position = positions[state.cursorIndex];
            state.cursorIndex += 1;
        }
    } else {
        const unused = positions.filter((candidate) => !state.used.has(candidate));
        if (unused.length > 0) {
            const prefix = new Uint32Array(covered.length + 1);
            for (let index = 0; index < covered.length; index += 1) {
                prefix[index + 1] = prefix[index] + covered[index];
            }
            let bestGain = -1;
            for (const candidate of unused) {
                const overlap = prefix[candidate + span] - prefix[candidate];
                const gain = span - overlap;
                if (
                    gain > bestGain
                    || (
                        gain === bestGain
                        && position < state.nextStart
                        && candidate >= state.nextStart
                    )
                ) {
                    position = candidate;
                    bestGain = gain;
                    if (gain === span && candidate >= state.nextStart) {
                        break;
                    }
                }
            }
        }
    }
    if (position === undefined) {
        position = positions.at(-1);
    }
    for (let index = position; index < position + span; index += 1) {
        covered[index] = 1;
    }
    state.used.add(position);
    state.nextStart = position + span;
    stateByKey.set(key, state);
    return position;
}

function retentionManifest(contentHash, markdown, prose) {
    const intervals = [];
    const decoratedByHash = new Map();
    const allocationState = new Map();
    const covered = new Uint8Array(markdown.length);
    const quoteChunkLength = 1;
    const markdownChunkHashes = rollingHashPositions(markdown, quoteChunkLength);
    const combinedProse = prose
        .map((entry) => canonicalizeLineEndings(entry.text))
        .join("");
    if (isSubsequence(markdown, combinedProse)) {
        fail(
            "FULL_FETCH_CONTENT",
            "$",
            "persisted evidence fields cannot jointly contain a decorated fetched page",
        );
    }
    for (const entry of prose) {
        const text = canonicalizeLineEndings(entry.text);
        if (!text) {
            continue;
        }
        if (text.includes(markdown)) {
            fail(
                "FULL_FETCH_CONTENT",
                entry.path,
                "persisted evidence text cannot contain a complete fetched page",
            );
        }
        if (isSubsequence(markdown, text)) {
            fail(
                "FULL_FETCH_CONTENT",
                entry.path,
                "persisted evidence text cannot contain a decorated complete fetched page",
            );
        }
        const exactPositions = [];
        let exactStart = markdown.indexOf(text);
        while (exactStart >= 0) {
            exactPositions.push(exactStart);
            exactStart = markdown.indexOf(text, exactStart + 1);
        }
        if (exactPositions.length > 0) {
            const start = allocateOccurrence(
                allocationState,
                `exact:${sha256Hex(text)}`,
                exactPositions,
                text.length,
                covered,
            );
            intervals.push({ start, end: start + text.length });
            continue;
        }
        if (text.length >= quoteChunkLength) {
            const textHashes = rollingHashPositions(text, quoteChunkLength);
            let matchedChars = 0;
            for (const [hash, textPositions] of textHashes) {
                const markdownPositions = markdownChunkHashes.get(hash);
                if (markdownPositions !== undefined) {
                    matchedChars += Math.min(textPositions.length, markdownPositions.length);
                    for (let index = 0; index < textPositions.length; index += 1) {
                        const markdownStart = allocateOccurrence(
                            allocationState,
                            `chunk:${hash}`,
                            markdownPositions,
                            quoteChunkLength,
                            covered,
                        );
                        intervals.push({
                            start: markdownStart,
                            end: markdownStart + quoteChunkLength,
                        });
                    }
                }
            }
            if (matchedChars > 0) {
                const fragmentHash = sha256Hex(text);
                decoratedByHash.set(fragmentHash, {
                    fragmentHash,
                    chars: Math.max(
                        decoratedByHash.get(fragmentHash)?.chars ?? 0,
                        matchedChars,
                    ),
                });
            }
        }
    }
    const merged = mergeIntervals(markdown, intervals);
    const totalChars = merged.reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
    );
    if (totalChars >= markdown.length) {
        fail(
            "FULL_FETCH_CONTENT",
            "$",
            "persisted evidence text cannot reconstruct a complete fetched page",
        );
    }
    if (totalChars > MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH) {
        fail(
            "EXCERPT_BUDGET_EXCEEDED",
            "$",
            `persisted text from one fetched page cannot exceed ${MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH} characters`,
        );
    }
    return {
        schemaVersion: 1,
        contentHash,
        contentLength: markdown.length,
        totalChars,
        intervals: merged,
        decoratedFragments: [...decoratedByHash.values()].sort((left, right) => (
            left.fragmentHash.localeCompare(right.fragmentHash)
        )),
    };
}

export function validateResearchBundleWithRetention(bundleInput, captureInputs) {
    const bundle = assertEvidenceContentHash(bundleInput);
    if (!Array.isArray(captureInputs)) {
        fail("INVALID_CAPTURES", "$.captures", "captured evidence must be an array");
    }
    if (captureInputs.length > MAX_EVIDENCE_CAPTURES) {
        fail(
            "TOO_MANY_CAPTURES",
            "$.captures",
            `captured evidence cannot exceed ${MAX_EVIDENCE_CAPTURES} records`,
        );
    }
    const captures = captureInputs.map(normalizeEvidenceCapture);
    const markdownByHash = new Map();
    for (const capture of captures) {
        if (capture.researchId !== bundle.researchId) {
            fail(
                "CAPTURE_RESEARCH_MISMATCH",
                "$.researchId",
                "captured evidence must belong to the bundle researchId",
            );
        }
        if (capture.logicalOperation === "docs-fetch") {
            const markdown = canonicalizeLineEndings(capture.fetchedMarkdown);
            const existingMarkdown = markdownByHash.get(capture.resultSha256);
            if (existingMarkdown !== undefined && existingMarkdown !== markdown) {
                fail(
                    "FETCH_HASH_COLLISION",
                    "$.captures",
                    "the same fetch digest resolved to different Markdown content",
                );
            }
            markdownByHash.set(capture.resultSha256, markdown);
        }
    }

    for (const [index, source] of bundle.sources.entries()) {
        const path = `$.sources[${index}]`;
        if (source.verificationState !== "verified") {
            fail(
                "SOURCE_NOT_VERIFIED",
                `${path}.verificationState`,
                'must be "verified" at the validation boundary',
            );
        }
        if (source.retrievalMethod !== "docs-fetch") {
            fail(
                "NON_FETCH_SOURCE",
                `${path}.retrievalMethod`,
                'publishable source excerpts require the logical "docs-fetch" operation',
            );
        }

        const match = sourceFetchEvidence(source, captures);
        const capture = match.capture;
        if (!capture) {
            if (match.timeMismatch) {
                fail(
                    "RETRIEVAL_TIME_MISMATCH",
                    `${path}.retrievedAt`,
                    "must equal a trusted matching fetch capture observedAt timestamp",
                );
            }
            fail(
                "FETCH_EVIDENCE_MISSING",
                path,
                `has no successful docs-fetch capture for source ID "${source.id}"`,
            );
        }
        const markdown = canonicalizeLineEndings(capture.fetchedMarkdown);
        const excerpt = canonicalizeLineEndings(source.exactExcerpt);
        if (!markdown.includes(excerpt)) {
            fail(
                "EXACT_EXCERPT_MISMATCH",
                `${path}.exactExcerpt`,
                "does not occur exactly in the fetched Markdown",
            );
        }
    }
    const prose = persistedProse(bundle);
    const retentionManifests = [...markdownByHash.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([contentHash, markdown]) => (
            retentionManifest(contentHash, markdown, prose)
        ));
    return { bundle, retentionManifests };
}

export function validateResearchBundle(bundleInput, captureInputs) {
    return validateResearchBundleWithRetention(bundleInput, captureInputs).bundle;
}
