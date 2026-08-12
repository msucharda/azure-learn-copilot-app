import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "manage_project_skills.py"
)
SPEC = importlib.util.spec_from_file_location("manage_project_skills", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ManageProjectSkillsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def run_main(self, *arguments):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = MODULE.main(list(arguments))
        payload = json.loads(stdout.getvalue()) if stdout.getvalue() else None
        return code, payload, stderr.getvalue()

    def write_plan(self, skills, catalog_names=None):
        plan = self.root / "plan.json"
        plan.write_text(
            json.dumps(
                {"catalog_names": catalog_names or [], "skills": skills}
            ),
            encoding="utf-8",
        )
        return plan

    def generated_entry(self, name="project-repository-testing"):
        return {
            "name": name,
            "description": "Runs project tests. Use when changing tested behavior.",
            "instructions": "# Routing\n\nUse when changing tested behavior.\n",
        }

    def test_scan_detects_signals_and_ignores_generated_and_vendor_files(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("print('ok')\n", encoding="utf-8")
        (self.root / "requirements.txt").write_text("fastapi\npytest\n", encoding="utf-8")
        (self.root / ".github" / "workflows").mkdir(parents=True)
        (self.root / ".github" / "workflows" / "ci.yml").write_text("name: CI\n", encoding="utf-8")
        (self.root / "infra").mkdir()
        (self.root / "infra" / "main.tf").write_text("terraform {}\n", encoding="utf-8")
        (self.root / "vendor").mkdir()
        (self.root / "vendor" / "ignored.go").write_text("package ignored\n", encoding="utf-8")
        (self.root / "venv").mkdir()
        (self.root / "venv" / "ignored.py").write_text("ignored = True\n", encoding="utf-8")
        (self.root / "packages" / "first-party").mkdir(parents=True)
        (self.root / "packages" / "first-party" / "index.ts").write_text(
            "export {}\n", encoding="utf-8"
        )
        (self.root / ".github" / "skills" / "recursive").mkdir(parents=True)
        (self.root / ".github" / "skills" / "recursive" / "body.ts").write_text(
            "export {}\n", encoding="utf-8"
        )

        report = MODULE.scan_repository(self.root.resolve(), 100)

        self.assertEqual(
            report["languages"],
            [
                {"name": "Python", "files": 1},
                {"name": "TypeScript", "files": 1},
            ],
        )
        self.assertEqual(report["frameworks"], ["FastAPI", "pytest"])
        self.assertEqual(report["ci"], [".github/workflows/ci.yml"])
        self.assertEqual(report["infrastructure"], ["infra/main.tf"])
        self.assertEqual(report["analysis"]["excluded_paths"], [".github/skills"])

    def test_apply_uses_repository_path_and_is_idempotent(self):
        plan = self.write_plan([self.generated_entry()])

        first_code, first, _ = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(plan)
        )
        second_code, second, _ = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(plan)
        )

        skill_file = self.root / ".github" / "skills" / "project-repository-testing" / "SKILL.md"
        self.assertEqual(first_code, 0)
        self.assertEqual(first["created"], ["project-repository-testing"])
        self.assertEqual(second_code, 0)
        self.assertEqual(second["unchanged"], ["project-repository-testing"])
        self.assertIn("managed-by: repository-skill-generator", skill_file.read_text())

    def test_apply_preserves_hand_authored_skill(self):
        skill_dir = self.root / ".github" / "skills" / "project-repository-testing"
        skill_dir.mkdir(parents=True)
        original = (
            "---\n"
            "name: project-repository-testing\n"
            "description: Hand authored.\n"
            "---\n\n"
            "Keep this.\n"
        )
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(original, encoding="utf-8")
        plan = self.write_plan([self.generated_entry()])

        code, _, error = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(plan)
        )

        self.assertEqual(code, 2)
        self.assertIn("hand-authored", error)
        self.assertEqual(skill_file.read_text(encoding="utf-8"), original)

    def test_prune_removes_only_generated_skills(self):
        initial = self.write_plan(
            [
                self.generated_entry("project-keep-generated"),
                self.generated_entry("project-remove-generated"),
            ]
        )
        self.assertEqual(
            self.run_main("apply", "--repo", str(self.root), "--plan", str(initial))[0],
            0,
        )
        authored = self.root / ".github" / "skills" / "authored" / "SKILL.md"
        authored.parent.mkdir(parents=True)
        authored.write_text(
            "---\nname: authored\ndescription: Hand authored.\n---\n\nKeep.\n",
            encoding="utf-8",
        )
        reduced = self.write_plan([self.generated_entry("project-keep-generated")])

        code, result, _ = self.run_main(
            "apply",
            "--repo",
            str(self.root),
            "--plan",
            str(reduced),
            "--prune",
        )

        self.assertEqual(code, 0)
        self.assertEqual(result["pruned"], ["project-remove-generated"])
        self.assertTrue(authored.exists())
        self.assertFalse(
            (self.root / ".github" / "skills" / "project-remove-generated").exists()
        )

    def test_rejects_catalog_collision(self):
        plan = self.write_plan(
            [self.generated_entry("project-existing-skill")],
            catalog_names=["project-existing-skill"],
        )

        code, _, error = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(plan)
        )

        self.assertEqual(code, 2)
        self.assertIn("collides with the skill catalog", error)

    def test_router_rejects_unknown_official_skill(self):
        entry = self.generated_entry("project-router")
        entry["routing"] = {
            "official_skills": [
                {
                    "name": "azure-functons",
                    "aliases": ["function"],
                    "exclusions": [],
                }
            ]
        }
        plan = self.write_plan([entry], catalog_names=["azure-functions"])

        code, _, error = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(plan)
        )

        self.assertEqual(code, 2)
        self.assertIn("absent from catalog_names", error)

    def test_rejects_symlinked_github_ancestor(self):
        outside = self.root / "outside"
        outside.mkdir()
        repository = self.root / "repository"
        repository.mkdir()
        (repository / ".github").symlink_to(outside, target_is_directory=True)
        plan = self.write_plan([self.generated_entry()])

        code, _, error = self.run_main(
            "apply", "--repo", str(repository), "--plan", str(plan)
        )

        self.assertEqual(code, 2)
        self.assertIn("symlinked skills path", error)
        self.assertFalse((outside / "skills").exists())

    def test_scan_rejects_excessive_file_limit(self):
        code, _, error = self.run_main(
            "scan",
            "--repo",
            str(self.root),
            "--max-files",
            str(MODULE.MAX_SCAN_FILES + 1),
        )

        self.assertEqual(code, 2)
        self.assertIn("--max-files must be between", error)

    def test_azure_router_fixture_is_bounded_and_has_selection_contract(self):
        fixture = Path(__file__).with_name("fixtures") / "azure_router_plan.json"

        code, result, error = self.run_main(
            "apply", "--repo", str(self.root), "--plan", str(fixture)
        )

        self.assertEqual((code, error), (0, ""))
        self.assertEqual(result["created"], ["project-azure-learn-skill-router"])
        skill = (
            self.root
            / ".github"
            / "skills"
            / "project-azure-learn-skill-router"
            / "SKILL.md"
        )
        content = skill.read_text(encoding="utf-8")
        self.assertLessEqual(len(content.encode("utf-8")), MODULE.MAX_ROUTER_BYTES)
        self.assertIn('kind: "official-skill-router"', content)
        self.assertIn('provenance: "project-repository-context"', content)
        self.assertIn('"status":"resolved|unresolved"', content)
        self.assertIn("`azure-functions`", content)

    def test_validate_rejects_mismatched_metadata(self):
        skill = self.root / ".github" / "skills" / "right-name" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text(
            "---\nname: wrong-name\ndescription: Invalid name mapping.\n---\n\nBody.\n",
            encoding="utf-8",
        )

        code, _, error = self.run_main("validate", "--repo", str(self.root))

        self.assertEqual(code, 2)
        self.assertIn("name must match parent directory", error)


if __name__ == "__main__":
    unittest.main()
