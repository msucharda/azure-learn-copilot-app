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

Workspace draft captures may contain bounded fetched Markdown. Published records contain only
bounded excerpts, hashes, lifecycle metadata, retention intervals, handoffs, and acknowledgements.
Evaluation reports contain no full fetched page. Cleanup must target only the exact configured
draft or published root.

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
3. For a fetch capture, call `read_learn_evidence_capture` with its `researchId`, `captureId`, and a bounded offset/length. It returns at most 4,096 exact Markdown characters and rejects non-fetch, cross-research, out-of-range, and complete-body reads.
4. Use the returned `observedAt` as the source `retrievedAt`. Call `persist_research_draft` to validate and store non-published revisions for the draft canvas; invalid bundles are not written.
5. On explicit publication, call `validate_research_bundle`, then immediately call `persist_research_draft` with that exact final revision in `validated` status. Call `publish_research_bundle` only with an immutable-content-identical `published` transition and the complete bounded handoff. Missing, stale, mismatched, or non-validated persisted drafts fail before any published record or handoff write. Publication repeats validation and preflights the evidence key, all fetched-content budgets, and the handoff under one cross-process store lock before writing records. A dead-owner lock fails closed with `ABANDONED_STORAGE_LOCK`; remove that exact lock directory only after confirming no writer is active.
6. Call `get_research_bundle` with the exact version to verify immutable read-back before handoff delivery.
7. In the parent, call `get_research_bundle` and then `acknowledge_research_handoff` with the delivered envelope and current parent session ID. The tool accepts only the stored matching handoff/bundle, returns `duplicate` idempotently, and returns `stale` without regression for an older delivery.
8. After publishing a valid later version, call `supersede_research_bundle` only when lifecycle metadata for an older version should become superseded.

Tool handlers throw structured contract, adapter, or storage errors. Failed adapter/validation calls do not create success-shaped evidence records.

The HTTP transport defaults to three attempts, 100 ms exponential base delay, 1,000 ms per-delay
cap, 2,000 ms total-delay cap, 2,000 ms bounded `Retry-After`, and 25% jitter. Configuration and
hard safety caps are listed in `docs/setup.md`. Only 429, transient 5xx, timeout, and network
failures retry. Every chosen delay, including `Retry-After`, is clamped by the 1,000 ms default
per-delay cap and then by the total-delay cap. Rate limits and outages remain explicit failures.

## Reference canvas operation

The `learn-references` canvas accepts:

```json
{
  "researchId": "12345678-1234-4234-8234-123456789abc",
  "version": 1,
  "view": "published"
}
```

`version` is optional and resolves to the latest complete record in the selected store. Inputs reject additional properties, malformed/non-lowercase UUIDs, non-positive or unsafe versions, and any view other than `draft` or `published`. Storage validation remains authoritative, so traversal, symlink, incomplete publication, malformed record, and content-hash failures are surfaced as unavailable errors without filesystem details.

Every open panel owns an unpredictable loopback port on `127.0.0.1`; no port is configured or externally bound. Concurrent open/rehydration requests for one instance are serialized and reuse its server. Closing the panel releases its SSE clients, heartbeat, sockets, and port. At most eight SSE clients attach to one instance, heartbeat comments are sent every 25 seconds, and a client is immediately evicted if any SSE write reports backpressure. Repaint messages contain only a revision number, request bodies are limited to 256 bytes, and projected state is limited to 4,000,000 bytes.

Agent-facing actions are read-only:

| Action | Input | Effect |
| --- | --- | --- |
| `refresh` | `{}` | Revalidates the selected record and emits one SSE repaint event |
| `set_support_filter` | `{ "support": "all\|supported\|partially-supported\|unsupported\|conflicting" }` | Changes the claim matrix filter for this panel |

The embedded refresh button calls the same loopback-only refresh path. There is no publish endpoint, `session.send` bridge, remote script/style, or fetched-page route. Publishing is an explicit child-agent turn through `publish-research-draft`.

## Nested session operation

Invoke `start-learn-research` in the parent. The deep path calls `prepare_learn_research`, then creates a coordinated interactive project child with the returned kickoff, `learn-researcher`, and an idle notification. The child uses `learn-draft-panel` (or another stable non-research ID) for the draft canvas. The parent uses a separate stable panel ID such as `learn-published-panel` only after verified acknowledgement.

The end-to-end live publish probe is intentionally manual because production publication writes durable shared evidence. To test without pollution, start the extension with fresh temporary `COPILOT_LEARN_DRAFT_ROOT` and `COPILOT_LEARN_PUBLISHED_ROOT`, run quick preparation, promote the returned `researchId` into a coordinated child, record one bounded fetch, persist and open the draft, explicitly publish, verify immediate schema-v1 delivery in the parent, acknowledge it, and open `{ "researchId": "<same-id>", "version": 1, "view": "published" }`. Confirm a duplicate returns `duplicate`, then remove only those exact temporary roots.

## Bounds and retention

