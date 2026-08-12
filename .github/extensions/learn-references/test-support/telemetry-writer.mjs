import {
    LocalStructuredTelemetry,
    opaqueTelemetryHash,
} from "../lib/local-telemetry.mjs";

const [root, countText, maxFileBytesText, maxFilesText, sentinel] = process.argv.slice(2);
const telemetry = await LocalStructuredTelemetry.create({
    root,
    maxFileBytes: Number(maxFileBytesText),
    maxFiles: Number(maxFilesText),
});
await Promise.all(Array.from({ length: Number(countText) }, () => telemetry.record({
    operation: "prepare_learn_research",
    outcome: "success",
    durationMs: 1,
    researchIdHash: opaqueTelemetryHash(sentinel),
})));
