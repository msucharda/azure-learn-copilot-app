import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function plain(text) {
    return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

function checkActiveQuestion(response) {
    const blocks = [...response.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
    const checkpoints = blocks.map((block) => ({ block, value: JSON.parse(block[1]) }))
        .filter(({ value }) => Object.hasOwn(value, "next_question"));
    assert.equal(checkpoints.length, 1, "one progress checkpoint is required");
    const { block, value } = checkpoints[0];
    assert.equal(typeof value.next_question, "string", "an active turn needs a next question");
    assert.ok(value.next_question.trim().length > 0, "next question must not be blank");
    const visibleBeforeCheckpoint = response.slice(0, block.index)
        .replace(/```[\s\S]*?```/g, "");
    assert.ok(
        plain(visibleBeforeCheckpoint).includes(plain(value.next_question)),
        "the actual next question must appear in prose before the checkpoint, not only inside JSON",
    );
}

function response(prose, question = "Which evidence would you inspect first, and why?") {
    return `${prose}\n\n### Progress checkpoint\n\n\`\`\`json\n${JSON.stringify({
        library_id: "synthetic-fixture",
        next_question: question,
    }, null, 2)}\n\`\`\``;
}

test("active coaching displays its question before checkpoint metadata", () => {
    checkActiveQuestion(response("Which evidence would you inspect first, and why?"));
});

test("ordinary Markdown emphasis does not change the visible question", () => {
    checkActiveQuestion(response("Which **evidence** would you inspect first,\nand why?"));
});

test("checkpoint-only questions do not count as a visible coaching prompt", () => {
    assert.throws(() => checkActiveQuestion(response("No evidence has been supplied.")));
});

test("prose framing is not the checkpoint's actual question", () => {
    assert.throws(() => checkActiveQuestion(response("We will start with your prediction.")));
});

test("a different prose question cannot conceal a mismatched checkpoint", () => {
    assert.throws(() => checkActiveQuestion(response("Are you ready to continue?")));
});

test("a question in a different code block is not ordinary prose", () => {
    assert.throws(() => checkActiveQuestion(response("```text\nWhich evidence would you inspect first, and why?\n```")));
});

test("generated active coaching response has a visible matching question", {
    skip: !process.env.COACHING_RESPONSE_ARTIFACT,
}, async () => {
    checkActiveQuestion(await readFile(process.env.COACHING_RESPONSE_ARTIFACT, "utf8"));
});
