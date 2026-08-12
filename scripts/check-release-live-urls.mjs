#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const live = process.argv.includes("--live");
if (!live) {
    process.stdout.write(`${JSON.stringify({
        status: "SKIP",
        reason: "live checks require the explicit --live flag",
    })}\n`);
    process.exit(0);
}

const corpus = JSON.parse(await readFile(
    new URL("../evaluation/release-corpus.json", import.meta.url),
    "utf8",
));
const urls = [...new Set([
    ...corpus.searchCases.flatMap((entry) => entry.results.map((result) => result.url)),
    ...corpus.safeLinks,
])];
if (urls.length > 10) {
    throw new Error("Live citation check is limited to 10 URLs");
}

const results = [];
for (const value of urls) {
    const url = new URL(value);
    if (
        url.protocol !== "https:"
        || url.hostname !== "learn.microsoft.com"
        || url.username
        || url.password
        || url.port
    ) {
        results.push({ url: value, status: "FAIL", code: "UNSAFE_URL" });
        continue;
    }
    try {
        const response = await fetch(url, {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(5_000),
            headers: { range: "bytes=0-0" },
        });
        await response.body?.cancel();
        results.push({
            url: value,
            status: response.ok ? "PASS" : "FAIL",
            code: `HTTP_${response.status}`,
        });
    } catch (error) {
        results.push({
            url: value,
            status: "FAIL",
            code: error?.name ?? "NETWORK_FAILURE",
        });
    }
}

const status = results.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
process.stdout.write(`${JSON.stringify({ status, checked: results.length, results }, null, 2)}\n`);
process.exitCode = status === "PASS" ? 0 : 1;
