# azure-learn-copilot-app

Foundation for a sourced Microsoft Learn research-agent system. PR 0 validated runtime capabilities, PR 1 defined schema version 1 contracts, and the production evidence pipeline implements deterministic validation, bounded Learn-result adaptation, atomic published storage, compact official-skill routing, production researcher agents, and a read-only reference canvas.

## Retained spike scaffold

- `docs/spikes/000-capability-spikes.md` records observed contracts and fallbacks.
- `.github/agents/learn-researcher.agent.md` is the production evidence researcher; `.github/agents/citation-critic.agent.md` performs bounded read-only support classification.
- `.github/skills/publish-research-draft/SKILL.md` validates and publishes a reviewed Markdown draft when the user says **publish**.
- `.github/extensions/learn-capability-spikes/` captures bounded diagnostic evidence and exposes canvas actions. Its fallback tool is named `record_learn_spike_evidence` so the production extension owns `record_learn_evidence`.
- `test/contracts.test.mjs` validates evidence bounds and hashing with Node built-ins.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external dependencies; nothing is vendored.

## Production evidence pipeline

- `.github/extensions/learn-references/extension.mjs` registers `record_learn_evidence`, bounded `read_learn_evidence_capture`, `validate_research_bundle`, `publish_research_bundle`, and `get_research_bundle`.
- The same extension registers the `learn-references` project canvas. Open it with `{ researchId, version?, view }`, where `view` is `draft` or `published`; omit `version` to read the latest complete version.
- `.github/extensions/learn-references/lib/` contains dependency-free contract, hashing, MCP adapter, tool-handler, storage, canvas-provider, and DOM-renderer modules.
- `.github/extensions/learn-references/fixtures/` contains bounded schema version 1 examples and rejection cases.
- `test/` covers strict contracts, deterministic hashes, fetched-Markdown quote authority, short-fragment and decorated bundle/handoff retention, defensive MCP result adaptation, concurrent publication, lifecycle storage, tool failures, and reference-canvas security/lifecycle behavior.
- `docs/architecture.md` records the component and trust boundaries.
- `docs/operations.md` documents storage roots, layouts, retention, validation, and operational limitations.

The official Microsoft Azure Agent Skills plugin and Microsoft Learn MCP endpoint remain external prerequisites. Production code discovers logical Learn operations from runtime tool schemas rather than compiling against a wrapper or legacy tool spelling.

The generated `.github/skills/project-azure-learn-skill-router/SKILL.md` contains only repository routing context for `azure-functions` and `microsoft-foundry`. It invokes one exact external skill lazily; uncovered or excluded products remain unresolved and use lightweight Learn discovery. The invoked external skill, never the generated router, supplies `officialSkill` provenance.

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

## Repository-specific Copilot skills

This repository provides two repository-scoped [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills). No router service or separate policy configuration is required.

- `repository-skill-generator` inspects a repository and the available skill catalog, then creates the smallest useful set of project skills.
- `session-skill-improver` uses repository-scoped Copilot session evidence to improve generated project skills.

## Install and use

Copy both directories under `.github/skills/` into the target repository at the same path. Copilot discovers each `SKILL.md` automatically.

Ask Copilot to **run `repository-skill-generator`** when initially setting up project skills or after material repository changes. Generated skills are written to `.github/skills/<skill-name>/SKILL.md`.

Ask Copilot to **run `session-skill-improver`** after the repository has accumulated repeated workflows, failures, retries, or user corrections in Copilot sessions. The skill queries the available session-history interface, scopes evidence to the current repository, and updates only generated skills.

## Generated artifacts

Generated skills contain this metadata:

```yaml
metadata:
  managed-by: repository-skill-generator
  generated: "true"
  format-version: "1"
  kind: "project-skill"
  provenance: "project-repository-context"
```

Compact official-skill routers use `kind: "official-skill-router"` instead. This marks project-owned routing context only: it does not represent official-skill provenance or an evidence source. Regeneration may replace or prune only skills carrying the ownership metadata. Hand-authored skills, including the two meta-skills, remain untouched. Repository analysis excludes skill bodies so generated output and the meta-skills do not become recursive input.

Generated names must start with `project-` and must not match any non-generated catalog name supplied in the generation plan. A plan may contain at most 8 generated skills. Each file is at most 16 KiB; a compact router is at most 12 KiB and may route to at most 8 official skills, with at most 8 aliases and 4 exclusions per route. A resolved router emits:

```json
{"status":"resolved","primary_skill":"exact-skill-name","fallback_skill":null,"matched_alias":"matched phrase"}
```

An unresolved route uses `null` for the skill and alias fields. The router lazily invokes one exact official skill and at most one explicit fallback. It never copies official skill bodies, categories, Learn excerpts, or curated URLs.

## Context measurement limitation

A compact project router reduces decision material only if the Copilot host can avoid injecting the complete installed skill inventory. Skills alone cannot guarantee that behavior. Before claiming context savings, manually compare equivalent sessions for plugin-wide discovery versus compact-router-to-exact-skill invocation, using host-visible input-token and skill/tool-loading events. If the host always injects global descriptions, have the parent context preselect the exact official skill and, where the product supports it, start a restricted researcher context. This repository adds no telemetry or runtime routing component.

The generator's standard-library helper supports deterministic scanning, application, and validation:

```bash
python .github/skills/repository-skill-generator/scripts/manage_project_skills.py scan --repo .
python .github/skills/repository-skill-generator/scripts/manage_project_skills.py apply --repo . --plan /path/to/plan.json --prune
python .github/skills/repository-skill-generator/scripts/manage_project_skills.py validate --repo . --require-meta
python -m unittest discover -s .github/skills/repository-skill-generator/tests -v
```