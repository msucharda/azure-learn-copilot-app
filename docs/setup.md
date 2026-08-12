# Learn research setup

## Prerequisites

Install the official `azure-agent-skills` plugin outside this repository. The app never vendors,
copies, or modifies official skills. Record the skill name, plugin name/version, and generation
time only when the runtime exposes them; absent provenance stays absent and metadata older than
three calendar months is treated as stale.

The runtime connects to `https://learn.microsoft.com/api/mcp`. It discovers tool names and schemas
dynamically and maps them to documentation search, documentation fetch, and code-sample search.
No fixed wrapper name or committed `.github/mcp.json` is required because this app runtime already
supplies the MCP endpoint. Deployments that own MCP configuration may inject the same exact
endpoint externally.

## Configuration

| Variable | Default | Bound or purpose |
| --- | --- | --- |
| `COPILOT_LEARN_DRAFT_ROOT` | workspace-keyed Copilot home path | Draft bundles and fetched Markdown captures |
| `COPILOT_LEARN_PUBLISHED_ROOT` | shared Copilot home path | Bounded published excerpts, hashes, handoffs, and acknowledgements |
| `COPILOT_LEARN_MCP_ENDPOINT` | `https://learn.microsoft.com/api/mcp` | HTTPS exact `learn.microsoft.com` host only |
| `COPILOT_LEARN_TIMEOUT_MS` | `30000` | 1,000 through 120,000 milliseconds per attempt |
| `COPILOT_LEARN_RETRY_MAX_ATTEMPTS` | `3` | 1 through 5 attempts |
| `COPILOT_LEARN_RETRY_BASE_DELAY_MS` | `100` | Up to 5,000 milliseconds |
| `COPILOT_LEARN_RETRY_MAX_DELAY_MS` | `1000` | Up to 5,000 milliseconds |
| `COPILOT_LEARN_RETRY_MAX_TOTAL_DELAY_MS` | `2000` | Up to 10,000 milliseconds |
| `COPILOT_LEARN_RETRY_MAX_RETRY_AFTER_MS` | `2000` | Up to 10,000 milliseconds |
| `COPILOT_LEARN_RETRY_JITTER_RATIO` | `0.25` | 0 through 0.5; inject zero in deterministic tests |
| `COPILOT_LEARN_METADATA_CACHE_TTL_MS` | `300000` | 1,000 through 3,600,000 milliseconds; validated tool schemas only |
| `COPILOT_LEARN_REFERENCES_TELEMETRY` | disabled | Set to `1` to enable local structured telemetry |
| `COPILOT_LEARN_REFERENCES_TELEMETRY_ROOT` | Copilot home telemetry path | Local telemetry root; must not be a symlink |

Invalid or excessive values fail startup. Full fetched pages are never persisted in the published
store, telemetry, benchmark reports, handoffs, or acknowledgements.

## Workflows

For a quick question, use **Refine here** in the current chat. Side Chat is user-initiated because
the host does not expose a programmatic Quick Chat creation API; manually confirm the required
project skills and tools are present.

For deep research, start `start-learn-research`, create the coordinated child with the returned
kickoff, and keep draft evidence and the draft canvas in that child. Publication requires a
separate explicit **publish** turn. The child sends only the bounded published handoff. If session
messaging is unavailable, copy the same envelope manually. The parent verifies stored publication,
acknowledges the handoff, and only then opens the published canvas.

The draft canvas may reflect workspace captures containing fetched Markdown. The published canvas
contains only bounded excerpts and hashes.
