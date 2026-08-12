# azure-learn-copilot-app

Foundation for a sourced Microsoft Learn research-agent system. PR 0 validated runtime capabilities, PR 1 defined schema version 1 contracts, and the production evidence pipeline implements deterministic validation, bounded Learn-result adaptation, atomic published storage, and a read-only reference canvas. Orchestration and rate-limit behavior remain future work.

## Retained spike scaffold

- `docs/spikes/000-capability-spikes.md` records observed contracts and fallbacks.
- `.github/agents/learn-researcher.agent.md` is a read-only deep-research probe.
- `.github/skills/publish-research-draft/SKILL.md` validates and publishes a reviewed Markdown draft when the user says **publish**.
- `.github/extensions/learn-capability-spikes/` captures bounded diagnostic evidence and exposes canvas actions. Its fallback tool is named `record_learn_spike_evidence` so the production extension owns `record_learn_evidence`.
- `test/contracts.test.mjs` validates evidence bounds and hashing with Node built-ins.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external dependencies; nothing is vendored.

## Production evidence pipeline

- `.github/extensions/learn-references/extension.mjs` registers `record_learn_evidence`, `validate_research_bundle`, `publish_research_bundle`, and `get_research_bundle`.
- The same extension registers the `learn-references` project canvas. Open it with `{ researchId, version?, view }`, where `view` is `draft` or `published`; omit `version` to read the latest complete version.
- `.github/extensions/learn-references/lib/` contains dependency-free contract, hashing, MCP adapter, tool-handler, storage, canvas-provider, and DOM-renderer modules.
- `.github/extensions/learn-references/fixtures/` contains bounded schema version 1 examples and rejection cases.
- `test/` covers strict contracts, deterministic hashes, fetched-Markdown quote authority, short-fragment and decorated bundle/handoff retention, defensive MCP result adaptation, concurrent publication, lifecycle storage, tool failures, and reference-canvas security/lifecycle behavior.
- `docs/architecture.md` records the component and trust boundaries.
- `docs/operations.md` documents storage roots, layouts, retention, validation, and operational limitations.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external prerequisites. Production code discovers logical Learn operations from runtime tool schemas rather than compiling against a wrapper or legacy tool spelling.

The reference canvas renders only bounded evidence fields already accepted by the draft or published stores. It never serves retained fetched Markdown, does not expose publishing controls, and does not bridge iframe input into an agent turn. Publishing remains the explicit `publish-research-draft` chat skill.

## Validate

```sh
node --test
```

This command runs the retained PR 0 tests and all production contract tests with Node built-ins.

Check every production extension module with:

```sh
find .github/extensions -name '*.mjs' -print0 | xargs -0 -n1 node --check
```