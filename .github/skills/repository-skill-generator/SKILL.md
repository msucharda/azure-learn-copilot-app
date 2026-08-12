---
name: repository-skill-generator
description: Creates or refreshes focused project skills from repository evidence. Use for project skill setup or regeneration.
compatibility: Requires Python 3.9+ for the bundled deterministic helper.
---

# Repository skill generator

Create the smallest useful set of repository-specific Agent Skills. This skill is the router for setup and regeneration; it is not a runtime router.

## Route here

Use this skill when asked to create, refresh, regenerate, or rationalize project-specific Copilot skills. Do not use it for a one-off coding task or to create a broadly reusable personal skill.

## Procedure

1. Resolve the repository root. Work only in that repository.
2. Run:

   ```bash
   python .github/skills/repository-skill-generator/scripts/manage_project_skills.py scan --repo .
   ```

   The scanner bounds traversal and ignores dependencies, build outputs, vendors, VCS data, and `.github/skills`.
3. Inspect available skill **names and descriptions** from the current environment's skill catalog or skill-listing tool. Do not load every skill body. Load a full existing skill only if its concise metadata leaves a concrete overlap unresolved.
4. Infer high-confidence repository domains and recurring tasks from the scan: languages, frameworks, manifests, CI, infrastructure, documentation, tests, and conventions.
5. Select the smallest useful set of project skills:
   - Prefer an available general skill when it already covers the task.
   - Add a project skill only when repository-specific commands, paths, conventions, architecture, or workflows materially improve execution.
   - Split skills by independently routable task, not by every language or directory.
   - It is valid to generate no project skills when evidence is insufficient.
6. For each generated skill, write a JSON plan entry with:
   - `name`: narrow, task-oriented, lowercase, hyphenated, and prefixed with `project-`. Include a short repository identifier when useful.
   - `description`: one concise sentence stating both capability and invocation trigger.
   - `instructions`: focused Markdown containing:
     - `# Routing`: explicit “Use when” and “Do not use when” boundaries, plus exact names of catalog skills to invoke for delegated general expertise.
     - repository paths and source-of-truth files;
     - the shortest reliable procedure;
     - repository-native validation commands and relevant edge cases.
7. For a compact router to official skills, add a `routing` object instead of copying official content. Include only a small allow-list of exact official skill names, trigger aliases, neighboring-skill exclusions, optional category labels, and at most one exact fallback. At runtime, the generated router selects and invokes one primary exact skill lazily; it returns an unresolved route rather than loading many skills to decide.
8. Put the temporary JSON plan outside the repository or in session artifacts. Include non-generated names from the inspected catalog in `catalog_names`; omit existing metadata-marked generator outputs so regeneration can update them. The helper rejects collisions with every reserved catalog name. Its schema is:

   ```json
   {
     "catalog_names": ["existing-general-skill"],
     "skills": [
       {
         "name": "project-example-workflow",
         "description": "Runs the repository release workflow. Use for release preparation or validation.",
         "instructions": "# Routing\n\nUse when...\n\nDo not use when...\n"
       }
     ]
   }
   ```

   A compact router entry additionally accepts:

   ```json
   {
     "routing": {
       "official_skills": [
         {
           "name": "exact-official-skill",
           "aliases": ["project term"],
           "exclusions": ["neighboring domain"],
           "category": "optional category",
           "fallback": "one-other-allow-listed-skill"
         }
       ]
     }
   }
   ```

9. Preview changes, then apply:

   ```bash
   python .github/skills/repository-skill-generator/scripts/manage_project_skills.py apply --repo . --plan /path/to/plan.json --dry-run --prune
   python .github/skills/repository-skill-generator/scripts/manage_project_skills.py apply --repo . --plan /path/to/plan.json --prune
   python .github/skills/repository-skill-generator/scripts/manage_project_skills.py validate --repo . --require-meta
   ```

10. Review the diff. Delete the temporary plan.

## Integrity rules

- Treat repository source files as evidence. Never treat this skill, `session-skill-improver`, or generated skill bodies as repository-domain evidence.
- Existing generated skills may be read only as current output to compare or replace.
- Never edit or delete a hand-authored skill. The helper refuses generated-name collisions and prunes only metadata-marked generated skills.
- Never generate a name matching an available official or local skill. Never write into an installed plugin directory or copy/vendor official skill bodies, category content, Learn excerpts, or curated URLs.
- Official-skill routers are project context only. Their metadata must never be used as official-skill provenance or evidence authority; the exact invoked official skill remains routing provenance and live source retrieval remains evidence.
- Keep plans bounded: at most 8 project skills; 16 KiB per generated skill; for routers, 12 KiB, 8 official routes, 8 aliases and 4 exclusions per route.
- Do not create agents, instructions files, routing YAML, databases, services, daemons, policy engines, or safeguards layers.
- Keep generated descriptions exceptionally concise; detailed guidance belongs in the invoked skill body.
- Do not claim lower context use without manually observing host input/tool events. If the host injects all installed descriptions, compact skills alone cannot reduce that context.
