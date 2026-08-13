# Microsoft Learn research

- Use only the project agents and Copilot App-provided tools. Do not add project extensions,
  project-defined tools, persistence services, or separate reference UI.
- Answer narrow questions in the current chat with the native Microsoft Learn tools.
- For deep work, invoke the built-in `/orchestrate` skill and have it create and guide one child with
  the `learn-researcher` agent. Do not implement a custom session or handoff protocol.
- If an orchestrated child cannot message back, resolve its runtime session from the exact child
  worktree and read its persisted transcript with app-native session-history tools.
- Assess orchestration in the coordinator. Ask the child only about research-tool and evidence
  friction that it can directly observe.
- Invoke at most one matching installed official product skill. Treat it as routing guidance, then
  verify claims with current Microsoft Learn pages.
- Fetch every cited page. Use read-only access only for exact tool-spooled output, and distinguish
  sourced facts from synthesized recommendations and unresolved assumptions.
- Return concise claims with adjacent `https://learn.microsoft.com` Markdown links and a short
  `References` list. Never fabricate or rewrite a source URL.
- Use `citation-critic` only when the user requests an evidence review.
