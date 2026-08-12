# azure-learn-copilot-app

Experimental foundation for a sourced Microsoft Learn research-agent system. PR 0 validates capabilities only; it does not implement the full product.

## Retained spike scaffold

- `docs/spikes/000-capability-spikes.md` records observed contracts and fallbacks.
- `.github/agents/learn-researcher.agent.md` is a read-only deep-research probe.
- `.github/skills/publish-research-draft/SKILL.md` validates and publishes a reviewed Markdown draft when the user says **publish**.
- `.github/extensions/learn-capability-spikes/` captures bounded Learn evidence and exposes diagnostic canvas actions.
- `test/contracts.test.mjs` validates evidence bounds and hashing with Node built-ins.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external dependencies; nothing is vendored.

## Validate

```sh
node --check .github/extensions/learn-capability-spikes/extension.mjs
node --test test/contracts.test.mjs
```

In the Copilot app, reload and inspect project extensions, reload skills, and open `docs/spikes/000-capability-spikes.md` in the editor canvas for review.