# Microsoft Learn research

- Use only project agents and Copilot App-provided skills, sessions, Microsoft Learn tools, and session
  artifacts. Do not add extensions, project-defined runtime tools, persistence services, canvases, or a
  separate reference UI.
- Answer narrow Microsoft/Azure questions in the current chat with native Microsoft Learn search and
  fetch. Return concise claims with adjacent `https://learn.microsoft.com` links and a short References
  list.
- For deep work, invoke the built-in `/orchestrate` skill and use one `learn-researcher` child. Do not
  recreate orchestration or handoff logic in project code.

## Reliable child startup

Use a verified two-turn handshake for every deep child:

1. Request `notify_on_idle: always`.
2. Start with a minimal initialization turn containing only the agent role, `Research mode`, and
   `Selected official product skill`.
3. Wait for the idle event and verify the normalized assistant turn exactly acknowledges readiness.
4. Only then send the complete research task once. Do not queue the task while initialization or skill
   loading is still running.
5. Wait for the next idle event and verify that a complete normalized answer exists. If the answer
   exists only in another delivery channel, record that channel and ask the same child to re-emit the
   existing answer without new research.
6. Do not archive or replace a child until session history proves that it has no unprocessed task.

Coordinator-generated Markdown is not a valid kickoff attachment; the App attachment field accepts
only app-staged image attachments from the creator message. Git staging does not change that. Put a
review packet in the session artifact directory and give a read-enabled reviewer its exact path.

## Modes and skill routing

- Put `Research mode: standard`, `evaluation`, or `repair` in the initialization turn. Standard is the
  normal path. Evaluation is only for controlled improvement or requested evidence review. Repair
  sends a critic brief back to the original researcher before publication.
- Direct Learn discovery is the default. Select at most one exact installed official product skill
  only when the coordinator can name a concrete taxonomy or terminology benefit, or when the user asks
  to test skill routing. Put `Selected official product skill: <exact-id>` or `none` in the kickoff.
- Never enumerate or inject a skill catalog. Skill content guides queries and atomization only; every
  factual premise and skill-provided URL still requires a successful Learn fetch.

## Research and publication

- Limit the evidence set to 15 authoritative pages, fetch every cited page, and treat search chunks as
  discovery only. Preserve exact qualifiers, actor/action boundaries, mutable status, numeric
  conditions, and successful fetch URLs.
- Require deterministic atomization before search: each numbered item, bullet, or semicolon-delimited
  subtopic is one row; terms joined inside that item remain one compound atom whose least-supported
  dimension sets the status.
- Require contradiction, qualifier-propagation, irreversible-choice, protective-control interaction,
  single-plane recovery, link, and claim-ledger preflights.
- Publish only the standard answer through References. An evaluation run appends
  `## Evaluation packet (coordinator only)` containing the coverage audit, observations, and evidence
  manifest; do not forward that packet as user-facing output.

## Formal review and repair

- When evidence review is requested, create a different-model `citation-critic` child. Supply the exact
  original task, complete answer, evaluation packet, and delivery channel in one session-artifact
  packet. The critic may read only that packet and review-fetch only the exact Learn URLs already in
  References; it cannot search, add sources, invoke skills, or propose another architecture.
- For controlled routing experiments, anonymize arm metadata before review, fix the scoring rubric and
  task hash before either answer is inspected, and decode the arms only after the verdict.
- Send the critic's repair brief to the winning or original researcher with `Research mode: repair`.
  Unless explicitly authorized, repair reuses the existing source set. Verify the corrected normalized
  answer, then publish only its user-facing portion.
- Record what worked, failures, complementary findings, model disagreements, repair results, and
  evidence-backed system changes in the session improvement-log artifact. Do not add runtime storage.