- Fetch Markdown is limited to 262,144 characters and stays only in draft capture storage.
- Validation accepts at most 500 capture records for one research ID.
- Search result bodies are limited to 512,000 characters, 100 results, and 20,000 canonical JSON characters per result.
- Persisted bundle prose counts source-derived fetched-content spans: exact field values, exact excerpts, embedded matches of at least 32 characters, insertion-only decoration alignments that preserve mandatory text runs, aggregate directly verified short substrings, and bounded ordered reconstruction. Eight-character seeds only locate short candidates; direct equality extends them, and a schema group must establish substantial coverage before its short requests contribute. For fetched bodies of at least 512 characters, separator characters absent from the page delimit reordered one-to-seven-character fragments, each of which must still be an exact source substring. Detector stages retain prose provenance and exclude positions already attributed by an earlier stage. Exact, decorated, short, and structural requests then enter one multiplicity-preserving occurrence allocation; confirmed ordered intervals and durable intervals from prior publications or handoffs seed that same covered bitmap. Distinct fields reserve distinct repeated occurrences where possible, but overlapping detector views of one field and legitimate subrange reuse remain union-based. The ordered pass starts at the longest directly verified source position, extends adjacent source windows forward and backward with a bounded filler ratio, and stops at its first failed window so repeated boilerplate elsewhere is not reserved. Only a window whose forward and backward replay agrees on one bounded prose range becomes confirmed coverage; tied mappings use bounded ambiguity accounting and fail closed if policy cannot be proven. All matching and allocation paths are bounded and fail closed when unresolved placement could violate policy. Ordinary prose that merely shares common characters with a page does not consume the budget. Hidden controls in persisted prose and hidden controls/default-ignorable characters in fetched Markdown fail validation. One fetched-content digest has a durable cross-version/cross-research budget of at most 12,000 characters and cannot retain 90% or more of a page. URL aliases do not reset the budget.
- Handoffs use the same verified-span allocator and persist immutable interval reservations per fetched-content digest; unrelated prose consumes no budget. Reservations share the 12,000-character and 90% cumulative limits with bundle prose, so repeated, overlapping, partitioned, and decorated page copies remain rejected across handoffs. A new handoff stored separately from publication must receive the original bounded fetch captures again because published storage never retains the page body; an identical stored handoff remains idempotent without them. Legacy scalar reservations are reconstructed from their stored envelopes and fresh captures before any new reservation can be added.
- Every JSON storage record is preflighted and read with the same 8,000,000-byte limit.
- Hook/tool summaries retain hashes, counts, at most five Learn URLs, and a 1,000-character preview; published storage contains no fetched page body.
- Evidence bundle, source, excerpt, handoff, and unresolved-item limits remain the schema v1 limits in `docs/architecture.md`.

Automatic production hook capture is intentionally not registered. The confirmed hook shape does not provide both dynamically discovered tool schemas and a trusted `researchId`, so name heuristics would weaken the boundary. Use `record_learn_evidence` until the runtime supplies those values.

Fetched pages are not cached. This preserves the always-live evidence capture boundary and prevents
stale excerpts from being reused. Re-fetch before reusing long-lived evidence. Microsoft does not
publish a numeric Learn MCP rate-limit quota, so no bundle, report, or release note may claim one.

## Skill routing and freshness

The generated project router is validated with:

```sh
python .github/skills/repository-skill-generator/scripts/manage_project_skills.py validate --repo . --require-meta
```

It contains three exact external entries, `azure-container-apps`, `azure-functions`, and `microsoft-foundry`, and no fallback. Excluded neighboring products and unknown products remain unresolved. The researcher records plugin name/version and generation date only when exposed by trusted runtime metadata or kickoff context. A generation date older than three calendar months is visibly stale; absent metadata remains absent.

Skill files cannot prove context reduction if the host injects the complete installed-skill catalog. Do not claim savings. For an out-of-band observation, run equivalent bounded prompts in fresh sessions: one with plugin-wide discovery and one with compact-router selection to the exact skill. Compare only host-visible input-token totals and skill/tool loading events, record host/model/plugin versions and prompt hashes, and report the observation without generalizing beyond that runtime.

Project agent and skill changes may require a fresh turn or session before the runtime picker sees them. Reload extensions separately, inspect diagnostics, and use a fresh session for the bounded router-to-skill-to-fetch/record probe.

## Validation

Run all retained and production tests:

```sh
node --test
```

Check every production module:

```sh
find .github/extensions -name '*.mjs' -print0 | xargs -0 -n1 node --check
```

Run the deterministic offline benchmark:

```sh
node scripts/run-release-evaluation.mjs
```

The current corpus requires 9 production-backed gates and 25 coverage labels, including opaque
runtime tool discovery/routing and distinct validated-draft then acknowledged-published canvas
stages. The temporary-root lifecycle probe closes the draft panel before publication and opens a
separate published panel only after parent acknowledgement.

For an explicit bounded live check, use the runner's live option only from an environment where
network access is approved. It must cap requests and timeouts, validate every returned citation as
an exact HTTPS `learn.microsoft.com` URL, and report `PASS`, `FAIL`, or `SKIP`. `SKIP` is required
when live access is unavailable or not requested; do not fabricate a pass.

```sh
node scripts/check-release-live-urls.mjs          # SKIP
node scripts/check-release-live-urls.mjs --live   # bounded PASS or FAIL
```

## Manual runtime release checklist

1. Create a user-initiated Side Chat and verify the router selects at most one official skill.
2. Confirm stale or absent skill provenance is visible and no token-savings claim is made.
3. Under fresh temporary draft and published roots, prepare one research identity.
4. Start a coordinated child, record a bounded fresh fetch, persist the draft, and inspect draft canvas text.
5. Send an explicit publish turn, read the immutable publication back, and deliver the bounded handoff.
6. In the parent, verify and acknowledge it; confirm duplicate and stale delivery do not regress state.
7. Open the published canvas, publish version 2, supersede version 1, then remove only the temporary roots.

Short attributed excerpts with canonical Learn links support product research. They are not a
license to redistribute full pages. Obtain legal review before commercial release; this is not
legal advice.
