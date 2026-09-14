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

Select the coordinator model in Copilot App. The researcher leaves `model` unset in its agent frontmatter;
when starting a coordinated deep-research or repair child, omit the native `model` and `reasoning_effort`
arguments so Copilot App inherits the creator's active settings. Do not ask the user to restate either
setting. Record observed child settings when available, and stop if the runtime reports an inheritance
mismatch rather than substituting or downgrading. The discovery coach pins GPT-6 Astra
(`gpt-6-astra`), while the critic pins Claude Sonnet 5 (`claude-sonnet-5`) for independent review. There
is no documented repository model-default key in `.github/github-app.yml`; these instructions do not
change the App-wide default or an already-running session's model.

For a quick question, ask in the current project chat. The project instructions direct Copilot to
use native Microsoft Learn tools and return clickable Markdown references.

For a learning journey, ask **"I want to learn AKS"** in a normal project chat. The coordinator follows
[self-directed discovery](learning.md): a `prompt-library-factory` child generates the library, the
coordinator saves it as a session artifact, and an interactive `discovery-coach` session starts with
one mission. The factory inherits the coordinator's active model and reasoning effort; the coach uses
`gpt-6-astra`. Neither needs Azure credentials for the default conceptual path.

You can also select `prompt-library-factory` directly, describe your objective, and pass its complete
JSON result to `discovery-coach`. Direct selection does not automatically save a file or launch another
agent. All supported learning topics use this same factory-to-coach path.

For isolated research, invoke `/orchestrate` and request one callback-enabled child:

- agent: `learn-researcher`;
- model and reasoning effort: omit both to use native inheritance from the coordinator;
- kickoff: `Research mode: standard`, callback session ID, frozen-task SHA-256, unique callback nonce,
  and the complete research question, version/platform scope, and constraints;
- omit inactive phase fields entirely; include only those needed by the selected research mode;
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
