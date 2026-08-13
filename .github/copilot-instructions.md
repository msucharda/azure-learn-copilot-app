# Microsoft Learn research

- Use only the project agents and Copilot App-provided tools. Do not add project extensions,
  project-defined tools, persistence services, or separate reference UI.
- Answer narrow questions in the current chat with the native Microsoft Learn tools.
- For deep work, invoke the built-in `/orchestrate` skill and have it create and guide one child with
  the `learn-researcher` agent. Do not implement a custom session or handoff protocol.
- Invoke at most one matching installed official product skill. Treat it as routing guidance, then
  verify claims with current Microsoft Learn pages.
- Return concise claims with adjacent `https://learn.microsoft.com` Markdown links and a short
  `References` list. Never fabricate or rewrite a source URL.
- Use `citation-critic` only when the user requests an evidence review.
