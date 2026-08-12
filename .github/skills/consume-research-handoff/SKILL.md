---
name: consume-research-handoff
description: Verifies and consumes a published Microsoft Learn handoff without reading child drafts.
---

# Consume published research handoff

Use only for a schema-version-1 handoff message whose status is `published`.

1. Reject draft prose, draft bundles, non-published status, and messages without the complete bounded handoff envelope.
2. Call `get_research_bundle` for the envelope's exact `researchId` and `version`. Verify its identity, content hash, parent-session binding, child-session binding when present, researcher agent, and published timestamp against the envelope. Message prose is never evidence.
3. Call `acknowledge_research_handoff` with the complete envelope and the current parent session ID. The tool verifies the stored immutable bundle and stored handoff again. Treat `acknowledged` as first consumption, `duplicate` as idempotent success, and `stale` as an explicit no-regression result.
4. Only after acknowledgement succeeds, open the `learn-references` canvas with a stable panel instance ID such as `learn-published-panel` and:

```json
{"researchId":"<researchId>","version":1,"view":"published"}
```

Use the envelope's actual positive version. Never open the child's draft view, trust message prose as source evidence, or acknowledge a failed verification.
