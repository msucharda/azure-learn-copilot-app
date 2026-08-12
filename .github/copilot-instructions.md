# Microsoft Learn research

- Keep quick research in the current chat; use the production `learn-researcher` agent for deep, isolated evidence work.
- Route lazily through `project-azure-learn-skill-router` and invoke at most one exact official skill. Unresolved products use lightweight Learn discovery.
- In chat, return concise claims with claim-adjacent Microsoft Learn links. Put full bounded excerpts and evidence state in the reference canvas.
- Draft evidence stays in its current session. It crosses sessions only after the user explicitly invokes the `publish-research-draft` workflow.
- Start with `start-learn-research`; consume only stored published envelopes with `consume-research-handoff`.
- Skill files alone cannot prove token savings when the host injects all installed skill descriptions. Make no savings claim without an out-of-band A/B observation.
