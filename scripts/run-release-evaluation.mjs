#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
    DEFAULT_CORPUS_PATH,
    runReleaseEvaluation,
} from "../evaluation/release-evaluation.mjs";

function option(name, fallback) {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
}

const corpusPath = resolve(option("--fixture", DEFAULT_CORPUS_PATH));
const reportOption = option("--report");
const reportPath = reportOption ? resolve(reportOption) : undefined;

async function writeReport(serialized) {
    if (!reportPath) {
        return;
    }
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, serialized, "utf8");
}

try {
    const report = await runReleaseEvaluation({ corpusPath });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    await writeReport(serialized);
    process.stdout.write(serialized);
    process.exitCode = report.passed ? 0 : 1;
} catch (error) {
    const report = {
        schemaVersion: 1,
        passed: false,
        fatal: {
            code: error?.code ?? error?.name ?? "ERROR",
        },
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    await writeReport(serialized);
    process.stdout.write(serialized);
    process.exitCode = 2;
}
