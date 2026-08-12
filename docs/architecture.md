# Learn research architecture

Status: schema version 1 contracts are implemented. Reference storage, the production canvas, nested-session orchestration, and rate-limit behavior are deferred.

## Repository boundaries

| Path | Responsibility |
| --- | --- |
| `.github/extensions/learn-references/lib/` | Dependency-free evidence, lifecycle, and handoff validators |
| `.github/extensions/learn-references/fixtures/` | Bounded valid and invalid schema version 1 examples |
| `.github/extensions/learn-capability-spikes/` | Retained PR 0 diagnostics; not the production reference store |
| `test/learn-reference-contracts.test.mjs` | Contract and lifecycle tests using `node:test` |
| `docs/spikes/000-capability-spikes.md` | Validated runtime observations that constrain production design |

`learn-references` intentionally has no `extension.mjs`. Adding the production extension, storage adapter, and canvas is later work.

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

SHA-256 fields are lowercase-normalized 64-character hexadecimal digests. The validator checks their representation. Digest creation and persistence belong to the future capture and storage adapters.

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

The storage design in the next layer must preserve the distinction between immutable version content and lifecycle metadata so it can atomically mark a published version superseded without rewriting its evidence.

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
4. the success hook records bounded pre-paraphrase evidence, while protocol and domain failures are captured at the future adapter boundary because wrapper failures can appear as successful text.

If a later deployment establishes repository-owned MCP configuration as the team standard, it can add the confirmed HTTP endpoint shape then. That decision is deployment configuration, not part of schema version 1.

## Validation

Run all retained and production contract tests:

```sh
node --test
```
