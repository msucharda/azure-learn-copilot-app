# Learn evidence pipeline operations

The production extension is `.github/extensions/learn-references/extension.mjs`. It uses only Node built-ins plus the bundled extension SDK at runtime.

## Storage roots

| Data | Configuration | Default | Visibility |
| --- | --- | --- | --- |
| Draft bundles and captured fetch Markdown | `COPILOT_LEARN_DRAFT_ROOT` | `$COPILOT_HOME/learn-references/drafts/<workspaceHash>` or the equivalent under `~/.copilot` | Current workspace only |
| Published evidence, lifecycle, handoffs, acknowledgements | `COPILOT_LEARN_PUBLISHED_ROOT` | `$COPILOT_HOME/learn-references/published` or `~/.copilot/learn-references/published` | Cross-session |
| Learn MCP endpoint | `COPILOT_LEARN_MCP_ENDPOINT` | `https://learn.microsoft.com/api/mcp` | Network transport; exact Learn host only |

Tests always configure fresh operating-system temporary directories. Runtime data is never written into the repository. A configured root may not itself be a symbolic link; descendants are checked on every access.

The default draft root is durable but workspace-keyed and separate from the cross-session published root. Delete a workspace's draft root after its captures are no longer needed. Published versions have no automatic expiry or garbage collection; retain them according to the surrounding application's evidence policy.

## Published layout

```text
published/
  evidence/<researchId>/<version>/payload.json
  evidence/<researchId>/<version>/lifecycle.json
  evidence/<researchId>/<version>/retention.json
  evidence/<researchId>/<version>/commit.json
  evidence/<researchId>/<version>/supersession.json
  retention/<fetchedContentHash>/budget.json
  retention/<fetchedContentHash>/handoffs/<reservationHash>.json
  handoffs/<parentSessionId>/<researchId>/<version>.json
  acknowledgements/<parentSessionId>/<researchId>/<version>.json
```

`payload.json`, the original published `lifecycle.json`, `retention.json`, and `commit.json` are immutable. The commit marker binds hashes of the initial lifecycle and complete fetched-content retention index. A published-to-superseded transition exclusively creates `supersession.json`; readers validate and compose that append-only metadata. Handoffs and acknowledgements never embed an evidence bundle or fetched page.

A read requires payload, lifecycle, and commit files and recomputes the immutable content hash. One missing file is an incomplete publication, not a partial success. Latest reads derive the greatest completely committed version from evidence directories, so a crash cannot strand a committed version behind an older pointer. Extension-owned temporary filenames are ignored by concurrent directory readers and are never interpreted as records.

## Tool flow

1. Discover Learn MCP tool definitions and map them to `docs-search`, `docs-fetch`, and `code-sample-search` with `LearnMcpAdapter`. Runtime names remain opaque.
2. Call `record_learn_evidence` with a `researchId`, logical operation, and bounded JSON-encoded tool arguments. The extension invokes the discovered Learn tool through its trusted transport. Result bodies, digests, counts, runtime names, and source URLs are adapter output and cannot be supplied by the caller.
3. Use the returned `observedAt` as the source `retrievedAt`, then call `validate_research_bundle`. Every declared source must be a verified `docs-fetch` source backed by the same canonical/retrieval URL, content digest, timestamp, and exact excerpt.
4. Call `publish_research_bundle`, optionally with a bounded handoff. Publication repeats validation and preflights the evidence key, all fetched-content budgets, and the handoff under one cross-process store lock before writing records. A dead-owner lock fails closed with `ABANDONED_STORAGE_LOCK`; remove that exact lock directory only after confirming no writer is active.
5. Call `get_research_bundle` with a version or omit it for `latest`. Every read verifies the content digest.

Tool handlers throw structured contract, adapter, or storage errors. Failed adapter/validation calls do not create success-shaped evidence records.

## Bounds and retention

- Fetch Markdown is limited to 262,144 characters and stays only in draft capture storage.
- Validation accepts at most 500 capture records for one research ID.
- Search result bodies are limited to 512,000 characters, 100 results, and 20,000 canonical JSON characters per result.
- Persisted bundle prose counts source-derived fetched-content spans: exact field values, exact excerpts, embedded matches of at least 32 characters, insertion-only decoration alignments that preserve mandatory text runs, aggregate directly verified short substrings, and bounded ordered reconstruction. Eight-character seeds only locate short candidates; direct equality extends them, and an order-independent occurrence allocator retains their concrete source intervals only after substantial union coverage is established. For fetched bodies of at least 512 characters, all separator characters absent from the page delimit reordered one-to-seven-character fragments; each component must still match an exact source substring and aggregate coverage must cross the same gate. The ordered pass starts at the longest directly verified source position, extends adjacent source windows forward and backward with a bounded filler ratio, and stops at its first failed window so repeated boilerplate elsewhere is not reserved. All matching paths are bounded and fail closed when unresolved placement could violate policy. Ordinary prose that merely shares common characters with a page does not consume the budget. Hidden controls in persisted prose and hidden controls/default-ignorable characters in fetched Markdown fail validation. One fetched-content digest has a durable cross-version/cross-research budget of at most 12,000 characters and cannot retain 90% or more of a page. URL aliases do not reset the budget.
- Handoffs use the same verified-span allocator and persist immutable interval reservations per fetched-content digest; unrelated prose consumes no budget. Reservations share the 12,000-character and 90% cumulative limits with bundle prose, so repeated, overlapping, partitioned, and decorated page copies remain rejected across handoffs. A new handoff stored separately from publication must receive the original bounded fetch captures again because published storage never retains the page body; an identical stored handoff remains idempotent without them. Legacy scalar reservations are reconstructed from their stored envelopes and fresh captures before any new reservation can be added.
- Every JSON storage record is preflighted and read with the same 8,000,000-byte limit.
- Hook/tool summaries retain hashes, counts, at most five Learn URLs, and a 1,000-character preview; published storage contains no fetched page body.
- Evidence bundle, source, excerpt, handoff, and unresolved-item limits remain the schema v1 limits in `docs/architecture.md`.

Automatic production hook capture is intentionally not registered. The confirmed hook shape does not provide both dynamically discovered tool schemas and a trusted `researchId`, so name heuristics would weaken the boundary. Use `record_learn_evidence` until the runtime supplies those values.

## Validation

Run all retained and production tests:

```sh
node --test
```

Check every production module:

```sh
find .github/extensions -name '*.mjs' -print0 | xargs -0 -n1 node --check
```
