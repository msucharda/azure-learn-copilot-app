---
name: start-learn-research
description: Starts quick or isolated Microsoft Learn research while preserving one stable research identity.
---

# Start Learn research

Use this workflow when the user asks to research an Azure or Microsoft Foundry question.

1. Present exactly two choices: **Refine here** and **Open deep research session**. Side Chat is also a user-initiated UI path for refinement; the host exposes no programmatic Quick Chat creation API.
2. Call `prepare_learn_research` with the selected machine choice, the original and normalized question, normalized scope, constraints, current parent session ID, bounded evidence seed, and unresolved questions. Omit `researchId` only for the first turn. Reuse the returned UUID-v4 for every quick refinement, deep promotion, and later version.
3. For **Refine here**, continue in this chat with the returned state. Do not create a session.
4. For **Open deep research session**, call the app-native `create_session` tool with the current project ID, `coordinate_with_creator: true`, `notify_on_idle: "once"`, and this kickoff:

```json
{
  "mode": "interactive",
  "agent": "learn-researcher",
  "prompt": "<exact prepare_learn_research kickoff>"
}
```

Use local execution unless the user explicitly requires cloud execution. Do not substitute a generic agent or rewrite the standalone kickoff. The child must re-fetch and record evidence needed for validation; copied seed summaries and URLs are discovery context, not trusted captures.

The user refines evidence only in the child after promotion. The parent does not read, retrieve, summarize, or synthesize child draft evidence.

An idle notification means only that the child stopped running. Never describe research as successful or a draft as ready from that notification. A published handoff is the only completion signal consumed by the parent.
