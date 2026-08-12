# Learn research architecture

Status: schema version 1 contracts, deterministic evidence validation, production extension tools, compact official-skill routing, production researcher/critic agents, and atomic reference storage are implemented. The production canvas, nested-session orchestration, and rate-limit behavior are deferred.

## Repository boundaries

| Path | Responsibility |
| --- | --- |
| `.github/extensions/learn-references/extension.mjs` | Production tool registration and configured store startup |
| `.github/extensions/learn-references/lib/` | Dependency-free contracts, hashing, Learn adapter, tool handlers, and storage |
| `.github/extensions/learn-references/fixtures/` | Bounded valid and invalid schema version 1 examples |
| `.github/extensions/learn-references/test-support/` | Bounded generated test inputs; no fetched Learn pages |
| `.github/skills/project-azure-learn-skill-router/SKILL.md` | Generated bounded allow-list that selects one exact external official skill |
| `.github/agents/learn-researcher.agent.md` | Read-only production researcher with evidence-tool write access only |
| `.github/agents/citation-critic.agent.md` | Read-only support classifier over supplied bounded evidence |
| `.github/extensions/learn-capability-spikes/` | Retained PR 0 diagnostics; not the production reference store |
| `test/*.test.mjs` | Contract, adapter, storage, and production-tool tests using `node:test` |
| `docs/spikes/000-capability-spikes.md` | Validated runtime observations that constrain production design |

The retained spike fallback tool is renamed `record_learn_spike_evidence`; the production extension owns `record_learn_evidence`.

The generated router is project context, not a runtime service, policy layer, evidence source, or official plugin. It currently allows only `azure-functions` and `microsoft-foundry`, has no fallback, and returns unresolved for excluded or uncovered products. On a resolved route the researcher invokes exactly one external skill and progressively reads only the relevant category. The selected external skill's observed plugin metadata populates `officialSkill`; missing metadata is not inferred, and generation dates older than three calendar months produce a visible warning.

The researcher sends all successful logical Learn operations through `record_learn_evidence`. Search is discovery only, code-sample search is reserved for SDK/code verification, and exact excerpts are authorized only by successful fetch captures. The citation critic neither fetches nor rewrites and cannot override deterministic validation.

## Evidence bundle schema version 1

Every bundle has `schemaVersion: 1`. `version` is the monotonic evidence revision for one stable `researchId`; it is not the schema version. Unknown schema versions and unknown properties are rejected rather than coerced.

The contract models:

- stable research, app-native session, agent, claim, source, and unresolved-item identities;
- original and normalized questions;
- product, version, platform, and task-intent scope;
- official skill name, plugin name/version, and optional generation time;
- claims with a support value of `supported`, `partially-supported`, `unsupported`, or `conflicting`;
- bounded source metadata with an exact excerpt, retrieval provenance, content hash, and verification state;
- claim-to-source references, which must resolve to unique source IDs;
- unresolved items, lifecycle timestamps, and a bundle content hash.

Published and superseded normalized bundles are recursively frozen. The transition validator also prevents published content from changing while the published version moves to `superseded`.

Validated, published, and superseded bundles contain at least one claim so every publishable version can produce the required executive finding in its handoff. A no-evidence conclusion is represented as an `unsupported` claim with an empty `sourceIds` array. Draft, validating, and rejected bundles may have no claims.

### Stable ID policy

`researchId` is a lowercase UUID v4 and is preserved across quick refinement, deep-session promotion, and later evidence versions. `parentSessionId` and optional `childSessionId` are raw app-native UUID v4 session IDs, canonicalized to lowercase, so they can be passed directly to session messaging operations without an encode/decode layer. Other IDs are lowercase, hyphen-delimited stable identifiers:

- `claim-*` for claims;
- `source-*` for sources;
- `unresolved-*` for unresolved items;
- an unprefixed stable identifier such as `learn-researcher` for the researcher agent.

IDs are unique within their collection. Fixtures use explicit example identifiers, not live session IDs.

### Microsoft Learn URL policy

Schema version 1 accepts only absolute HTTPS URLs whose exact host is `learn.microsoft.com`. Canonical URLs must already match the URL parser's serialized form, so host casing and default ports are not silently rewritten. They cannot contain credentials, custom ports, query strings, or fragments. An optional retrieval URL may retain a query string or fragment needed to reproduce retrieval, but it uses the same HTTPS host policy.

This narrow policy excludes redirectors and third-party mirrors. A future schema version must make any host expansion explicit.

### Bounded data

The contract limits bundles to 200 claims, 200 sources, and 50 unresolved items. Exact excerpts are limited to 6,000 characters. A handoff contains at most 20 executive findings and 20 unresolved risks; it never embeds the evidence bundle or a fetched Learn page.

SHA-256 fields are lowercase-normalized 64-character hexadecimal digests. Evidence content hashes use canonical JSON with recursively sorted object keys over normalized immutable bundle fields. `status`, `lifecycle`, and `contentHash` are excluded, so a valid published-to-superseded lifecycle transition does not change the digest. Validation, publication, supersession, and published reads recompute the digest.

