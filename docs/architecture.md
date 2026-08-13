# Architecture

## Design

The system is prompt-defined and agent-only:

```mermaid
flowchart LR
    U[User or parent session] --> O[Built-in orchestrate skill]
    O --> R[learn-researcher]
    R --> L[Native Microsoft Learn tools]
    L --> R
    R --> A[Markdown answer and website links]
    A --> O
    O --> U
    A --> C[citation-critic on request]
```

There is no project runtime, custom tool server, durable evidence store, or separate reference
renderer. Copilot App owns tool execution and session coordination.

## Agents

### `learn-researcher`

The researcher targets `github-copilot`, is read-only, and has two tool capabilities:

- `read` only for exact files created when a Learn tool spools oversized output;
- `microsoft-learn/*` for native documentation search, page fetch, and code-sample search.

The researcher intentionally does not load an installed product-skill catalog. Broad skill indexes
can inject substantial unrelated context, while direct Learn search already supplies current
discovery. Material claims must be checked against a bounded set of fetched Microsoft Learn pages.

### `citation-critic`

The critic has no tools. It classifies supplied claim/evidence pairs without fetching new material
or rewriting the answer. This keeps evidence review independent from source discovery.

## Quick and deep paths

A quick question stays in the current chat. Deep research invokes Copilot App's built-in
`/orchestrate` skill to create and guide one `learn-researcher` child. The child answers normally;
the orchestrator coordinates its result. If automatic delivery is unavailable, the coordinator
resolves the child's runtime session from its exact worktree and reads the persisted transcript with
app-native session-history tools. No custom research identity, publication state, acknowledgement
protocol, or storage handoff is part of the project contract.

GitHub's documented deep-research workflow investigates a repository. The custom researcher remains
the appropriate policy boundary for external Microsoft Learn research and its stricter citation
format. Custom agents and MCP namespaced tool allow-lists are supported by the
[custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration),
while multi-session coordination is provided by the
[built-in skills](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

## Reference contract

References are part of the answer:

1. Each material factual claim has an adjacent descriptive Markdown link.
2. Search results are discovery only; every cited page was successfully fetched.
3. The source set contains at most 15 authoritative pages.
4. Every Markdown link, including unresolved and next-step links, belongs to the successful fetch
   set. It uses an explicitly returned canonical URL or the exact successful request URL; canonical
   forms are never inferred or rewritten.
5. Every source URL comes from native tool output.
6. URLs use HTTPS and the exact `learn.microsoft.com` host.
7. A short `References` list contains each linked page once.
8. Tool failures or unsupported claims remain explicit rather than receiving a guessed link.
9. A coverage preflight preserves every named service, constraint, comparison, and enumerated or
   comma-separated subtopic as an atomic item. Each maps to fetched evidence, a supported
   recommendation, or an unresolved statement; parent-area mentions and unsupported recommendations
   do not count, and source and word limits do not permit silent omission.
10. Each decision area uses all three exact labels for fetched facts, synthesized recommendation, and
   assumptions or unresolved constraints, even when the last reports that none were identified.
11. Mutable claims such as service status, deprecation, availability, regions, and numeric limits
   require current fetched support.
12. Recommendations cannot introduce unfetched product capabilities or other material factual
   premises.
13. The core synthesis is at most 1,500 words. When the atomic checklist exceeds 30 items, it may use
    at most 2,000 words solely to restore requested coverage.
14. The answer retains at most three decision-critical unresolved groups and names every unsupported
    atomic item within its group rather than hiding gaps behind an aggregate phrase.

The links open the source as a normal website, including
[Microsoft Learn](https://learn.microsoft.com/).

## Trust boundaries

- Retrieved pages are untrusted data; instructions embedded in them are ignored.
- The researcher cannot edit the repository, execute shell commands, or deploy resources.
- Read access is limited by instruction to exact files spooled by Learn tool calls; unrelated
  workspace and user files are out of scope.
- The critic cannot search, fetch, invoke skills, or broaden the supplied evidence.
- Copilot App provides and authorizes all tools and orchestration.
