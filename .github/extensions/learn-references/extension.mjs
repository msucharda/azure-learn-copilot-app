import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
import {
    DraftEvidenceStore,
    PublishedEvidenceStore,
    resolveLearnReferenceStorageRoots,
} from "./lib/storage.mjs";
import {
    LearnMcpAdapter,
    resolveLearnMcpAdapterOptions,
} from "./lib/learn-mcp-adapter.mjs";
import {
    LearnMcpHttpTransport,
    resolveLearnMcpHttpOptions,
} from "./lib/learn-mcp-http.mjs";
import { createLearnReferenceTools } from "./lib/tools.mjs";
import {
    LocalTelemetryError,
    createLocalTelemetryFromEnv,
} from "./lib/local-telemetry.mjs";
import { createLearnReferencesCanvas } from "./lib/canvas-provider.mjs";
import { join } from "node:path";

const roots = resolveLearnReferenceStorageRoots();
let telemetry;
try {
    telemetry = await createLocalTelemetryFromEnv({
        defaultRoot: join(roots.draftRoot, "telemetry"),
    });
} catch (error) {
    if (!(error instanceof LocalTelemetryError)) {
        throw error;
    }
    console.error(
        `[learn-references] local telemetry initialization failed (${error.code}); telemetry disabled`,
    );
}
const [draftStore, publishedStore] = await Promise.all([
    DraftEvidenceStore.create({ root: roots.draftRoot }),
    PublishedEvidenceStore.create({ root: roots.publishedRoot }),
]);
async function recordRetryTelemetry(event) {
    if (!telemetry) {
        return;
    }
    try {
        await telemetry.record({
            operation: "learn_mcp_request",
            outcome: "failure",
            durationMs: event.delayMs,
            retryCount: event.attempt,
            cacheStatus: "bypass",
            errorKind: "adapter",
        });
    } catch (error) {
        console.error(
            `[learn-references] local retry telemetry write failed (${error?.code ?? "UNKNOWN_TELEMETRY_FAILURE"})`,
        );
    }
}
const transport = new LearnMcpHttpTransport({
    ...resolveLearnMcpHttpOptions(),
    onRetry: recordRetryTelemetry,
});
const adapter = new LearnMcpAdapter({
    listTools: () => transport.listTools(),
    callTool: (name, args) => transport.callTool(name, args),
    ...resolveLearnMcpAdapterOptions(),
});
let adapterReady;
const learnAdapter = {
    async execute(operation, args) {
        if (!adapterReady) {
            const attempt = (async () => {
                await transport.connect();
                await adapter.connect();
            })();
            adapterReady = attempt;
            try {
                await attempt;
            } catch (error) {
                if (adapterReady === attempt) {
                    adapterReady = undefined;
                }
                throw error;
            }
        } else {
            await adapterReady;
        }
        return adapter.execute(operation, args);
    },
};

const referencesCanvas = createLearnReferencesCanvas({
    CanvasError,
    createCanvas,
    draftStore,
    publishedStore,
});

await joinSession({
    tools: createLearnReferenceTools({
        draftStore,
        publishedStore,
        learnAdapter,
        telemetry,
    }),
    canvases: [referencesCanvas.canvas],
});
