---
name: publish-research-draft
description: Validate and publish the current Microsoft Learn research Markdown draft when the user says "publish" or asks to hand it to the parent researcher.
---

# Publish research draft

Use this skill only after the user explicitly says **publish** or clearly requests a parent handoff.

1. Keep the draft in a Markdown file and open that file in the editor canvas while it is being reviewed.
2. Read the complete draft before publishing. Reject the publish request if required spike outcomes, evidence, production decisions, or validation results are missing.
3. Do not publish full Microsoft Learn pages, secrets, local absolute paths, runtime session IDs in repository content, or unbounded tool output.
4. Build a concise handoff containing:
   - PASS/PARTIAL/FAIL matrix
   - production decisions and fallbacks
   - changed files
   - validation results
   - commit SHA and PR URL when available
   - blockers that affect later work
5. If a coordinator session ID is present in the active task context, send the handoff with the app-native session messaging tool using immediate delivery. Never copy that live ID into the draft.
6. If app-native messaging is unavailable or no coordinator is in context, return this manual envelope in chat:

```text
[RESEARCH_DRAFT_PUBLISH]
status: ready
source: <repository-relative Markdown path>
summary: <bounded summary>
decisions: <bounded production decisions>
validation: <bounded validation results>
```

The user's publish message is confirmation to validate and hand off the current file; it is not permission to bypass missing evidence or validation.
