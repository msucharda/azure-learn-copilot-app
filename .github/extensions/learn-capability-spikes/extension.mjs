import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
import {
    appendBoundedRecord,
    isLearnTool,
    normalizeEvidenceRecord,
    sha256,
    summarizeFailedHook,
    summarizeSuccessfulHook,
} from "./contracts.mjs";

const servers = new Map();
const evidence = [];
const skillInvocations = [];
let session;

function renderHtml(instanceId) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Learn capability spikes</title>
    <style>
      body { margin: 0; padding: 1rem; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px) var(--font-sans, system-ui); }
      main { max-width: 42rem; }
      textarea, input { box-sizing: border-box; width: 100%; margin: .25rem 0 .75rem; padding: .5rem; color: inherit; background: inherit; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; }
      button { padding: .5rem .75rem; font: inherit; font-weight: var(--font-weight-semibold, 600); }
      #status { color: var(--text-color-muted, #656d76); }
    </style>
  </head>
  <body>
    <main>
      <h1>Learn capability spikes</h1>
      <p>This diagnostic canvas exposes hook and custom-agent capability probes. Research drafts are reviewed as Markdown files and published from chat.</p>
      <p>Instance: <code>${instanceId}</code></p>
    </main>
  </body>
</html>`;
}

function sendJson(res, statusCode, value) {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
}

async function startServer(instanceId) {
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(renderHtml(instanceId));
                return;
            }
            if (req.method === "GET" && url.pathname === "/health") {
                sendJson(res, 200, { ok: true, instanceId });
                return;
            }
            sendJson(res, 404, { error: "not found" });
        } catch (error) {
            sendJson(res, 400, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

function matchingAgent(agents) {
    return agents.find((agent) => agent.name === "learn-researcher");
}

function bundledRuntimePath() {
    const bootstrap = process.argv.find((arg) => arg.endsWith("extension_bootstrap.mjs"));
    if (!bootstrap) {
        throw new CanvasError("runtime_unavailable", "The bundled Copilot runtime path was not visible to the extension");
    }
    return join(dirname(dirname(bootstrap)), "index.js");
}

function nodeExecutablePath() {
    for (const directory of (process.env.PATH ?? "").split(":")) {
        const candidate = join(directory, "node");
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        } catch {
            continue;
        }
    }
    throw new CanvasError("node_unavailable", "Node.js was not found on PATH");
}

async function runResearcherProbe() {
    const client = new CopilotClient({
        mode: "copilot-cli",
        connection: RuntimeConnection.forStdio({
            path: nodeExecutablePath(),
            args: [bundledRuntimePath()],
        }),
        logLevel: "error",
    });
    let nested;
    try {
        nested = await client.createSession({
            workingDirectory: process.cwd(),
            enableConfigDiscovery: true,
            enableSkills: true,
            pluginDirectories: [
                join(
                    process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
                    "installed-plugins",
                    "microsoft-agent-skills",
                    "azure-agent-skills",
                ),
            ],
            mcpServers: {
                "microsoft-learn": {
                    type: "http",
                    url: "https://learn.microsoft.com/api/mcp",
                    tools: ["*"],
                },
            },
            agent: "learn-researcher",
            onPermissionRequest: async () => ({
                kind: "reject",
                feedback: "The capability probe is read-only.",
            }),
        });

        const observed = {
            tools: [],
            skills: [],
        };
        nested.on("tool.execution_start", (event) => {
            observed.tools.push(event.data.toolName);
        });
        nested.on("skill.invoked", (event) => {
            observed.skills.push({
                name: event.data.name,
                pluginName: event.data.pluginName,
                pluginVersion: event.data.pluginVersion,
                source: event.data.source,
                trigger: event.data.trigger,
            });
        });

        const agents = await nested.rpc.agent.list();
        const agent = matchingAgent(agents.agents ?? []);
        if (!agent) {
            throw new CanvasError("researcher_unavailable", "learn-researcher was not discovered in the nested session");
        }

        const response = await nested.sendAndWait([
            "Run a read-only capability probe.",
            "Invoke the installed microsoft-foundry skill using the runtime skill mechanism.",
            "Do not fetch a full page or modify files.",
            "Return concise JSON with the skill invocation tool name if visible, plugin name/version, metadata.generated_at, and relevant Learn MCP tool names.",
        ].join(" "), 120_000);
        const result = response?.data.content ?? "";
        const invoked = await nested.rpc.skills.getInvoked();

        return {
            agent: {
                name: agent.name,
                tools: agent.tools ?? null,
                source: agent.source,
            },
            task: {
                status: response ? "completed" : "no-response",
                resultLength: result.length,
                resultSha256: sha256(result),
                resultPreview: result.slice(0, 1_200),
            },
            observed: {
                toolNames: [...new Set(observed.tools)],
                skillInvocations: observed.skills,
                invokedSkillNames: (invoked.skills ?? []).map((item) => item.name),
            },
        };
    } finally {
        if (nested) {
            const nestedId = nested.sessionId;
            await nested.disconnect();
            await client.deleteSession(nestedId);
        }
        await client.stop();
    }
}

session = await joinSession({
    tools: [
        {
            name: "record_learn_evidence",
            description: "Record bounded, hashed Microsoft Learn evidence when hook capture is unavailable",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    toolName: { type: "string", minLength: 1, maxLength: 160 },
                    argsSummary: { type: "string", minLength: 1, maxLength: 500 },
                    resultSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
                    resultCount: { type: "integer", minimum: 0, maximum: 100 },
                    sources: {
                        type: "array",
                        maxItems: 5,
                        items: { type: "string", format: "uri" },
                    },
                },
                required: ["toolName", "argsSummary", "resultSha256", "resultCount"],
            },
            handler: async (input) => {
                const record = normalizeEvidenceRecord(input);
                appendBoundedRecord(evidence, record);
                return {
                    textResultForLlm: JSON.stringify({
                        recorded: true,
                        evidenceSha256: sha256(JSON.stringify(record)),
                    }),
                    resultType: "success",
                };
            },
        },
    ],
    hooks: {
        onPostToolUse: async (input) => {
            if (isLearnTool(input.toolName)) {
                appendBoundedRecord(evidence, summarizeSuccessfulHook(input));
            }
        },
        onPostToolUseFailure: async (input) => {
            if (isLearnTool(input.toolName)) {
                appendBoundedRecord(evidence, summarizeFailedHook(input));
            }
        },
    },
    canvases: [
        createCanvas({
            id: "learn-capability-spikes",
            displayName: "Learn capability spikes",
            description: "Inspect bounded Learn evidence and queue validated research drafts.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    topic: { type: "string", minLength: 1, maxLength: 120 },
                },
                required: ["topic"],
            },
            actions: [
                {
                    name: "capture_summary",
                    description: "Return bounded evidence captured by Learn tool hooks",
                    handler: async () => ({
                        count: evidence.length,
                        records: evidence,
                    }),
                },
                {
                    name: "runtime_contracts",
                    description: "Reload and summarize project skills and custom agents",
                    handler: async () => {
                        const skillDiagnostics = await session.rpc.skills.reload();
                        const skills = await session.rpc.skills.list();
                        const agents = await session.rpc.agent.reload();
                        return {
                            skillDiagnostics,
                            projectSkills: (skills.skills ?? [])
                                .filter((item) => item.source === "project")
                                .map((item) => ({
                                    name: item.name,
                                    enabled: item.enabled,
                                    source: item.source,
                                })),
                            projectAgents: (agents.agents ?? [])
                                .filter((item) => item.source === "project")
                                .map((item) => ({
                                    name: item.name,
                                    tools: item.tools ?? null,
                                    source: item.source,
                                })),
                        };
                    },
                },
                {
                    name: "close_probe",
                    description: "Close this diagnostic canvas and release its loopback server",
                    handler: async (ctx) => {
                        setTimeout(() => {
                            void session.rpc.canvas.close({ instanceId: ctx.instanceId });
                        }, 0);
                        return { closing: true, instanceId: ctx.instanceId };
                    },
                },
                {
                    name: "run_researcher_probe",
                    description: "Run the read-only custom researcher against an installed Azure Agent Skill",
                    handler: runResearcherProbe,
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: `Learn spike: ${ctx.input.topic}`,
                    status: "Ready",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});

session.on("skill.invoked", (event) => {
    skillInvocations.push({
        agentId: event.agentId,
        name: event.data.name,
        pluginName: event.data.pluginName,
        pluginVersion: event.data.pluginVersion,
        source: event.data.source,
        trigger: event.data.trigger,
    });
});
