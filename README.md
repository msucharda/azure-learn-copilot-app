# Azure Learn Copilot agent system

An agent-only Microsoft Learn research and Intune discovery workflow for Copilot App. The repository
contains no project extensions, custom runtime tools, persistence layer, or separate reference UI.
Research uses the Microsoft Learn tools configured in Copilot App and returns normal website links.
The Intune workshop adds delegated, read-only Entra evidence from Microsoft MCP Server for Enterprise.

## Components

| Path | Purpose |
| --- | --- |
| `.github/agents/learn-researcher.agent.md` | Produces evidence-backed standard, evaluation, and repair answers |
| `.github/agents/citation-critic.agent.md` | Verifies existing Learn references and reviews research contracts |
| `.github/agents/intune-discovery-coach.agent.md` | Coaches bounded Intune discovery with Learn documentation and read-only Entra evidence |
| `.github/copilot-instructions.md` | Coordinates prompt refinement, research, source triage, and citation review through native orchestration |
| `prompts/intune/prompt-library.json` | Defines the ordered seven-mission workshop, evidence gates, and safety guardrails |

## Flow

1. Before research, Astra classifies the request as clear, exploratory, or materially ambiguous. It preserves
   useful breadth, but when interpretations would change the product, evidence, decision, or risk, it uses
   one `ask_user` question with two or three differentiated choices.
2. Freeze the selected interpretation with the original request, objective, scope, assumptions, exclusions,
   and unresolved items. Only then hash the task. Answer a narrow request in the current chat.
3. For deeper work, invoke Copilot App's built-in `/orchestrate` skill and start one
   `learn-researcher` child with the complete frozen task and a task-hash-correlated callback envelope
   in one kickoff. Idle notifications are diagnostic only. Standard research uses the default context
   tier; long context is reserved for measured large-packet or context-pressure cases.
4. The researcher uses direct Microsoft Learn discovery in every mode. Installed product skills and
   product-skill catalogs are outside the research path.
5. The child deterministically atomizes the task, selects at most 15 authoritative pages, fetches every
   cited page, and runs coverage, contradiction, interaction, claim-ledger, and link preflights.
6. Standard mode returns concise Markdown with claim-adjacent links and a unique `References` list.
   Evaluation mode appends a coordinator-only packet. A different-model critic reads that exact packet,
   refetches only its existing Learn URLs, and returns a repair brief through the same callback protocol.
   A fresh repair-mode researcher receives one exact packet, and the coordinator publishes only the
   corrected user-facing answer.

The separate Intune coach reads the mission library, uses Microsoft Learn MCP for documentation, and
uses Enterprise MCP only for Entra users, groups, group membership, devices, licenses, organization,
and directory-role evidence. Enterprise MCP is read-only and does not expose Intune configuration or
managed-device APIs. Workshop assignments must never target **All users** or **All devices**.

