import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(await readFile(new URL("../prompts/prompt-library.schema.json", import.meta.url), "utf8"));

// This checks the schema vocabulary used here, not arbitrary third-party JSON Schemas.
function checkSchema(value, rule, path = "library") {
    if (rule.$ref) {
        assert.match(rule.$ref, /^#\/\$defs\/[^/]+$/);
        return checkSchema(value, schema.$defs[rule.$ref.split("/").at(-1)], path);
    }
    if (Object.hasOwn(rule, "const")) assert.deepEqual(value, rule.const, path);
    if (rule.enum) assert.ok(rule.enum.includes(value), `${path}: enum`);
    if (rule.type) {
        const types = Array.isArray(rule.type) ? rule.type : [rule.type];
        const matches = (type) => type === "null" ? value === null
            : type === "array" ? Array.isArray(value)
            : type === "integer" ? Number.isInteger(value)
            : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
            : typeof value === type;
        assert.ok(types.some(matches), `${path}: type`);
    }
    if (typeof value === "string") {
        if (rule.minLength !== undefined) assert.ok(value.length >= rule.minLength, `${path}: minLength`);
        if (rule.pattern) assert.match(value, new RegExp(rule.pattern), path);
        if (rule.format === "date-time") {
            assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, path);
            assert.ok(Number.isFinite(Date.parse(value)), `${path}: date-time`);
        }
    }
    if (typeof value === "number") {
        if (rule.minimum !== undefined) assert.ok(value >= rule.minimum, `${path}: minimum`);
        if (rule.maximum !== undefined) assert.ok(value <= rule.maximum, `${path}: maximum`);
    }
    if (Array.isArray(value)) {
        if (rule.minItems !== undefined) assert.ok(value.length >= rule.minItems, `${path}: minItems`);
        if (rule.maxItems !== undefined) assert.ok(value.length <= rule.maxItems, `${path}: maxItems`);
        if (rule.uniqueItems) assert.equal(new Set(value.map((item) => JSON.stringify(item))).size, value.length, `${path}: uniqueItems`);
        if (rule.items) value.forEach((item, index) => checkSchema(item, rule.items, `${path}[${index}]`));
    } else if (value !== null && typeof value === "object") {
        for (const key of rule.required ?? []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`);
        for (const [key, item] of Object.entries(value)) {
            if (rule.propertyNames) checkSchema(key, rule.propertyNames, `${path}: property name`);
            const child = rule.properties?.[key];
            if (child) checkSchema(item, child, `${path}.${key}`);
            else if (rule.additionalProperties === false) assert.fail(`${path}.${key}: additional property`);
            else if (typeof rule.additionalProperties === "object") checkSchema(item, rule.additionalProperties, `${path}.${key}`);
        }
    }
}

function checkLibrary(library) {
    checkSchema(library, schema);
    for (const collection of [library.missions, library.sources]) {
        assert.equal(new Set(collection.map((item) => item.id)).size, collection.length, "unique IDs");
    }
    assert.equal(new Set(library.sources.map((source) => source.url)).size, library.sources.length, "unique source URLs");
    const sourceIds = new Set(library.sources.map((source) => source.id));
    const usedSources = new Set();
    for (const source of library.sources) {
        const url = new URL(source.url);
        assert.equal(url.protocol, "https:");
        assert.equal(url.hostname, "learn.microsoft.com");
        assert.equal(url.username + url.password + url.port, "");
    }
    for (const mission of library.missions) {
        assert.ok(mission.estimated_minutes <= library.learner.session_minutes, "mission duration");
        if (library.learner.practice_mode === "conceptual") assert.equal(mission.kind, "conceptual");
        for (const id of mission.source_ids) {
            assert.ok(sourceIds.has(id), `unknown source: ${id}`);
            usedSources.add(id);
        }
        for (const match of JSON.stringify(mission).matchAll(/\{\{([^{}]+)\}\}/g)) {
            assert.ok(Object.hasOwn(library.variables, match[1]), `unknown variable: ${match[1]}`);
        }
    }
    assert.deepEqual(usedSources, sourceIds, "unused sources");
}

function fixture() {
    return {
        schema_version: 2,
        library_id: "synthetic-discovery",
        title: "Synthetic contract fixture",
        topic: "Synthetic topic",
        description: "Shape only; not fetched product evidence or a published library.",
        refinement: {
            original_request: "I want to learn a Microsoft topic.",
            selected_interpretation: "Conceptual self-discovery",
            objective: "Explain a topic from evidence.",
            in_scope: ["Orientation", "Evidence", "Reflection"],
            assumptions: ["Beginner", "No live resources"],
            exclusions: ["Deployment"],
            unresolved: [],
        },
        learner: {
            experience: "beginner",
            goal: "Explain a topic from evidence.",
            session_minutes: 30,
            practice_mode: "conceptual",
            prerequisites: [],
        },
        variables: { example_name: { description: "Synthetic label", value: null } },
        guardrails: ["Do not execute commands or inspect live resources."],
        sources: [{
            id: "fixture-source",
            title: "Synthetic source metadata",
            url: "https://learn.microsoft.com/en-us/test-fixture",
            supports: ["Validator fixture, not a verified factual claim"],
            retrieved_at: null,
        }],
        missions: ["orient", "inspect", "reflect"].map((id) => ({
            id,
            title: `Synthetic ${id}`,
            objective: "Explain how evidence tests a prediction.",
            kind: "conceptual",
            estimated_minutes: 20,
            prompt: "Ask me to predict the evidence for {{example_name}}.",
            hints: ["What would you expect?", "What would falsify that expectation?"],
            evidence_required: ["A prediction and explanation"],
            exit_criteria: "The learner distinguishes evidence from inference.",
            source_ids: ["fixture-source"],
        })),
    };
}

test("v2 library supports conceptual and sandbox profiles without a fixed product", () => {
    const library = fixture();
    checkLibrary(library);
    library.learner.practice_mode = "sandbox";
    library.missions[1].kind = "hands-on";
    library.variables.example_name.value = "owned-disposable-example";
    checkLibrary(library);
});

const invalidCases = [
    ["legacy version", (library) => { library.schema_version = 1; }],
    ["missing field", (library) => { delete library.refinement; }],
    ["extra privileges", (library) => { library.tools = ["shell"]; }],
    ["too few missions", (library) => { library.missions.pop(); }],
    ["too many missions", (library) => { library.missions = Array.from({ length: 13 }, (_, i) => ({ ...library.missions[0], id: `mission-${i}` })); }],
    ["duplicate mission", (library) => { library.missions[1].id = library.missions[0].id; }],
    ["unknown source", (library) => { library.missions[0].source_ids = ["missing"]; }],
    ["unused source", (library) => { library.sources.push({ ...library.sources[0], id: "unused", url: "https://learn.microsoft.com/en-us/unused" }); }],
    ["duplicate source", (library) => { library.sources.push({ ...library.sources[0] }); }],
    ["too many sources", (library) => { library.sources = Array.from({ length: 16 }, () => library.sources[0]); }],
    ["spoofed host", (library) => { library.sources[0].url = "https://learn.microsoft.com.example.org/topic"; }],
    ["non-HTTPS URL", (library) => { library.sources[0].url = "http://learn.microsoft.com/topic"; }],
    ["invalid timestamp", (library) => { library.sources[0].retrieved_at = "recently"; }],
    ["blank objective", (library) => { library.missions[0].objective = " "; }],
    ["undeclared variable", (library) => { library.missions[0].prompt = "Inspect {{unknown}}."; }],
    ["invalid variable name", (library) => { library.variables["shell-command"] = { description: "Invalid name", value: null }; }],
    ["conceptual deployment", (library) => { library.missions[0].kind = "hands-on"; }],
    ["overlong mission", (library) => { library.missions[0].estimated_minutes = 31; }],
    ["missing evidence", (library) => { library.missions[0].evidence_required = []; }],
];

for (const [name, mutate] of invalidCases) {
    test(`v2 library rejects ${name}`, () => {
        const library = fixture();
        mutate(library);
        assert.throws(() => checkLibrary(library));
    });
}

test("generated session artifact satisfies the same contract", {
    skip: !process.env.PROMPT_LIBRARY_ARTIFACT,
}, async () => {
    const library = JSON.parse(await readFile(process.env.PROMPT_LIBRARY_ARTIFACT, "utf8"));
    checkLibrary(library);
});