Fetched Markdown hashes normalize CRLF and lone CR line endings to LF and make no other content transformation. Exact excerpts must occur byte-for-byte after that line-ending normalization. Leading, trailing, and repeated whitespace remains significant.

## Lifecycle

These are the only allowed status transitions:

| From | Allowed next status |
| --- | --- |
| `draft` | `validating` |
| `validating` | `validated` or `rejected` |
| `validated` | `published` |
| `published` | `superseded` |
| `superseded` | None |
| `rejected` | None |

`rejected` and `superseded` are terminal. A published version can only become superseded, and that transition preserves its content. New research after publication starts a new, higher `version` in `draft`; it does not mutate the old version into a new draft.

Lifecycle timestamps are status-specific, UTC, ordered, and strict. For example, a published bundle requires `createdAt`, `validatingAt`, `validatedAt`, `publishedAt`, and `updatedAt`, while a draft cannot carry later-stage timestamps.

Published storage keeps immutable version content in `payload.json`, original lifecycle history in `lifecycle.json`, all fetched-content hashes in `retention.json`, and an atomic `commit.json` visibility marker. Supersession exclusively creates append-only transition metadata and revalidates the v1 transition plus the unchanged content digest.

## Child-to-parent handoff

A handoff is a separate bounded schema version 1 envelope. It includes:

- the same `researchId`, evidence `version`, session references, researcher agent, and content hash as the published bundle;
- one to 20 executive findings tied to claim IDs in that bundle;
- zero to 20 unresolved risks;
- the exact published time.

`assertHandoffMatchesBundle` rejects an envelope unless all identity and hash fields match a published bundle and every executive finding references an existing claim. The envelope is suitable for immediate app-native messaging; it is not storage.

## Two-speed research UX

Both entry modes use the same `researchId`, evidence contract, and eventual parent-owned reference store.

| Mode | Use | Boundary |
| --- | --- | --- |
| **Refine here / current chat or user-created Side Chat** | Quick, branchless questions and narrow follow-ups | The user creates Side Chat because no programmatic Quick Chat creation API exists; project-only capabilities are not assumed |
| **Open deep research session** | Isolation, a custom researcher agent, project capabilities, longer work, and versioned publish-back | The session receives the current evidence snapshot and returns a bounded handoff |

Promotion to deep research preserves the existing `researchId`, versioned evidence, and unresolved items. It does not restart research or create an unrelated record.

## Microsoft Learn MCP configuration

PR 0 confirmed two runtime naming layers:

- raw server tools: `microsoft_docs_search`, `microsoft_code_sample_search`, and `microsoft_docs_fetch`;
- current app wrappers: `microsoft-learn-microsoft_docs_search`, `microsoft-learn-microsoft_code_sample_search`, and `microsoft-learn-microsoft_docs_fetch`.

Installed skills may use the logical legacy spelling `mcp_microsoftdocs:*`; production code must not compile against that spelling or any current wrapper name. It discovers tools and input/output schemas from `tools/list` on every connection and validates the returned shape before use.

No `.github/mcp.json` is added in this layer. The current app runtime already supplies Microsoft Learn MCP, and PR 0 demonstrated explicit server injection for isolated SDK sessions. A duplicate repository config could drift or conflict without proving team-wide ownership. Runtime prerequisites are:

1. the official Microsoft Azure Agent Skills plugin is installed externally and its name/version are recorded when invoked;
2. the app runtime or parent orchestrator supplies `https://learn.microsoft.com/api/mcp`;
3. the connection dynamically discovers tools and schemas;
4. the adapter rejects protocol, wrapper, schema, and domain failures before any evidence record is written.

The production `LearnMcpAdapter` accepts transport functions, discovers the three logical operations from `tools/list` schemas on every connection, and treats runtime names as opaque. The production extension connects lazily to the exact `https://learn.microsoft.com` host, disables redirects, invokes the discovered tool itself, and records only the normalized result. Callers cannot submit a result body or digest as evidence. Tests use a faithful fake transport with arbitrary names and argument spellings. The extension does not automatically capture success hooks because the confirmed hook payload does not carry both dynamically discovered schemas and a trusted `researchId`; `record_learn_evidence` is the reliable, trusted execution boundary.

If a later deployment establishes repository-owned MCP configuration as the team standard, it can add the confirmed HTTP endpoint shape then. That decision is deployment configuration, not part of schema version 1.

## Evidence authority and result adaptation

Documentation search and code-sample search are discovery operations. Only a successful logical `docs-fetch` result for the exact canonical and retrieval URL can authorize a published article source. The source digest must match the fetched Markdown digest, its verification state must be `verified`, and its exact excerpt must occur in that Markdown.

`retrievedAt` is not caller-authored provenance: it must equal `observedAt` on one matching trusted fetch capture. Repeated unchanged fetches remain distinguishable by that timestamp.

