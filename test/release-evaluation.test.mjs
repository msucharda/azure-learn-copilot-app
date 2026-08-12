import assert from "node:assert/strict";
import {
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
    DEFAULT_CORPUS_PATH,
    runReleaseEvaluation,
} from "../evaluation/release-evaluation.mjs";

const PROJECT_ROOT = new URL("../", import.meta.url);

async function temporaryRoot(t) {
    const root = await mkdtemp(join(
        await realpath(tmpdir()),
        "learn-release-evaluation-",
    ));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

test("offline release corpus passes every deterministic production gate", async (t) => {
    const root = await temporaryRoot(t);
    const first = await runReleaseEvaluation({ workRoot: root });
    const second = await runReleaseEvaluation({ workRoot: root });
    assert.equal(first.passed, true);
    assert.equal(first.totals.failed, 0);
    assert.equal(first.coverage.missing.length, 0);
    assert.deepEqual(first, second);
    assert.deepEqual(await readdir(root), []);
    assert.equal(
        JSON.stringify(first).includes("Production Learn articles are substantially larger"),
        false,
    );
});

test("runner emits JSON report and uses a nonzero exit for a broken corpus", async (t) => {
    const root = await temporaryRoot(t);
    const broken = join(root, "broken.json");
    const report = join(root, "report.json");
    const corpus = JSON.parse(await readFile(DEFAULT_CORPUS_PATH, "utf8"));
    corpus.schemaVersion = 2;
    await writeFile(broken, JSON.stringify(corpus), "utf8");
    const result = spawnSync(process.execPath, [
        "scripts/run-release-evaluation.mjs",
        "--fixture",
        broken,
        "--report",
        report,
    ], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(await readFile(report, "utf8"));
    assert.equal(parsed.passed, false);
    assert.equal(parsed.fatal.code, "ERR_ASSERTION");
    assert.deepEqual(Object.keys(parsed.fatal), ["code"]);
});
