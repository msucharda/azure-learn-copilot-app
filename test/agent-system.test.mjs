import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const RESEARCHER_PATH = ".github/agents/learn-researcher.agent.md";
const CRITIC_PATH = ".github/agents/citation-critic.agent.md";
const INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
const DOCUMENTATION_PATHS = [
    "README.md",
    "docs/architecture.md",
    "docs/setup.md",
    "docs/troubleshooting.md",
];

function at(path) {
    return new URL(path, ROOT);
}

async function text(path) {
    return readFile(at(path), "utf8");
}

function frontmatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, "agent frontmatter is required");
    return match[1];
}

function tools(markdown) {
    const match = frontmatter(markdown).match(/^tools: (.+)$/m);
    assert.ok(match, "agent tools must be explicit");
    return JSON.parse(match[1]);
}

function property(markdown, name) {
    const match = frontmatter(markdown).match(new RegExp(`^${name}: (.+)$`, "m"));
    assert.ok(match, `${name} must be explicit`);
    return match[1];
}

async function assertMissing(path) {
    await assert.rejects(
        stat(at(path)),
        (error) => error?.code === "ENOENT",
        `${path} must not exist`,
    );
}

test("repository has an agent-only project surface", async () => {
    await Promise.all([
        assertMissing(".github/extensions"),
        assertMissing(".github/skills"),
    ]);

    const [researcher, critic] = await Promise.all([
        text(RESEARCHER_PATH),
        text(CRITIC_PATH),
    ]);
    assert.deepEqual(tools(researcher), [
        "read",
        "microsoft-learn/*",
    ]);
    assert.deepEqual(tools(critic), []);
    assert.equal(property(researcher, "target"), "github-copilot");
    assert.equal(property(critic, "target"), "github-copilot");
});

test("researcher uses native discovery and returns website references", async () => {
    const researcher = await text(RESEARCHER_PATH);
    assert.match(researcher, /documentation search directly/i);
    assert.match(researcher, /every explicitly\s+requested decision and subtopic into an atomic coverage checklist/i);
    assert.match(researcher, /comma-separated requests into individual items/i);
    assert.match(researcher, /parent decision area does not cover its children/i);
    assert.match(researcher, /search chunks as discovery only/i);
    assert.match(researcher, /Select at most 15 authoritative pages/i);
    assert.match(researcher, /Fetch every selected page/i);
    assert.match(researcher, /not successfully fetched cannot appear in a\s+claim link/i);
    assert.match(researcher, /code-sample\s+search/i);
    assert.match(researcher, /spools output to a local file/i);
    assert.match(researcher, /Do not inspect unrelated workspace\s+or user files/i);
    assert.match(researcher, /lifecycle, availability, deprecation, and regional constraints/i);
    assert.match(researcher, /Do not say Microsoft recommends or prefers/i);
    assert.match(researcher, /recommendation may synthesize trade-offs, but it cannot introduce an unfetched product\s+capability/i);
    assert.match(researcher, /compare every recommendation against all fetched constraints and every explicit\s+scenario requirement/i);
    assert.match(researcher, /Never combine mutually exclusive connection modes, feature gaps, deployment\s+options, or support states/i);
    assert.match(researcher, /do not bypass a required control for convenience/i);
    assert.match(researcher, /Point every atomic item to a sentence\s+in the core answer/i);
    assert.match(researcher, /unsupported recommendation, or `Agent-system observations` do not count\s+as coverage/i);
    assert.match(researcher, /Name or clearly restate every unsupported atomic item/i);
    assert.match(researcher, /do not hide multiple gaps behind an aggregate phrase/i);
    assert.match(researcher, /report complete coverage while any item is absent/i);
    assert.match(researcher, /Source and word limits require concise prioritization, not omission/i);
    assert.match(researcher, /audit every Markdown URL in the draft/i);
    assert.match(researcher, /canonical URL and title only\s+when the successful fetch explicitly returns them/i);
    assert.match(researcher, /preserve the exact request URL that\s+fetched successfully/i);
    assert.match(researcher, /never infer, normalize, or rewrite a canonical form/i);
    assert.match(researcher, /including unresolved items and suggested next\s+steps/i);
    assert.match(researcher, /core synthesis within 1,500 words/i);
    assert.match(researcher, /atomic checklist exceeds 30 items may the core use up to\s+2,000 words/i);
    assert.match(researcher, /allowance to cover requested items rather than add detail to already\s+covered items/i);
    assert.match(researcher, /compact `Coverage audit` immediately before\s+`References`/i);
    assert.match(researcher, /table with `Decision area`, `Covered`, and `Unresolved` columns/i);
    assert.match(researcher, /Every atomic\s+checklist item must appear exactly once/i);
    assert.match(researcher, /Mark an item `Covered` only when the core answer explicitly addresses it/i);
    assert.match(researcher, /audit does not substitute for the\s+core answer/i);
    assert.match(researcher, /detailed discussion to at most the three unresolved decision groups/i);
    assert.match(researcher, /Name any additional unsupported atomic items tersely/i);
    assert.match(researcher, /include all three exact labels: `\*\*Fetched facts:\*\*`,\s+`\*\*Recommendation:\*\*`, and `\*\*Assumptions or unresolved constraints:\*\*`/i);
    assert.match(researcher, /None identified from the fetched\s+sources/i);
    assert.match(researcher, /descriptive Markdown link beside each material factual claim/i);
    assert.match(researcher, /host is exactly\s+`learn\.microsoft\.com`/i);
    assert.match(researcher, /`References` list containing each cited fetched page/i);
    assert.match(researcher, /built-in `orchestrate` skill/i);
    assert.doesNotMatch(researcher, /send_session_message/);
    for (const forbidden of ["edit", "execute", "shell", "bash"]) {
        assert.equal(tools(researcher).includes(forbidden), false);
    }
});

test("project instructions use native orchestration", async () => {
    const instructions = await text(INSTRUCTIONS_PATH);
    assert.match(instructions, /built-in `\/orchestrate` skill/i);
    assert.match(instructions, /`learn-researcher` agent/i);
    assert.match(instructions, /persisted transcript with app-native session-history tools/i);
    assert.match(instructions, /local full-text index/i);
    assert.match(instructions, /do not load a product-skill catalog/i);
    assert.match(instructions, /native Microsoft Learn tools/i);
    assert.match(instructions, /`References` list/i);
    assert.doesNotMatch(instructions, /create_session|send_session_message/);
});

test("critic cannot fetch or broaden evidence", async () => {
    const critic = await text(CRITIC_PATH);
    for (const status of [
        "supported",
        "partially-supported",
        "unsupported",
        "conflicting",
    ]) {
        assert.match(critic, new RegExp(`\\\`${status}\\\``));
    }
    assert.match(critic, /Do not\s+open new sources, broaden the source set, rewrite the answer/i);
});

test("documentation links are safe websites", async () => {
    const documents = await Promise.all(DOCUMENTATION_PATHS.map(text));
    const urls = documents.flatMap((document) => [
        ...document.matchAll(/\[[^\]]+\]\((https:\/\/[^)]+)\)/g),
    ].map((match) => match[1]));

    const allowedHosts = new Set([
        "docs.github.com",
        "learn.microsoft.com",
    ]);
    assert.ok(urls.length >= 6, "documentation must contain authoritative website links");
    for (const value of urls) {
        const url = new URL(value);
        assert.equal(url.protocol, "https:");
        assert.equal(allowedHosts.has(url.hostname), true);
        assert.equal(url.username, "");
        assert.equal(url.password, "");
        assert.equal(url.port, "");
    }
});
