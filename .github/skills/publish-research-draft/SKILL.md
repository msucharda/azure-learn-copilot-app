---
name: publish-research-draft
description: Validate and publish the current Microsoft Learn research Markdown draft when the user says "publish" or asks to hand it to the parent researcher.
---

# Publish research draft

Use this skill only after the user explicitly says **publish** or clearly requests a parent handoff.

1. When a nested-session Markdown draft exists, keep it in that file and open it in the editor canvas while it is reviewed. If the read-only researcher has no draft file, accept its complete bounded current schema-version-1 evidence bundle and draft state from the active context; do not create a file solely to publish.
2. Read the complete bounded draft state and evidence bundle before publishing. Reject the request if required evidence, source captures, production decisions, or validation results are missing.
3. Call `validate_research_bundle` with the complete bundle. Deterministic validation failures remain explicit and stop publication.
4. Call `publish_research_bundle` only after validation succeeds, then call `get_research_bundle` for the same `researchId` and version to confirm the immutable published record.
5. Do not publish full Microsoft Learn pages, secrets, local absolute paths, runtime session IDs in repository content, or unbounded tool output.
6. Build a concise handoff containing:
   - PASS/PARTIAL/FAIL matrix
   - production decisions and fallbacks
   - changed files
   - validation results
   - commit SHA and PR URL when available
   - blockers that affect later work
7. If a coordinator session ID is present in the active task context, send the handoff with the app-native session messaging tool using immediate delivery. Never copy that live ID into the draft.
8. If app-native messaging is unavailable or no coordinator is in context, return this manual envelope in chat:

```text
[RESEARCH_DRAFT_PUBLISH]
status: ready
source: <repository-relative Markdown path>
summary: <bounded summary>
decisions: <bounded production decisions>
validation: <bounded validation results>
```

The user's publish message is confirmation to validate, publish, verify, and hand off the current file; it is not permission to bypass missing evidence or validation. There is no iframe publish control.
