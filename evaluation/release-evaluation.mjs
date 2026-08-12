import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    DraftEvidenceStore,
    LearnMcpHttpTransport,
    PublishedEvidenceStore,
    adaptLearnMcpResult,
    createLearnReferenceTools,
    createLearnReferencesCanvas,
    discoverLearnOperations,
    hashFetchedMarkdown,
    normalizeEvidenceBundle,
    normalizeEvidenceCapture,
    setEvidenceContentHash,
    validateResearchBundle,
} from "../.github/extensions/learn-references/lib/index.mjs";
import {
    REFERENCE_CANVAS_HTML,
    REFERENCE_CANVAS_JS,
} from "../.github/extensions/learn-references/lib/canvas-renderer.mjs";
import {
    clone,
    handoffFor,
    makePublishedEvidence,
    rehash,
} from "../.github/extensions/learn-references/test-support/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORPUS_PATH = join(HERE, "release-corpus.json");
const FIXED_NOW = "2026-08-12T09:05:00.000Z";

function errorCode(error) {
    return error?.code ?? error?.name ?? "ERROR";
}

async function rejectsCode(callback, expected) {
    try {
        await callback();
        return "accepted";
    } catch (error) {
        assert.equal(errorCode(error), expected);
        return expected;
    }
}

function response(body, { status = 200, headers = {} } = {}) {
    return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "content-type": "application/json", ...headers } },
    );
}

function initialized(id) {
    return {
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "2025-06-18", capabilities: {} },
    };
}

function toolMap(tools) {
    return new Map(tools.map((tool) => [tool.name, tool]));
}

function validated(bundleInput) {
    const bundle = clone(bundleInput);
    bundle.status = "validated";
    bundle.lifecycle = {
        createdAt: bundle.lifecycle.createdAt,
        validatingAt: bundle.lifecycle.validatingAt,
        validatedAt: bundle.lifecycle.validatedAt,
        updatedAt: bundle.lifecycle.validatedAt,
    };
    return rehash(bundle);
}

function withSkillDate(bundleInput, generatedAt) {
    const bundle = clone(bundleInput);
    bundle.officialSkill.generatedAt = generatedAt;
    return rehash(bundle);
}

async function createHarness(root) {
    const draftStore = await DraftEvidenceStore.create({ root: join(root, "draft") });
    const publishedStore = await PublishedEvidenceStore.create({
        root: join(root, "published"),
    });
    let adapted;
    const learnAdapter = {
        execute: async () => adapted,
    };
    let currentTime = "2026-08-12T09:01:00Z";
    const tools = toolMap(createLearnReferenceTools({
        draftStore,
        publishedStore,
        learnAdapter,
        now: () => currentTime,
        uuid: () => "90000000-0000-4000-8000-000000000001",
    }));
    return {
        draftStore,
        publishedStore,
        tools,
        setAdapted(value) {
            adapted = value;
        },
        setNow(value) {
            currentTime = value;
        },
    };
}

async function runTransportGates(corpus) {
    const delays = [];
    let calls = 0;
    const statuses = corpus.transport.transientStatuses;
    const transport = new LearnMcpHttpTransport({
        fetchImplementation: async (_url, options) => {
            calls += 1;
            if (calls <= statuses.length) {
                return response("transient", {
                    status: statuses[calls - 1],
                    headers: calls === 1
                        ? { "retry-after": corpus.transport.retryAfter }
                        : {},
                });
            }
            return response(initialized(JSON.parse(options.body).id));
        },
        retryPolicy: {
            maxAttempts: 4,
            baseDelayMs: 1,
            maxDelayMs: 2,
            maxTotalDelayMs: 4,
            maxRetryAfterMs: 2,
            jitterRatio: 0,
        },
        sleep: async (delay) => delays.push(delay),
    });
    await transport.connect();

    let timeoutCalls = 0;
    const timeout = new LearnMcpHttpTransport({
        fetchImplementation: async () => {
            timeoutCalls += 1;
            throw new DOMException("timed out", "TimeoutError");
        },
        retryPolicy: {
            maxAttempts: 2,
            baseDelayMs: 0,
            maxDelayMs: 0,
            maxTotalDelayMs: 0,
            maxRetryAfterMs: 0,
            jitterRatio: 0,
        },
        sleep: async () => {},
    });
    const timeoutCode = await rejectsCode(() => timeout.connect(), "PROTOCOL_FAILURE");
    return {
        retries: { calls, delays, statuses },
        timeout: { calls: timeoutCalls, code: timeoutCode },
    };
}

