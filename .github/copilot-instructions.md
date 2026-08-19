# Microsoft Learn research

- Use only project agents, Copilot App-native sessions and orchestration, Microsoft Learn tools, and
  session artifacts. Do not add extensions, project-defined runtime tools, persistence services,
  canvases, or a separate reference UI.
- Answer narrow Microsoft/Azure questions in the current chat with native Microsoft Learn search and
  fetch. Return concise claims with adjacent `https://learn.microsoft.com` links and a short References
  list.
- For deep work, invoke the built-in `/orchestrate` skill and use one `learn-researcher` child. Do not
  recreate orchestration or handoff logic in project code.

## Pre-research prompt refinement

Before Learn discovery, task hashing, or launching a research child, Sol evaluates the original request
and classifies it as exactly one of:

- `clear`: one plausible product, goal, and scope; proceed without asking.
- `exploratory`: breadth or uncertainty is the user's goal; preserve it, state assumptions, and do not ask.
- `materially ambiguous`: two or three interpretations would change the product, evidence plan, decision,
  or risk. Generate 2-3 concise interpretations, each with its goal and decisive differentiator, then use
  `ask_user` once with one focused question. Put a recommended choice first only when context supports it;
  do not add an `Other` choice because the UI supplies freeform input.

Do not ask merely because details are missing when explicit assumptions or conditional branches preserve
intent safely. After selection, freeze one refinement record containing `Original request`, `Selected
interpretation`, `Objective`, `In scope`, `Assumptions`, `Exclusions`, and `Unresolved`. Compute the task
SHA-256 only after that record is final. Give the research child the original and refined request; it must
not reinterpret them. MAI preprocessing can begin only after Sol fixes intent.

## Correlated child execution

Use one kickoff and an explicit agent callback for every deep child:

1. Freeze the complete task and compute its SHA-256. Generate a unique callback nonce.
2. If a child depends on unmerged agent or instruction changes, commit and push the current branch,
   pass it as `base_branch`, and verify the child branch contains the expected commit before accepting
   `STARTED`. A local-only commit is not a valid child-session base.
3. Request `coordinate_with_creator: true` and `notify_on_idle: always`.
4. Put the research mode, `Callback session ID`, `Task SHA-256`, `Callback nonce`, and the
   complete frozen task in the kickoff. Do not deliver work in a follow-up session message.
5. Require the child to callback `STARTED` before research and `COMPLETED` with the complete result, or
   `FAILED` with a reason. Accept a callback only from the expected child project-session ID and only
   when both identifiers match.
6. Treat idle notifications as diagnostics, never completion. If the child becomes idle without the
   required callback, inspect its transcript once, record a delivery failure, and do not automatically
   resend the task.
7. Ignore duplicate or stale callbacks. Validate the complete normalized result before archiving.
8. Use `context_tier: default`. Escalate to `long_context` only for evaluation/A-B packets over 15,000
   characters, more than 30 fixed atoms, multi-answer comparison, or a recorded default-context run that
   reaches 120,000 input tokens or shows context loss. Record every escalation.

Coordinator-generated Markdown is not a valid kickoff attachment; the App attachment field accepts
only app-staged image attachments from the creator message. Git staging does not change that. Put a
review packet in the session artifact directory and give a read-enabled reviewer its exact path.

## Modes and direct discovery

- Put `Research mode: standard`, `evaluation`, or `repair` in the kickoff. Standard is the normal path.
  Evaluation is only for controlled improvement or requested evidence review. Repair starts a fresh
  child with the prior answer and critic brief in one exact packet.
- Direct Learn discovery is the only evidence path. Do not load, preselect, or inject an installed
  product skill or skill catalog. Three blinded routing rounds found no quality benefit and added
  startup complexity; factual premises come only from successfully fetched Learn pages.

## Research and publication

- A discovery-only candidate pool may exceed 15 pages, but Sol fixes protected evidence slots before
  ranking. Each slot fixes actor, action, target service/plane, and an adjacent-candidate exclusion.
  An advisory weak ranker may fill those slots; it cannot derive, merge, drop, or support claims.
- Limit the final evidence set to 15 authoritative pages and fetch every cited page. Exact operations,
  schemas, identity, limits, and qualifier-bearing pages precede generic or adjacent-product pages.
- Preserve actor/action boundaries, mutable status, numeric conditions, and successful fetch URLs. When
  retrieval timestamps are unavailable, label mutable facts time-sensitive and require revalidation.
- Require deterministic atomization before search: each numbered item, bullet, or semicolon-delimited
  subtopic is one row; terms joined inside that item remain one compound atom whose least-supported
  dimension sets the status.
- Require contradiction, qualifier-propagation, irreversible-choice, protective-control interaction,
  single-plane recovery, link, and claim-ledger preflights. Check every mandatory action verb against
  its operations page and distinguish data-plane from management-plane behavior.
- Require explicit support for negative/exclusive claims or label them synthesis. Preserve routing
  symmetry, preference, and steering qualifiers; topology coexistence is not evidence of load-sharing.
- For multi-table queries, map every table to its producer, diagnostic category, destination, and
  prerequisites; enforce join cardinality and preserve identity provenance across telemetry planes.
- For a current-to-target decision, surface lost capabilities, restart/redeploy needs, documented
  defaults and side effects, cost/billing, permission scope, and relevant preview alternatives. Treat
  parent headings and notes as claim conditions; do not silently reconcile source-internal conflicts.
- For a requested runbook, include an exact fetched CLI, API, or IaC operation and target scope when
  available. Label synthesized conditions in the conclusion, and rebuild the final core, audit, and
  evidence manifest together so no unused manifest value or optimistic status survives.
- Count all user-visible core text before References, including headings, labels, tables, and fenced code;
  exclude Markdown URL targets. Target 1,350 words when code or tables appear, with 1,500 as the ceiling.
- Reverse-map each assumption or unresolved dimension to its compound audit row. If one fetched page says
  a method is unavailable and another exposes it, report a conflict instead of choosing silently.
- Treat query parameters and selected pivots as citation scope. Attach each link to the smallest factual
  clause it supports; a co-citation cannot transfer support from another page.
- Sweep each recommended numeric/default value for conditional overrides and creation-time toggles.
  Require manifest `Core location` headings and an exact qualified core match for every listed value.
- Publish only the standard answer through References. An evaluation run appends
  `## Evaluation packet (coordinator only)` containing the coverage audit, observations, and evidence
  manifest; do not forward that packet as user-facing output.

## Formal review and repair

- When evidence review is requested, create a different-model `citation-critic` child with the callback
  envelope. Supply the exact original task, complete answer, evaluation packet, and delivery channel in
  one session-artifact packet. The critic may read only that packet and review-fetch only the exact
  Learn URLs already in References; it cannot search, add sources, invoke skills, or propose another
  architecture.
- For controlled A/B experiments, anonymize arm metadata before review, fix the scoring rubric and task
  hash before either answer is inspected, and decode the arms only after the verdict.
- Start a fresh callback-enabled `learn-researcher` child with `Research mode: repair` and one exact
  packet containing the prior answer and critic brief. Unless explicitly authorized, repair reuses the
  existing source set. A critic brief is analysis, not evidence: verify every proposed fact against an
  exact existing page and pivot, reject unsupported suggestions, and preserve the gap. Verify the
  corrected result, then publish only its user-facing portion.
- Record what worked, failures, complementary findings, model disagreements, repair results, and
  evidence-backed system changes in the session improvement-log artifact. Do not add runtime storage.
