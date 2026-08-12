---
name: publish-research-draft
description: Validate and publish the current Microsoft Learn research Markdown draft when the user says "publish" or asks to hand it to the parent researcher.
---

# Publish research draft

Use this skill only after the user explicitly says **publish** or clearly requests a parent handoff.

1. Keep review in the child session and its `learn-references` draft canvas. If a nested-session Markdown draft also exists, it may remain in that file, but the persisted bounded schema-version-1 bundle is authoritative. Do not create a file solely to publish.
2. Read the complete bounded draft state and evidence bundle before publishing. Reject the request if required evidence, source captures, production decisions, or validation results are missing.
3. Build the complete bounded schema-version-1 handoff envelope from the bundle. Call `validate_research_bundle` with the complete final revision. Deterministic validation failures remain explicit and stop publication and handoff.
4. Immediately after validation succeeds, call `persist_research_draft` with that exact final revision in `validated` status. This persisted revision is authoritative. Build the `published` representation only by applying its valid lifecycle transition; do not change immutable content.
5. Call `publish_research_bundle` with that matching published representation and handoff, then call `get_research_bundle` for the same `researchId` and version. Verify identity, version, status, content hash, parent binding, child binding when present, researcher agent, and `publishedAt` before sending anything.
6. Do not publish full Microsoft Learn pages, secrets, local absolute paths, runtime session IDs in repository content, or unbounded tool output.
7. If the coordinator parent session ID is present in active runtime context, call app-native `send_session_message` with `delivery_mode: "immediate"` and message content equal to the schema-version-1 handoff envelope JSON only. Send exactly once after successful read-back. Never send a draft, extra prose, a fetched page, or a live ID outside the envelope's schema field.
8. If app-native messaging is unavailable, return the same complete bounded schema-version-1 handoff envelope as copyable JSON in chat. Do not invent a success-shaped substitute:

```json
{
  "schemaVersion": 1,
  "researchId": "<uuid-v4>",
  "version": 1,
  "status": "published",
  "parentSessionId": "<uuid-v4>",
  "researcherAgent": "learn-researcher",
  "executiveFindings": [{"claimId":"claim-example","text":"<bounded finding>"}],
  "unresolvedRisks": [],
  "contentHash": "<sha256>",
  "publishedAt": "<timestamp>"
}
```

The user's publish message is confirmation to validate, publish, verify, and hand off the current bundle; it is not permission to bypass missing evidence or validation. Publishing is an agent turn. There is no canvas button, iframe publish control, or session-send bridge.
