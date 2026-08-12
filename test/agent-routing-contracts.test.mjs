import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTER_PATH = ".github/skills/project-azure-learn-skill-router/SKILL.md";
const RESEARCHER_PATH = ".github/agents/learn-researcher.agent.md";
const CRITIC_PATH = ".github/agents/citation-critic.agent.md";
const INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
const PUBLISH_PATH = ".github/skills/publish-research-draft/SKILL.md";

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
        "azure-functions",
        "microsoft-foundry",
    ]);
    assert.equal(parseRoutes(router).filter(({ fallback }) => fallback).length, 0);
    assert.match(router, /\{"status":"resolved\|unresolved","primary_skill":"exact-name\|null","fallback_skill":"exact-name\|null","matched_alias":"string\|null"\}/);
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
    assert.equal(resolve(routes, "Use Foundry Local with a foundry sdk").status, "unresolved");
    assert.equal(resolve(routes, "Configure Azure Kubernetes Service").status, "unresolved");
});

test("researcher allows only routing, reading, and production evidence tools", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    const header = frontmatter(researcher);
    assert.match(header, /tools: \["skill", "read", "record_learn_evidence", "validate_research_bundle", "publish_research_bundle", "get_research_bundle"\]/);
    assert.doesNotMatch(header, /\b(?:edit|bash|shell|write)\b/);
    assert.match(researcher, /invoke exactly one `primary_skill` by exact name/i);
    assert.match(researcher, /more than three calendar months old/i);
    assert.match(researcher, /generated project router is never evidence provenance/i);
    assert.match(researcher, /every successful Learn operation through `record_learn_evidence`/i);
});

test("researcher avoids fixed Learn wrapper and legacy operation names", async () => {
    const researcher = await readFile(RESEARCHER_PATH, "utf8");
    assert.doesNotMatch(researcher, /microsoft_docs_(?:search|fetch)|microsoft_code_sample_search|mcp_microsoftdocs|microsoft-learn-microsoft/);
    assert.match(researcher, /logical operation `docs-fetch`/);
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
    const publish = await readFile(PUBLISH_PATH, "utf8");
    assert.match(publish, /user explicitly says \*\*publish\*\*/i);
    assert.match(publish, /`validate_research_bundle`/);
    assert.match(publish, /`publish_research_bundle`/);
    assert.match(publish, /`get_research_bundle`/);
    assert.match(publish, /There is no iframe publish control/);
});