No project skill router, installed product skill, or product-skill catalog is loaded into the
researcher. Current fetched pages from [Microsoft Learn](https://learn.microsoft.com/) are the sole
citation source.

## Routing decision

Three frozen-task, same-model, blinded comparisons tested direct Learn discovery against one matching
official product skill. Critical-defect precedence determined the winner before score totals.

| Round | Product | Direct | Skill | Winner |
| --- | --- | ---: | ---: | --- |
| 16 | Service Bus | 26/35 | 26/35 | Direct, medium confidence |
| 17 | Key Vault | 26/35 | 23/35 | Direct, medium confidence |
| 18 | API Management | 28/35 | 24/35 | Direct, medium confidence |

Direct discovery won all three rounds. The skill arms occasionally improved product-specific depth,
but introduced more serious lead-path defects and more initialization complexity. Product-skill
routing is therefore removed rather than retained as a standard or evaluation option.

GitHub's standard deep-research workflow is designed to investigate repository code. This custom
agent remains useful for external Microsoft Learn research because it enforces a Learn-only source
and link contract. See GitHub's documentation for
[repository deep research](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate),
[custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration), and the
[built-in `/orchestrate` skill](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

## Improvement loop

The base model is GPT-6 Astra (`gpt-6-astra`) for coordination, research, and Intune
coaching. The independent critic uses Claude Sonnet 5 (`claude-sonnet-5`). Agent profiles pin their
models, and coordinated kickoffs select them explicitly. Select Astra for the main chat in Copilot App;
repository instructions cannot change an already-running model or the App-wide default.

Each iteration runs a different Azure architecture scenario in a fresh coordinated
`learn-researcher` session. Controlled experiments hold the task, model, and rubric fixed and anonymize
answers before blind review. The core answer is bounded to
1,500 words, or 2,000 evaluation words for more than 30 atoms. Atomization is fixed before search:
each numbered item, bullet, or semicolon-delimited subtopic is one row, and a compound row receives the
status of its least-supported dimension.

The same preflight also checks interactions between individually supported controls, propagates source
qualifiers through migration, backup, failover, sharing, monitoring, and cost, and derives pre-rollout
commitments from every fetched one-way or irreversible qualifier. A compact interaction table checks
protective controls against recovery and reconfiguration actions, including single-plane dependencies.
Conditional lead choices require a fetched fallback or remain unresolved. The source budget reserves
lead-mode capability, operations/reliability, network/management-plane, and limits/lifecycle pages
before alternatives. Mandatory action verbs are checked against operations pages, and mutable facts
without tool-exposed timestamps require deployment-time revalidation. Current-to-target decisions also
surface lost capabilities, restart and cost consequences, permission scope, preview alternatives, and
source conflicts. Requested runbooks include fetched executable operations rather than intentions alone,
but fenced commands count toward the core ceiling. Assumptions and conditional numeric overrides
reverse-map to compound audit rows; manifest values map to exact core headings and pivot-scoped links.
Negative or exclusive claims require explicit support or a synthesis label, and route coexistence cannot
be paraphrased as load-sharing without preserving symmetry and traffic-steering qualifiers. Multi-table
queries map each table to its telemetry producer and configuration, establish join cardinality, and keep
credential, principal, telemetry-field, and aggregation-key provenance distinct across identity planes.
Discovery may consider more than 15 candidate pages, but the strong intent stage fixes protected evidence
slots before ranking. Each slot fixes the actor, action, target service or plane, and the decisive reason
to reject the closest adjacent candidate. A weak ranker can fill but cannot derive or remove slots; only
the final set of at most 15 fetched pages supports claims.
The coordinator keeps useful exploratory ambiguity, but materially different interpretations are resolved
before orchestration. Research receives both the original request and the frozen selected interpretation;
MAI never decides user intent.

Evaluation details live after References in a coordinator-only packet rather than the published answer.
A different-model critic reads that exact artifact, verifies only its existing Learn links, and returns
a repair brief instead of another architecture. A fresh repair-mode researcher receives the prior
answer and brief in one exact packet. The brief is analysis rather than evidence; each proposed fact is
re-verified against the fixed source set. The coordinator records runtime failures, repair results, and
evidence-backed system changes in an uncommitted Copilot session artifact.

Reliability review separates callback acceptance, recipient receipt, and retained result content.
Late error statuses are reconciled against exact correlated results before any retry. Evidence review
records full source URLs and inspected clauses, prioritizes operations and permissions, and uses a
limited verdict when material clauses remain uninspected. Repairs preserve exact conflicting
source-location pairs rather than treating critic advice as evidence. Word-count utilities remain
coordinator-owned; researchers cannot broaden their tool boundary to satisfy an output constraint.
These are agent safeguards, not fixes to Copilot App's delivery infrastructure.

## Validate

```sh
node --test
```

The tests enforce the agent-only file layout, native tool allow-lists, and linked-reference contract.
They are structural contract tests, not model-quality or live-integration tests. Model migrations also
need fresh native-session cases for research, critique/repair, callback delivery, and
workshop safety. Keep exact tasks, callback identities, observed models, source traces, and independent
reviews in session artifacts; a passed synthetic safety case does not establish Enterprise MCP access
or completion of the seven live workshop missions.
See [architecture](docs/architecture.md), [setup](docs/setup.md), and
[troubleshooting](docs/troubleshooting.md).
