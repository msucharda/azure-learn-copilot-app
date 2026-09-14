# Self-directed discovery

Ask in a normal project chat:

> I want to learn AKS.

The coordinator first explores what you already know and what you want to accomplish, one question at
a time in normal chat. After you confirm a short summary and proposed focus, it creates a Microsoft
Learn-backed prompt library, saves it as a session artifact, and starts `discovery-coach` with that
context. The training is built around your knowledge, not a predetermined beginner sequence.

The coach guides a natural conversation: a small scenario, one focused question, then feedback on your
answer. It builds toward the mission's goal over several turns instead of presenting a worksheet.
Progress stays in native conversation history; ordinary replies contain no checkpoint JSON, internal
IDs, or validation reports. Neither learning agent uses `ask_user` dialogs; answer in the normal chat
composer. Ask to export a checkpoint only when you need portable progress.

To personalize the library, include your experience, outcome, time, and practice preference:

> I know Kubernetes basics. Help me understand AKS operational responsibilities in five conceptual
> missions of 20 minutes each. I do not have an Azure subscription.

> Create a beginner learning library for Azure Storage. I want hands-on practice in my own disposable
> sandbox, but do not deploy anything for me.

Microsoft/Azure topics supported by fetched Learn documentation are the initial scope. This is not a
general-web tutor. The factory and generic coach need only Microsoft Learn MCP and use the same
library-driven workflow for every supported topic.

## Components and contracts

| Component | Responsibility |
| --- | --- |
| `prompt-library-factory` | Generate curriculum from the confirmed discovery summary, frozen objective, and fetched Learn evidence; inherit the coordinator model |
| `discovery-coach` | Explore goals and prior knowledge without a library, then coach a tailored path using GPT-6 Astra |
| `prompts/prompt-library.schema.json` | Declarative version 2 library structure: profile, refinement, variables, sources, ordered missions |
| `prompts/coaching-contract.md` | Shared learning loop, evidence gates, safety, and progress/resume contract |

The factory is a reusable project agent, not a registered Copilot factory or a project-defined runtime.
Neither it nor the coach can write files, run shell commands, deploy resources, or create sessions.
The normal coordinator uses Copilot App's built-in `/orchestrate` and native session tools; the agents
have only read, documentation, and correlated-callback tools. Questions are ordinary assistant messages,
not blocking tool calls. Live environment
and endpoint facts must come from narrowly scoped learner-provided evidence.

## Discovery before generation

For a new learning request, read the shared contract and conduct discovery in the current coordinator
chat before launching the factory. This is learning-specific conversation, not the research-only
ambiguity gate: even a clear topic can need exploration of prior knowledge. Use normal assistant
messages, never `ask_user`, and end each turn after one focused question.

Start from the learner's volunteered context. Explore a familiar task, mental model, or desired outcome;
follow their answer with a small scenario when useful, not a generic list of prerequisite questions.
Distinguish reported experience from demonstrated understanding and keep gaps, misconceptions, and
unknowns separate. Do not infer knowledge from a job title or force an expert through a beginner script.
Already supplied evidence and a confirmed summary can avoid a repeated interview.

The discovery summary covers goal/use case, reported experience, demonstrated concepts with brief
evidence, gaps, unresolved knowledge, relevant time/depth/practice preferences, assumptions, and proposed
emphasis. Keep it concise and in plain language. Confirm that summary before generation; missing
preferences can remain explicit assumptions instead of triggering a questionnaire.

If the learner asks to skip discovery or start immediately, record the explicit opt-out and unknowns.
Only then use beginner, seven missions, and 30 minutes as fallback values where information is absent.
Otherwise select depth and mission count from the confirmed summary. Conceptual practice is always
the safe default when unspecified; neither discussion nor a sandbox preference authorizes live work.

Selecting `discovery-coach` directly without a library also starts discovery. The coach cannot launch
the factory: pass its confirmed summary back to the coordinator, or explicitly request a bounded
summary callback with a fresh envelope. Direct learner turns never reuse the opening envelope or send
unsolicited callbacks. The coordinator retains the summary with the generation task; the learner need
not manage JSON or files. Without native orchestration, the learner can pass the plain summary to
`prompt-library-factory` manually.

