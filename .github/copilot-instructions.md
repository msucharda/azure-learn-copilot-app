# Microsoft Learn research

- Use only the project agents and Copilot App-provided tools. Do not add project extensions,
  project-defined tools, persistence services, or separate reference UI.
- Answer narrow questions in the current chat with the native Microsoft Learn tools.
- For deep work, invoke the built-in `/orchestrate` skill and have it create and guide one child with
  the `learn-researcher` agent. Do not implement a custom session or handoff protocol.
- If an orchestrated child cannot message back, resolve its runtime session from the exact child
  worktree and read its persisted transcript with app-native session-history tools. If normalized
  turns are unavailable, use the local full-text index for that exact runtime session and read only
  its final response.
- Assess orchestration in the coordinator. Ask the child only about research-tool and evidence
  friction that it can directly observe.
- Use direct Microsoft Learn discovery in `learn-researcher`; do not load a product-skill catalog or
  add a project router.
- Limit the authoritative source set to 15 pages, fetch every cited page, and never cite a search
  snippet. Use read-only access only for exact tool-spooled output, and distinguish sourced facts
  from synthesized recommendations and unresolved assumptions.
- Require an atomic coverage preflight that preserves each named service, constraint, comparison, and
  comma-separated subtopic. A parent-area mention or unsupported recommendation is not coverage;
  neither the source cap nor the word cap permits silent omission.
- Require a final link preflight: use an explicitly returned canonical URL or the exact successful
  request URL, never an inferred rewrite; allow no unfetched Markdown link in any section.
- Require a contradiction preflight across fetched constraints, recommendations, and explicit
  scenario requirements. Mutually exclusive options must be chosen between or presented as
  conditional alternatives, and mandatory controls cannot be bypassed for convenience.
- Keep the core synthesis within 1,500 words, allowing up to 2,000 only when the atomic checklist
  exceeds 30 items and only to restore requested coverage. Give every decision all three exact labels:
  fetched facts, recommendation, and assumptions or unresolved constraints; name every unsupported
  item in the last label rather than hiding gaps behind an aggregate phrase.
- For checklists over 30 items, require a compact pre-reference `Coverage audit` table that assigns
  one row and one status to every atomic item: `Covered`, `Partially covered`, or `Unresolved`. The
  table row count must equal the checklist count.
- Return concise claims with adjacent `https://learn.microsoft.com` Markdown links and a short
  `References` list. Never fabricate or rewrite a source URL.
- Use `citation-critic` only when the user requests an evidence review.
