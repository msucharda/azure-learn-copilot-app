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

function compact(markdown) {
    return markdown.replace(/\s+/g, " ").trim();
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

test("repository exposes only the native agent system", async () => {
    await Promise.all([
        assertMissing(".github/extensions"),
        assertMissing(".github/skills"),
    ]);

    const [researcher, critic] = await Promise.all([
        text(RESEARCHER_PATH),
        text(CRITIC_PATH),
    ]);

    const nativeAgentTools = ["read", "microsoft-learn/*", "send_session_message"];
    assert.deepEqual(tools(researcher), nativeAgentTools);
    assert.deepEqual(tools(critic), nativeAgentTools);
    assert.equal(property(researcher, "target"), "github-copilot");
    assert.equal(property(critic, "target"), "github-copilot");
});

test("researcher separates standard, evaluation, and repair behavior", async () => {
    const researcher = await text(RESEARCHER_PATH);
    const contract = compact(researcher);

    assert.ok(researcher.split("\n").length <= 150, "researcher contract must stay compact");
    for (const mode of ["standard", "evaluation", "repair"]) {
        assert.match(contract, new RegExp(`Research mode: ${mode}`, "i"));
    }

    assert.match(contract, /All modes use direct Microsoft Learn discovery/i);
    assert.match(contract, /Do not invoke or request installed product skills/i);
    assert.doesNotMatch(researcher, /Selected official product skill|Load at most.*official skill/i);
    assert.match(contract, /Each numbered item, bullet, or semicolon-delimited subtopic is one atom/i);
    assert.match(contract, /least-supported dimension determines that atom's final status/i);
    assert.match(contract, /Select at most 15 authoritative pages/i);
    assert.match(contract, /Fetch every selected page/i);
    assert.match(contract, /Reserve evidence slots for the lead's exact service, tier, and mode/i);
    assert.match(contract, /mark mutable facts time-sensitive and require deployment-time revalidation/i);
    assert.match(contract, /every material answer claim maps to the ledger, and every material ledger fact maps to the answer/i);
    assert.match(contract, /Do not claim a mode is reversible unless fetched evidence establishes it/i);
    assert.match(contract, /Protective-control interactions/i);
    assert.match(contract, /For each mandatory scenario verb.*check the dedicated operations page/i);
    assert.match(contract, /identity, key, DNS, network, or management plane gates all access/i);
    assert.match(contract, /every URL must be HTTPS on exactly `learn\.microsoft\.com`/i);
    assert.match(contract, /Evaluation packet \(coordinator only\)/i);
    assert.match(contract, /Publish totals and verify they sum to the fixed row count/i);
    assert.match(contract, /current-run fetch status/i);
    assert.match(contract, /Return the complete corrected answer, not a patch/i);
    assert.match(contract, /Callback session ID.*Task SHA-256.*Callback nonce/i);
    assert.match(contract, /STARTED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /COMPLETED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /FAILED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /Send each callback at most once/i);
    assert.match(contract, /return `CALLBACK_CONFIGURATION_ERROR` and do not research/i);
    assert.doesNotMatch(researcher, /create_session/);
});

test("critic reads one packet and verifies only existing references", async () => {
    const critic = await text(CRITIC_PATH);
    const contract = compact(critic);

    assert.ok(critic.split("\n").length <= 100, "critic contract must stay compact");
    assert.match(contract, /use `read` only on that file/i);
    assert.match(contract, /fetch only the exact `https:\/\/learn\.microsoft\.com` URLs already present/i);
    assert.match(contract, /Do not search, use code-sample discovery, follow a new link, replace a citation, add a source/i);
    assert.match(contract, /review-time verification, not the researcher's original tool trace/i);
    for (const status of ["supported", "partially-supported", "unsupported", "conflicting"]) {
        assert.match(critic, new RegExp(`\\\`${status}\\\``));
    }
    assert.match(contract, /deterministic atomization, row count, published status totals/i);
    assert.match(contract, /End with a compact repair brief/i);
    assert.match(contract, /Do not rewrite the answer or propose a competing architecture/i);
    assert.match(contract, /STARTED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /COMPLETED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /FAILED <task-sha-256> <callback-nonce>/i);
});

test("project instructions enforce a verified native-session pipeline", async () => {
    const instructions = await text(INSTRUCTIONS_PATH);
    const contract = compact(instructions);

    assert.ok(instructions.split("\n").length <= 120, "project instructions must stay compact");
    assert.match(contract, /built-in `\/orchestrate` skill/i);
    assert.match(contract, /freeze the complete task and compute its SHA-256/i);
    assert.match(contract, /generate a unique callback nonce/i);
    assert.match(contract, /coordinate_with_creator: true.*notify_on_idle: always/i);
    assert.match(contract, /Do not deliver work in a follow-up session message/i);
    assert.match(contract, /callback `STARTED` before research and `COMPLETED` with the complete result/i);
    assert.match(contract, /Accept a callback only from the expected child project-session ID/i);
    assert.match(contract, /Treat idle notifications as diagnostics, never completion/i);
    assert.match(contract, /do not automatically resend the task/i);
    assert.match(contract, /Git staging does not change that/i);
    assert.match(contract, /review packet in the session artifact directory/i);
    assert.match(contract, /Direct Learn discovery is the only research path/i);
    assert.match(contract, /Do not load, preselect, or inject an installed product skill/i);
    assert.doesNotMatch(instructions, /Selected official product skill|Select at most one exact installed official product skill/i);
    assert.match(contract, /Research mode: standard.*evaluation.*repair/i);
    assert.match(contract, /do not forward that packet as user-facing output/i);
    assert.match(contract, /review-fetch only the exact Learn URLs already in References/i);
    assert.match(contract, /Start a fresh callback-enabled `learn-researcher` child/i);
    assert.match(contract, /publish only its user-facing portion/i);
    assert.doesNotMatch(instructions, /create_session/);
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
