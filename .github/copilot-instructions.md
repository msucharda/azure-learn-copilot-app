# Microsoft Learn research

- Use only the project agents and Copilot App-provided tools. Do not add project extensions,
  project-defined tools, persistence services, or separate reference UI.
- Answer narrow questions in the current chat with the native Microsoft Learn tools.
- For deep work, invoke the built-in `/orchestrate` skill and have it create and guide one child with
  the `learn-researcher` agent. Do not implement a custom session or handoff protocol.
- If an orchestrated child cannot message back, resolve its runtime session from the exact child
  worktree and read its persisted transcript with app-native session-history tools. If normalized
  turns are unavailable, use the local full-text index for that exact runtime session and read only
  its final response.
- If a long kickoff repeatedly loses its runtime before the first turn, initialize the same agent with
  a minimal turn and send the unchanged task in the next coordinated turn. If a completed answer is
  missing from session history, ask the same child to re-emit it without new research before retrying
  with another model.
- Assess orchestration in the coordinator. Ask the child only about research-tool and evidence
  friction that it can directly observe.
- Before launching deep research, identify the primary Azure product and select at most one exact
  matching installed official product skill. Do not enumerate or inject a product-skill catalog and do
  not add a project router. Put `Selected official product skill: <exact-id>` in the child kickoff, or
  `Selected official product skill: none` when there is no clear match. The child loads only that
  preselected skill, then uses direct Microsoft Learn discovery.
- Treat selected-skill content as routing and checklist guidance only, never as evidence. Every factual
  premise and every skill-provided URL used in the answer must still be established by a successfully
  fetched Microsoft Learn page. If the selected skill is unavailable or mismatched, continue with
  direct Learn discovery and expose the issue only in requested agent-system observations.
- Limit the authoritative source set to 15 pages, fetch every cited page, and never cite a search
  snippet. Use read-only access only for exact tool-spooled output, and distinguish sourced facts
  from synthesized recommendations and unresolved assumptions.
- Require an atomic coverage preflight that preserves each named service, constraint, comparison, and
  comma-separated subtopic. A parent-area mention or unsupported recommendation is not coverage;
  neither the source cap nor the word cap permits silent omission.
- Require a final link preflight: use an explicitly returned canonical URL or the exact successful
  request URL, never an inferred rewrite; allow no unfetched Markdown link in any section.
- Require a contradiction preflight across fetched constraints, recommendations, and explicit
  scenario requirements. Mutually exclusive options must be chosen between or presented as
  conditional alternatives, and mandatory controls cannot be bypassed for convenience.
- Require an interaction and propagation preflight. Preserve source qualifiers and actor/action
  boundaries; state when one recommended control changes another's operation or recovery path; carry
  constraints into relevant migration, copy, backup, failover, monitoring, and cost steps. Recheck
  locks, policies, immutability, network restrictions, key protection, and deletion guards against
  every recovery and reconfiguration action. Require a dedicated pre-rollout commitments table for
  every create-time, one-way, locked, irreversible, and mode-selection or mode-switch property. A
  conditional lead choice needs a fetched, scenario-compliant fallback or remains unresolved.
- Require a core-length preflight that removes repeated facts, catalog detail, and secondary examples
  before requested coverage; recommendations apply rather than restate fetched facts.
- Keep the core synthesis within 1,500 words, allowing up to 2,000 only when the atomic checklist
  exceeds 30 items and only to restore requested coverage. Give every decision all three exact labels:
  fetched facts, recommendation, and assumptions or unresolved constraints; name every unsupported
  item in the last label rather than hiding gaps behind an aggregate phrase.
- For checklists over 30 items, require a compact pre-reference `Coverage audit` table that assigns
  one row and one status to every atomic item: `Covered`, `Partially covered`, or `Unresolved`. The
  table row count must equal the checklist count. An item named in an assumptions block cannot be
  `Covered`; rebuild and recount the audit from the final assumptions blocks before answering.
- Require dedicated fetched evidence for every named capability, generation, SKU, region, or
  compatibility relationship on which the lead recommendation depends. Surface conflicts between
  fetched pages instead of choosing silently.
- For an improvement round that requests agent observations, require an in-band `Evidence manifest`
  with one row per fetched page: matching `References` entry, fetched title, tool-exposed retrieval
  timestamp or `Unavailable`, and the material support states and constraints used. Preserve the exact
  value and conditions of every cited multiplier, range, duration, percentage, count, and numeric
  limit. Keep each exact URL only in the linked `References` list. The manifest is answer context, not
  a durable evidence store.
- Do not emit numeric word-count estimates unless a tool computed them deterministically.
- Return concise claims with adjacent `https://learn.microsoft.com` Markdown links and a short
  `References` list. Never fabricate or rewrite a source URL.
- Use `citation-critic` only when the user requests an evidence review. For an iterative improvement
  review, run it in a separate coordinated child with a different model family and pass the exact
  original task, complete answer, and same fetched evidence context. It reviews the existing answer;
  it does not produce another architecture. If the original tool trace is unavailable, identify any
  coordinator refetch as reconstructed evidence rather than claiming it is the exact original context.
  Include the answer delivery channel (`normalized turn`, `task_complete summary`, `re-emitted turn`,
  or `reconstructed`) in the reviewer packet so transport defects remain separate from answer defects.
- At the end of every requested improvement round, append a session-artifact log entry containing what
  worked, what failed, the complementary review, model disagreements, and system changes with their
  rationale. Do not add a runtime persistence layer or commit the log to the repository.
