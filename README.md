# Azure Learn Copilot agent system

An agent-only Microsoft Learn research and focused-learning workflow for Copilot App. The repository
contains no project extensions, custom runtime tools, persistence layer, or separate reference UI.
Research and lessons use the Microsoft Learn tools configured in Copilot App, and references are
returned as normal website links.

## Components

| Path | Purpose |
| --- | --- |
| `.github/agents/learn-researcher.agent.md` | Produces evidence-backed research answers, focused lessons, and learner-response feedback |
| `.github/agents/citation-critic.agent.md` | Verifies existing Learn references and reviews research or learning contracts |
| `.github/copilot-instructions.md` | Coordinates research and focused learning through native orchestration |

## Flow

1. Answer a narrow question in the current chat with the native Microsoft Learn tools.
2. For deeper work, invoke Copilot App's built-in `/orchestrate` skill and start one
   `learn-researcher` child with the complete frozen task and a task-hash-correlated callback envelope
   in one kickoff. Idle notifications are diagnostic only. Standard research uses the default context
   tier; long context is reserved for measured large-packet or context-pressure cases.
3. The researcher uses direct Microsoft Learn discovery in every mode. Installed product skills and
   product-skill catalogs are outside the research path.
4. The child deterministically atomizes the task, selects at most 15 authoritative pages, fetches every
   cited page, and runs coverage, contradiction, interaction, claim-ledger, and link preflights.
5. Standard mode returns concise Markdown with claim-adjacent links and a unique `References` list.
   Evaluation mode appends a coordinator-only packet. A different-model critic reads that exact packet,
   refetches only its existing Learn URLs, and returns a repair brief through the same callback protocol.
   A fresh repair-mode researcher receives one exact packet, and the coordinator publishes only the
   corrected user-facing answer.

## Focused learning

Focused learning uses the same direct Learn evidence and callback transport, but a smaller teaching
contract:

1. Establish one learning objective, learner level, time budget, and optional diagnostic response.
2. Generate a 400-700-word lesson from at most five fetched Learn pages.
3. Include one worked example, one recall question, and one application question without answers.
4. After the learner responds, start a fresh feedback phase with the exact lesson and responses.
5. Correct only missed concepts, ask one unanswered retry, and record `Mastered`, `Practicing`, and
   `Next objective`.

The current conversation carries the loop. The system does not create a learner database or schedule
review unless the learner explicitly requests an App-native workflow.

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
slots before ranking. A weak ranker can fill those slots but cannot derive or remove them; only the final
set of at most 15 fetched pages supports claims.

Evaluation details live after References in a coordinator-only packet rather than the published answer.
A different-model critic reads that exact artifact, verifies only its existing Learn links, and returns
a repair brief instead of another architecture. A fresh repair-mode researcher receives the prior
answer and brief in one exact packet. The brief is analysis rather than evidence; each proposed fact is
re-verified against the fixed source set. The coordinator records runtime failures, repair results, and
evidence-backed system changes in an uncommitted Copilot session artifact.

## Validate

```sh
node --test
```

The tests enforce the agent-only file layout, native tool allow-lists, and linked-reference contract.
See [architecture](docs/architecture.md), [setup](docs/setup.md), and
[troubleshooting](docs/troubleshooting.md).
