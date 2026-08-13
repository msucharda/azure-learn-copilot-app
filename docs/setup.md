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

Installed Agent Skills remain available in Copilot App. For deep research, the coordinator may
preselect one exact matching official product skill without enumerating or injecting the broader
catalog. `learn-researcher` uses that skill only to guide its checklist and Learn queries; fetched
Learn pages remain the only citation evidence.

## Use

For a quick question, ask in the current project chat. The project instructions direct Copilot to
use native Microsoft Learn tools and return clickable Markdown references.

For isolated research, invoke `/orchestrate` and request one child with:

- agent: `learn-researcher`;
- mode: `interactive`;
- kickoff field: `Selected official product skill: <exact-id>` or `none`;
- the complete research question, version/platform scope, and constraints in the kickoff.

The built-in skill creates and guides the child. The child returns one final linked Markdown answer;
there is no custom handoff or publish step. If the result is not delivered automatically, use the
App's native session history to resolve the runtime session from the exact child worktree and read
its final transcript. See the
[built-in skills reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

Use `citation-critic` when a supplied answer and its excerpts need support classification.

## Validate repository contracts

```sh
node --test
```

Project agent changes may require a new turn or session before they appear in the agent picker.
