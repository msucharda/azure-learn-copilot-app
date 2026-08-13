# Azure Learn Copilot agent system

An agent-only Microsoft Learn research workflow for Copilot App. The repository contains no project
extensions, custom runtime tools, persistence layer, or separate reference UI. Research uses the
Microsoft Learn tools configured in Copilot App, and references are returned as normal website
links.

## Components

| Path | Purpose |
| --- | --- |
| `.github/agents/learn-researcher.agent.md` | Searches and fetches current Microsoft Learn content, synthesizes an answer, and returns linked references |
| `.github/agents/citation-critic.agent.md` | Reads an exact review packet and independently verifies its existing Learn references |
| `.github/copilot-instructions.md` | Keeps quick research inline and delegates deep research through native orchestration |

## Flow

1. Answer a narrow question in the current chat with the native Microsoft Learn tools.
2. For deeper work, invoke Copilot App's built-in `/orchestrate` skill and start one
   `learn-researcher` child with a verified two-turn handshake: request repeated idle notifications,
   wait for the minimal initialization response, and only then send the complete task once.
3. Direct Learn discovery is the default. The coordinator may preselect one exact official product
   skill when it can name a concrete routing benefit; that skill guides terminology and query planning
   but never supplies evidence.
4. The child deterministically atomizes the task, selects at most 15 authoritative pages, fetches every
   cited page, and runs coverage, contradiction, interaction, claim-ledger, and link preflights.
5. Standard mode returns concise Markdown with claim-adjacent links and a unique `References` list.
   Evaluation mode appends a coordinator-only packet. A different-model critic reads that exact packet,
   refetches only its existing Learn URLs, and sends a repair brief back to the original researcher.
   The coordinator publishes only the corrected user-facing answer.

No project skill router or product-skill catalog is loaded into the researcher. A single progressively
loaded official skill may narrow discovery when explicitly justified, but it is not evidence. Current
fetched pages from [Microsoft Learn](https://learn.microsoft.com/) remain the citation source.

GitHub's standard deep-research workflow is designed to investigate repository code. This custom
agent remains useful for external Microsoft Learn research because it enforces a Learn-only source
and link contract. See GitHub's documentation for
[repository deep research](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate),
[custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration), and the
[built-in `/orchestrate` skill](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

## Improvement loop

Each iteration runs a different Azure architecture scenario in a fresh coordinated
`learn-researcher` session. Controlled routing experiments hold the task, model, and rubric fixed,
anonymize the answers, and decode skill use only after blind review. The core answer is bounded to
1,500 words, or 2,000 evaluation words for more than 30 atoms. Atomization is fixed before search:
each numbered item, bullet, or semicolon-delimited subtopic is one row, and a compound row receives the
status of its least-supported dimension.

The same preflight also checks interactions between individually supported controls, propagates source
qualifiers through migration, backup, failover, sharing, monitoring, and cost, and derives pre-rollout
commitments from every fetched one-way or irreversible qualifier. A compact interaction table checks
protective controls against recovery and reconfiguration actions, including single-plane dependencies.
Conditional lead choices require a fetched fallback or remain unresolved.

Evaluation details live after References in a coordinator-only packet rather than the published answer.
A different-model critic reads that exact artifact, verifies only its existing Learn links, and returns
a repair brief instead of another architecture. The original researcher applies one repair turn before
publication. The coordinator records agreements, disagreements, runtime failures, repair results, and
evidence-backed system changes in an uncommitted Copilot session artifact.

## Validate

```sh
node --test
```

The tests enforce the agent-only file layout, native tool allow-lists, and linked-reference contract.
See [architecture](docs/architecture.md), [setup](docs/setup.md), and
[troubleshooting](docs/troubleshooting.md).
