# Capability spikes for the Learn research system

Status: experimental foundation only. This document records PR 0 observations; it does not define the full product.

## Outcome matrix

| Spike | Outcome | Production conclusion |
| --- | --- | --- |
| 0.1 Installed skills in a custom researcher | **PASS** | A project custom agent can invoke an installed plugin skill in an isolated SDK-created session. |
| 0.2 Learn MCP namespace and schemas | **PASS** | Use dynamic discovery against the official endpoint; do not compile against assumed schemas or the skill's legacy namespace spelling. |
| 0.3 Extension hook result capture | **PARTIAL** | Success hooks expose the required pre-paraphrase fields. A genuine Learn MCP failure hook was not produced because invalid fetch input returned a successful text result. |
| 0.4 Child-to-parent handoff | **PASS** | App-native immediate session messaging completed a nonce round trip. |
| 0.5 Publish UX and canvas-to-turn | **PARTIAL** | Canvas discovery and loopback behavior work, but publish moved to a chat skill and Markdown editor canvas by product decision. The iframe-to-`session.send` path was not retained. |
| 0.6 Side Chat / Quick Chat | **PARTIAL** | No programmatic Quick Chat creation API or existing Quick Chat was available. Quick and deep research remain equivalent entry modes with different power. |

## Spike 0.1: Official skills inside a custom researcher

### Hypothesis

A repository custom agent running in a nested session can discover and invoke the already-installed `azure-agent-skills` plugin without copying or modifying it.

### Setup

- Retained `.github/agents/learn-researcher.agent.md`.
- Started a nested session through the bundled Copilot SDK with project config discovery enabled.
- Passed the installed plugin directory as a read-only external plugin directory.
- Selected `learn-researcher` and configured its allow-list as `skill`, `read`, and `microsoft-learn/*`.
- Denied permission requests so the probe could not mutate files or external state.
- Used the default model/context behavior; no long-context override was set.

### Observed behavior

- The nested runtime discovered `learn-researcher` from the project with its exact tool allow-list.
- The agent invoked the tool named `skill` with the skill argument `microsoft-foundry`.
- Runtime events identified the source as `plugin`, plugin name `azure-agent-skills`, version `1.0.0`, and trigger `agent-invoked`.
- The agent then attempted the runtime tool `view`; the explicit permission handler blocked it. The allow-list controls visibility, while the permission handler remains an independent enforcement layer.
- The injected skill context named the three available Learn tools but did not expose the skill frontmatter or plugin version. Direct read-only inspection by the parent found `metadata.generated_at: "2026-08-09"` in the installed `SKILL.md`.
- The separately installed shell `copilot` executable was version `0.0.340` and did not support `--agent`. The bundled app SDK runtime did support the custom-agent session.

### Concrete evidence

- Nested response SHA-256: `0860271487304243ec96a26d1fa567c9df9906c11de9cf85eac613e34475481c`.
- Observed tool events: `skill`, then `view`.
- Observed invoked skill: `microsoft-foundry`.
- Installed plugin manifest: name `azure-agent-skills`, version `1.0.0`.

### Status

**PASS**

### Decision

Build the deep-research worker as a custom agent with a narrow tool allow-list. Treat skill invocation events, not model prose, as authoritative evidence that a skill loaded. Treat `metadata.generated_at` as local skill metadata that may not appear in injected context.

### Fallback

If dynamic skill discovery or invocation is unavailable, the parent selects the skill and passes bounded context in kickoff:

```text
[SELECTED_SKILL_CONTEXT]
skill: microsoft-foundry
plugin: azure-agent-skills
pluginVersion: 1.0.0
generatedAt: 2026-08-09
scope: <specific category and relevant links only>
```

## Spike 0.2: Learn MCP namespace and dynamic schemas

### Hypothesis

The official endpoint supports MCP initialization, runtime tool discovery, and the three required documentation operations without a package dependency.

### Setup

- Connected directly to `https://learn.microsoft.com/api/mcp` with Streamable HTTP.
- Initialized protocol version `2025-06-18`.
- Called `tools/list`, then each discovered tool with bounded queries.
- Also exercised the tools exposed by the current app runtime.
- Did not commit an MCP config because the current runtime already provided the server.

### Observed behavior

- Server identity: `Microsoft Learn MCP Server` version `1.0.0`.
- Raw tool names:
  - `microsoft_docs_search`
  - `microsoft_code_sample_search`
  - `microsoft_docs_fetch`
- Current app wrapper names:
  - `microsoft-learn-microsoft_docs_search`
  - `microsoft-learn-microsoft_code_sample_search`
  - `microsoft-learn-microsoft_docs_fetch`
