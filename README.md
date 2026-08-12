# azure-learn-copilot-app

Foundation for a sourced Microsoft Learn research-agent system. PR 0 validated runtime capabilities; schema version 1 now defines production evidence and handoff contracts. The reference-store backing, production canvas, orchestration, and rate-limit behavior are not implemented.

## Retained spike scaffold

- `docs/spikes/000-capability-spikes.md` records observed contracts and fallbacks.
- `.github/agents/learn-researcher.agent.md` is a read-only deep-research probe.
- `.github/skills/publish-research-draft/SKILL.md` validates and publishes a reviewed Markdown draft when the user says **publish**.
- `.github/extensions/learn-capability-spikes/` captures bounded Learn evidence and exposes diagnostic canvas actions.
- `test/contracts.test.mjs` validates evidence bounds and hashing with Node built-ins.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external dependencies; nothing is vendored.

## Production contracts

- `.github/extensions/learn-references/lib/` contains dependency-free ES module validators for evidence bundles, lifecycle transitions, and child-to-parent handoffs.
- `.github/extensions/learn-references/fixtures/` contains bounded schema version 1 examples and rejection cases.
- `test/learn-reference-contracts.test.mjs` covers strict shape validation, cross-references, lifecycle immutability, and handoff matching.
- `docs/architecture.md` records the schema, URL policy, two-speed UX, MCP discovery strategy, and deferred storage boundary.

The `learn-references` directory intentionally has no `extension.mjs` yet, so it is not a discoverable production extension.

## Validate

```sh
node --test
```

This command runs the retained PR 0 tests and all production contract tests with Node built-ins.