## Coordinator generation protocol

1. Classify the request as clear, exploratory, or materially ambiguous using the repository refinement
   categories, resolving material interpretations in normal chat. After discovery confirmation or
   explicit opt-out, freeze the complete original request, selected refinement, discovery summary,
   confirmation/opt-out evidence, and learner profile. Scope changes require a new frozen task, not a
   silent rewrite. Do not create a generation hash from an unconfirmed default profile.
2. Read the shared contract and schema. Use 3-12 missions and 5-180 minutes per mission, chosen for the
   learner's goals and demonstrated knowledge. Use orientation, prediction, observation, diagnosis,
   and reflection as appropriate, not seven mandatory slots. Keep hands-on design, safety, and cleanup
   gates where applicable. If an explicit bound is outside the contract, explain it and ask in chat
   rather than clamp it.
3. Invoke `/orchestrate`. Freeze and hash the complete generation task, including the profile,
   confirmed discovery summary or explicit opt-out, and original/refined request, and generate a unique
   callback nonce. Start one `prompt-library-factory`
   child with that entire task in one kickoff, callback session ID, task SHA-256, callback nonce,
   `coordinate_with_creator: true`, and `notify_on_idle: always`. Use `context_tier: default`; omit
   `model` and `reasoning_effort` so the child inherits the coordinator's active settings, and never ask
   the user to supply them. Record observed child settings when available and stop if the runtime reports
   a mismatch rather than substituting. Curriculum generation is not a `learn-researcher` answer: omit
   research-only mode/phase fields and do not apply its word ceiling to JSON.
4. Apply the existing expected-child/hash/nonce checks for STARTED and COMPLETED/FAILED, branch
   inheritance, recovered delivery, and duplicate/idle handling. If the agent changes are unmerged,
   commit and push first, pass that feature branch as the base, and verify the expected commit.
   Never deliver the work in a follow-up message, and never treat idle as library completion.
5. Accept only a complete version 2 JSON library. Check it against the schema and semantic preflight:
   unique mission/source IDs and URLs, no dangling or unused sources, declared placeholders, coverage
   of the frozen scope, mission duration bounds, and conceptual-only missions for a conceptual profile.
   Check the child trace for successful fetches and support of material curriculum claims. An agent's
   claim to have fetched a URL is not a substitute for that trace. Preserve gaps and safety refusals;
   never publish an invalid library as ready.
   Also check personalization: the chosen starting point and examples connect to the summary,
   confirmed priorities have coverage, and known concepts are not padded into redundant missions.
   Self-reported familiarity must not be converted to passed evidence. `DISCOVERY_PROFILE_REQUIRED`
   means return to discovery, not retry the same missing-profile task or silently fill defaults.
6. Save the accepted JSON unchanged as a new UTF-8 file in the coordinator's session artifact directory,
   using a unique topic/run name. Compute its SHA-256 from the saved bytes and retain a separate
   generation record containing the task identity, library digest, confirmed discovery summary,
   confirmation/opt-out evidence, source provenance, model record, and artifact path.
   Do not overwrite an existing library or commit learner-specific data. The
   factory's output is not a saved artifact until this step succeeds.

The JSON schema intentionally contains no tool grants, deployment authority, secrets, or progress
state. `variables` are named, described literal values; unknown values are null. `sources` contains
only successful fetched Learn URLs, inspected support clauses, and a tool-exposed retrieval timestamp
or null. Every mission names its source IDs and has progressive hints, required evidence, and an exit
criterion. Schema version 2 stays unchanged: the discovery summary travels in the generation
packet/record and coach kickoff, not a new required library or checkpoint field. Existing artifacts
remain compatible. Shape checks do not prove personalization, citation quality, safety, or achievement.

## Starting and continuing the journey

