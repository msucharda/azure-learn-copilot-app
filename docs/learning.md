# Self-directed discovery

Ask in a normal project chat:

> I want to learn AKS.

The coordinator creates a Microsoft Learn-backed prompt library, saves it as a session artifact, and
starts `discovery-coach` at the first mission. The default is beginner, seven missions of up to
30 minutes each, and conceptual practice without a subscription or live resources. These are visible
assumptions, not answers attributed to the learner. Broad topic discovery is intentional; it does not
need a questionnaire before starting.

To personalize the library, include your experience, outcome, time, and practice preference:

> I know Kubernetes basics. Help me understand AKS operational responsibilities in five conceptual
> missions of 20 minutes each. I do not have an Azure subscription.

> Create a beginner learning library for Azure Storage. I want hands-on practice in my own disposable
> sandbox, but do not deploy anything for me.

Microsoft/Azure topics supported by fetched Learn documentation are the initial scope. This is not a
general-web tutor. The factory and generic coach need only Microsoft Learn MCP; Enterprise MCP remains
optional and exclusive to the existing Intune workshop.

## Components and contracts

| Component | Responsibility |
| --- | --- |
| `prompt-library-factory` | Generate curriculum from the frozen objective and current fetched Learn evidence; inherit the coordinator model |
| `discovery-coach` | Coach one mission at a time using GPT-6 Astra, without resource-access tools |
| `prompts/prompt-library.schema.json` | Declarative version 2 library structure: profile, refinement, variables, sources, ordered missions |
| `prompts/coaching-contract.md` | Shared learning loop, evidence gates, safety, and progress/resume contract |
| `intune-discovery-coach` | Retain the specialized v1 workshop and its stricter Entra/Intune safety boundaries |

The factory is a reusable project agent, not a registered Copilot factory or a project-defined runtime.
Neither it nor the coaches can write files, run shell commands, deploy resources, or create sessions.
The normal coordinator uses Copilot App's built-in `/orchestrate` and native session tools; the agents
have only read, documentation, learner-question, and correlated-callback capabilities. Intune alone
retains its reviewed read-only Enterprise MCP access.

## Coordinator generation protocol

1. Classify the request as clear, exploratory, or materially ambiguous using the repository refinement
   gate. Ask one focused question only when different interpretations change the product, objective,
   evidence plan, or risk. Freeze the complete original request and selected refinement. Set the
   learner's experience, goal, session duration, practice mode, and desired mission count from the
   request or explicit assumptions. Scope changes require a new frozen task, not a silent rewrite.
2. Read the shared contract and schema. Use 3-12 missions and 5-180 minutes per mission; the default
   seven-stage progression is orientation, prerequisites, experiment design, safety review, observation,
   diagnosis, and reflection/cleanup. Adapt the stages to conceptual reasoning when no sandbox was
   requested. If an explicit bound is outside the contract, explain it and ask rather than clamp it.
3. Invoke `/orchestrate`. Freeze and hash the complete generation task, including the profile and
   original/refined request, and generate a unique callback nonce. Start one `prompt-library-factory`
   child with that entire task in one kickoff, callback session ID, task SHA-256, callback nonce,
   `coordinate_with_creator: true`, and `notify_on_idle: always`. Use `context_tier: default` and pass
   the coordinator's exact active model ID. Record parent, requested, and observed child models;
   stop rather than substitute on a mismatch. Curriculum generation is not a `learn-researcher`
   answer: omit research-only mode/phase fields and do not apply its word ceiling to JSON.
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
6. Save the accepted JSON unchanged as a new UTF-8 file in the coordinator's session artifact directory,
   using a unique topic/run name. Compute its SHA-256 from the saved bytes and retain a separate
   generation record containing the task identity, library digest, source provenance, model record,
   and artifact path. Do not overwrite an existing library or commit learner-specific data. The
   factory's output is not a saved artifact until this step succeeds.

