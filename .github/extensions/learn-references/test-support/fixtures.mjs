import {
    hashFetchedMarkdown,
    setEvidenceContentHash,
} from "../lib/index.mjs";

export const RESEARCH_ID = "12345678-1234-4234-8234-123456789abc";
export const PARENT_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CHILD_SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function rehash(bundleInput) {
    return setEvidenceContentHash({
        ...clone(bundleInput),
        contentHash: "0".repeat(64),
    });
}

export function makePublishedEvidence({
    researchId = RESEARCH_ID,
    version = 1,
    markdown = [
        "# Runtime discovery",
        "",
        "Tool schemas are discovered at runtime.",
        "",
        "Additional documentation context keeps the retained excerpt well below the page boundary.",
        "The remaining content is intentionally unrelated to the exact excerpt and handoff summary.",
        "Production Learn articles are substantially larger than their bounded evidence excerpts.",
    ].join("\n"),
    exactExcerpt = "Tool schemas are discovered at runtime.",
    canonicalUrl = "https://learn.microsoft.com/azure/example",
    retrievalUrl = "https://learn.microsoft.com/azure/example?view=current",
    question = "How should Learn tools be integrated?",
} = {}) {
    const sourceHash = hashFetchedMarkdown(markdown);
    const bundle = rehash({
        schemaVersion: 1,
        researchId,
        version,
        status: "published",
        parentSessionId: PARENT_SESSION_ID,
        childSessionId: CHILD_SESSION_ID,
        researcherAgent: "learn-researcher",
        question: {
            original: question,
            normalized: question,
        },
        scope: {
            product: "Microsoft Learn MCP Server",
            version: "current",
            platform: "Copilot CLI",
            taskIntent: "Publish verified Learn evidence.",
        },
        officialSkill: {
            skillName: "microsoft-foundry",
            pluginName: "azure-agent-skills",
            pluginVersion: "1.0.0",
        },
        claims: [{
            id: "claim-runtime-discovery",
            text: "Learn tool schemas are discovered dynamically.",
            sourceIds: ["source-runtime-discovery"],
            support: "supported",
        }],
        sources: [{
            id: "source-runtime-discovery",
            title: "Learn tool discovery",
            canonicalUrl,
            retrievalUrl,
            sectionHeading: "Runtime discovery",
            exactExcerpt,
            whyItMatters: "It establishes the supported integration boundary.",
            retrievalMethod: "docs-fetch",
            retrievedAt: "2026-08-12T09:01:00Z",
            contentHash: sourceHash,
            verificationState: "verified",
        }],
        unresolvedItems: [],
        lifecycle: {
            createdAt: "2026-08-12T09:00:00Z",
            validatingAt: "2026-08-12T09:02:00Z",
            validatedAt: "2026-08-12T09:03:00Z",
            publishedAt: "2026-08-12T09:04:00Z",
            updatedAt: "2026-08-12T09:04:00Z",
        },
        contentHash: "0".repeat(64),
    });
    const captureIdSuffix = String(version).padStart(12, "0");
    const capture = {
        schemaVersion: 1,
        captureId: `10000000-0000-4000-8000-${captureIdSuffix}`,
        researchId,
        logicalOperation: "docs-fetch",
        runtimeToolName: "runtime-tool-opaque-name",
        argsSummary: `fetch ${retrievalUrl}`,
        resultSha256: sourceHash,
        resultCount: 1,
        sourceUrls: [retrievalUrl],
        observedAt: "2026-08-12T09:01:00Z",
        canonicalUrl,
        retrievalUrl,
        fetchedMarkdown: markdown,
    };
    return { bundle, capture, markdown };
}

export function mixedDetectorBundle(
    bundleInput,
    markdown,
    {
        wholeFieldTotal,
        fragmentTotalTarget,
        fragmentLength = 15,
        fragmentRegionStart = 30_000,
        fillerText = "qzjkx",
        wholeRegionStart = 0,
    },
) {
    const bundle = clone(bundleInput);
    const claims = [];
    let wholePosition = wholeRegionStart;
    let wholeRemaining = wholeFieldTotal;
    for (let index = 0; wholeRemaining > 0; index += 1) {
        const take = Math.min(3_900, wholeRemaining);
        claims.push({
            id: `claim-whole-${index + 1}`,
            text: markdown.slice(wholePosition, wholePosition + take),
            sourceIds: bundle.claims[0].sourceIds,
            support: "supported",
        });
        wholePosition += take;
        wholeRemaining -= take;
    }

    const region = markdown.slice(
        fragmentRegionStart,
        fragmentRegionStart + fragmentTotalTarget + 4_000,
    );
    const fragments = [];
    for (
        let index = 0;
        index + fragmentLength <= region.length;
        index += fragmentLength
    ) {
        fragments.push(region.slice(index, index + fragmentLength));
    }
    const filler = fillerText.repeat(100);
    let fragmentCharsUsed = 0;
    let cursor = 0;
    for (
        let fieldIndex = 0;
        fragmentCharsUsed < fragmentTotalTarget && cursor < fragments.length;
        fieldIndex += 1
    ) {
        let fieldText = "";
        while (
            fieldText.length < 3_800
            && cursor < fragments.length
            && fragmentCharsUsed < fragmentTotalTarget
        ) {
            fieldText += fragments[cursor] + filler.slice(0, 5);
            fragmentCharsUsed += fragments[cursor].length;
            cursor += 1;
        }
        claims.push({
            id: `claim-fragment-${fieldIndex + 1}`,
            text: fieldText.slice(0, 4_000),
            sourceIds: bundle.claims[0].sourceIds,
            support: "supported",
        });
    }
    bundle.claims = claims;
    return {
        bundle: rehash(bundle),
        declaredTotal: wholeFieldTotal + fragmentCharsUsed,
        normalizedWholeTotal: claims
            .filter((claim) => claim.id.startsWith("claim-whole-"))
            .reduce((total, claim) => total + claim.text.trim().length, 0),
    };
}

export function handoffFor(bundle) {
    return {
        schemaVersion: 1,
        researchId: bundle.researchId,
        version: bundle.version,
        status: "published",
        parentSessionId: bundle.parentSessionId,
        childSessionId: bundle.childSessionId,
        researcherAgent: bundle.researcherAgent,
        executiveFindings: [{
            claimId: bundle.claims[0].id,
            text: "Runtime discovery is required.",
        }],
        unresolvedRisks: [],
        contentHash: bundle.contentHash,
        publishedAt: bundle.lifecycle.publishedAt,
    };
}

export function acknowledgementFor(bundle, acknowledgedAt = "2026-08-12T09:05:00.000Z") {
    return {
        schemaVersion: 1,
        parentSessionId: bundle.parentSessionId,
        researchId: bundle.researchId,
        version: bundle.version,
        status: "acknowledged",
        contentHash: bundle.contentHash,
        acknowledgedAt,
    };
}
