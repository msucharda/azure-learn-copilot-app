import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTER_PATH = ".github/skills/project-azure-learn-skill-router/SKILL.md";
const RESEARCHER_PATH = ".github/agents/learn-researcher.agent.md";
const CRITIC_PATH = ".github/agents/citation-critic.agent.md";
const INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
const PUBLISH_PATH = ".github/skills/publish-research-draft/SKILL.md";
const START_PATH = ".github/skills/start-learn-research/SKILL.md";
const CONSUME_PATH = ".github/skills/consume-research-handoff/SKILL.md";

function frontmatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, "frontmatter is required");
    return match[1];
}

function parseRoutes(markdown) {
    return [...markdown.matchAll(
        /### `([^`]+)`\n\n- Aliases: ([^\n]+)\n- Exclusions: ([^\n]+)(?:\n- Category: ([^\n]+))?(?:\n- Fallback: `([^`]+)`)?/g,
    )].map((match) => ({
        name: match[1],
        aliases: match[2].split(", "),
        exclusions: match[3] === "(none)" ? [] : match[3].split(", "),
        fallback: match[5] ?? null,
    }));
}

function resolve(routes, input) {
    const normalized = input.toLowerCase();
    const matches = routes.filter((route) =>
        route.aliases.some((alias) => normalized.includes(alias))
        && !route.exclusions.some((exclusion) => normalized.includes(exclusion)));
    if (matches.length !== 1) {
        return {
            status: "unresolved",
            primary_skill: null,
            fallback_skill: null,
            matched_alias: null,
        };
    }
    const route = matches[0];
    return {
        status: "resolved",
        primary_skill: route.name,
        fallback_skill: route.fallback,
        matched_alias: route.aliases.find((alias) => normalized.includes(alias)),
    };
}

test("generated router has exact ownership metadata and bounded allow-list", async () => {
    const router = await readFile(ROUTER_PATH, "utf8");
    const metadata = [...frontmatter(router).matchAll(/^  ([a-z-]+): (.+)$/gm)]
        .map((match) => match[1]);
    assert.deepEqual(metadata, [
        "managed-by",
        "generated",
        "format-version",
        "kind",
        "provenance",
    ]);
    assert.ok(Buffer.byteLength(router) <= 12 * 1024);
    assert.deepEqual(parseRoutes(router).map(({ name }) => name), [
        "azure-container-apps",
        "azure-functions",
        "microsoft-foundry",
    ]);
    assert.equal(parseRoutes(router).filter(({ fallback }) => fallback).length, 0);
    assert.match(router, /\{"status":"resolved\|unresolved","primary_skill":"exact-name\|null","fallback_skill":"exact-name\|null","matched_alias":"string\|null"\}/);
});

test("router resolves stateful Azure Container Apps research to one exact official skill", async () => {
    const routes = parseRoutes(await readFile(ROUTER_PATH, "utf8"));
    assert.deepEqual(resolve(routes, "Research stateful storage on Azure Container Apps"), {
        status: "resolved",
        primary_skill: "azure-container-apps",
        fallback_skill: null,
        matched_alias: "azure container apps",
    });
});

test("router resolves Azure Functions to one exact official skill", async () => {
    const routes = parseRoutes(await readFile(ROUTER_PATH, "utf8"));
    assert.deepEqual(resolve(routes, "Verify an Azure Functions trigger"), {
        status: "resolved",
        primary_skill: "azure-functions",
        fallback_skill: null,
        matched_alias: "azure functions",
    });
});

test("router resolves Microsoft Foundry to one exact official skill", async () => {
    const routes = parseRoutes(await readFile(ROUTER_PATH, "utf8"));
    assert.deepEqual(resolve(routes, "Check the Microsoft Foundry SDK"), {
        status: "resolved",
        primary_skill: "microsoft-foundry",
        fallback_skill: null,
        matched_alias: "microsoft foundry",
    });
});

test("router exclusions and uncovered products remain unresolved", async () => {
    const routes = parseRoutes(await readFile(ROUTER_PATH, "utf8"));
    assert.equal(resolve(routes, "Use Azure Container Instances").status, "unresolved");
    assert.equal(resolve(routes, "Use Foundry Local with a foundry sdk").status, "unresolved");
    assert.equal(resolve(routes, "Configure Azure Kubernetes Service").status, "unresolved");
});

test("researcher allows only routing, bounded reading, and production evidence tools", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    const header = frontmatter(researcher);
    assert.match(header, /tools: \["skill", "read", "open_canvas", "send_session_message", "record_learn_evidence", "read_learn_evidence_capture", "persist_research_draft", "validate_research_bundle", "publish_research_bundle", "get_research_bundle"\]/);
    assert.doesNotMatch(header, /\b(?:edit|bash|shell|write)\b/);
    assert.match(researcher, /invoke exactly one `primary_skill` by exact name/i);
    assert.match(researcher, /more than three calendar months old/i);
    assert.match(researcher, /generated project router is never evidence provenance/i);
    assert.match(researcher, /every successful Learn operation through `record_learn_evidence`/i);
    assert.match(researcher, /inspect only necessary bounded chunks with `read_learn_evidence_capture`/i);
});

test("researcher avoids fixed Learn wrapper and legacy operation names", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    assert.doesNotMatch(researcher, /microsoft_docs_(?:search|fetch)|microsoft_code_sample_search|mcp_microsoftdocs|microsoft-learn-microsoft/);
    assert.match(researcher, /logical operation `docs-fetch`/);
});

