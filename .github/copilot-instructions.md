# Microsoft Learn research and focused learning

- Use only project agents, Copilot App-native sessions and orchestration, Microsoft Learn tools, and
  session artifacts. Do not add extensions, project-defined runtime tools, persistence services,
  canvases, or a separate reference UI.
- Answer narrow Microsoft/Azure questions in the current chat with native Microsoft Learn search and
  fetch. Return concise claims with adjacent `https://learn.microsoft.com` links and a short References
  list.
- For deep work, invoke the built-in `/orchestrate` skill and use one `learn-researcher` child. Do not
  recreate orchestration or handoff logic in project code.

## Correlated child execution

Use one kickoff and an explicit agent callback for every deep child:

1. Freeze the complete task and compute its SHA-256. Generate a unique callback nonce.
2. If a child depends on unmerged agent or instruction changes, commit and push the current branch,
   pass it as `base_branch`, and verify the child branch contains the expected commit before accepting
   `STARTED`. A local-only commit is not a valid child-session base.
3. Request `coordinate_with_creator: true` and `notify_on_idle: always`.
4. Put the mode and phase fields, `Callback session ID`, `Task SHA-256`, `Callback nonce`, and the
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
- Use `Learning mode: focused` with `Learning phase: lesson` or `feedback` for bounded teaching.
- Direct Learn discovery is the only evidence path. Do not load, preselect, or inject an installed
  product skill or skill catalog. Three blinded routing rounds found no quality benefit and added
  startup complexity; factual premises come only from successfully fetched Learn pages.

## Focused learning loop

1. Establish one learning objective, learner level, and time budget. If no baseline is available, ask
   one short diagnostic question; use `Diagnostic response: Not supplied` only when the user wants the
   lesson immediately.
2. Start one callback-enabled lesson child with the objective, level, budget, and diagnostic response.
   Require 400-700 words, at most five fetched Learn pages, one worked example, one recall question, and
   one application question without answers. Do not cue the recall answer or use an exact portal label
   unless fetched page text supports it.
3. Publish the lesson and stop for the learner's responses.
4. Put the exact lesson, References, and learner responses in one packet for a fresh feedback child.
   Feedback reuses only those References, corrects missed concepts, asks one unanswered transfer retry
   in a novel scenario, and ends with a `Mastered` / `Practicing` / `Next objective` ledger. A concept
   contradicted by any applied response remains `Practicing`; use `Mastered: None yet` rather than
   narrowing mastery to recall. The exact lesson is the teaching boundary; References verify it and
   learner responses are not factual sources.
5. Do not create a learner database or schedule review automatically. Use current conversation context;
   create an App-native scheduled review only when the learner explicitly requests it.

## Research and publication

- Limit the evidence set to 15 authoritative pages, fetch every cited page, and treat search chunks as
  discovery only. Preserve exact qualifiers, actor/action boundaries, mutable status, numeric
  conditions, and successful fetch URLs. When retrieval timestamps are unavailable, label mutable
  facts time-sensitive and require deployment-time revalidation.
- Reserve evidence slots for the lead architecture's exact tier and mode before alternatives:
  capability, reliability/operations, network/management-plane, and limits/lifecycle pages.
- Require deterministic atomization before search: each numbered item, bullet, or semicolon-delimited
  subtopic is one row; terms joined inside that item remain one compound atom whose least-supported
  dimension sets the status.
- Require contradiction, qualifier-propagation, irreversible-choice, protective-control interaction,
  single-plane recovery, link, and claim-ledger preflights. Check every mandatory action verb against
  its operations page and distinguish data-plane from management-plane behavior.
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
