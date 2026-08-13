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

For isolated research, invoke `/orchestrate` and request one child with repeated idle notifications.
Use a two-turn handshake:

- agent: `learn-researcher`;
- first turn: `Research mode: standard`;
- wait for and verify the ready response;
- second turn: send the complete research question, version/platform scope, and constraints exactly
  once.

Verify a complete normalized answer before archiving the child. If the result is not delivered
automatically, use App-native session history to read it and ask the same child to re-emit the existing
answer without new research. See the
[built-in skills reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

For evidence review, use `Research mode: evaluation`, save the returned coordinator-only packet as a
session artifact, and give `citation-critic` that exact path. It independently fetches only the Learn
URLs already in References and returns a repair brief for the original researcher. Do not put a
generated Markdown packet in kickoff attachments; those accept only app-staged creator images, and
Git staging is unrelated.

## Validate repository contracts

```sh
node --test
```

Project agent changes may require a new turn or session before they appear in the agent picker.
