# Setup

## Requirements

- Copilot App with project custom-agent discovery.
- The Microsoft Learn MCP server configured in Copilot App and exposed as `microsoft-learn/*`.

No project extension, SDK package, local service, storage root, environment variable, or committed
MCP configuration is required.

Copilot App inherits MCP servers configured for a repository or Copilot CLI and also supports
managing servers in App settings. Configure the official Microsoft Learn endpoint there and name the
server `microsoft-learn`, matching the agent allow-list. See
[customizing Copilot App](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
and [Microsoft Learn MCP setup](https://learn.microsoft.com/en-us/training/support/mcp-get-started).

Installed product skills may remain available elsewhere in Copilot App, but this project does not load
them. `learn-researcher` uses direct Learn discovery in every mode, and fetched Learn pages are the only
citation evidence.

## Use

For a quick question, ask in the current project chat. The project instructions direct Copilot to
use native Microsoft Learn tools and return clickable Markdown references.

For focused learning, provide one objective, your current level, and a time budget. The coordinator
asks one short diagnostic question unless you request an immediate lesson. It then launches:

- `Learning mode: focused`;
- `Learning phase: lesson`;
- `Learning objective`, `Learner level`, `Time budget`, and `Diagnostic response`;
- the same callback envelope and default context tier used by research.

Answer the lesson's recall and application questions in the project chat. A fresh
`Learning phase: feedback` child receives the exact lesson and your responses, reuses only the lesson's
References, and returns targeted correction plus a learning ledger.

For isolated research, invoke `/orchestrate` and request one callback-enabled child:

- agent: `learn-researcher`;
- kickoff: `Research mode: standard`, callback session ID, frozen-task SHA-256, unique callback nonce,
  and the complete research question, version/platform scope, and constraints;
- coordination: `coordinate_with_creator: true`;
- notification: `notify_on_idle: always`, used only to diagnose missing callbacks;
- context: `context_tier: default`. Use `long_context` only for a packet over 15,000 characters, more
  than 30 fixed atoms, a multi-answer comparison, or a prior default run that reaches 120,000 input
  tokens or exhibits context loss.

Accept only `STARTED`, `COMPLETED`, or `FAILED` callbacks from the expected child with both exact
identifiers. Verify a complete normalized answer before archiving the child. An idle child without a
matching callback is a delivery failure and is not automatically retried. See the
[built-in skills reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

When a child must test agent changes that are not on the default branch, commit and push the feature
branch first, pass that branch as `base_branch`, and verify the child contains the expected commit.
Native child-session creation resolves the pushed branch state; an unpushed local commit is not inherited.

For a newly authorized frozen tandem evaluation, first start `learn-source-triage` with
`mai-code-1.1-flash`, `Triage mode: source-selection`, the complete protected-slot task, and the same
callback envelope. The completed five-route program produced no passing screen, so do not use this path
for standard research. Validate strict JSON before giving the advisory packet to a GPT-5.6 Sol
`learn-researcher`; triage is not evidence. Do not retry a failed triage session.

For evidence review, use `Research mode: evaluation`, save the returned coordinator-only packet as a
session artifact, and give `citation-critic` that exact path. It independently fetches only the Learn
URLs already in References. Give its repair brief and the prior answer to a fresh callback-enabled
researcher in one repair-mode packet. Do not put a generated Markdown packet in kickoff attachments;
those accept only app-staged creator images, and Git staging is unrelated.

## Validate repository contracts

```sh
node --test
```

Project agent changes may require a new turn or session before they appear in the agent picker.
