import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const TRIAGE_PATH = ".github/agents/learn-source-triage.agent.md";
const EVIDENCE_PATH = ".github/agents/learn-evidence-extractor.agent.md";
const OPERATIONS_PATH = ".github/agents/learn-operations-extractor.agent.md";
const PREFLIGHT_PATH = ".github/agents/learn-preflight-auditor.agent.md";
const WRITER_PATH = ".github/agents/learn-bounded-writer.agent.md";
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
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
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

    const [triage, evidence, operations, preflight, writer, researcher, critic] = await Promise.all([
        text(TRIAGE_PATH),
        text(EVIDENCE_PATH),
        text(OPERATIONS_PATH),
        text(PREFLIGHT_PATH),
        text(WRITER_PATH),
        text(RESEARCHER_PATH),
        text(CRITIC_PATH),
    ]);

    const nativeAgentTools = ["read", "microsoft-learn/*", "send_session_message"];
    assert.deepEqual(tools(triage), nativeAgentTools);
    assert.deepEqual(tools(evidence), nativeAgentTools);
    assert.deepEqual(tools(operations), nativeAgentTools);
    assert.deepEqual(tools(preflight), nativeAgentTools);
    assert.deepEqual(tools(writer), ["read", "send_session_message"]);
    assert.deepEqual(tools(researcher), nativeAgentTools);
    assert.deepEqual(tools(critic), nativeAgentTools);
    assert.equal(property(triage, "target"), "github-copilot");
    assert.equal(property(evidence, "target"), "github-copilot");
    assert.equal(property(operations, "target"), "github-copilot");
    assert.equal(property(preflight, "target"), "github-copilot");
    assert.equal(property(writer, "target"), "github-copilot");
    assert.equal(property(researcher, "target"), "github-copilot");
    assert.equal(property(critic, "target"), "github-copilot");
});

test("MAI evaluation agents keep bounded single-purpose contracts", async () => {
    const [evidence, operations, preflight, writer] = await Promise.all([
        text(EVIDENCE_PATH),
        text(OPERATIONS_PATH),
        text(PREFLIGHT_PATH),
        text(WRITER_PATH),
    ]);

    for (const agent of [evidence, operations, preflight, writer]) {
        assert.ok(agent.split("\n").length <= 100, "MAI evaluation agent must stay compact");
        assert.match(agent, /evaluation-only/i);
        assert.match(agent, /STARTED <task-sha-256> <callback-nonce>/i);
        assert.match(agent, /COMPLETED <task-sha-256> <callback-nonce>/i);
        assert.match(agent, /final tool call/i);
        assert.match(agent, /identical complete result/i);
    }

    assert.match(compact(evidence), /Evidence mode: claim-extraction/i);
    assert.match(compact(evidence), /do not search, follow links, replace URLs, or add sources/i);
    assert.match(compact(evidence), /URL fragments, query pivots, parent headings/i);
    assert.match(compact(evidence), /EVIDENCE_PAYLOAD_LIMIT/i);

    assert.match(compact(operations), /Evidence mode: operation-extraction/i);
    assert.match(compact(operations), /must be the first tool call/i);
    assert.match(compact(operations), /scan every fetched page/i);
    assert.match(compact(operations), /Never infer a command, selector, API version, permission, prerequisite, or safety condition/i);
    assert.match(compact(operations), /permission action segment is not an operation name/i);
    assert.match(compact(operations), /API display name is not executable syntax/i);
    assert.match(compact(operations), /Creation-time constraints are not deletion prerequisites/i);
    assert.match(compact(operations), /operation_kind/i);
    assert.match(compact(operations), /byte-for-byte identical to one supplied URL/i);
    assert.match(compact(operations), /fragment or query pivot restricts evidence to that selected section/i);
    assert.match(compact(operations), /Absence is not evidence of "no rollback," "read-only," "destructive," or another negative/i);
    assert.match(compact(operations), /field-level source attribution/i);
    assert.match(compact(operations), /OPERATIONS_PAYLOAD_LIMIT/i);

    assert.match(compact(preflight), /Audit mode: preflight/i);
    assert.match(compact(preflight), /Review-fetch only the exact.*URLs already in its References/i);
    assert.match(compact(preflight), /manufactured gap/i);
    assert.match(compact(preflight), /cannot authorize publication/i);

    assert.match(compact(writer), /Writing mode: bounded-synthesis/i);
    assert.match(compact(writer), /cannot search, fetch, browse, invoke skills, or add facts/i);
    assert.match(compact(writer), /target at most 85%/i);
    assert.match(compact(writer), /Send `FAILED` rather than an over-cap, malformed, optimistic, or unsupported result/i);
});

