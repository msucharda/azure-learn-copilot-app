# Microsoft Learn research

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
2. Request `coordinate_with_creator: true` and `notify_on_idle: always`.
3. Put `Research mode`, `Callback session ID`, `Task SHA-256`, `Callback nonce`, and the complete frozen
   task in the kickoff. Do not deliver work in a follow-up session message.
4. Require the child to callback `STARTED` before research and `COMPLETED` with the complete result, or
   `FAILED` with a reason. Accept a callback only from the expected child project-session ID and only
   when both identifiers match.
5. Treat idle notifications as diagnostics, never completion. If the child becomes idle without the
   required callback, inspect its transcript once, record a delivery failure, and do not automatically
   resend the task.
6. Ignore duplicate or stale callbacks. Validate the complete normalized result before archiving.

Coordinator-generated Markdown is not a valid kickoff attachment; the App attachment field accepts
only app-staged image attachments from the creator message. Git staging does not change that. Put a
review packet in the session artifact directory and give a read-enabled reviewer its exact path.

## Modes and direct discovery

- Put `Research mode: standard`, `evaluation`, or `repair` in the kickoff. Standard is the normal path.
  Evaluation is only for controlled improvement or requested evidence review. Repair starts a fresh
  child with the prior answer and critic brief in one exact packet.
- Direct Learn discovery is the only research path in all three modes. Do not load, preselect, or inject
  an installed product skill or skill catalog. Three blinded routing rounds found no quality benefit
  and added startup complexity; factual premises come only from successfully fetched Learn pages.

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
  existing source set. Verify the corrected result, then publish only its user-facing portion.
- Record what worked, failures, complementary findings, model disagreements, repair results, and
  evidence-backed system changes in the session improvement-log artifact. Do not add runtime storage.
