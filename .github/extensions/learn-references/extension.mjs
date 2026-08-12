import { joinSession } from "@github/copilot-sdk/extension";
import {
    DraftEvidenceStore,
    PublishedEvidenceStore,
    resolveLearnReferenceStorageRoots,
} from "./lib/storage.mjs";
import { LearnMcpAdapter } from "./lib/learn-mcp-adapter.mjs";
import { LearnMcpHttpTransport } from "./lib/learn-mcp-http.mjs";
import { createLearnReferenceTools } from "./lib/tools.mjs";

const roots = resolveLearnReferenceStorageRoots();
const [draftStore, publishedStore] = await Promise.all([
    DraftEvidenceStore.create({ root: roots.draftRoot }),
    PublishedEvidenceStore.create({ root: roots.publishedRoot }),
]);
const transport = new LearnMcpHttpTransport({
    endpoint: process.env.COPILOT_LEARN_MCP_ENDPOINT,
});
const adapter = new LearnMcpAdapter({
    listTools: () => transport.listTools(),
    callTool: (name, args) => transport.callTool(name, args),
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

await joinSession({
    tools: createLearnReferenceTools({
        draftStore,
        publishedStore,
        learnAdapter,
    }),
});
