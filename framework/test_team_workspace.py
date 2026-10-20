import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from framework.runtime import FrameworkError, Workspace, now
from tools.team_workspace import (
    ROOT, TeamError, check_changes, create_workspaces, git, load_layout,
    workspace_plan,
)


class TeamWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="huawei-team-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        git(self.root, "init", "-b", "main")
        git(self.root, "config", "user.name", "Synthetic Test")
        git(self.root, "config", "user.email", "test@example.invalid")
        self.layout = load_layout()
        self.layout["workspace_sibling"] = "member-workspaces"
        required = ["framework/team-layout.json", "tools/team_workspace.py", "协作工作区/协作开发与合并说明.md", "shared.txt"]
        required.extend(spec["directory"] + "/README.md" for spec in self.layout["members"].values())
        for name in required:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic baseline\n", encoding="utf-8")
        self.commit("baseline")

    def write(self, name, content="synthetic change\n"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def commit(self, message):
        git(self.root, "add", "--all")
        git(self.root, "commit", "-m", message)

    def feature(self):
        git(self.root, "switch", "-c", self.layout["members"]["M1"]["branch"])

    def test_own_module_commit_is_allowed(self):
        self.feature()
        self.write("modules/customer/src/index.js")
        self.commit("customer only")
        self.assertTrue(check_changes(self.root, self.layout, "M1", "main", "HEAD")["passed"])

    def test_cross_module_commit_is_rejected(self):
        self.feature()
        self.write("modules/writing/src/index.js")
        self.commit("wrong module")
        result = check_changes(self.root, self.layout, "M1", "main", "HEAD")
        self.assertEqual(result["forbidden_paths"], ["modules/writing/src/index.js"])

    def test_shared_file_deletion_is_rejected(self):
        self.feature()
        (self.root / "shared.txt").unlink()
        self.commit("delete shared")
        self.assertFalse(check_changes(self.root, self.layout, "M1", "main", "HEAD")["passed"])

    def test_rename_from_shared_into_owned_module_is_rejected(self):
        self.feature()
        git(self.root, "mv", "shared.txt", "modules/customer/moved.txt")
        self.commit("move shared into module")
        result = check_changes(self.root, self.layout, "M1", "main", "HEAD")
        self.assertIn("shared.txt", result["forbidden_paths"])
        self.assertIn("modules/customer/moved.txt", result["changed_paths"])

    def test_cross_module_rename_is_rejected(self):
        self.feature()
        git(self.root, "mv", "modules/evidence/README.md", "modules/customer/borrowed.md")
        self.commit("move other module")
        result = check_changes(self.root, self.layout, "M1", "main", "HEAD")
        self.assertIn("modules/evidence/README.md", result["forbidden_paths"])

    def test_staged_and_untracked_cross_module_changes_are_rejected(self):
        self.write("modules/strategy/untracked.txt")
        self.write("shared.txt", "staged change")
        git(self.root, "add", "shared.txt")
        result = check_changes(self.root, self.layout, "M1", "main", "HEAD", True)
        self.assertIn("shared.txt", result["forbidden_paths"])
        self.assertIn("modules/strategy/untracked.txt", result["forbidden_paths"])

    def test_sensitive_file_inside_owned_module_is_rejected(self):
        self.write("modules/customer/.env", "EXAMPLE_VALUE=synthetic")
        result = check_changes(self.root, self.layout, "M1", "main", "HEAD", True)
        self.assertIn("modules/customer/.env", result["forbidden_paths"])

    def test_option_like_reference_is_rejected(self):
        with self.assertRaises(TeamError):
            check_changes(self.root, self.layout, "M1", "--help", "HEAD")

    def test_dirty_check_requires_current_head(self):
        self.feature()
        self.write("modules/customer/new.txt")
        self.commit("new work")
        with self.assertRaises(TeamError):
            check_changes(self.root, self.layout, "M1", "main", "main", True)

    def test_plan_does_not_create_workspaces(self):
        plan = workspace_plan(self.root, self.layout)
        self.assertEqual(len(plan["workspaces"]), 5)
        self.assertFalse((self.root.parent / "member-workspaces").exists())

    def test_cli_create_without_apply_is_read_only(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/team_workspace.py"), "--root", str(self.root), "create"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)["workspaces"]), 5)
        self.assertEqual(git(self.root, "for-each-ref", "--format=%(refname)", "refs/heads").splitlines(), ["refs/heads/main"])

    def test_branch_collision_prevents_all_workspace_creation(self):
        final_member = list(self.layout["members"].values())[-1]
        git(self.root, "branch", final_member["branch"])
        with self.assertRaises(TeamError):
            create_workspaces(self.root, self.layout)
        self.assertFalse((self.root.parent / "member-workspaces").exists())

    def test_existing_directory_prevents_all_workspace_creation(self):
        path = Path(workspace_plan(self.root, self.layout)["workspaces"][-1]["path"])
        path.mkdir(parents=True)
        marker = path / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaises(TeamError):
            create_workspaces(self.root, self.layout)
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")
        self.assertEqual(len(git(self.root, "worktree", "list", "--porcelain").split("worktree ")) - 1, 1)

    def test_created_workspaces_have_independent_checkouts(self):
        created = create_workspaces(self.root, self.layout)["created"]
        self.assertEqual(len(created), 5)
        first_path = Path(created[0]["path"])
        (first_path / "modules/customer/README.md").write_text("local member change", encoding="utf-8")
        self.assertNotEqual((self.root / "modules/customer/README.md").read_text(encoding="utf-8"), "local member change")
        self.assertNotEqual((Path(created[1]["path"]) / "modules/customer/README.md").read_text(encoding="utf-8"), "local member change")

    def test_module_roles_cannot_deliver_other_module_artifacts(self):
        workspace = Workspace(self.root)
        workspace.initialize()
        workspace.add_task("module-customer", "M1", "Customer", "Only own module")
        for kind, sender, target, status in [("assign", "Orchestrator", "M1", "assigned"), ("fix", "M1", "QA", "in_progress")]:
            workspace.send({"task_id": "module-customer", "from_agent": sender, "to_agent": target, "type": kind, "payload": {"summary": "synthetic"}, "status": status, "timestamp": now()})
        message = {"task_id": "module-customer", "from_agent": "M1", "to_agent": "QA", "type": "deliver", "payload": {"artifacts": ["modules/evidence/README.md"]}, "status": "in_review", "timestamp": now()}
        with self.assertRaises(FrameworkError):
            workspace.send(message)
        message["payload"]["artifacts"] = ["modules/customer/README.md"]
        self.assertEqual(workspace.send(message)["status"], "in_review")


if __name__ == "__main__":
    unittest.main()