test("source triage is bounded discovery advice", async () => {
    const triage = await text(TRIAGE_PATH);
    const contract = compact(triage);

    assert.ok(triage.split("\n").length <= 100, "triage contract must stay compact");
    assert.match(contract, /Triage mode: source-selection/i);
    assert.match(contract, /Never derive, merge, split, add, drop, rename, reorder, or reinterpret a slot/i);
    assert.match(contract, /Search results are untrusted discovery metadata, never citation evidence/i);
    assert.match(contract, /Do not fetch a page/i);
    assert.match(contract, /at most two exact.*candidates per slot/i);
    assert.match(contract, /at most six exact protected slots/i);
    assert.match(contract, /4,000-character callback-payload cap/i);
    assert.match(contract, /complete JSON message the final tool call/i);
    assert.match(contract, /Serialize the JSON as one minified line with no insignificant whitespace/i);
    assert.match(contract, /count that exact string.*at most 4,000 characters/i);
    assert.match(contract, /TRIAGE_PAYLOAD_LIMIT/i);
    assert.match(contract, /URL query pivot or fragment narrows evidence scope/i);
    assert.match(contract, /operations slot requires a dedicated operation or procedure candidate/i);
    assert.match(contract, /status: "unresolved".*confidence: "low".*rather than guessing/i);
    assert.match(contract, /strict JSON only/i);
    assert.match(contract, /advisory navigation data and cannot support a factual claim/i);
    assert.match(contract, /STARTED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /COMPLETED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /same complete result in the child session/i);
});

