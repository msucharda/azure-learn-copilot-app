import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function plain(text) {
    return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

function checkActiveTurn(response) {
    assert.doesNotMatch(
        response,
        /\b(?:library_id|library_sha256|current_mission_id|confirmed_variables|next_question|evidence_summary|callback_nonce|task_sha256)\b|Progress checkpoint/i,
        "normal coaching must not expose progress metadata, even in hidden or unfenced content",
    );
    assert.doesNotMatch(
        response,
        /Callback session ID|Task SHA-256|Callback nonce|\b(?:STARTED|COMPLETED|FAILED)\s+[a-f0-9]{64}\b/i,
        "callback transport metadata is not learner-facing content",
    );
    assert.doesNotMatch(
        response,
        /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:Topic|Objective|Expected evidence|Evidence required|Exit criteria|Unresolved)(?:\*\*)?\s*:/i,
        "normal coaching must not become a mission worksheet",
    );
    const core = response.split(/^\s*(?:#{1,6}\s+References\s*|\*\*References:?\*\*)\s*$/im)[0];
    const visible = core
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<details\b[\s\S]*?<\/details>/gi, "")
        .replace(/^\s*(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\s*\1\s*$/gm, "")
        .replace(/`[^`\r\n]*`/g, "")
        .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "");
    assert.equal(
        (visible.match(/\?/g) ?? []).length, 1,
        "an active coordinated turn needs one visible question, not a checklist of questions",
    );
    assert.match(
        plain(visible), /\?$/,
        "the coaching question must be the final sentence before References",
    );
    const words = plain(core.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")).split(/\s+/);
    assert.ok(
        words.length <= 180,
        "ordinary coaching must stay within 180 words before References",
    );
}

const QUESTION = "What would you expect the gateway to do first?";

function legacyResponse(prose) {
    return `${prose}\n\n### Progress checkpoint\n\n\`\`\`json\n${JSON.stringify({
        library_id: "synthetic-fixture",
        next_question: QUESTION,
    }, null, 2)}\n\`\`\``;
}

test("ordinary coaching is a short conversation without a checkpoint", () => {
    checkActiveTurn(`Let's start with a fictional chat application. No live resources are needed.\n\n${QUESTION}`);
});

test("follow-up coaching can acknowledge the learner and take one small step", () => {
    checkActiveTurn("You have separated the application from the model. Let's focus on the space between them.\n\nWhere would you put the gateway in your sketch?");
});

test("a stuck learner can receive a hint rather than a rubric", () => {
    checkActiveTurn(`Let's simplify the example to three boxes: an application, a gateway, and a model.\n\n${QUESTION}`);
});

test("a requested explanation can come before a comprehension question", () => {
    checkActiveTurn("In this fictional design, the receptionist checks a visitor's invitation, while the specialist answers their question.\n\nWhich role would you assign to the gateway?");
});

test("ordinary Markdown emphasis does not change the visible question", () => {
    checkActiveTurn("What would you expect the **gateway**\nto do first?");
});

test("References and URL query parameters do not obscure the final question", () => {
    checkActiveTurn(`Use this [synthetic reference](https://learn.microsoft.com/example?view=test) for context.\n\n${QUESTION}\n\n### References\n\n- [Example](https://learn.microsoft.com/example?view=test)`);
});

test("relevant technical JSON examples are not confused with checkpoint dumps", () => {
    checkActiveTurn('Here is a synthetic message:\n\n```json\n{"role":"user","content":"Hello?"}\n```\n\nWhich field contains the message text?');
});

test("the previous question-before-checkpoint shape is now a regression", () => {
    assert.throws(() => checkActiveTurn(legacyResponse(QUESTION)), /progress metadata/);
});

test("checkpoint-only questions do not count as a visible coaching prompt", () => {
    assert.throws(() => checkActiveTurn(legacyResponse("No evidence has been supplied.")), /progress metadata/);
});

for (const [label, metadata] of [
    ["unfenced JSON", '{"next_question":"What happens next?"}'],
    ["collapsed JSON", '<details><summary>Progress</summary>{"library_id":"example"}</details>'],
    ["commented JSON", '<!-- {"current_mission_id":"example"} -->'],
    ["callback identifiers", `COMPLETED ${"a".repeat(64)} ${"b".repeat(32)}`],
]) {
    test(`normal replies reject ${label}`, () => {
        assert.throws(() => checkActiveTurn(`${metadata}\n\n${QUESTION}`));
    });
}

test("prose framing alone is not an actual question", () => {
    assert.throws(() => checkActiveTurn("We will start with your prediction."), /one visible question/);
});

for (const [label, hidden] of [
    ["code fence", `\`\`\`text\n${QUESTION}\n\`\`\``],
    ["tilde fence", `~~~text\n${QUESTION}\n~~~`],
    ["inline code", `\`${QUESTION}\``],
    ["HTML comment", `<!-- ${QUESTION} -->`],
    ["collapsed section", `<details><summary>Question</summary>${QUESTION}</details>`],
]) {
    test(`a question in a ${label} is not the visible next step`, () => {
        assert.throws(() => checkActiveTurn(`Let's make a prediction.\n\n${hidden}`), /one visible question/);
    });
}

test("multiple questions do not qualify as one conversational step", () => {
    assert.throws(() => checkActiveTurn(`${QUESTION} Where is the trust boundary?`), /one visible question/);
});

test("the question cannot be followed by more assignment text", () => {
    assert.throws(() => checkActiveTurn(`${QUESTION}\n\nNow prepare a six-row responsibility table.`), /final sentence/);
});

test("an assignment brief is rejected even without JSON", () => {
    assert.throws(() => checkActiveTurn(`**Expected evidence:** A diagram, a table, and three justifications.\n\n${QUESTION}`), /mission worksheet/);
});

test("an ordinary active turn cannot bury its question in a long reply", () => {
    assert.throws(() => checkActiveTurn(`${"Background detail. ".repeat(90)}\n\n${QUESTION}`), /180 words/);
});

test("generated ordinary coaching response is conversational and metadata-free", {
    skip: !process.env.COACHING_RESPONSE_ARTIFACT,
}, async () => {
    checkActiveTurn(await readFile(process.env.COACHING_RESPONSE_ARTIFACT, "utf8"));
});
