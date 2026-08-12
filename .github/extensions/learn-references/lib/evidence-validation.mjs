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

const MIN_VERIFIED_EMBEDDED_SPAN = 32;
const MAX_DECORATION_CANDIDATES = 16;
const MAX_DECORATION_STRIDE = 8;
const MAX_DECORATION_ALIGNMENT_STATES = 250_000;
const MAX_RETENTION_ALLOCATION_STATES = 250_000;
const NEAR_FULL_CONTENT_NUMERATOR = 9;
const NEAR_FULL_CONTENT_DENOMINATOR = 10;
const DECORATION_CHARACTER_PATTERN = /[\p{P}\p{S}\p{Z}\p{M}\p{Cf}\s]|\p{Default_Ignorable_Code_Point}/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const DEFAULT_IGNORABLE_PATTERN = /\p{Default_Ignorable_Code_Point}/u;

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
    if (Array.from(value).some((character) => (
        (
            CONTROL_CHARACTER_PATTERN.test(character)
            && !["\t", "\n", "\r"].includes(character)
        )
        || DEFAULT_IGNORABLE_PATTERN.test(character)
    ))) {
        fail(
            "UNSAFE_FETCHED_MARKDOWN",
            path,
            "cannot contain hidden control or default-ignorable characters",
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

function allOccurrences(value, needle) {
    const positions = [];
    let start = value.indexOf(needle);
    while (start >= 0) {
        positions.push(start);
        start = value.indexOf(needle, start + 1);
    }
    return positions;
}

function allocateVerifiedOccurrence(text, positions, states, covered) {
    const state = states.get(text) ?? { used: new Set() };
    const available = positions.filter((position) => !state.used.has(position));
    const candidates = available.length > 0 ? available : positions;
    const prefix = new Uint32Array(covered.length + 1);
    for (let index = 0; index < covered.length; index += 1) {
        prefix[index + 1] = prefix[index] + covered[index];
    }
    let selected = candidates[0];
    let greatestGain = -1;
    for (const position of candidates) {
        const overlap = prefix[position + text.length] - prefix[position];
        const gain = text.length - overlap;
        if (gain > greatestGain) {
            selected = position;
            greatestGain = gain;
        }
    }
    for (let index = selected; index < selected + text.length; index += 1) {
        covered[index] = 1;
    }
    state.used.add(selected);
    states.set(text, state);
    return selected;
}

function markCovered(covered, intervals) {
    for (const interval of intervals) {
        for (let index = interval.start; index < interval.end; index += 1) {
            covered[index] = 1;
        }
    }
}

function greedyVerifiedRequests(markdown, requests, initialIntervals, ordered) {
    const covered = new Uint8Array(markdown.length);
    markCovered(covered, initialIntervals);
    const states = new Map();
    const intervals = [];
    for (const request of ordered) {
        for (let index = 0; index < request.count; index += 1) {
            const start = allocateVerifiedOccurrence(
                request.text,
                request.positions,
                states,
                covered,
            );
            if (start !== undefined) {
                intervals.push({ start, end: start + request.text.length });
            }
        }
    }
    return intervals;
}

function intervalCoverage(markdown, intervals) {
    return mergeIntervals(markdown, intervals).reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
    );
}

function maximumGroupCoverage(request) {
    const occurrenceIntervals = request.positions.map((start) => ({
        start,
        end: start + request.text.length,
    }));
    const union = occurrenceIntervals
        .sort((left, right) => left.start - right.start)
        .reduce((merged, interval) => {
            const previous = merged.at(-1);
            if (previous && interval.start <= previous.end) {
                previous.end = Math.max(previous.end, interval.end);
            } else {
                merged.push({ ...interval });
            }
            return merged;
        }, [])
        .reduce((total, interval) => total + interval.end - interval.start, 0);
    return Math.min(request.count * request.text.length, union);
}

function optimisticCandidateCoverage(markdown, initialIntervals, groups) {
    const changes = new Int32Array(markdown.length + 1);
    const include = (start, end) => {
        changes[start] += 1;
        changes[end] -= 1;
    };
    for (const interval of initialIntervals) {
        include(interval.start, interval.end);
    }
    for (const group of groups) {
        for (const start of group.positions) {
            include(start, start + group.text.length);
        }
    }
    let active = 0;
    let coverage = 0;
    for (let index = 0; index < markdown.length; index += 1) {
        active += changes[index];
        if (active > 0) {
            coverage += 1;
        }
    }
    return coverage;
}

function allocateVerifiedRequests(markdown, requests, initialIntervals) {
    const constrainedFirst = [...requests].sort((left, right) => (
        left.positions.length - right.positions.length
        || right.text.length - left.text.length
        || left.text.localeCompare(right.text)
    ));
    const longestFirst = [...requests].sort((left, right) => (
        right.text.length - left.text.length
        || left.positions.length - right.positions.length
        || left.text.localeCompare(right.text)
    ));
    const greedyCandidates = [
        greedyVerifiedRequests(markdown, requests, initialIntervals, constrainedFirst),
        greedyVerifiedRequests(markdown, requests, initialIntervals, longestFirst),
    ];
    let best = greedyCandidates[0];
    let greatestCoverage = intervalCoverage(markdown, [
        ...initialIntervals,
        ...best,
    ]);
    for (const candidate of greedyCandidates.slice(1)) {
        const coverage = intervalCoverage(markdown, [
            ...initialIntervals,
            ...candidate,
        ]);
        if (coverage > greatestCoverage) {
            best = candidate;
            greatestCoverage = coverage;
        }
    }
    const safeCoverageLimit = Math.min(
        markdown.length - 1,
        MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH,
        Math.ceil(
            markdown.length
            * NEAR_FULL_CONTENT_NUMERATOR
            / NEAR_FULL_CONTENT_DENOMINATOR,
        ) - 1,
    );
    if (greatestCoverage > safeCoverageLimit) {
        return best;
    }

    const groups = [...requests]
        .map((request) => ({
            ...request,
            selectedCount: Math.min(request.count, request.positions.length),
            maximumCoverage: maximumGroupCoverage(request),
        }))
        .sort((left, right) => (
            left.positions.length - right.positions.length
            || right.text.length - left.text.length
            || left.text.localeCompare(right.text)
        ));
    const remainingPotential = new Uint32Array(groups.length + 1);
    for (let index = groups.length - 1; index >= 0; index -= 1) {
        remainingPotential[index] = Math.min(
            markdown.length,
            remainingPotential[index + 1] + groups[index].maximumCoverage,
        );
    }
    const coverageCounts = new Uint32Array(markdown.length);
    let currentCoverage = 0;
    const apply = (start, end, delta) => {
        for (let index = start; index < end; index += 1) {
            if (delta > 0 && coverageCounts[index] === 0) {
                currentCoverage += 1;
            } else if (delta < 0 && coverageCounts[index] === 1) {
                currentCoverage -= 1;
            }
            coverageCounts[index] += delta;
        }
    };
    for (const interval of initialIntervals) {
        apply(interval.start, interval.end, 1);
    }
    const selected = [];
    let explored = 0;
    let truncated = false;

    const searchGroup = (groupIndex) => {
        if (truncated) {
            return;
        }
        if (
            Math.min(
                markdown.length,
                currentCoverage + remainingPotential[groupIndex],
            ) <= greatestCoverage
        ) {
            return;
        }
        if (groupIndex === groups.length) {
            greatestCoverage = currentCoverage;
            best = selected.map((interval) => ({ ...interval }));
            return;
        }
        const group = groups[groupIndex];
        const choose = (positionIndex, remaining) => {
            if (truncated) {
                return;
            }
            if (remaining === 0) {
                searchGroup(groupIndex + 1);
                return;
            }
            const lastStart = group.positions.length - remaining;
            for (let index = positionIndex; index <= lastStart; index += 1) {
                explored += 1;
                if (explored > MAX_RETENTION_ALLOCATION_STATES) {
                    truncated = true;
                    return;
                }
                const start = group.positions[index];
                const interval = { start, end: start + group.text.length };
                apply(interval.start, interval.end, 1);
                selected.push(interval);
                choose(index + 1, remaining - 1);
                selected.pop();
                apply(interval.start, interval.end, -1);
            }
        };
        choose(0, group.selectedCount);
    };
    searchGroup(0);
    if (
        truncated
        && optimisticCandidateCoverage(
            markdown,
            initialIntervals,
            groups,
        ) > safeCoverageLimit
    ) {
        fail(
            "RETENTION_ALLOCATION_AMBIGUOUS",
            "$",
            "verified repeated spans have too many valid placements to prove the retention budget",
        );
    }
    return best;
}

function buildVerifiedWindowIndex(markdown) {
    const windows = new Map();
    for (
        let index = 0;
        index <= markdown.length - MIN_VERIFIED_EMBEDDED_SPAN;
        index += 1
    ) {
        const window = markdown.slice(index, index + MIN_VERIFIED_EMBEDDED_SPAN);
        const positions = windows.get(window) ?? [];
        positions.push(index);
        windows.set(window, positions);
    }
    return windows;
}

function longestVerifiedExactSpan(markdown, text, textStart, pagePositions) {
    let best;
    for (const pagePosition of pagePositions) {
        let left = 0;
        while (
            textStart - left > 0
            && pagePosition - left > 0
            && text[textStart - left - 1] === markdown[pagePosition - left - 1]
        ) {
            left += 1;
        }
        let right = MIN_VERIFIED_EMBEDDED_SPAN;
        while (
            textStart + right < text.length
            && pagePosition + right < markdown.length
            && text[textStart + right] === markdown[pagePosition + right]
        ) {
            right += 1;
        }
        const candidate = {
            textStart: textStart - left,
            textEnd: textStart + right,
            length: left + right,
        };
        if (best === undefined || candidate.length > best.length) {
            best = candidate;
        }
        if (candidate.textStart === 0 && candidate.textEnd === text.length) {
            break;
        }
    }
    return best;
}

function verifiedEmbeddedSpans(markdown, text, windowIndex) {
    const spans = [];
    for (
        let index = 0;
        index <= text.length - MIN_VERIFIED_EMBEDDED_SPAN;
        index += 1
    ) {
        const window = text.slice(index, index + MIN_VERIFIED_EMBEDDED_SPAN);
        const positions = windowIndex.get(window);
        if (positions === undefined) {
            continue;
        }
        const span = longestVerifiedExactSpan(markdown, text, index, positions);
        if (span !== undefined) {
            spans.push(text.slice(span.textStart, span.textEnd));
            index = span.textEnd - 1;
        }
    }
    return spans;
}

function isDecorationCharacter(character) {
    return DECORATION_CHARACTER_PATTERN.test(character);
}

function collapseRuns(text, character, maximumRun) {
    let collapsed = "";
    let run = 0;
    for (const current of Array.from(text)) {
        if (current === character) {
            run += 1;
            if (run <= maximumRun) {
                collapsed += current;
            }
        } else {
            run = 0;
            collapsed += current;
        }
    }
    return collapsed;
}

function observedRunLengths(text, character) {
    const lengths = new Set();
    let run = 0;
    for (const current of Array.from(text)) {
        if (current === character) {
            run += 1;
        } else if (run > 0) {
            lengths.add(run);
            run = 0;
        }
    }
    if (run > 0) {
        lengths.add(run);
    }
    return lengths;
}

function decorationVariants(text, markdown) {
    const variants = new Set();
    const characters = Array.from(text);
    const frequencies = new Map();
    for (const character of characters) {
        if (isDecorationCharacter(character)) {
            frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
        }
    }
    const absentDecorations = [...frequencies.keys()].filter(
        (character) => !markdown.includes(character),
    );
    if (absentDecorations.length > 0) {
        const absent = new Set(absentDecorations);
        const candidate = characters.filter((character) => !absent.has(character)).join("");
        if (candidate.length > 0 && candidate !== text) {
            variants.add(candidate);
        }
    }
    const likelyDecorations = [...frequencies.entries()]
        .sort((left, right) => (
            Number(markdown.includes(left[0])) - Number(markdown.includes(right[0]))
            || right[1] - left[1]
            || left[0].localeCompare(right[0])
        ))
        .slice(0, MAX_DECORATION_CANDIDATES);
    for (const [character] of likelyDecorations) {
        const candidate = text.split(character).join("");
        if (candidate.length > 0 && candidate !== text) {
            variants.add(candidate);
        }
        for (const runLength of observedRunLengths(markdown, character)) {
            const collapsed = collapseRuns(text, character, runLength);
            if (collapsed.length > 0 && collapsed !== text) {
                variants.add(collapsed);
            }
        }
    }
    for (
        let stride = 2;
        stride <= MAX_DECORATION_STRIDE && characters.length / stride >= MIN_VERIFIED_EMBEDDED_SPAN;
        stride += 1
    ) {
        for (let offset = 0; offset < stride; offset += 1) {
            const candidate = characters
                .filter((_character, index) => index % stride === offset)
                .join("");
            if (candidate.length >= MIN_VERIFIED_EMBEDDED_SPAN) {
                variants.add(candidate);
            }
        }
    }
    return variants;
}

function tokenizeDecoratedText(text) {
    const runs = [];
    const decorations = [""];
    let mandatory = "";
    for (const character of Array.from(text)) {
        if (isDecorationCharacter(character)) {
            if (mandatory) {
                runs.push(mandatory);
                mandatory = "";
                decorations.push(character);
            } else {
                decorations[decorations.length - 1] += character;
            }
        } else {
            mandatory += character;
        }
    }
    if (mandatory) {
        runs.push(mandatory);
        decorations.push("");
    }
    return { runs, decorations };
}

function isDecorationSubsequence(needle, decorations) {
    let matched = 0;
    const needleCharacters = Array.from(needle);
    for (const character of Array.from(decorations)) {
        if (character === needleCharacters[matched]) {
            matched += 1;
        }
    }
    return matched === needleCharacters.length;
}

function verifiedDecoratedSpans(markdown, text) {
    const { runs, decorations } = tokenizeDecoratedText(text);
    if (
        runs.length === 0
        || decorations.every((value) => value.length === 0)
    ) {
        return [];
    }
    const anchoredRuns = runs.map((run, index) => ({
        index,
        run,
        positions: allOccurrences(markdown, run),
    })).filter((entry) => entry.positions.length > 0);
    if (anchoredRuns.length === 0) {
        return [];
    }
    anchoredRuns.sort((left, right) => (
        left.positions.length - right.positions.length
        || right.run.length - left.run.length
        || left.run.localeCompare(right.run)
    ));
    const positionsByRun = runs.map((run) => allOccurrences(markdown, run));
    let explored = 0;
    const inspectGap = (path, states = 1) => {
        explored += states;
        if (explored > MAX_DECORATION_ALIGNMENT_STATES) {
            fail(
                "DECORATION_ALIGNMENT_AMBIGUOUS",
                path,
                "decorated text has too many exact fetched-content alignments",
            );
        }
    };

    const lowerBound = (values, target) => {
        let low = 0;
        let high = values.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (values[middle] < target) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    };

    const longestPrefixDecoration = (boundary, value) => {
        const decorationCharacters = Array.from(value);
        let decorationIndex = decorationCharacters.length - 1;
        let consumed = 0;
        const available = Array.from(markdown.slice(
            Math.max(0, boundary - value.length),
            boundary,
        ));
        for (let index = available.length - 1; index >= 0; index -= 1) {
            inspectGap("$.decoratedPrefix");
            const character = available[index];
            while (
                decorationIndex >= 0
                && decorationCharacters[decorationIndex] !== character
            ) {
                decorationIndex -= 1;
            }
            if (decorationIndex < 0) {
                break;
            }
            consumed += character.length;
            decorationIndex -= 1;
        }
        return boundary - consumed;
    };

    const longestSuffixDecoration = (boundary, value) => {
        const decorationCharacters = Array.from(value);
        let decorationIndex = 0;
        let consumed = 0;
        const available = Array.from(markdown.slice(
            boundary,
            Math.min(markdown.length, boundary + value.length),
        ));
        for (const character of available) {
            inspectGap("$.decoratedSuffix");
            while (
                decorationIndex < decorationCharacters.length
                && decorationCharacters[decorationIndex] !== character
            ) {
                decorationIndex += 1;
            }
            if (decorationIndex >= decorationCharacters.length) {
                break;
            }
            consumed += character.length;
            decorationIndex += 1;
        }
        return boundary + consumed;
    };

    const earliestPrefix = (anchor, anchorStart) => {
        let states = new Set([anchorStart]);
        let firstRun = anchor.index;
        for (let index = anchor.index - 1; index >= 0; index -= 1) {
            const preceding = new Set();
            const gap = decorations[index + 1];
            const run = runs[index];
            const runPositions = positionsByRun[index];
            for (const nextStart of states) {
                const minimumStart = Math.max(
                    0,
                    nextStart - gap.length - run.length,
                );
                const maximumStart = nextStart - run.length;
                let positionIndex = lowerBound(runPositions, minimumStart);
                while (
                    positionIndex < runPositions.length
                    && runPositions[positionIndex] <= maximumStart
                ) {
                    const runStart = runPositions[positionIndex];
                    const boundary = runStart + run.length;
                    inspectGap(
                        "$.decoratedPrefix",
                        nextStart - boundary + 1,
                    );
                    if (isDecorationSubsequence(
                        markdown.slice(boundary, nextStart),
                        gap,
                    )) {
                        preceding.add(runStart);
                    }
                    positionIndex += 1;
                }
            }
            if (preceding.size === 0) {
                break;
            }
            states = preceding;
            firstRun = index;
        }
        const earliestRunStart = Math.min(...states);
        return {
            start: firstRun === 0
                ? longestPrefixDecoration(earliestRunStart, decorations[0])
                : earliestRunStart,
            runIndex: firstRun,
        };
    };

    const latestSuffix = (anchor, anchorEnd) => {
        let states = new Set([anchorEnd]);
        let lastRun = anchor.index;
        for (let index = anchor.index + 1; index < runs.length; index += 1) {
            const following = new Set();
            const gap = decorations[index];
            const run = runs[index];
            const runPositions = positionsByRun[index];
            for (const previousEnd of states) {
                const maximumStart = Math.min(
                    markdown.length - run.length,
                    previousEnd + gap.length,
                );
                let positionIndex = lowerBound(runPositions, previousEnd);
                while (
                    positionIndex < runPositions.length
                    && runPositions[positionIndex] <= maximumStart
                ) {
                    const runStart = runPositions[positionIndex];
                    inspectGap(
                        "$.decoratedSuffix",
                        runStart - previousEnd + 1,
                    );
                    if (isDecorationSubsequence(
                        markdown.slice(previousEnd, runStart),
                        gap,
                    )) {
                        following.add(runStart + run.length);
                    }
                    positionIndex += 1;
                }
            }
            if (following.size === 0) {
                break;
            }
            states = following;
            lastRun = index;
        }
        const latestRunEnd = Math.max(...states);
        return {
            end: lastRun === runs.length - 1
                ? longestSuffixDecoration(
                    latestRunEnd,
                    decorations[runs.length],
                )
                : latestRunEnd,
            runIndex: lastRun,
        };
    };

    const matches = new Map();
    for (const anchor of anchoredRuns) {
        for (const position of anchor.positions) {
            const prefix = earliestPrefix(anchor, position);
            const suffix = latestSuffix(anchor, position + anchor.run.length);
            const completeField = (
                prefix.runIndex === 0
                && suffix.runIndex === runs.length - 1
            );
            if (
                suffix.end > prefix.start
                && suffix.end - prefix.start < text.length
                && (
                    completeField
                    || suffix.end - prefix.start >= MIN_VERIFIED_EMBEDDED_SPAN
                )
            ) {
                const span = markdown.slice(prefix.start, suffix.end);
                matches.set(
                    `${prefix.runIndex}:${suffix.runIndex}:${span}`,
                    span,
                );
            }
        }
    }
    return [...matches.values()];
}

function normalizeInitialIntervals(markdown, intervals, path) {
    if (!Array.isArray(intervals)) {
        fail("INVALID_RETENTION_INTERVALS", path, "must be an array");
    }
    return intervals.map((interval, index) => {
        const intervalPath = `${path}[${index}]`;
        if (
            interval === null
            || typeof interval !== "object"
            || Array.isArray(interval)
            || !Number.isSafeInteger(interval.start)
            || !Number.isSafeInteger(interval.end)
            || interval.start < 0
            || interval.end <= interval.start
            || interval.end > markdown.length
            || interval.segmentHash !== sha256Hex(
                markdown.slice(interval.start, interval.end),
            )
        ) {
            fail(
                "INVALID_RETENTION_INTERVAL",
                intervalPath,
                "must identify a hash-verified fetched Markdown span",
            );
        }
        return { start: interval.start, end: interval.end };
    });
}

function retentionManifest(
    contentHash,
    markdown,
    prose,
    { initialIntervals = [] } = {},
) {
    const requestsByText = new Map();
    const normalizedInitialIntervals = normalizeInitialIntervals(
        markdown,
        initialIntervals,
        "$.initialIntervals",
    );
    const windowIndex = buildVerifiedWindowIndex(markdown);
    const addRequest = (text, count) => {
        const existing = requestsByText.get(text);
        if (existing === undefined) {
            requestsByText.set(text, {
                text,
                positions: allOccurrences(markdown, text),
                count,
            });
        } else {
            existing.count += count;
        }
    };

    const collectVerifiedText = (text) => {
        if (!text) {
            return { wholeMatch: false, spans: [] };
        }
        const positions = allOccurrences(markdown, text);
        if (positions.length > 0) {
            return { wholeMatch: true, spans: [text] };
        }
        if (text.length < MIN_VERIFIED_EMBEDDED_SPAN) {
            return { wholeMatch: false, spans: [] };
        }
        return {
            wholeMatch: false,
            spans: verifiedEmbeddedSpans(markdown, text, windowIndex),
        };
    };

    for (const entry of prose) {
        const text = canonicalizeLineEndings(entry.text);
        if (!text) {
            continue;
        }
        if (Array.from(text).some((character) => (
            CONTROL_CHARACTER_PATTERN.test(character)
            && !["\t", "\n", "\r"].includes(character)
        ))) {
            fail(
                "UNSAFE_PERSISTED_TEXT",
                entry.path,
                "persisted evidence text cannot contain hidden control characters",
            );
        }
        if (text.includes(markdown)) {
            fail(
                "FULL_FETCH_CONTENT",
                entry.path,
                "persisted evidence text cannot contain a complete fetched page",
            );
        }
        const matchesBySpan = new Map();
        const mergeMatches = (spans) => {
            const counts = new Map();
            for (const span of spans) {
                counts.set(span, (counts.get(span) ?? 0) + 1);
            }
            for (const [span, count] of counts) {
                matchesBySpan.set(
                    span,
                    Math.max(matchesBySpan.get(span) ?? 0, count),
                );
            }
        };
        const { wholeMatch, spans } = collectVerifiedText(text);
        mergeMatches(spans);
        if (!wholeMatch) {
            const entryVariants = new Set([text]);
            let variantWholeMatch = false;
            for (const variant of decorationVariants(text, markdown)) {
                if (!entryVariants.has(variant)) {
                    entryVariants.add(variant);
                    const variantMatch = collectVerifiedText(variant);
                    mergeMatches(variantMatch.spans);
                    variantWholeMatch ||= variantMatch.wholeMatch;
                }
            }
            if (!variantWholeMatch) {
                mergeMatches(verifiedDecoratedSpans(markdown, text));
            }
        }
        for (const [span, count] of matchesBySpan) {
            addRequest(span, count);
        }
    }
    const intervals = allocateVerifiedRequests(
        markdown,
        [...requestsByText.values()],
        normalizedInitialIntervals,
    );
    const merged = mergeIntervals(markdown, intervals);
    const cumulative = mergeIntervals(markdown, [
        ...normalizedInitialIntervals,
        ...intervals,
    ]);
    const totalChars = merged.reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
    );
    const cumulativeChars = cumulative.reduce(
        (total, interval) => total + interval.end - interval.start,
        0,
    );
    if (
        cumulativeChars >= markdown.length
        || (
            cumulativeChars * NEAR_FULL_CONTENT_DENOMINATOR
            >= markdown.length * NEAR_FULL_CONTENT_NUMERATOR
        )
    ) {
        fail(
            "FULL_FETCH_CONTENT",
            "$",
            "persisted evidence text cannot reconstruct a near-complete fetched page",
        );
    }
    if (cumulativeChars > MAX_PUBLISHED_EXCERPT_CHARS_PER_FETCH) {
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
    };
}

