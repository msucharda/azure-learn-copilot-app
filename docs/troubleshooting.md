# Learn research troubleshooting

| Code or symptom | Meaning | Operator response |
| --- | --- | --- |
| `PROTOCOL_FAILURE` | Network failure or timeout after bounded retries | Retry later; do not describe the research as successful |
| `PROTOCOL_HTTP_ERROR` with 429 | Rate limited after bounded retries | Honor the surfaced outage; Microsoft publishes no numeric Learn MCP quota to cite |
| `PROTOCOL_HTTP_ERROR` with 5xx | Learn service remained unavailable | Retry later; preserve unresolved claims |
| `UNSAFE_PROTOCOL_REDIRECT` | Endpoint or response attempted a redirect | Correct the exact Learn endpoint; redirects are never followed |
| `SCHEMA_DRIFT`, `INVALID_TOOLS_LIST`, or `UNKNOWN_RESULT_SHAPE` | Runtime tool/result schema is unsupported | Inspect discovered schemas and update the adapter; do not coerce the result |
| `AUTHORITATIVE_DRAFT_MISMATCH` | Publish input differs from the persisted validated draft | Revalidate and persist the exact final draft before publishing |
| `AUTHORITATIVE_DRAFT_NOT_VALIDATED` | Explicit validated state is missing | Complete validation and persist the validated revision |
| `HANDOFF_NOT_FOUND` or binding mismatch | Handoff is absent or belongs to another parent/version | Verify stored publication and use the exact bounded envelope |
| `stale` acknowledgement | An older handoff arrived after a newer one | Keep the newer acknowledgement; no regression is written |

The adapter does not retry caller errors, redirects, protocol/schema/domain failures, or invalid
hosts. It retries only 429, transient 5xx, timeouts, and network failures, with small attempt and
total-delay caps and bounded jitter. A valid bounded `Retry-After` is honored.

There is no full-page fetch cache. Fresh fetches are required before evidence reuse; caching a page
in the always-live record path would make freshness misleading and could permit stale excerpt
reuse. The adapter retains only discovered tool metadata for the active connection. Long-lived
evidence must be re-fetched and revalidated before a later publication. The one-entry validated
tool-schema mapping expires after five minutes by default and is refreshed from `tools/list`.

To clean up, remove only the exact workspace draft root after its research is no longer needed.
Retain or remove published evidence, handoffs, and acknowledgements according to the application
evidence policy. Never recursively remove the Copilot home or repository root.

Short attributed Microsoft Learn excerpts and canonical links are evidence, not permission to
redistribute full pages. Do not publish full-page captures. Obtain legal review before commercial
release. This repository does not provide legal advice.