test("researcher answers in chat and keeps the canvas reference-only", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    assert.match(researcher, /complete user-facing synthesis in chat/i);
    assert.match(researcher, /links directly beside the claims they support/i);
    assert.match(researcher, /only the exact `canonicalUrl` of a persisted source backed by a successful `docs-fetch`/i);
    assert.match(researcher, /Resolve current Microsoft Learn URLs with a bounded `docs-search`/i);
    assert.match(researcher, /URL embedded in a skill is only a discovery hint/i);
    assert.match(researcher, /retain only the current search-result URL/i);
    assert.match(researcher, /canvas is reference-only: source title, section heading, exact excerpt, and canonical Microsoft Learn URL/i);
    assert.match(researcher, /Do not use the canvas for the research answer, claim matrix, provenance, lifecycle, or unresolved-item narrative/i);
});

test("unresolved routing cannot fabricate schema provenance or publish", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    const unresolved = researcher.match(
        /If the route is unresolved,[\s\S]*?until an external official skill is selected\./,
    )?.[0];
    assert.ok(unresolved);
    assert.match(unresolved, /at most one bounded `docs-search`/);
    assert.match(unresolved, /Do not create `officialSkill`, a bundle, claims, sources, citations/);
    assert.match(unresolved, /or call validation\/publication tools/);
    assert.doesNotMatch(unresolved, /validate_research_bundle|publish_research_bundle/);
});

test("citation critic is read-only and cannot broaden or rewrite", async () => {
    const critic = await readFile(CRITIC_PATH, "utf8");
    assert.match(frontmatter(critic), /tools: \["read"\]/);
    for (const status of ["supported", "partially-supported", "unsupported", "conflicting"]) {
        assert.match(critic, new RegExp(`\\\`${status}\\\``));
    }
    assert.match(critic, /no rewritten answer/i);
    assert.match(critic, /Do not edit files, invoke skills, search or fetch sources/i);
    assert.match(critic, /override deterministic bundle validation/i);
});

test("project instructions stay minimal and contain no copied source URLs", async () => {
    const [router, instructions] = await Promise.all([
        readFile(ROUTER_PATH, "utf8"),
        readFile(INSTRUCTIONS_PATH, "utf8"),
    ]);
    assert.ok(instructions.split("\n").length <= 10);
    assert.doesNotMatch(`${router}\n${instructions}`, /https?:\/\//);
    assert.doesNotMatch(instructions, /microsoft_docs_|mcp_microsoftdocs|microsoft-learn-microsoft/);
    assert.match(instructions, /crosses sessions only after.*publish-research-draft/i);
    assert.match(instructions, /cannot prove token savings/i);
});

test("publish workflow validates, publishes, and verifies only on explicit request", async () => {
    const [researcher, publish] = await Promise.all([
        readFile(RESEARCHER_PATH, "utf8"),
        readFile(PUBLISH_PATH, "utf8"),
    ]);
    assert.match(researcher, /On explicit publication, invoke `publish-research-draft` by exact skill name/);
    assert.match(researcher, /Never perform the validation, publication, immutable read-back, or handoff sequence directly outside the publish skill/);
    assert.doesNotMatch(researcher, /On explicit publication, use `publish_research_bundle`/);
    assert.match(publish, /user explicitly says \*\*publish\*\*/i);
    assert.match(publish, /persisted bounded schema-version-1 bundle is authoritative/);
    assert.match(publish, /`validate_research_bundle`/);
    assert.match(publish, /`persist_research_draft`/);
    assert.match(publish, /persisted revision is authoritative/);
    assert.match(publish, /`publish_research_bundle`/);
    assert.match(publish, /`get_research_bundle`/);
    assert.match(publish, /There is no canvas button, iframe publish control, or session-send bridge/);
});

test("two-speed start and published-only consumption use app-native session boundaries", async () => {
    const [start, consume, publish] = await Promise.all([
        readFile(START_PATH, "utf8"),
        readFile(CONSUME_PATH, "utf8"),
        readFile(PUBLISH_PATH, "utf8"),
    ]);
    assert.match(start, /\*\*Refine here\*\* and \*\*Open deep research session\*\*/);
    assert.match(start, /no programmatic Quick Chat creation API/);
    assert.match(start, /`coordinate_with_creator: true`/);
    assert.match(start, /`notify_on_idle: "once"`/);
    assert.match(start, /"mode": "interactive"/);
    assert.match(start, /"agent": "learn-researcher"/);
    assert.match(start, /Reuse the returned UUID-v4/);
    assert.match(start, /parent does not read, retrieve, summarize, or synthesize child draft evidence/);
    assert.match(start, /idle notification means only that the child stopped running/i);
    assert.match(start, /Never describe research as successful or a draft as ready from that notification/i);
    assert.match(start, /published handoff is the only completion signal consumed by the parent/i);
    assert.match(consume, /Call `get_research_bundle`/);
    assert.match(consume, /Call `acknowledge_research_handoff`/);
    assert.match(consume, /"view":"published"/);
    assert.match(consume, /Never open the child's draft view/);
    assert.match(publish, /message content equal to the schema-version-1 handoff envelope JSON only/);
    assert.match(publish, /`delivery_mode: "immediate"`/);
});