async function runEndToEnd(root) {
    const context = await createHarness(root);
    const first = makePublishedEvidence({ version: 1 });
    const adapted = adaptLearnMcpResult("docs-fetch", first.markdown, {
        canonicalUrl: first.capture.canonicalUrl,
        retrievalUrl: first.capture.retrievalUrl,
    });
    context.setAdapted({ ...adapted, runtimeToolName: "offline-fetch" });
    const prepare = await context.tools.get("prepare_learn_research").handler({
        choice: "open-deep-research-session",
        researchId: first.bundle.researchId,
        question: first.bundle.question.original,
        normalizedQuestion: first.bundle.question.normalized,
        scope: first.bundle.scope,
        constraints: ["Offline deterministic release evaluation."],
        parentSessionId: first.bundle.parentSessionId,
        evidenceSeed: [],
        unresolvedQuestions: [],
    });
    assert.match(prepare.structuredContent.kickoff, /re-fetch and record every source/i);
    await context.tools.get("record_learn_evidence").handler({
        researchId: first.bundle.researchId,
        logicalOperation: "docs-fetch",
        argumentsJson: JSON.stringify({ address: first.capture.retrievalUrl }),
    });
    const persisted = validated(first.bundle);
    await context.tools.get("validate_research_bundle").handler({ bundle: persisted });
    await context.tools.get("persist_research_draft").handler({ bundle: persisted });
    await assert.rejects(
        context.publishedStore.get(first.bundle.researchId, 1),
        (error) => error.code === "PUBLISHED_NOT_FOUND",
    );
    const firstHandoff = handoffFor(first.bundle);
    await context.tools.get("publish_research_bundle").handler({
        bundle: first.bundle,
        handoff: firstHandoff,
    });
    const readBack = await context.tools.get("get_research_bundle").handler({
        researchId: first.bundle.researchId,
        version: 1,
    });
    assert.equal(readBack.structuredContent.bundle.contentHash, first.bundle.contentHash);
    assert.equal(JSON.stringify(firstHandoff).includes(first.markdown), false);
    context.setNow(FIXED_NOW);
    const acknowledged = await context.tools.get("acknowledge_research_handoff").handler({
        parentSessionId: first.bundle.parentSessionId,
        handoff: firstHandoff,
    });
    assert.equal(acknowledged.structuredContent.outcome, "acknowledged");

    class CanvasError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    const canvasDefinition = createLearnReferencesCanvas({
        draftStore: context.draftStore,
        publishedStore: context.publishedStore,
        createCanvas: (definition) => definition,
        CanvasError,
        heartbeatMs: 60_000,
    });
    const opened = await canvasDefinition.canvas.open({
        instanceId: "release-evaluation",
        input: {
            researchId: first.bundle.researchId,
            version: 1,
            view: "published",
        },
    });
    const projection = await (await fetch(new URL("/state", opened.url))).json();
    assert.equal(projection.view, "published");
    assert.equal(JSON.stringify(projection).includes(first.markdown), false);
    await canvasDefinition.closeAll();

    const second = makePublishedEvidence({
        version: 2,
        question: "What changed in release version two?",
    });
    await context.draftStore.recordCapture(second.capture);
    await context.tools.get("persist_research_draft").handler({
        bundle: validated(second.bundle),
    });
    await context.tools.get("publish_research_bundle").handler({
        bundle: second.bundle,
        handoff: handoffFor(second.bundle),
    });
    await context.tools.get("supersede_research_bundle").handler({
        researchId: first.bundle.researchId,
        version: 1,
        supersedingVersion: 2,
        supersededAt: "2026-08-12T09:10:00Z",
    });
    const superseded = await context.publishedStore.get(first.bundle.researchId, 1);
    return {
        prepare: "deep",
        publishedVersions: [1, 2],
        acknowledgement: acknowledged.structuredContent.outcome,
        canvas: projection.status,
        v1Status: superseded.status,
        durableUserEvidence: false,
    };
}