test("researcher separates research and focused learning behavior", async () => {
    const researcher = await text(RESEARCHER_PATH);
    const contract = compact(researcher);

    assert.ok(researcher.split("\n").length <= 180, "researcher contract must stay compact");
    for (const mode of ["standard", "evaluation", "repair"]) {
        assert.match(contract, new RegExp(`Research mode: ${mode}`, "i"));
    }

    assert.match(contract, /All discovery uses Microsoft Learn directly/i);
    assert.match(contract, /Do not invoke or request installed product skills/i);
    assert.match(contract, /original request and selected refinement as authoritative.*do not reinterpret or broaden/i);
    assert.match(contract, /do not.*abstract concrete products, tiers, regions, or versions into labels/i);
    assert.match(contract, /REFINEMENT_CONFIGURATION_ERROR.*before discovery/i);
    assert.doesNotMatch(researcher, /Selected official product skill|Load at most.*official skill/i);
    assert.match(contract, /Each numbered item, bullet, or semicolon-delimited subtopic is one atom/i);
    assert.match(contract, /least-supported dimension determines that atom's final status/i);
    assert.match(contract, /fixed atoms, copy them verbatim into the audit before searching/i);
    assert.match(contract, /Never split, merge, add, drop, or renumber fixed atoms/i);
    assert.match(contract, /Fetch every selected page/i);
    assert.match(contract, /reserve slots for the lead's exact service, tier, and mode/i);
    assert.match(contract, /slot fixes actor, action, target service\/plane, and a decisive exclusion/i);
    assert.match(contract, /advisory ranker.*cannot derive, merge, or drop slots.*prove the fixed scope/i);
    assert.match(contract, /source-triage packet.*untrusted discovery advice/i);
    assert.match(contract, /fetch every selected page and independently verify/i);
    assert.match(contract, /perform direct discovery only for the affected slot/i);
    assert.match(contract, /never retry the triage agent/i);
    assert.match(contract, /Select at most 15 exact pages before generic alternatives/i);
    assert.match(contract, /task's smaller page cap is hard/i);
    assert.match(contract, /never repeat a successful fetch/i);
    assert.match(contract, /mark mutable facts time-sensitive and require deployment-time revalidation/i);
    assert.match(contract, /every material answer claim maps to the ledger, and every material ledger fact maps to the answer/i);
    assert.match(contract, /parent-heading.*section scope/i);
    assert.match(contract, /URL-fragment.*section scope/i);
    assert.match(contract, /query-parameter or selected-pivot scope/i);
    assert.match(contract, /current-to-target change.*lost or incompatible features.*restart\/redeploy needs/i);
    assert.match(contract, /billing\/cost, permissions, and management scope/i);
    assert.match(contract, /source-internal conflict instead of harmonizing it/i);
    assert.match(contract, /normalizing actor, mode, error class, and lifecycle scope/i);
    assert.match(contract, /exclusive or negative claim needs an explicit prohibition.*labeled as synthesis/i);
    assert.match(contract, /In `Conclusion`, label any synthesized condition or sequence/i);
    assert.match(contract, /Lock every fact and operation to its exact mechanism, tier, mode, and plane/i);
    assert.match(contract, /mutually exclusive alternative stays conditional and never supplies the lead path/i);
    assert.match(contract, /requested runbook or procedure.*exact fetched CLI, API, or IaC operation/i);
    assert.match(contract, /never infer a missing destructive-mode selector/i);
    assert.match(contract, /recommended numeric\/default setting.*conditional overrides and creation-time toggles/i);
    assert.match(contract, /relevant documented mode variants, including preview alternatives/i);
    assert.match(contract, /Remove each manifest value absent from the core/i);
    assert.match(contract, /one fetched page says a method is unavailable and another exposes it, mark the conflict/i);
    assert.match(contract, /Do not claim a mode is reversible unless fetched evidence establishes it/i);
    assert.match(contract, /Protective-control interactions/i);
    assert.match(contract, /For each mandatory scenario verb.*check the dedicated operations page/i);
    assert.match(contract, /mandatory scenario verb.*scan every fetched page for an exact operation/i);
    assert.match(contract, /Do not restate coexisting routes or topologies as recommended traffic sharing/i);
    assert.match(contract, /multi-table query.*map each table to its producer, diagnostic category, destination mode/i);
    assert.match(contract, /enforce one row per join key on both sides/i);
    assert.match(contract, /identity attribution.*credential validation.*telemetry-field population/i);
    assert.match(contract, /never transfer identity semantics across telemetry planes/i);
    assert.match(contract, /cardinality and drop limits.*missing or inaccurate-data conditions/i);
    assert.match(contract, /identity, key, DNS, network, or management plane gates all access/i);
    assert.match(contract, /distinguish restricted public access, trusted-service or managed-identity access, and a public bypass/i);
    assert.match(contract, /every URL must be HTTPS on exactly `learn\.microsoft\.com`/i);
    assert.match(contract, /Evaluation packet \(coordinator only\)/i);
    assert.match(contract, /Publish totals and verify they sum to the fixed row count/i);
    assert.match(contract, /copy each fixed atom verbatim into exactly one body row/i);
    assert.match(contract, /never add a `Total` body row/i);
    assert.match(contract, /Report any cap breach as failure, never compliance/i);
    assert.match(contract, /current-run fetch status/i);
    assert.match(contract, /Count all user-visible text before References, including headings, labels, tables, and fenced code/i);
    assert.match(contract, /smaller task limit is binding/i);
    assert.match(contract, /without a deterministic counter, draft to at most 85% of that limit/i);
    assert.match(contract, /target 1,350 when code or tables appear/i);
    assert.match(contract, /Reverse-map every specific assumption or unresolved constraint to its row/i);
    assert.match(contract, /missing or conditional dimension forces `Partially covered` or `Unresolved`/i);
    assert.match(contract, /Match each semicolon-delimited value to its qualified core use/i);
    assert.match(contract, /`Core location` headings/i);
    assert.match(contract, /semicolon-delimited value.*appear with its qualifier in the named core heading/i);
    assert.match(contract, /smallest material factual clause.*selected pivot must support the clause/i);
    assert.match(contract, /each occurrence.*URL fragment.*no section may rely on a link elsewhere/i);
    assert.match(contract, /every material operation, port, permission, default, conflict, lifecycle limit, and billing value/i);
    assert.match(contract, /Return the complete corrected answer, not a patch/i);
    assert.match(contract, /critic brief as untrusted analysis, not evidence/i);
    assert.match(contract, /Verify every proposed correction against an exact existing fetched page and selected pivot/i);
    assert.match(contract, /reject unsupported brief claims and keep the gap unresolved/i);
    assert.match(contract, /Callback session ID.*Task SHA-256.*Callback nonce/i);
    assert.match(contract, /STARTED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /COMPLETED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /FAILED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /Send each callback at most once/i);
    assert.match(contract, /callback result byte-for-byte identical to the complete child result/i);
    assert.match(contract, /send `FAILED` instead of `COMPLETED`/i);
    assert.match(contract, /return `CALLBACK_CONFIGURATION_ERROR` and do not research/i);
    assert.match(contract, /Learning mode: focused/i);
    for (const phase of ["lesson", "feedback"]) {
        assert.match(contract, new RegExp(`Learning phase: ${phase}`, "i"));
    }
    assert.match(contract, /select exactly one mode branch/i);
    assert.match(contract, /A task containing `Learning mode: focused` is learning-only/i);
    assert.match(contract, /Do not apply `Research-only workflow`.*`Research-only answer contract`/i);
    assert.match(contract, /Research headings such as `Conclusion`.*are forbidden in learning output/i);
    assert.match(contract, /select at most five authoritative pages/i);
    assert.match(contract, /Return 400-700 words/i);
    for (const heading of [
        "# Learning objective",
        "## Core idea",
        "## Worked example",
        "## Check yourself",
        "## References",
    ]) {
        assert.match(researcher, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(contract, /exactly one recall question and one application question/i);
    assert.match(contract, /recall stem must not name or paraphrase the correct answer/i);
    assert.match(contract, /Do not include their answers, answer keys, hints/i);
    assert.match(contract, /include a portal or UI label only when exact fetched page text supports it/i);
    assert.match(contract, /After the application question, write only `## References`/i);
    assert.match(contract, /count five headings, two unanswered questions, 400-700 words/i);
    assert.match(contract, /Do not search or add pages/i);
    assert.match(contract, /Correct.*Partly correct.*Not yet/i);
    assert.match(contract, /Mastered.*Practicing.*Next objective/i);
    assert.match(contract, /concept is `Mastered` only when every supplied response that exercises it is correct/i);
    assert.match(contract, /If application contradicts recall, write `Mastered: None yet`/i);
    assert.match(contract, /never narrow the claim to the recall scenario/i);
    assert.match(contract, /unanswered transfer question that changes or inverts the actor\/action scenario/i);
    assert.match(contract, /must not repeat the corrected entities, options, checklist, sequence, or be answerable by copying/i);
    assert.match(contract, /exact lesson is the complete teaching scope/i);
    assert.match(contract, /do not add a factual claim absent from it, even when that claim appears in a Reference or learner response/i);
    assert.match(contract, /learner responses are evidence of understanding, not factual sources/i);
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
    assert.match(contract, /current-state to target-state transition, including lost capabilities/i);
    assert.match(contract, /every manifest value must appear with its qualifier in the final core/i);
    assert.match(contract, /runbooks include an exact fetched CLI, API, or IaC operation/i);
    assert.match(contract, /conclusions label synthesized conditions/i);
    assert.match(contract, /all user-visible core text including headings, labels, tables, and fenced code/i);
    assert.match(contract, /final core under the named `Core location`/i);
    assert.match(contract, /recommended numeric\/default setting includes or explicitly excludes/i);
    assert.match(contract, /negative\/exclusive claims have explicit support or are labeled synthesis/i);
    assert.match(contract, /multi-table queries map producers, diagnostic categories, destinations/i);
    assert.match(contract, /identity attribution preserves provenance across telemetry planes/i);
    assert.match(contract, /discovery ranker filled strong-model protected evidence slots/i);
    assert.match(contract, /actor, action, target service\/plane, and adjacent-candidate exclusions match/i);
    assert.match(contract, /final evidence set.*discovery pool.*supports claims/i);
    assert.match(contract, /answer follows the supplied selected refinement without broadening, narrowing, or replacing/i);
    assert.match(contract, /End with a compact repair brief/i);
    assert.match(contract, /Do not rewrite the answer or propose a competing architecture/i);
    assert.match(contract, /STARTED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /COMPLETED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /FAILED <task-sha-256> <callback-nonce>/i);
    assert.match(contract, /For a focused-learning packet, score factual fidelity, focus, teaching clarity/i);
    assert.match(contract, /exactly one recall and one application question/i);
    assert.match(contract, /unsupported load-bearing fact, leaked answer, false mastery claim/i);
});

test("project instructions enforce a verified native-session pipeline", async () => {
    const instructions = await text(INSTRUCTIONS_PATH);
    const contract = compact(instructions);

    assert.ok(instructions.split("\n").length <= 145, "project instructions must stay compact");
    assert.match(contract, /Before Learn discovery, task hashing, or launching a research child/i);
    assert.match(contract, /`clear`.*`exploratory`.*`materially ambiguous`/i);
    assert.match(contract, /interpretations would change the product, evidence plan, decision, or risk/i);
    assert.match(contract, /Generate 2-3 concise interpretations.*use `ask_user` once/i);
    assert.match(contract, /recommended choice first only when context supports it/i);
    assert.match(contract, /Do not ask merely because details are missing/i);
    assert.match(contract, /`Original request`.*`Selected interpretation`.*`Objective`.*`In scope`/i);
    assert.match(contract, /`Assumptions`.*`Exclusions`.*`Unresolved`/i);
    assert.match(contract, /Compute the task SHA-256 only after that record is final/i);
    assert.match(contract, /research child.*must not reinterpret/i);
    assert.match(contract, /MAI preprocessing can begin only after Sol fixes intent/i);
    assert.match(contract, /built-in `\/orchestrate` skill/i);
    assert.match(contract, /freeze the complete task and compute its SHA-256/i);
    assert.match(contract, /generate a unique callback nonce/i);
    assert.match(contract, /commit and push the current branch.*pass it as `base_branch`/i);
    assert.match(contract, /verify the child branch contains the expected commit/i);
    assert.match(contract, /local-only commit is not a valid child-session base/i);
    assert.match(contract, /coordinate_with_creator: true.*notify_on_idle: always/i);
    assert.match(contract, /Do not deliver work in a follow-up session message/i);
    assert.match(contract, /callback `STARTED` before research and `COMPLETED` with the complete result/i);
    assert.match(contract, /Accept a callback only from the expected child project-session ID/i);
    assert.match(contract, /Treat idle notifications as diagnostics, never completion/i);
    assert.match(contract, /do not automatically resend the task/i);
    assert.match(contract, /`COMPLETED` payload missing the full required result.*delivery failure/i);
    assert.match(contract, /never reconstruct, resend, or retry it automatically/i);
    assert.match(contract, /Use `context_tier: default`/i);
    assert.match(contract, /packets? over 15,000 characters/i);
    assert.match(contract, /more than 30 fixed atoms/i);
    assert.match(contract, /reaches 120,000 input tokens or shows context loss/i);
    assert.match(contract, /Git staging does not change that/i);
    assert.match(contract, /review packet in the session artifact directory/i);
    assert.match(contract, /Direct Learn discovery is the only evidence path/i);
    assert.match(contract, /Do not load, preselect, or inject an installed product skill/i);
    assert.match(contract, /discovery-only candidate pool may exceed 15 pages/i);
    assert.match(contract, /Sol fixes protected evidence slots before ranking/i);
    assert.match(contract, /slot fixes actor, action, target service\/plane, and an adjacent-candidate exclusion/i);
    assert.match(contract, /advisory weak ranker may fill those slots.*cannot derive, merge, drop, or support claims/i);
    assert.match(contract, /evaluation-only MAI source triage/i);
    assert.match(contract, /`learn-source-triage` child with `mai-code-1\.1-flash`/i);
    for (const agent of [
        "learn-evidence-extractor",
        "learn-operations-extractor",
        "learn-preflight-auditor",
        "learn-bounded-writer",
    ]) {
        assert.match(contract, new RegExp(agent));
    }
    assert.match(contract, /bounded writer reads one exact normalized packet and has no Learn tools/i);
    assert.match(contract, /untouched, blinded quality non-inferiority plus end-to-end cost savings/i);
    assert.match(contract, /Keep GPT-5\.6 Sol as the production final researcher/i);
    assert.match(contract, /model-comparison arm may instead name GPT-5\.6 Terra/i);
    assert.match(contract, /Never use the triage packet to support a claim/i);
    assert.match(contract, /final evidence set to 15 authoritative pages/i);
    assert.doesNotMatch(instructions, /Selected official product skill|Select at most one exact installed official product skill/i);
    assert.match(contract, /Research mode: standard.*evaluation.*repair/i);
    assert.match(contract, /Learning mode: focused.*Learning phase: lesson.*feedback/i);
    assert.match(contract, /Establish one learning objective, learner level, and time budget/i);
    assert.match(contract, /400-700 words, at most five fetched Learn pages/i);
    assert.match(contract, /Publish the lesson and stop for the learner's responses/i);
    assert.match(contract, /Feedback reuses only those References/i);
    assert.match(contract, /Do not create a learner database or schedule review automatically/i);
    assert.match(contract, /do not forward that packet as user-facing output/i);
    assert.match(contract, /review-fetch only the exact Learn URLs already in References/i);
    assert.match(contract, /cold-context, strong frontier-class, different-family.*`citation-critic`/i);
    assert.match(contract, /never use a mini or economy model for a promotion verdict/i);
    assert.match(contract, /freeze every prompt, atom, rubric, budget, threshold, and hash/i);
    assert.match(contract, /launch all parallel cases before inspecting results/i);
    assert.match(contract, /make no contract edit until every strong-critic verdict completes/i);
    assert.match(contract, /Sol is the control plane and cannot override a critical defect/i);
    assert.match(contract, /researcher, critic, and coordinator usage separately by session/i);
    assert.match(contract, /Start a fresh callback-enabled `learn-researcher` child/i);
    assert.match(contract, /publish only its user-facing portion/i);
    assert.match(contract, /critic brief is analysis, not evidence/i);
    assert.match(contract, /reject unsupported suggestions, and preserve the gap/i);
    assert.match(contract, /current-to-target decision, surface lost capabilities, restart\/redeploy needs/i);
    assert.match(contract, /parent headings and notes as claim conditions/i);
    assert.match(contract, /requested runbook, include an exact fetched CLI, API, or IaC operation/i);
    assert.match(contract, /rebuild the final core, audit, and evidence manifest together/i);
    assert.match(contract, /no unused manifest value or optimistic status survives/i);
    assert.match(contract, /Count all user-visible core text before References, including headings, labels, tables, and fenced code/i);
    assert.match(contract, /Target 1,350 words when code or tables appear/i);
    assert.match(contract, /Reverse-map each assumption or unresolved dimension to its compound audit row/i);
    assert.match(contract, /method is unavailable and another exposes it, report a conflict/i);
    assert.match(contract, /query parameters and selected pivots as citation scope/i);
    assert.match(contract, /co-citation cannot transfer support/i);
    assert.match(contract, /negative\/exclusive claims or label them synthesis/i);
    assert.match(contract, /topology coexistence is not evidence of load-sharing/i);
    assert.match(contract, /multi-table queries, map every table to its producer, diagnostic category, destination/i);
    assert.match(contract, /enforce join cardinality and preserve identity provenance across telemetry planes/i);
    assert.match(contract, /Sweep each recommended numeric\/default value for conditional overrides/i);
    assert.match(contract, /manifest `Core location` headings/i);
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