After retention succeeds, create one `discovery-coach` native session in **interactive** mode, using
`gpt-6-astra` and `context_tier: default`. Its complete kickoff contains the original/refined learning
request, complete confirmed discovery summary or explicit opt-out, exact authorized library path,
saved library SHA-256, and a fresh task hash/nonce/callback
envelope. Use coordination and always-on idle notifications as above, and the same pushed base branch
when needed. Supply paths in the kickoff text, not generated Markdown attachments. For a remote child
that cannot read a local artifact, put the complete JSON inline in the kickoff instead; do not send an
unreachable local path or imply that an attachment was staged.
If discovery happened in an existing coach session, reuse that session with the same complete
continuation task and a fresh envelope instead of discarding its history. Supply any summary packet
through its exact authorized path or inline; never send a remote child an unreachable path.

The coach's first callback contains one short conversational opening and one focused question, not a
mission rubric or checkpoint. Specify the shared learner-facing conversation rules in the kickoff:
build on the confirmed discovery context without repeating the interview, start with one relevant
small scenario, and finish with
the question before any References. Do not request an automatic Progress checkpoint or `next_question`.
Retain that exact result, show the library location and opening turn, and navigate the learner to the
coach session for direct interaction. Do not automatically archive this session: it is the learner's
ongoing journey. Direct follow-ups omit callback fields; the agent must not reuse the first envelope.
Keep the learner handoff brief: use a short library artifact link and the conversational opening, not
the factory's JSON, validation log, model settings, hashes, or callback acknowledgments as a briefing.
If the learner stays in the coordinator instead, relay the question unchanged in ordinary chat and
send each subsequent bounded task with a fresh envelope. No child should block on a question tool.

A copied mission is also usable: select `discovery-coach`, provide the full library inline or its
exact authorized file path, and paste the mission prompt. The coach still enforces mission order.
Selecting `prompt-library-factory` directly without a confirmed summary starts conversational
discovery, unless the learner explicitly opts out. After confirmation, standalone generation produces
JSON that must be passed to the coach by the learner or coordinator, since the factory cannot persist
files or start sessions.
If native orchestration is unavailable, explain this manual path without claiming an automatic handoff.

## Progress, resumption, and changes

Native session history persists the conversation and its evidence. At a mission boundary or requested
pause, the coach gives a brief plain-language recap, not a `Progress checkpoint` JSON block. Waiting
for an answer is not a pause/export request. In an active coordinated turn, the actual question is the
final sentence before any References; direct follow-ups also use ordinary chat after brief feedback.

Only an explicit learner or coordinator request produces a checkpoint export, in a separate turn.
The learner can copy it, or the coordinator can retain it as a separate session artifact without
forwarding its JSON into normal coaching. Keep the shared checkpoint fields, including `next_question`
(null if none is pending), verified digest, evidence, and unresolved items. A read-only coach must not
claim that it wrote a progress file. Keep evidence summaries minimal and sanitized, not raw tenant data
or secrets.
Before a library exists, native history and the plain-language discovery summary are sufficient to
resume the conversation; do not invent library-bound checkpoints. On explicit request, export the
discovery summary as plain text. Once a library exists, the existing v2 checkpoint format applies.

To resume in the existing coach session, ask it to continue from the conversation; no export is
required. If history is incomplete, recover the smallest missing evidence rather than guessing a pass.
For a transfer to a new session, request an export and give the coordinator the exact library and
checkpoint paths. The coordinator recomputes
the library digest and supplies the verified digest, complete task, and separately authorized paths
in one new coach kickoff. Inline JSON is the alternative for a remote session. The coach checks
identity, mission IDs/order, claimed evidence, and current safety proof; stale or inconsistent progress
cannot unlock a mission. Missing or mismatched digests require re-establishing evidence, not trusting
a pasted `passed` flag.
The coach offers concise prior evidence for review or a fresh attempt at the first unproved criterion,
rather than automatically making the learner repeat the whole curriculum.

Changing subject, objectives, or conceptual/sandbox preference creates a revised library in a new
artifact. Do not copy passed states across changed objectives. A library cannot grant privileges or
turn a conceptual result into a proved live experiment.
Within the agreed path, use prior explanations to shorten redundant instruction only after checking
them against the current mission criteria. Tailor examples, hints, and pacing as new gaps emerge.
If discovery or later answers require a different scope or order, confirm the revised emphasis and
generate a new library. Do not silently mutate the retained library or bypass safety prerequisites.