The JSON schema intentionally contains no tool grants, deployment authority, secrets, or progress
state. `variables` are named, described literal values; unknown values are null. `sources` contains
only successful fetched Learn URLs, inspected support clauses, and a tool-exposed retrieval timestamp
or null. Every mission names its source IDs and has progressive hints, required evidence, and an exit
criterion. Shape checks do not prove citation quality, safe operations, or learner achievement.

## Starting and continuing the journey

After retention succeeds, create one `discovery-coach` native session in **interactive** mode, using
`gpt-6-astra` and `context_tier: default`. Its complete kickoff contains the original/refined learning
request, exact authorized library path, saved library SHA-256, and a fresh task hash/nonce/callback
envelope. Use coordination and always-on idle notifications as above, and the same pushed base branch
when needed. Supply paths in the kickoff text, not generated Markdown attachments. For a remote child
that cannot read a local artifact, put the complete JSON inline in the kickoff instead; do not send an
unreachable local path or imply that an attachment was staged.

The coach's first callback contains one bounded opening turn with the mission and first question.
Retain that exact result, show the library location and opening turn, and navigate the learner to the
coach session for direct interaction. Do not automatically archive this session: it is the learner's
ongoing journey. Direct follow-ups omit callback fields; the agent must not reuse the first envelope.
If the learner stays in the coordinator instead, relay the question with `ask_user` and send each
subsequent bounded task with a fresh envelope. No child should wait on a learner question during a
coordinated turn.

A copied mission is also usable: select `discovery-coach`, provide the full library inline or its
exact authorized file path, and paste the mission prompt. The coach still enforces mission order.
Selecting `prompt-library-factory` directly supports standalone generation; its JSON must be passed
to the coach by the learner or coordinator, since the factory cannot persist files or start sessions.
If native orchestration is unavailable, explain this manual path without claiming an automatic handoff.

## Progress, resumption, and changes

The coach returns a `Progress checkpoint` at each mission boundary or pause. Native session history
persists the conversation. The learner can copy a checkpoint; a coordinator can retain it as a
separate session artifact when asked. A read-only coach must not claim that it wrote a progress file.
Keep evidence summaries minimal and sanitized, not raw tenant data or secrets.
In coordinated turns, the actual next question appears in ordinary prose before the checkpoint, with
the same question in `next_question`; it must not be hidden only in JSON.

To resume in the existing coach session, ask it to continue from the last checkpoint. To resume in a
new session, give the coordinator the exact library and checkpoint paths. The coordinator recomputes
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

## Hands-on boundaries

Sandbox practice is always learner-executed. Before an executable step, require current proof of a
disposable owned target, exact scope, permissions, baseline, cost exposure, approval, rollback,
timeout, and cleanup. Reject production/shared targets and irreversible changes. Generated variable
values, broad administrator access, documentation, and past checkpoints are not proof of safety.

For Intune hands-on requests, use `intune-discovery-coach` with
`prompts/intune/prompt-library.json`, not a generated substitute. Its seven missions, single assigned
device proof, **All users**/**All devices** prohibition, and manual-change gates remain unchanged.
The generic coach can support conceptual Intune discussion without Enterprise access, but it must not
approximate the specialized workshop's live evidence.

## Contract checks

`node --test` covers both the preserved Intune v1 library and generic v2 structural contracts.
To include an actual generated artifact in the existing test runner, set `PROMPT_LIBRARY_ARTIFACT` to
its exact local JSON path and run `node --test .\test\prompt-library.test.mjs`. This is optional
development validation, not a runtime service; without that variable the live-artifact case is skipped.
Synthetic fixtures test shape and rejection paths only. Generation quality, callback delivery,
interactive behavior, and safety still require native-session evidence.
For an active coordinated coaching response, set `COACHING_RESPONSE_ARTIFACT` to its saved Markdown
and run `node --test .\test\coaching-response.test.mjs` to check that the actual question is visible
before, and agrees with, its checkpoint. This does not assess the answer's factual or teaching quality.
