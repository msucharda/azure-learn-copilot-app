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
        "skill",
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
    assert.match(researcher, /fetch\s+the most relevant pages/i);
    assert.match(researcher, /code-sample search/i);
    assert.match(researcher, /spools truncated output to a local file/i);
    assert.match(researcher, /Do not inspect unrelated workspace\s+or user files/i);
    assert.match(researcher, /lifecycle, availability, deprecation, and regional constraints/i);
    assert.match(researcher, /source-backed facts, scenario assumptions, and your synthesized recommendation/i);
    assert.match(researcher, /descriptive Markdown link beside each material factual claim/i);
    assert.match(researcher, /host is exactly\s+`learn\.microsoft\.com`/i);
    assert.match(researcher, /short `References` list/i);
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