The adapter accepts bounded raw arrays, `results` objects, `structuredContent.results`, MCP text blocks, JSON-RPC success envelopes, and wrapper `ToolResultObject`-like shapes. It rejects JSON-RPC errors, `isError`, non-success result types, malformed JSON, schema drift, oversized bodies, and failure-shaped text returned through a nominally successful wrapper. Search bodies are reduced to counts, hashes, bounded previews, and Learn URLs. Bounded fetch Markdown is retained only in the workspace-local capture store and never copied to published records.

## Storage model

Draft bundles and fetch captures use a workspace-hashed root under `$COPILOT_HOME/learn-references/drafts` by default or `COPILOT_LEARN_DRAFT_ROOT` when configured. Published artifacts use the extension-owned cross-session root under `$COPILOT_HOME/learn-references/published` by default or `COPILOT_LEARN_PUBLISHED_ROOT`.

Published versions are keyed by `(researchId, version)`. A cross-process store lock serializes semantic preflight, while fsynced temporary files, exclusive atomic links, directory synchronization, and a final commit marker prevent partial or duplicate immutable records from becoming valid. Locks with dead owners fail closed for explicit operator cleanup rather than risking unsafe takeover. An orphan payload, lifecycle, or retention-index file is explicitly incomplete. The commit binds the immutable content digest plus hashes of the initial lifecycle and complete fetch-retention index. Equivalent concurrent publication is idempotent, while different immutable content at the same key conflicts. Latest reads derive the greatest completely committed version, so publication order and a crash after commit cannot regress it.

Supersession is an exclusive, append-once `supersession.json` metadata record. Readers compose it with the original published lifecycle and validate the v1 transition, so immutable payload and original lifecycle history are never rewritten.

Every fetched-content digest also has one immutable retention budget. Validation counts only source-derived spans: complete field matches, exact excerpts, embedded matches of at least 32 characters, bounded insertion-only decoration alignments that preserve mandatory text runs, aggregate short exact fragments, and bounded ordered reconstruction. Short-fragment candidates use exact eight-character seeds only for discovery, extend through direct substring equality, and enter an order-independent occurrence allocation only after their schema group establishes substantial aggregate coverage. For fetched bodies of at least 512 characters, every separator character absent from the page forms a structural boundary for reordered one-to-seven-character fragments; every separated fragment must still be an exact source substring, and only a schema group with substantial aggregate coverage contributes intervals.

All detectors share one allocation boundary per fetched-content hash. Exact, embedded, decorated, short-fragment, and structural matches first become equality-verified requests with persisted-prose provenance. A later detector excludes prose positions already attributed by an earlier detector, so two detector views of one field cannot create independent copies. The remaining requests are combined into one multiplicity-preserving multiset. Prior durable intervals and confirmed ordered intervals seed the same covered bitmap before repeated occurrences are selected, so a short-fragment request cannot silently reuse a repeated occurrence already claimed by a whole field, earlier version, or handoff. Distinct persisted fields still reserve distinct source occurrences when they exist, while overlapping or subrange reuse remains union-based. Bounded search maximizes the defensible union and fails closed when repeated placement could cross policy.

Whole-field exact matches are omitted from ordered streams. The ordered pass starts from the longest directly verified prose/source anchor, extends contiguous source windows forward and backward with a bounded filler ratio, and stops at the first failed window instead of skipping into a repeated region. An extension becomes confirmed coverage only when forward and backward replay agree on the same bounded prose range; tied mappings remain explicit bounded ambiguity and fail closed when their possible union could cross policy. Hidden controls are rejected from persisted prose, while fetched Markdown also rejects default-ignorable characters so alignment cannot become asymmetric. No rolling-hash equality or isolated single-character alphabet overlap contributes coverage. Unioned intervals detect near/full-page material split or reordered across fields. Retention records contain only verified covered intervals, group URL aliases by fetched-content hash, and require cumulative coverage to remain below 90% of the page and the 12,000-character cap. The first durable reservation establishes the budget; later versions and research IDs may reuse approved ranges but cannot add new page content. Each publication commits the hashes of all fetch captures, including zero-overlap and undeclared discovery-time fetches, in `retention.json`; valid no-evidence bundles use an empty hash list. Handoffs run through the same verified allocator and add immutable interval reservations against every committed fetch hash; storing a new handoff after publication therefore requires the original bounded captures again rather than a persisted page body. Legacy scalar reservations are revalidated from their stored envelopes before extension. All semantic conflicts are rejected during locked preflight, and the bundle commit marker is created only after retention and any handoff succeed, so partial payload/lifecycle files are never readable evidence.

Handoff envelopes and acknowledgements use separate roots and bounded schemas. Duplicate acknowledgements for `(parentSessionId, researchId, version)` are idempotent only when the normalized data is identical.

Path components are contract-validated, every resolved path stays beneath its configured root, and directory/file symlinks are rejected. See `docs/operations.md` for layout and retention details.

## Validation

Run all retained and production contract tests:

```sh
node --test
```
