#!/usr/bin/env python3
"""Deterministically scan repositories and manage metadata-marked Agent Skills."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple


SKILLS_RELATIVE = Path(".github") / "skills"
MANAGER = "repository-skill-generator"
META_SKILLS = {MANAGER, "session-skill-improver"}
FORMAT_VERSION = "1"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
IGNORED_DIRECTORIES = {
    ".git",
    ".gradle",
    ".hg",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".svn",
    ".terraform",
    ".tox",
    ".venv",
    "__pycache__",
    "bin",
    "bower_components",
    "build",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "obj",
    "out",
    "site-packages",
    "target",
    "vendor",
    "venv",
}
LANGUAGE_EXTENSIONS = {
    ".cs": "C#",
    ".cpp": "C++",
    ".fs": "F#",
    ".go": "Go",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".php": "PHP",
    ".ps1": "PowerShell",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".swift": "Swift",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
}
MANIFEST_NAMES = {
    "Cargo.toml",
    "Gemfile",
    "go.mod",
    "package.json",
    "pom.xml",
    "pyproject.toml",
    "requirements.txt",
}
CONVENTION_NAMES = {
    ".editorconfig",
    ".pre-commit-config.yaml",
    ".pre-commit-config.yml",
    "biome.json",
    "deno.json",
    "eslint.config.js",
    "eslint.config.mjs",
    "ruff.toml",
}
INFRA_SUFFIXES = {".bicep", ".tf", ".tfvars"}
DOC_SUFFIXES = {".md", ".mdx", ".rst"}
MAX_DESCRIPTION = 240
MAX_GENERATED_SKILLS = 8
MAX_INSTRUCTION_CHARS = 12_000
MAX_SKILL_BYTES = 16 * 1024
MAX_ROUTER_BYTES = 12 * 1024
MAX_OFFICIAL_ROUTES = 8
MAX_ALIASES_PER_ROUTE = 8
MAX_EXCLUSIONS_PER_ROUTE = 4
MAX_ROUTING_TERM_CHARS = 80
PROJECT_PREFIX = "project-"
MAX_SCAN_FILES = 20_000
MAX_SCAN_DIRECTORIES = 10_000
MAX_SCAN_ENTRIES = 100_000


class SkillError(Exception):
    """A user-correctable skill management error."""


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def iter_repository_files(
    root: Path, max_files: int
) -> Tuple[List[Path], bool, Dict[str, int]]:
    files: List[Path] = []
    truncated = False
    skills_root = root / SKILLS_RELATIVE
    pending = [root]
    visited_directories = 0
    visited_entries = 0
    while pending:
        current_path = pending.pop()
        visited_directories += 1
        if visited_directories > MAX_SCAN_DIRECTORIES:
            truncated = True
            break
        entries = []
        try:
            with os.scandir(current_path) as iterator:
                for entry in iterator:
                    visited_entries += 1
                    if visited_entries > MAX_SCAN_ENTRIES:
                        truncated = True
                        break
                    entries.append(entry)
        except OSError:
            continue
        if truncated:
            break
        child_directories: List[Path] = []
        for entry in sorted(entries, key=lambda item: item.name):
            path = Path(entry.path)
            if entry.is_symlink():
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name not in IGNORED_DIRECTORIES and path != skills_root:
                        child_directories.append(path)
                elif entry.is_file(follow_symlinks=False):
                    files.append(path)
                    if len(files) >= max_files:
                        truncated = True
                        break
            except OSError:
                continue
        if truncated:
            break
        pending.extend(reversed(child_directories))
    return files, truncated, {
        "visited_directories": visited_directories,
        "visited_entries": visited_entries,
    }


def _read_text(path: Path, limit: int = 200_000) -> str:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)
    except OSError:
        return ""


def _frameworks(files: Sequence[Path]) -> List[str]:
    found = set()
    package_files = [path for path in files if path.name == "package.json"]
    for path in package_files:
        try:
            package = json.loads(_read_text(path))
        except (ValueError, TypeError):
            continue
        dependencies = {}
        for key in ("dependencies", "devDependencies", "peerDependencies"):
            value = package.get(key, {})
            if isinstance(value, dict):
                dependencies.update(value)
        framework_packages = {
            "@angular/core": "Angular",
            "@nestjs/core": "NestJS",
            "astro": "Astro",
            "express": "Express",
            "next": "Next.js",
            "react": "React",
            "svelte": "Svelte",
            "vue": "Vue",
        }
        for package_name, framework in framework_packages.items():
            if package_name in dependencies:
                found.add(framework)

    text_manifests = {
        "pyproject.toml": {
            "django": "Django",
            "fastapi": "FastAPI",
            "flask": "Flask",
            "pytest": "pytest",
        },
        "requirements.txt": {
            "django": "Django",
            "fastapi": "FastAPI",
            "flask": "Flask",
            "pytest": "pytest",
        },
        "pom.xml": {"spring-boot": "Spring Boot"},
        "Cargo.toml": {"actix-web": "Actix Web", "axum": "Axum"},
    }
    for path in files:
        detectors = text_manifests.get(path.name)
        if not detectors:
            continue
        content = _read_text(path).lower()
        for needle, framework in detectors.items():
            if needle in content:
                found.add(framework)
    return sorted(found)


def scan_repository(root: Path, max_files: int) -> Dict[str, Any]:
    files, truncated, traversal = iter_repository_files(root, max_files)
    language_counts: Counter[str] = Counter()
    manifests: List[str] = []
    ci: List[str] = []
    infrastructure: List[str] = []
    documentation: List[str] = []
    conventions: List[str] = []
    test_files = 0

    for path in files:
        relative = _relative(path, root)
        language = LANGUAGE_EXTENSIONS.get(path.suffix.lower())
        if language:
            language_counts[language] += 1
        if (
            path.name in MANIFEST_NAMES
            or path.suffix in {".csproj", ".fsproj", ".sln"}
            or path.name.endswith((".gradle", ".gradle.kts"))
        ):
            manifests.append(relative)
        if relative.startswith(".github/workflows/") or path.name in {
            "azure-pipelines.yml",
            "azure-pipelines.yaml",
            "Jenkinsfile",
        }:
            ci.append(relative)
        if path.suffix.lower() in INFRA_SUFFIXES or path.name in {
            "Dockerfile",
            "docker-compose.yml",
            "docker-compose.yaml",
        }:
            infrastructure.append(relative)
        if path.suffix.lower() in DOC_SUFFIXES:
            documentation.append(relative)
        if path.name in CONVENTION_NAMES or path.name.startswith(
            (".eslintrc", ".prettierrc")
        ):
            conventions.append(relative)
        lowered_parts = [part.lower() for part in path.parts]
        if (
            "test" in lowered_parts
            or "tests" in lowered_parts
            or re.search(r"(?:^|[._-])(test|spec)(?:[._-]|$)", path.name.lower())
        ):
            test_files += 1

    return {
        "repository": str(root),
        "analysis": {
            "file_count": len(files),
            "truncated": truncated,
            "visited_directories": traversal["visited_directories"],
            "visited_entries": traversal["visited_entries"],
            "limits": {
                "files": max_files,
                "directories": MAX_SCAN_DIRECTORIES,
                "entries": MAX_SCAN_ENTRIES,
            },
            "ignored_directory_names": sorted(IGNORED_DIRECTORIES),
            "excluded_paths": [SKILLS_RELATIVE.as_posix()],
        },
        "languages": [
            {"name": name, "files": count}
            for name, count in sorted(
                language_counts.items(), key=lambda item: (-item[1], item[0])
            )
        ],
        "frameworks": _frameworks(files),
        "manifests": sorted(manifests),
        "ci": sorted(ci),
        "infrastructure": sorted(infrastructure),
        "documentation": sorted(documentation)[:100],
        "conventions": sorted(conventions),
        "test_file_count": test_files,
    }


def parse_frontmatter(path: Path) -> Tuple[Dict[str, Any], str]:
    text = _read_text(path)
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise SkillError(f"{path}: missing YAML frontmatter")
    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration as error:
        raise SkillError(f"{path}: unterminated YAML frontmatter") from error

    metadata: Dict[str, Any] = {}
    nested: Dict[str, str] = {}
    in_metadata = False
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("  ") and in_metadata:
            key, separator, value = line.strip().partition(":")
            if not separator:
                raise SkillError(f"{path}: invalid metadata entry")
            nested[key.strip()] = _decode_scalar(value.strip())
            continue
        key, separator, value = line.partition(":")
        if not separator or line.startswith((" ", "\t")):
            raise SkillError(f"{path}: unsupported frontmatter syntax")
        key = key.strip()
        if key == "metadata" and not value.strip():
            metadata[key] = nested
            in_metadata = True
        else:
            metadata[key] = _decode_scalar(value.strip())
            in_metadata = False
    body = "\n".join(lines[end + 1 :]).strip()
    return metadata, body


def _decode_scalar(value: str) -> str:
    if value.startswith('"') and value.endswith('"'):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, str) else str(decoded)
        except ValueError:
            return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def is_generated(path: Path) -> bool:
    try:
        frontmatter, _ = parse_frontmatter(path)
    except SkillError:
        return False
    metadata = frontmatter.get("metadata")
    return (
        isinstance(metadata, dict)
        and metadata.get("managed-by") == MANAGER
        and metadata.get("generated") == "true"
    )


def _validate_name(name: Any) -> str:
    if not isinstance(name, str) or not NAME_RE.fullmatch(name) or len(name) > 64:
        raise SkillError(
            f"invalid skill name {name!r}; use at most 64 lowercase letters, numbers, and hyphens"
        )
    if name in META_SKILLS:
        raise SkillError(f"generated plan cannot replace authored meta-skill {name!r}")
    return name


def _validate_string_list(
    value: Any, field: str, limit: int, *, names: bool = False
) -> List[str]:
    if not isinstance(value, list) or len(value) > limit:
        raise SkillError(f"{field} must be an array with at most {limit} entries")
    result: List[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise SkillError(f"{field} entries must be non-empty strings")
        item = item.strip()
        if names:
            if not NAME_RE.fullmatch(item) or len(item) > 64:
                raise SkillError(f"{field} contains invalid skill name {item!r}")
        elif len(item) > MAX_ROUTING_TERM_CHARS or "\n" in item:
            raise SkillError(
                f"{field} entries must be one line of at most {MAX_ROUTING_TERM_CHARS} characters"
            )
        if item not in result:
            result.append(item)
    return result


def _validate_routing(
    value: Any, skill_name: str, catalog_names: set
) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"official_skills"}:
        raise SkillError(f"{skill_name}: routing must contain only official_skills")
    routes = value["official_skills"]
    if not isinstance(routes, list) or not routes or len(routes) > MAX_OFFICIAL_ROUTES:
        raise SkillError(
            f"{skill_name}: official_skills must contain 1-{MAX_OFFICIAL_ROUTES} routes"
        )
    normalized: List[Dict[str, Any]] = []
    route_names = []
    allowed_keys = {"name", "aliases", "exclusions", "category", "fallback"}
    for index, route in enumerate(routes):
        if not isinstance(route, dict) or not set(route).issubset(allowed_keys):
            raise SkillError(f"{skill_name}: invalid official_skills[{index}]")
        if not {"name", "aliases", "exclusions"}.issubset(route):
            raise SkillError(
                f"{skill_name}: official_skills[{index}] requires name, aliases, and exclusions"
            )
        name = route["name"]
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or len(name) > 64:
            raise SkillError(f"{skill_name}: invalid official skill name {name!r}")
        if name not in catalog_names:
            raise SkillError(
                f"{skill_name}: official route {name!r} is absent from catalog_names"
            )
        if name in route_names:
            raise SkillError(f"{skill_name}: duplicate official route {name!r}")
        category = route.get("category")
        if category is not None and (
            not isinstance(category, str)
            or not category.strip()
            or len(category.strip()) > MAX_ROUTING_TERM_CHARS
            or "\n" in category
        ):
            raise SkillError(f"{skill_name}: invalid category for {name}")
        fallback = route.get("fallback")
        if fallback is not None and (
            not isinstance(fallback, str)
            or not NAME_RE.fullmatch(fallback)
            or len(fallback) > 64
            or fallback == name
        ):
            raise SkillError(f"{skill_name}: invalid fallback for {name}")
        route_names.append(name)
        normalized.append(
            {
                "name": name,
                "aliases": _validate_string_list(
                    route["aliases"],
                    f"{skill_name}.{name}.aliases",
                    MAX_ALIASES_PER_ROUTE,
                ),
                "exclusions": _validate_string_list(
                    route["exclusions"],
                    f"{skill_name}.{name}.exclusions",
                    MAX_EXCLUSIONS_PER_ROUTE,
                ),
                "category": category.strip() if category else None,
                "fallback": fallback,
            }
        )
    for route in normalized:
        fallback = route["fallback"]
        if fallback is not None and fallback not in route_names:
            raise SkillError(
                f"{skill_name}: fallback {fallback!r} must be in the same allow-list"
            )
    return {"official_skills": normalized}


def _validate_plan(plan: Any) -> List[Dict[str, Any]]:
    if not isinstance(plan, dict) or set(plan) != {"catalog_names", "skills"}:
        raise SkillError(
            "plan must contain only 'catalog_names' and a 'skills' array"
        )
    catalog_names = set(
        _validate_string_list(
            plan["catalog_names"], "catalog_names", 2_000, names=True
        )
    )
    entries = plan["skills"]
    if not isinstance(entries, list) or len(entries) > MAX_GENERATED_SKILLS:
        raise SkillError(
            f"plan 'skills' must be an array with at most {MAX_GENERATED_SKILLS} entries"
        )
    validated: List[Dict[str, Any]] = []
    seen = set()
    for index, entry in enumerate(entries):
        if (
            not isinstance(entry, dict)
            or not {"name", "description", "instructions"}.issubset(entry)
            or not set(entry).issubset(
                {"name", "description", "instructions", "routing"}
            )
        ):
            raise SkillError(
                f"skills[{index}] requires name, description, and instructions; routing is optional"
            )
        name = _validate_name(entry["name"])
        description = entry["description"]
        instructions = entry["instructions"]
        if not name.startswith(PROJECT_PREFIX):
            raise SkillError(f"{name}: generated names must start with {PROJECT_PREFIX!r}")
        if name in catalog_names:
            raise SkillError(f"{name}: generated name collides with the skill catalog")
        if name in seen:
            raise SkillError(f"duplicate generated skill name {name!r}")
        if (
            not isinstance(description, str)
            or not description.strip()
            or "\n" in description
            or len(description) > MAX_DESCRIPTION
        ):
            raise SkillError(
                f"{name}: description must be one non-empty line of at most {MAX_DESCRIPTION} characters"
            )
        if (
            not isinstance(instructions, str)
            or not instructions.strip()
            or len(instructions) > MAX_INSTRUCTION_CHARS
        ):
            raise SkillError(
                f"{name}: instructions must be non-empty Markdown of at most {MAX_INSTRUCTION_CHARS} characters"
            )
        seen.add(name)
        normalized: Dict[str, Any] = {
            "name": name,
            "description": description.strip(),
            "instructions": instructions.strip(),
        }
        if "routing" in entry:
            normalized["routing"] = _validate_routing(
                entry["routing"], name, catalog_names
            )
        validated.append(normalized)
    return validated


def _render_router_contract(routing: Mapping[str, Any]) -> str:
    lines = [
        "## Official skill allow-list",
        "",
        "Use only these exact external skill names. Load no official skill body until selection.",
        "",
    ]
    for route in routing["official_skills"]:
        lines.append(f"### `{route['name']}`")
        lines.append("")
        lines.append(f"- Aliases: {', '.join(route['aliases']) or '(none)'}")
        lines.append(
            f"- Exclusions: {', '.join(route['exclusions']) or '(none)'}"
        )
        if route["category"]:
            lines.append(f"- Category: {route['category']}")
        if route["fallback"]:
            lines.append(f"- Fallback: `{route['fallback']}`")
        lines.append("")
    lines.extend(
        [
            "## Selection contract",
            "",
            "1. Match repository terminology against aliases and reject neighboring exclusions.",
            "2. Select one confident primary exact skill name. Use its declared fallback only if the primary is unavailable or clearly inapplicable.",
            "3. Invoke the selected official skill lazily by exact name. Never load several official skills to decide.",
            "4. If confidence is insufficient, return `unresolved`; use only lightweight official-documentation discovery if the task requires research.",
            "5. This project router is context, not an evidence authority or official-skill provenance.",
            "",
            "Return exactly one selection object before invocation:",
            "",
            '```json',
            '{"status":"resolved|unresolved","primary_skill":"exact-name|null","fallback_skill":"exact-name|null","matched_alias":"string|null"}',
            "```",
        ]
    )
    return "\n".join(lines)


def render_skill(entry: Mapping[str, Any]) -> str:
    description = json.dumps(entry["description"], ensure_ascii=True)
    kind = "official-skill-router" if "routing" in entry else "project-skill"
    body = entry["instructions"].strip()
    if "routing" in entry:
        body = f"{body}\n\n{_render_router_contract(entry['routing'])}"
    rendered = (
        "---\n"
        f"name: {entry['name']}\n"
        f"description: {description}\n"
        "metadata:\n"
        f"  managed-by: {MANAGER}\n"
        '  generated: "true"\n'
        f'  format-version: "{FORMAT_VERSION}"\n'
        f'  kind: "{kind}"\n'
        '  provenance: "project-repository-context"\n'
        "---\n\n"
        "<!-- Generated by repository-skill-generator; edit through the generator or session improver. -->\n\n"
        f"{body}\n"
    )
    size_limit = MAX_ROUTER_BYTES if "routing" in entry else MAX_SKILL_BYTES
    if len(rendered.encode("utf-8")) > size_limit:
        raise SkillError(
            f"{entry['name']}: rendered skill exceeds {size_limit} bytes"
        )
    return rendered


def _ensure_safe_skills_root(root: Path) -> Path:
    skills_root = root
    for component in SKILLS_RELATIVE.parts:
        skills_root = skills_root / component
        if skills_root.is_symlink():
            raise SkillError(f"refusing symlinked skills path: {skills_root}")
    try:
        skills_root.resolve().relative_to(root)
    except ValueError as error:
        raise SkillError(f"skills root escapes repository: {skills_root}") from error
    return skills_root


def apply_plan(
    root: Path, entries: Sequence[Mapping[str, Any]], prune: bool, dry_run: bool
) -> Dict[str, List[str]]:
    skills_root = _ensure_safe_skills_root(root)
    desired = {entry["name"]: entry for entry in entries}

    for name in desired:
        directory = skills_root / name
        skill_file = directory / "SKILL.md"
        if directory.is_symlink():
            raise SkillError(f"refusing symlinked skill directory: {directory}")
        if directory.exists() and not skill_file.is_file():
            raise SkillError(f"{directory}: existing directory has no SKILL.md")
        if skill_file.exists() and not is_generated(skill_file):
            raise SkillError(f"{name}: refusing to replace hand-authored skill")

    result: Dict[str, List[str]] = {
        "created": [],
        "updated": [],
        "unchanged": [],
        "pruned": [],
    }
    rendered = {name: render_skill(entry) for name, entry in desired.items()}
    for name in sorted(desired):
        skill_file = skills_root / name / "SKILL.md"
        previous = _read_text(skill_file) if skill_file.exists() else None
        if previous == rendered[name]:
            result["unchanged"].append(name)
        elif previous is None:
            result["created"].append(name)
        else:
            result["updated"].append(name)

    if prune and skills_root.is_dir():
        for directory in sorted(skills_root.iterdir()):
            if (
                directory.is_dir()
                and not directory.is_symlink()
                and directory.name not in desired
                and directory.name not in META_SKILLS
                and is_generated(directory / "SKILL.md")
            ):
                result["pruned"].append(directory.name)

    if dry_run:
        return result

    skills_root.mkdir(parents=True, exist_ok=True)
    for name in result["created"] + result["updated"]:
        directory = skills_root / name
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "SKILL.md"
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=directory,
            prefix=".SKILL.",
            delete=False,
        ) as handle:
            handle.write(rendered[name])
            temporary = Path(handle.name)
        temporary.replace(target)
    for name in result["pruned"]:
        shutil.rmtree(skills_root / name)
    return result


def validate_skills(root: Path, require_meta: bool) -> Dict[str, Any]:
    skills_root = _ensure_safe_skills_root(root)
    errors: List[str] = []
    found: List[str] = []
    if skills_root.is_dir():
        for directory in sorted(skills_root.iterdir()):
            if not directory.is_dir() or directory.is_symlink():
                continue
            skill_file = directory / "SKILL.md"
            if not skill_file.is_file():
                errors.append(f"{directory}: missing SKILL.md")
                continue
            try:
                frontmatter, body = parse_frontmatter(skill_file)
                name = frontmatter.get("name")
                description = frontmatter.get("description")
                if name != directory.name:
                    errors.append(f"{skill_file}: name must match parent directory")
                if not isinstance(name, str) or not NAME_RE.fullmatch(name) or len(name) > 64:
                    errors.append(f"{skill_file}: invalid name")
                if (
                    not isinstance(description, str)
                    or not description
                    or len(description) > 1024
                ):
                    errors.append(f"{skill_file}: invalid description")
                if not body:
                    errors.append(f"{skill_file}: empty instructions")
                if is_generated(skill_file):
                    metadata = frontmatter["metadata"]
                    if metadata.get("format-version") != FORMAT_VERSION:
                        errors.append(f"{skill_file}: unsupported generated format version")
                    if metadata.get("kind") not in {
                        "project-skill",
                        "official-skill-router",
                    }:
                        errors.append(f"{skill_file}: invalid generated skill kind")
                    if metadata.get("provenance") != "project-repository-context":
                        errors.append(f"{skill_file}: invalid generated provenance")
                found.append(directory.name)
            except SkillError as error:
                errors.append(str(error))
    if require_meta:
        for name in sorted(META_SKILLS):
            if name not in found:
                errors.append(f"missing authored meta-skill {name}")
            elif is_generated(skills_root / name / "SKILL.md"):
                errors.append(f"meta-skill {name} must not be generated")
    if errors:
        raise SkillError("\n".join(errors))
    return {"valid": True, "skills": found}


def _load_plan(path: Path) -> List[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return _validate_plan(json.load(handle))
    except OSError as error:
        raise SkillError(f"cannot read plan {path}: {error}") from error
    except ValueError as error:
        raise SkillError(f"invalid JSON plan {path}: {error}") from error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="emit bounded repository evidence as JSON")
    scan.add_argument("--repo", type=Path, default=Path.cwd())
    scan.add_argument("--max-files", type=int, default=5_000)

    apply = subparsers.add_parser("apply", help="apply a generated-skill JSON plan")
    apply.add_argument("--repo", type=Path, default=Path.cwd())
    apply.add_argument("--plan", type=Path, required=True)
    apply.add_argument("--prune", action="store_true")
    apply.add_argument("--dry-run", action="store_true")

    validate = subparsers.add_parser("validate", help="validate repository Agent Skills")
    validate.add_argument("--repo", type=Path, default=Path.cwd())
    validate.add_argument("--require-meta", action="store_true")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        root = args.repo.expanduser().resolve()
        if not root.is_dir():
            raise SkillError(f"repository root is not a directory: {root}")
        if args.command == "scan":
            if not 1 <= args.max_files <= MAX_SCAN_FILES:
                raise SkillError(
                    f"--max-files must be between 1 and {MAX_SCAN_FILES}"
                )
            result = scan_repository(root, args.max_files)
        elif args.command == "apply":
            result = apply_plan(
                root, _load_plan(args.plan), prune=args.prune, dry_run=args.dry_run
            )
        else:
            result = validate_skills(root, require_meta=args.require_meta)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except SkillError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