## Hands-on boundaries

Sandbox practice is always learner-executed. Before an executable step, require current proof of a
disposable owned target, exact scope, permissions, baseline, cost exposure, approval, rollback,
timeout, and cleanup. Reject production/shared targets and irreversible changes. Generated variable
values, broad administrator access, documentation, and past checkpoints are not proof of safety.

The shared contract also applies endpoint-specific safeguards when relevant: single assigned-device
proof, no **All users**/**All devices** assignments, no destructive device actions, and no tenant-wide
changes. A generated library cannot override these restrictions or invent live evidence.

## Live validation (explicit opt-in)

A request to generate a library never authorizes cloud access. When the user explicitly requests
validation against actual Azure behavior, the coordinator may act as the test operator with approved
Azure or computer-use tools. The factory and coach remain read-only; do not expand their tool lists.

Confirm the requested identity and tenant before connecting, then select an approved subscription
and exact disposable scope. Start read-only. Obtain separate approval for resource creation,
access/network configuration, budget, payload bounds, and teardown; never reuse a shared resource
merely because an administrator can access it. Keep credentials and raw sensitive data out of artifacts.

Record expected versus observed behavior and the evidence plane for each tested step. Resource
visibility in the portal, deployment success, and what-if output do not establish data-plane access.
Compare actual post-deployment settings with the plan: inherited policies can reject or modify
configuration. Test a bounded metadata read from the intended client before an upload or other write.
Separate authentication/RBAC from endpoint, DNS, network/perimeter, and policy failures.

Portal hints and token or control-plane telemetry are not proof of the data request's source address.
Do not follow generic suggestions to allow all networks, use keys, or exempt policy to clear an error.
Correct only the approved scope; if access still fails, revise the hypothesis and report the remaining
blocker. Never report a completed round trip when upload, read-back, or cleanup was not observed.

Environment setup, authentication delays, connectivity preparation, and policy remediation are outside
the active mission timer and must be visible as prerequisites, not hidden extra work. Operator tests
do not prove that a learner passed a mission or that the advertised time budget was met.

Retain sanitized observations and relevant errors in session artifacts. Teardown requires its own
approved scope: remove only the operator-created lab and temporary grants, then verify their removal.
Distinguish fixture teardown from the mission's rollback or retained-data proof. State billing
uncertainty rather than claiming zero cost from an empty listing or an unavailable billing record.

## Contract checks

`node --test` covers the supported agent inventory, shared coaching safety, and generic v2 library contracts.
To include an actual generated artifact in the existing test runner, set `PROMPT_LIBRARY_ARTIFACT` to
its exact local JSON path and run `node --test .\test\prompt-library.test.mjs`. This is optional
development validation, not a runtime service; without that variable the live-artifact case is skipped.
Synthetic fixtures test shape and rejection paths only. Generation quality, callback delivery,
interactive behavior, and safety still require native-session evidence.
For an active coordinated coaching response, set `COACHING_RESPONSE_ARTIFACT` to its saved Markdown
and run `node --test .\test\coaching-response.test.mjs`. The ordinary-turn check requires a short reply
with one visible question at the end before References and rejects checkpoint/transport metadata,
including the former question-plus-JSON shape. It does not ban relevant technical JSON examples.
Explicit checkpoint exports and requested long explanations are different output shapes, not inputs
to this check. Shape checks do not assess teaching quality, safety, or factual support: inspect a
native opening and learner follow-ups, including a misconception and a request for explanation.
For an unprofiled discovery opening without a library, set `DISCOVERY_RESPONSE_ARTIFACT` to its saved
Markdown and use the same runner. Set `LEARNING_TRACE_ARTIFACT` to the exact native `events.jsonl` path
to check for question-dialog calls. Inspect the native trace as well: normal and coordinated turns
must not call `ask_user`, generate a curriculum before confirmation, or invent passed states. Inspect
factory output against the confirmed summary, not merely the v2 schema.