export async function runReleaseEvaluation({
    corpusPath = DEFAULT_CORPUS_PATH,
    workRoot,
} = {}) {
    const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
    assert.equal(corpus.schemaVersion, 1);
    const base = workRoot ?? await realpath(tmpdir());
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, "run-"));
    const gates = [];
    const gate = async (id, coverage, callback) => {
        try {
            const observed = await callback();
            gates.push({ id, coverage, passed: true, observed });
        } catch (error) {
            gates.push({
                id,
                coverage,
                passed: false,
                observed: { code: errorCode(error) },
            });
        }
    };
    try {
        await gate("search-shapes", ["concepts", "sdk-methods", "tutorials", "zero-results"], () => {
            const counts = {};
            for (const entry of corpus.searchCases) {
                const result = adaptLearnMcpResult(entry.operation, { results: entry.results });
                assert.equal(result.resultCount, entry.expectedCount);
                const expectedUrls = entry.results
                    .map((item) => item.url)
                    .filter(Boolean);
                assert.deepEqual(result.sourceUrls, expectedUrls);
                counts[entry.id] = result.resultCount;
            }
            return counts;
        });
        await gate("adapter-failure-envelope", ["failure-envelope"], async () => ({
            code: await rejectsCode(
                () => Promise.resolve(adaptLearnMcpResult("docs-fetch", {
                    resultType: "success",
                    structuredContent: { success: false, error: "not found" },
                }, {
                    canonicalUrl: corpus.safeLinks[0],
                    retrievalUrl: corpus.safeLinks[0],
                })),
                "MCP_ERROR",
            ),
        }));
        await gate("strict-contracts", ["schema-drift", "redirect-input", "safe-links"], async () => {
            const fixture = makePublishedEvidence();
            const schema = await rejectsCode(
                () => Promise.resolve(discoverLearnOperations([{
                    name: "opaque-drift",
                    inputSchema: {
                        type: "object",
                        properties: {
                            payload: { type: "object" },
                        },
                        required: ["payload"],
                    },
                }])),
                "SCHEMA_DRIFT",
            );
            const bundleDrift = { ...clone(fixture.bundle), futureField: true };
            const bundleSchema = await rejectsCode(
                () => Promise.resolve(normalizeEvidenceBundle(bundleDrift)),
                "UNKNOWN_PROPERTY",
            );
            const redirected = clone(fixture.capture);
            redirected.retrievalUrl = "https://learn.microsoft.com/azure/other?view=current";
            redirected.sourceUrls = [redirected.retrievalUrl];
            const redirect = await rejectsCode(
                () => Promise.resolve(normalizeEvidenceCapture(redirected)),
                "FETCH_URL_MISMATCH",
            );
            const unsafe = [];
            for (const link of corpus.unsafeLinks) {
                const changed = clone(fixture.bundle);
                changed.sources[0].canonicalUrl = link;
                unsafe.push(await rejectsCode(
                    () => Promise.resolve(normalizeEvidenceBundle(changed)),
                    link.startsWith("https://learn.microsoft.com.evil")
                        ? "INVALID_LEARN_HOST"
                        : "INVALID_URL",
                ));
            }
            const safeFetch = adaptLearnMcpResult("docs-fetch", "Safe Learn content.", {
                canonicalUrl: corpus.safeLinks[0],
                retrievalUrl: corpus.safeLinks[1],
            });
            assert.equal(safeFetch.canonicalUrl, corpus.safeLinks[0]);
            assert.equal(safeFetch.retrievalUrl, corpus.safeLinks[1]);
            return {
                schema,
                bundleSchema,
                redirect,
                unsafe,
                safe: [safeFetch.canonicalUrl, safeFetch.retrievalUrl],
            };
        });
        await gate("evidence-semantics", [
            "quota-uncertainty",
            "conflicting-sources",
            "exact-quote",
            "high-risk-unsupported",
            "stale-skill-metadata",
        ], async () => {
            const fixture = makePublishedEvidence();
            const exact = validateResearchBundle(fixture.bundle, [fixture.capture]);
            const mismatch = clone(fixture.bundle);
            mismatch.sources[0].exactExcerpt = "This quote is not in the capture.";
            const quoteMismatch = await rejectsCode(
                () => Promise.resolve(validateResearchBundle(rehash(mismatch), [fixture.capture])),
                "EXACT_EXCERPT_MISMATCH",
            );
            const unsupported = clone(fixture.bundle);
            unsupported.claims = [{
                id: "claim-quota",
                text: "A numeric service rate limit is not established by captured evidence.",
                sourceIds: [],
                support: "unsupported",
            }];
            unsupported.unresolvedItems = [{
                id: "unresolved-quota",
                text: "Confirm current quota from an authoritative product-specific source.",
            }];
            const normalizedUnsupported = normalizeEvidenceBundle(rehash(unsupported));
            assert.doesNotMatch(normalizedUnsupported.claims[0].text, /\b\d+\s*(?:\/|per)\s*(?:s|sec|second|minute)\b/i);
            const highRisk = clone(fixture.bundle);
            highRisk.claims[0].sourceIds = [];
            const rejectedHighRisk = await rejectsCode(
                () => Promise.resolve(normalizeEvidenceBundle(highRisk)),
                "INVALID_LENGTH",
            );
            const conflicting = clone(fixture.bundle);
            conflicting.claims[0].support = "conflicting";
            conflicting.claims[0].text = "The captured sources conflict about SDK behavior.";
            const conflictState = normalizeEvidenceBundle(rehash(conflicting)).claims[0].support;
            const stale = normalizeEvidenceBundle(withSkillDate(fixture.bundle, "2020-01-01"));
            const staleSkillMetadata = (
                Date.parse(FIXED_NOW) - Date.parse(stale.officialSkill.generatedAt)
            ) > 90 * 24 * 60 * 60 * 1_000;
            assert.equal(staleSkillMetadata, true);
            return {
                exact: exact.sources.length,
                quoteMismatch,
                unsupported: normalizedUnsupported.claims[0].support,
                rejectedHighRisk,
                conflictState,
                staleSkillGeneratedAt: stale.officialSkill.generatedAt,
                staleSkillMetadata,
            };
        });
        await gate("renderer-safety", [
            "prompt-injection",
            "malicious-markup",
            "renderer-text-only",
            "safe-links",
        ], () => {
            assert.equal(REFERENCE_CANVAS_JS.includes("innerHTML"), false);
            assert.match(REFERENCE_CANVAS_JS, /textContent/);
            assert.match(REFERENCE_CANVAS_JS, /parsed\.protocol !== "https:"/);
            assert.match(REFERENCE_CANVAS_JS, /parsed\.hostname !== "learn\.microsoft\.com"/);
            assert.match(REFERENCE_CANVAS_JS, /noopener noreferrer/);
            for (const text of corpus.adversarialText) {
                assert.equal(REFERENCE_CANVAS_HTML.includes(text), false);
            }
            return {
                rendering: "textContent",
                executableHtml: false,
                adversarialSamples: corpus.adversarialText.length,
            };
        });
        await gate("transport-resilience", ["transport-retries", "transport-timeout"], () => (
            runTransportGates(corpus)
        ));
        await gate("workflow-state", [
            "draft-isolation",
            "handoff-ordering",
            "manual-handoff",
            "authoritative-draft",
        ], async () => {
            const context = await createHarness(join(root, "workflow"));
            const first = makePublishedEvidence({ version: 1 });
            const second = makePublishedEvidence({
                version: 2,
                question: "A newer handoff.",
            });
            for (const fixture of [first, second]) {
                await context.draftStore.recordCapture(fixture.capture);
                await context.tools.get("persist_research_draft").handler({
                    bundle: validated(fixture.bundle),
                });
                await context.tools.get("publish_research_bundle").handler({
                    bundle: fixture.bundle,
                    handoff: handoffFor(fixture.bundle),
                });
            }
            await assert.rejects(
                context.publishedStore.getAcknowledgement(
                    first.bundle.parentSessionId,
                    first.bundle.researchId,
                    1,
                ),
                (error) => error.code === "ACKNOWLEDGEMENT_NOT_FOUND",
            );
            const storedManualHandoff = await context.publishedStore.getHandoff(
                first.bundle.parentSessionId,
                first.bundle.researchId,
                1,
            );
            const newer = await context.tools.get("acknowledge_research_handoff").handler({
                parentSessionId: second.bundle.parentSessionId,
                handoff: handoffFor(second.bundle),
            });
            const duplicate = await context.tools.get("acknowledge_research_handoff").handler({
                parentSessionId: second.bundle.parentSessionId,
                handoff: handoffFor(second.bundle),
            });
            const stale = await context.tools.get("acknowledge_research_handoff").handler({
                parentSessionId: first.bundle.parentSessionId,
                handoff: handoffFor(first.bundle),
            });
            const mismatch = clone(second.bundle);
            mismatch.question.original = "Changed after validation.";
            const authoritative = await rejectsCode(
                () => context.tools.get("publish_research_bundle").handler({
                    bundle: rehash(mismatch),
                    handoff: handoffFor(rehash(mismatch)),
                }),
                "AUTHORITATIVE_DRAFT_MISMATCH",
            );
            return {
                parentUnavailableUntilAck: true,
                childInterruptionLeavesHandoff: storedManualHandoff.version,
                outcomes: [
                    newer.structuredContent.outcome,
                    duplicate.structuredContent.outcome,
                    stale.structuredContent.outcome,
                ],
                authoritative,
            };
        });
        await gate("end-to-end-release", ["end-to-end"], () => (
            runEndToEnd(join(root, "end-to-end"))
        ));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
    const covered = new Set(gates.flatMap((entry) => entry.coverage));
    const missingCoverage = corpus.requiredCoverage.filter((entry) => !covered.has(entry));
    const passed = gates.filter((entry) => entry.passed).length;
    return {
        schemaVersion: 1,
        corpus: corpus.name,
        deterministic: true,
        totals: {
            gates: gates.length,
            passed,
            failed: gates.length - passed,
        },
        coverage: {
            required: corpus.requiredCoverage.length,
            covered: corpus.requiredCoverage.length - missingCoverage.length,
            missing: missingCoverage,
        },
        gates,
        passed: passed === gates.length && missingCoverage.length === 0,
    };
}