- Installed skills refer to `mcp_microsoftdocs:microsoft_docs_fetch`. That is a logical/legacy namespace and maps to the runtime's Microsoft Learn server plus `microsoft_docs_fetch`; it is not the callable name in this app.
- Search and code-sample calls returned both `content` text blocks and `structuredContent.results`.
- Fetch returned a `content` text block without `structuredContent`.
- An unknown tool returned JSON-RPC error code `-32602`.
- The server advertised `listChanged: true` for tools, prompts, and resources. No list-change notification occurred during the bounded test window.
- Invalid Microsoft page URLs were returned as successful text results rather than protocol/tool failures.

### Concrete evidence

| Call | Result shape | Count | SHA-256 of structured result or content |
| --- | --- | ---: | --- |
| `microsoft_docs_search` | `content` + `structuredContent.results` | 10 | `76e4a2d148fe50464ee96d43b720b696848df331625ec4b96792f2f99b3f9ef2` |
| `microsoft_docs_fetch` | `content` | N/A | `975ae7a7c2364de00be62ea1ef58a6d0d206f1cf50acd233f541f678df7e941d` |
| `microsoft_code_sample_search` | `content` + `structuredContent.results` | 10 | `d290866951037bddc163e4bbe6e4977e74885aa7be8665bdd99241c54d6e7463` |

The dynamic schemas included `inputSchema`, optional `outputSchema`, titles, descriptions, and read-only/idempotent annotations.

### Status

**PASS**

### Decision

Discover the tools and schemas on every MCP connection. Production configuration may use this confirmed SDK shape, while still treating names and schemas as dynamic:

```js
{
  "microsoft-learn": {
    "type": "http",
    "url": "https://learn.microsoft.com/api/mcp",
    "tools": ["*"]
  }
}
```

### Fallback

If MCP initialization fails, use the installed skill's bounded link index and parent-selected context. Do not silently substitute unverified web content.

## Spike 0.3: MCP result capture from extension hooks

### Hypothesis

`onPostToolUse` and `onPostToolUseFailure` can capture evidence before model paraphrasing without persisting full Learn pages.

### Setup

- Scaffolded the project extension through the bundled extension workflow.
- Registered success and failure hooks.
- Filtered capture to Learn tool names.
- Stored only bounded argument summaries, shape metadata, counts, and SHA-256 digests in memory.
- Added and invoked the `record_learn_evidence` fallback tool.

### Observed behavior

- Successful Learn calls exposed `toolName`, `toolArgs`, and a `ToolResultObject` before paraphrasing.
- Search and code-sample hook inputs contained a `structuredContent` property. Fetch did not.
- Hook result keys included `textResultForLlm`, `contents`, `resultType`, telemetry fields, and `structuredContent` when supplied by the MCP tool.
- Large app tool output changed `textResultForLlm` into a bounded spool notice, while `structuredContent` remained visible to the hook. Evidence must therefore hash structured content directly when present.
- Invalid fetch URLs produced `resultType: "success"` with explanatory text, so they did not invoke `onPostToolUseFailure`.
- SDK types confirm the failure hook receives `toolName`, `toolArgs`, and only a stringified `error`, not the full result object. A genuine Learn MCP failure could not be induced safely through the configured wrapper.
- The fallback tool accepted a 64-character digest, result count, bounded args summary, and up to five Microsoft Learn source URLs. Invalid digests, counts, or non-Learn URLs fail validation.

### Concrete evidence

- The live fallback record produced evidence digest `55ac7ad3d6a7d85f443a44ca10679e2f43965bc4c5c0b6f9677c0e3db6e731d0`.
- Live success hooks observed `structuredContent` for search and code-sample search and no `structuredContent` for fetch.
- Unit fixtures verify the bounded capture contract and 20-record in-memory limit.

### Status

**PARTIAL**

### Decision

Use the success hook for automatic capture. Store hashes/counts and approved source metadata, never full pages. Keep `record_learn_evidence` as the explicit fallback. Treat the extension hook and canvas APIs as experimental SDK contracts.

Production compatibility update: the retained diagnostic extension now exposes `record_learn_spike_evidence` to avoid colliding with the production `learn-references` extension. The production extension owns `record_learn_evidence`; the observations and original fallback shape below remain the historical PR 0 result.

### Fallback

Call:

```text
record_learn_evidence(
  toolName,
  argsSummary,
  resultSha256,
  resultCount,
  sources[]
)
```