function normalizeBundleCaptures(bundle, captureInputs) {
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
    for (const capture of captures) {
        if (capture.researchId !== bundle.researchId) {
            fail(
                "CAPTURE_RESEARCH_MISMATCH",
                "$.researchId",
                "captured evidence must belong to the bundle researchId",
            );
        }
    }
    return captures;
}

function fetchedMarkdownByHash(captures) {
    const markdownByHash = new Map();
    for (const capture of captures) {
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
    return markdownByHash;
}

function retentionManifestsForNormalizedProse(
    markdownByHash,
    prose,
    initialIntervalsByHash = new Map(),
) {
    if (!(initialIntervalsByHash instanceof Map)) {
        fail(
            "INVALID_RETENTION_INTERVALS",
            "$.initialIntervalsByHash",
            "must be a Map keyed by fetched-content hash",
        );
    }
    return [...markdownByHash.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([contentHash, markdown]) => (
            retentionManifest(contentHash, markdown, prose, {
                initialIntervals: initialIntervalsByHash.get(contentHash) ?? [],
            })
        ));
}

export function retentionManifestsForProse(
    bundleInput,
    captureInputs,
    proseInputs,
    { initialIntervalsByHash = new Map() } = {},
) {
    const bundle = assertEvidenceContentHash(bundleInput);
    const captures = normalizeBundleCaptures(bundle, captureInputs);
    if (!Array.isArray(proseInputs)) {
        fail("INVALID_RETENTION_PROSE", "$.prose", "must be an array");
    }
    const prose = proseInputs.map((entry, index) => {
        const path = `$.prose[${index}]`;
        if (
            entry === null
            || typeof entry !== "object"
            || Array.isArray(entry)
            || typeof entry.path !== "string"
            || typeof entry.text !== "string"
        ) {
            fail(
                "INVALID_RETENTION_PROSE",
                path,
                "must contain string path and text properties",
            );
        }
        return { path: entry.path, text: entry.text };
    });
    return retentionManifestsForNormalizedProse(
        fetchedMarkdownByHash(captures),
        prose,
        initialIntervalsByHash,
    );
}

export function validateResearchBundleWithRetention(bundleInput, captureInputs) {
    const bundle = assertEvidenceContentHash(bundleInput);
    const captures = normalizeBundleCaptures(bundle, captureInputs);
    const markdownByHash = fetchedMarkdownByHash(captures);

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
    const retentionManifests = retentionManifestsForNormalizedProse(
        markdownByHash,
        prose,
    );
    return { bundle, retentionManifests };
}

export function validateResearchBundle(bundleInput, captureInputs) {
    return validateResearchBundleWithRetention(bundleInput, captureInputs).bundle;
}
