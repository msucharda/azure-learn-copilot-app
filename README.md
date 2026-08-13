# Azure Learn Copilot agent system

An agent-only Microsoft Learn research workflow for Copilot App. The repository contains no project
extensions, custom runtime tools, persistence layer, or separate reference UI. Research uses the
Microsoft Learn tools configured in Copilot App, and references are returned as normal website
links.

## Components

| Path | Purpose |
| --- | --- |
| `.github/agents/learn-researcher.agent.md` | Searches and fetches current Microsoft Learn content, synthesizes an answer, and returns linked references |
| `.github/agents/citation-critic.agent.md` | Classifies whether supplied evidence supports supplied claims |
| `.github/copilot-instructions.md` | Keeps quick research inline and delegates deep research through native orchestration |

## Flow

1. Answer a narrow question in the current chat with the native Microsoft Learn tools.
2. For deeper work, invoke Copilot App's built-in `/orchestrate` skill and have it create one
   `learn-researcher` child.
3. The researcher may invoke one matching official product skill, then verifies the answer with
   native Microsoft Learn search, fetch, and code-sample tools.
4. The researcher returns concise Markdown with claim-adjacent links and a unique `References`
   list. The built-in orchestrator coordinates the child result.

No project skill router is required. Installed skills are native routing guidance; current pages from
[Microsoft Learn](https://learn.microsoft.com/) are the citation source.

GitHub's standard deep-research workflow is designed to investigate repository code. This custom
agent remains useful for external Microsoft Learn research because it enforces a Learn-only source
and link contract. See GitHub's documentation for
[repository deep research](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate),
[custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration), and the
[built-in `/orchestrate` skill](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

## Validate

```sh
node --test
```

The tests enforce the agent-only file layout, native tool allow-lists, and linked-reference contract.
See [architecture](docs/architecture.md), [setup](docs/setup.md), and
[troubleshooting](docs/troubleshooting.md).