For failure evidence, record the protocol error code/message hash at the MCP adapter boundary because the wrapper may convert domain errors into successful text.

## Spike 0.4: Child-to-parent handoff

### Hypothesis

A coordinated child can send an immediate, tagged message to its parent and receive acknowledgement without polling.

### Setup

- Sent an immediate app-native message containing a unique nonce, the child identity, and an acknowledgement request.
- Continued other work without blocking.

### Observed behavior

- The session messaging tool was available under the active tool restrictions.
- Immediate delivery succeeded.
- The parent returned the same nonce in an acknowledgement.

### Concrete evidence

Round trip:

```text
[CAPABILITY-SPIKE-HANDOFF-PROBE] nonce=<unique-nonce>
[CAPABILITY-SPIKE-HANDOFF-ACK] nonce=<same-unique-nonce>
```

No live session identifiers are retained in repository content.

### Status

**PASS**

### Decision

Use immediate app-native messaging for bounded worker results and publish acknowledgements. Include `researchId`, worker identity, evidence version, and nonce.

### Fallback

```text
[RESEARCH_HANDOFF]
researchId: <stable-id>
sender: <worker-name>
nonce: <unique-nonce>
evidenceVersion: 1
status: PASS|PARTIAL|FAIL
summary: <bounded-summary>
```

## Spike 0.5: Publish from Markdown review

### Hypothesis

The original hypothesis was that a loopback canvas Publish button could call `session.send(...)` and enqueue a validated agent turn.

### Setup

- Scaffolded and validated a loopback-only project canvas.
- Read the bundled SDK lifecycle, canvas, hook, and `session.send` contracts.
- Initially built the button/POST path, then removed it after product review favored a chat skill and file-backed Markdown editor.
- Added `.github/skills/publish-research-draft/SKILL.md`.

### Observed behavior

- Canvas discovery, open, action invocation, schema rejection, reserved action rejection, reload, and loopback health all worked.
- The bundled SDK exposes `session.send(...)`, but the iframe POST path was not executed before the UX was superseded and removed.
- Runtime skill reload discovered `publish-research-draft` as an enabled project skill with no diagnostics.
- The current turn's generated skill picker remained cached and could not invoke the newly added skill. A new turn/session is required to test the exact `"publish"` utterance.
- The editor canvas supports opening an existing repository Markdown file directly; this report is the retained review surface.

### Concrete evidence

- Valid canvas ID: `learn-capability-spikes`.
- Invalid empty `topic` failed before `open`.
- Reserved action `canvas.open` was rejected.
- `close_probe` closed the canvas and its loopback health endpoint became unreachable, confirming `onClose` cleanup.
- Project skill reload returned zero warnings and zero errors.
- The old publish button and route are absent from retained code.

### Status

**PARTIAL**

### Decision

Review the draft as a repository Markdown file in the editor canvas. The user says **publish** in chat; `publish-research-draft` validates the file and performs the parent handoff. Do not make publish an iframe control.

### Fallback

If the project skill is unavailable in the active turn, use:

```text
Use the publish-research-draft workflow to validate and publish docs/spikes/000-capability-spikes.md.
```

If skill reload is unavailable, use the manual `[RESEARCH_DRAFT_PUBLISH]` envelope defined in the skill.

## Spike 0.6: Side Chat / Quick Chat as a research workspace

### Hypothesis

Quick Chat can provide a saved, no-worktree refinement mode, while a nested project session provides isolated deep research. Both modes can share one research identity and evidence/reference contract.

### Setup

- Inspected the app's project/session/chat APIs.
- Listed current sessions and chats.
- Compared available creation and messaging tools.
- Did not block on manual UI creation.

### Observed behavior

- The app API exposes `create_session` for project sessions but no `create_chat` or Quick Chat creation operation. Programmatic creation is therefore unavailable in this runtime; the user must initiate Quick Chat through the UI.
- `list_sessions_and_chats` returned the two project sessions and no chat item, so chat listing, handoff, skill/MCP availability, project inheritance, and canvas behavior could not be exercised against a real Quick Chat.
- `send_session_message` accepts both project-session and chat IDs once an item exists.
- Project-scoped custom agent, project skill, and project canvas discovery passed in a project session. Their inheritance into Quick Chat is unverified and must not be assumed.
- Official product direction treats Quick Chats as saved conversations without a branch/worktree.

### Concrete evidence

Current API surface:

| Capability | Project session | Quick Chat in this run |
| --- | --- | --- |
| Programmatic creation | `create_session` | No creation API |
| Listing | Returned as `type: session` | No chat item available |
| App-native messaging | Passed | API accepts chat IDs; no live chat to test |
| Installed plugin skills | Passed | Untested |
| Learn MCP | Passed | Untested |
| Project context/config | Passed | Untested |
| Project canvas extension/actions | Passed | Untested |
| Open/update reference editor canvas | Passed | Untested |

### Status

**PARTIAL**

### Decision

Expose two equivalent entry modes, not a replacement hierarchy:

| Entry mode | Best for | Guaranteed boundary |
| --- | --- | --- |
| **Refine here / Side Chat** | Fast, narrow follow-ups and saved research conversation without a worktree | No code mutation or assumed project-only extension capability; promote when the task grows |
| **Open deep research session** | Isolation, dedicated context, long-running/custom-agent work, code changes, worktree access, and explicit publish-back | Full project session contract and bounded handoff |

Both modes carry the same `researchId`, evidence schema, and reference-store pointer. Promotion creates a deep session with the existing research snapshot; it does not restart research.

### Fallback

Manual Quick Chat test:

1. From a reference, choose **Ask in Side Chat**.
2. Confirm the new item appears as a chat in `list_sessions_and_chats`.
3. Invoke `microsoft-foundry` and one bounded Learn search.
4. Ask it to report project context and available MCP servers without modifying files.
5. Test `list_canvas_capabilities` for the project spike canvas and open the shared Markdown reference in the editor canvas.
6. Send a nonce-tagged message from the chat to the parent with `send_session_message`.
7. Promote the same `researchId` to a project child session and confirm evidence sequence continuity.

If any capability fails, keep Quick Chat as conversation-only refinement and send the manual handoff envelope to a deep project session.

## Shared research contract

Quick and deep modes use the same logical contract:

| Field | Contract |
| --- | --- |
| `researchId` | Stable UUID created once by the coordinator and preserved through refinement, promotion, and publish |
| `evidenceVersion` | Integer schema version; starts at `1` |
| `evidenceId` | Stable UUID for one evidence record |
| `sourceUrl` | Canonical `https://learn.microsoft.com/...` URL |
| `toolName` | Runtime-observed MCP tool name |
| `argsSha256` | SHA-256 of canonical arguments |
| `resultSha256` | SHA-256 of structured output or content |
| `resultCount` | Bounded result count when applicable |
| `observedAt` | UTC timestamp |
| `status` | `captured`, `superseded`, or `rejected` |

The reference store is parent-owned and workspace-independent. Workers receive a `researchId` plus a snapshot/version pointer and append bounded evidence through the handoff contract. A worker checkout is not the canonical store. PR 0 validates the interface but does not implement the backing store.

Promotion envelope:

```text
[RESEARCH_PROMOTION]
researchId: <stable-id>
evidenceVersion: 1
snapshotVersion: <monotonic-version>
openQuestions: <bounded-list>
referencePointer: <parent-owned-reference>
```

## Architecture decision table

| Contract | Confidence | Safe production use |
| --- | --- | --- |
| Installed Open Plugins directory as read-only dependency | High | Yes; pin/record manifest identity and never vendor it |
| `.github/agents/*.agent.md` discovery | High | Yes |
| Custom-agent skill invocation via `skill` | High | Yes; verify with `skill.invoked` events |
| Custom-agent tool allow-list | High | Yes; pair with an independent permission policy |
| `metadata.generated_at` in injected skill context | Low | No; read metadata at trusted parent/plugin inspection time |
| Official Learn MCP endpoint | High | Yes |
| Fixed Learn MCP schemas or wrapper names | Low | No; discover dynamically |
| Search/code `structuredContent.results` | High | Yes after runtime shape check |
| Fetch `content` text blocks | High | Yes after runtime shape check |
| Success hook pre-paraphrase visibility | Medium | Yes behind an adapter; API is experimental |
| Failure hook as the only error source | Low | No; capture JSON-RPC/adapter failures too |
| App-native immediate handoff | High | Yes |
| Project skill publish workflow | Medium | Yes after a fresh-turn invocation test |
| Iframe Publish button | Low | No; superseded by chat skill |
| Quick Chat creation from an agent | Low | No API in this runtime |
| Quick Chat project capabilities | Unknown | Manual test required; do not assume inheritance |
| Shared `researchId`/evidence/reference interface | Medium | Yes as the cross-mode boundary; backing store remains future work |

## Validation

Run:

```sh
node --check .github/extensions/learn-capability-spikes/extension.mjs
node --test test/contracts.test.mjs
```

The extension must then be reloaded and inspected with the Copilot extension workflow before driving canvas discovery/open/actions.
