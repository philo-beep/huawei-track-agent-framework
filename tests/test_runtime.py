import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from framework.runtime import FrameworkError, Workspace


class WorkspaceProtocolTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / ("huawei-tests-" + uuid4().hex)
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)
        self.workspace = Workspace(self.root)
        self.workspace.initialize()

    def add_task(self, task_id="ui", owner="A", dependencies=None):
        self.workspace.add_task(
            task_id,
            owner,
            "Implement a verifiable artifact",
            "The artifact exists and satisfies the acceptance criteria",
            dependencies=dependencies,
        )

    def message(self, task_id, sender, recipient, message_type, status, payload=None):
        return {
            "task_id": task_id,
            "from_agent": sender,
            "to_agent": recipient,
            "type": message_type,
            "payload": {} if payload is None else payload,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def send(self, task_id, sender, recipient, message_type, status, payload=None):
        return self.workspace.send(
            self.message(task_id, sender, recipient, message_type, status, payload)
        )

    def start(self, task_id="ui", owner="A"):
        self.send(task_id, "Orchestrator", owner, "assign", "assigned")
        self.send(
            task_id, owner, "QA", "fix", "in_progress",
            {"summary": "Start work against the acceptance criteria"},
        )

    def artifact(self, owner="A", name="result.txt", content="initial delivery"):
        artifact_path = self.root / "outputs" / owner / name
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(content, encoding="utf-8")
        return artifact_path.relative_to(self.root).as_posix()

    def deliver(self, task_id="ui", owner="A", artifacts=None):
        if artifacts is None:
            artifacts = [self.artifact(owner)]
        self.send(
            task_id, owner, "QA", "deliver", "in_review", {"artifacts": artifacts}
        )

    def approve(self, task_id="ui"):
        return self.send(
            task_id,
            "QA",
            "Orchestrator",
            "review",
            "done",
            {"summary": "All acceptance criteria passed"},
        )

    def issue(self, owner="A"):
        return {
            "issue_id": "ISSUE-001",
            "description": "Missing an error recovery action",
            "owner": owner,
            "severity": "major",
            "retest": "An error state shows a working recovery action",
        }

    def test_dependencies_block_assignment_until_accepted(self):
        self.add_task("source", "C")
        self.add_task("training", "D", ["source"])
        with self.assertRaises(FrameworkError):
            self.send("training", "Orchestrator", "D", "assign", "assigned")
        self.start("source", "C")
        self.deliver("source", "C")
        with self.assertRaises(FrameworkError):
            self.send("training", "Orchestrator", "D", "assign", "assigned")
        self.approve("source")
        self.start("training", "D")

    def test_only_orchestrator_can_assign_to_responsible_owner(self):
        self.add_task()
        invalid_routes = [("QA", "A"), ("Orchestrator", "B"), ("A", "A")]
        for sender, recipient in invalid_routes:
            with self.subTest(sender=sender, recipient=recipient):
                with self.assertRaises(FrameworkError):
                    self.send("ui", sender, recipient, "assign", "assigned")
        self.start()

    def test_owner_cannot_deliver_before_starting_work(self):
        self.add_task()
        self.send("ui", "Orchestrator", "A", "assign", "assigned")
        with self.assertRaises(FrameworkError):
            self.deliver()
        self.send(
            "ui", "A", "QA", "fix", "in_progress",
            {"summary": "Start work against the acceptance criteria"},
        )
        self.deliver()
        self.approve()

    def test_delivery_must_come_from_owner_and_go_to_qa(self):
        self.add_task()
        self.start()
        artifact = self.artifact()
        for sender, recipient in [("B", "QA"), ("A", "Orchestrator")]:
            with self.subTest(sender=sender, recipient=recipient):
                with self.assertRaises(FrameworkError):
                    self.send(
                        "ui", sender, recipient, "deliver", "in_review",
                        {"artifacts": [artifact]},
                    )
        self.deliver(artifacts=[artifact])
        self.approve()

    def test_qa_is_the_only_reviewer(self):
        self.add_task()
        self.start()
        self.deliver()
        for sender in ["Orchestrator", "A", "E"]:
            with self.subTest(sender=sender):
                with self.assertRaises(FrameworkError):
                    self.send("ui", sender, "Orchestrator", "review", "done")
        self.approve()

    def test_delivery_rejects_paths_outside_owner_directory(self):
        self.add_task()
        self.start()
        other_owner_artifact = self.artifact("B")
        outside_file = self.root.parent / (self.root.name + "-outside.txt")
        outside_file.write_text("outside", encoding="utf-8")
        self.addCleanup(outside_file.unlink, missing_ok=True)
        invalid_paths = [
            other_owner_artifact,
            "../" + outside_file.name,
            str(outside_file.resolve()),
            "outputs/A/../../agent.md",
            "outputs/A/missing.txt",
        ]
        for artifact_path in invalid_paths:
            with self.subTest(path=artifact_path):
                with self.assertRaises(FrameworkError):
                    self.deliver(artifacts=[artifact_path])
        self.deliver()
        self.approve()

    def test_delivery_requires_nonempty_artifacts(self):
        self.add_task()
        self.start()
        for payload in [{}, {"artifacts": []}, {"artifacts": "outputs/A/result.txt"}]:
            with self.subTest(payload=payload):
                with self.assertRaises(FrameworkError):
                    self.send("ui", "A", "QA", "deliver", "in_review", payload)
        self.deliver()
        self.approve()

    def test_review_detects_changed_delivery_bytes(self):
        self.add_task()
        self.start()
        artifact = self.artifact()
        self.deliver(artifacts=[artifact])
        (self.root / artifact).write_text("changed after delivery", encoding="utf-8")
        with self.assertRaises(FrameworkError):
            self.approve()

    def test_review_detects_deleted_delivery(self):
        self.add_task()
        self.start()
        artifact = self.artifact()
        self.deliver(artifacts=[artifact])
        (self.root / artifact).unlink()
        with self.assertRaises(FrameworkError):
            self.approve()

    def test_rejection_must_route_issues_to_responsible_owner(self):
        self.add_task()
        self.start()
        self.deliver()
        invalid_cases = [
            ("QA", "B", [self.issue()]),
            ("QA", "A", [self.issue("B")]),
            ("Orchestrator", "A", [self.issue()]),
            ("QA", "A", []),
        ]
        for sender, recipient, issues in invalid_cases:
            with self.subTest(sender=sender, recipient=recipient, issues=issues):
                with self.assertRaises(FrameworkError):
                    self.send(
                        "ui", sender, recipient, "reject", "changes_requested",
                        {"issues": issues},
                    )
        self.approve()

    def test_rejection_fix_and_reinspection_survive_reopening_workspace(self):
        self.add_task()
        self.start()
        artifact = self.artifact()
        self.deliver(artifacts=[artifact])
        self.send(
            "ui", "QA", "A", "reject", "changes_requested",
            {"issues": [self.issue()]},
        )
        self.workspace = Workspace(self.root)
        with self.assertRaises(FrameworkError):
            self.send("ui", "B", "QA", "fix", "in_progress")
        self.send(
            "ui", "A", "QA", "fix", "in_progress",
            {"summary": "Resolve the reported issue", "issue_ids": ["ISSUE-001"]},
        )
        (self.root / artifact).write_text("recovery action included", encoding="utf-8")
        self.deliver(artifacts=[artifact])
        self.workspace = Workspace(self.root)
        self.approve()
        self.workspace.validate()
        with self.assertRaises(FrameworkError):
            self.send("ui", "A", "QA", "fix", "in_progress")

    def test_status_cannot_disagree_with_message_transition(self):
        self.add_task()
        with self.assertRaises(FrameworkError):
            self.send("ui", "Orchestrator", "A", "assign", "done")
        self.start()

    def test_duplicate_message_is_rejected_without_state_mutation(self):
        self.add_task()
        message = self.message("ui", "Orchestrator", "A", "assign", "assigned")
        self.workspace.send(message)
        before = self.workspace.read()
        with self.assertRaises(FrameworkError):
            self.workspace.send(message)
        self.assertEqual(before, self.workspace.read())

    def test_dependency_list_rejects_unknown_duplicate_and_self_dependencies(self):
        self.add_task("source", "C")
        for dependencies in [["missing"], ["source", "source"], ["training"], "source"]:
            with self.subTest(dependencies=dependencies):
                with self.assertRaises(FrameworkError):
                    self.add_task("training", "D", dependencies)
        self.add_task("training", "D", ["source"])

    def test_board_and_message_history_track_complete_workflow(self):
        self.add_task()
        self.start()
        self.deliver()
        self.approve()
        board = self.workspace.read()
        self.assertEqual(board["tasks"]["ui"]["status"], "done")
        self.assertEqual(len(board["messages"]), 4)
        self.assertTrue(board["events"])
        self.assertGreater(board["revision"], 0)
        self.workspace.validate()

    def finish_task(self, task_id="ui", owner="A"):
        self.add_task(task_id, owner)
        self.start(task_id, owner)
        self.deliver(task_id, owner)
        self.approve(task_id)

    def test_release_requires_qa_completion_and_e_approval(self):
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Product content matches the candidate")
        self.finish_task()
        self.finish_task("product", "E")
        self.add_task("backend", "D")
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Product content matches the candidate")
        self.workspace.hold("backend", "Deferred from this release", cancel=True)
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        for reviewer in ["QA", "Orchestrator", "A"]:
            with self.subTest(reviewer=reviewer):
                with self.assertRaises(FrameworkError):
                    self.workspace.approve_release(reviewer, "Product matches")
        self.workspace.approve_release("E", "Product content matches the candidate")
        self.assertTrue(self.workspace.release_check()["ready"])

    def test_release_requires_a_qa_accepted_product_task(self):
        self.finish_task()
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Product matches without product evidence")
        self.add_task("cancelled-product", "E")
        self.workspace.hold("cancelled-product", "Product draft was cancelled", cancel=True)
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Cancelled product evidence is insufficient")
        self.finish_task("product", "E")
        self.workspace.approve_release("E", "QA accepted the product document")
        self.assertTrue(self.workspace.release_check()["ready"])

    def test_release_approval_invalidated_by_board_changes(self):
        self.finish_task()
        self.finish_task("product", "E")
        self.workspace.approve_release("E", "Product matches")
        self.add_task("new-task", "B")
        self.assertIsNone(self.workspace.read()["release_approval"])
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        self.workspace.hold("new-task", "Not included in this release", cancel=True)
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        self.workspace.approve_release("E", "Product still matches after scope change")
        self.assertTrue(self.workspace.release_check()["ready"])

    def test_release_rechecks_artifact_bytes_after_e_approval(self):
        self.finish_task()
        self.finish_task("product", "E")
        self.workspace.approve_release("E", "Product matches")
        (self.root / "outputs/A/result.txt").write_text("unreviewed change", encoding="utf-8")
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Attempt to approve changed files")

    def test_qa_can_reopen_changed_accepted_delivery_and_reapprove_release(self):
        self.finish_task()
        self.finish_task("product", "E")
        self.workspace.approve_release("E", "Product matches the accepted candidate")
        artifact = self.root / "outputs/A/result.txt"
        artifact.write_text("Change requires a new QA review", encoding="utf-8")
        with self.assertRaises(FrameworkError):
            self.approve()
        self.send(
            "ui", "QA", "A", "reject", "changes_requested",
            {"issues": [self.issue()]},
        )
        self.assertIsNone(self.workspace.read()["release_approval"])
        self.send(
            "ui", "A", "QA", "fix", "in_progress",
            {"summary": "Address the reopened issue", "issue_ids": ["ISSUE-001"]},
        )
        artifact.write_text("Reviewed recovery action included", encoding="utf-8")
        self.deliver(artifacts=["outputs/A/result.txt"])
        self.approve()
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        self.workspace.approve_release("E", "Product matches the newly accepted candidate")
        self.assertTrue(self.workspace.release_check()["ready"])

    def test_hold_and_resume_preserve_previous_state_and_reason(self):
        self.add_task()
        self.start()
        self.workspace.hold("ui", "Awaiting a required external input")
        self.assertEqual(self.workspace.read()["tasks"]["ui"]["status"], "blocked")
        with self.assertRaises(FrameworkError):
            self.deliver()
        with self.assertRaises(FrameworkError):
            self.workspace.resume("ui", "")
        self.workspace = Workspace(self.root)
        self.workspace.resume("ui", "External input is now available")
        self.assertEqual(self.workspace.read()["tasks"]["ui"]["status"], "in_progress")
        self.deliver()
        self.approve()
        events = self.workspace.read()["events"]
        hold_event = next(event for event in events if event["type"] == "task_blocked")
        resume_event = next(event for event in events if event["type"] == "task_resumed")
        self.assertTrue(hold_event["payload"]["reason"])
        self.assertTrue(resume_event["payload"]["reason"])
        self.workspace.validate()

    def test_cancelled_and_completed_tasks_cannot_resume_or_restart(self):
        self.add_task("cancelled")
        self.workspace.hold("cancelled", "User cancelled the scope", cancel=True)
        with self.assertRaises(FrameworkError):
            self.workspace.resume("cancelled", "Try to reopen cancellation")
        with self.assertRaises(FrameworkError):
            self.start("cancelled")
        self.finish_task()
        with self.assertRaises(FrameworkError):
            self.workspace.hold("ui", "Try to change an accepted task")
        with self.assertRaises(FrameworkError):
            self.workspace.resume("ui", "Try to reopen acceptance")

    def test_dependency_artifact_mutation_blocks_downstream_start(self):
        self.finish_task("source", "C")
        self.add_task("training", "D", ["source"])
        (self.root / "outputs/C/result.txt").write_text("unreviewed data", encoding="utf-8")
        with self.assertRaises(FrameworkError):
            self.start("training", "D")
        self.assertEqual(self.workspace.read()["tasks"]["training"]["status"], "pending")

    def test_reaccepted_dependency_requires_downstream_qa_reinspection(self):
        self.finish_task()
        self.add_task("integration", "B", ["ui"])
        self.start("integration", "B")
        self.deliver("integration", "B")
        self.approve("integration")
        self.finish_task("product", "E")
        self.workspace.approve_release("E", "Original dependency candidate matches")

        artifact = self.root / "outputs/A/result.txt"
        artifact.write_text("Updated upstream result", encoding="utf-8")
        self.send(
            "ui", "QA", "A", "reject", "changes_requested",
            {"issues": [self.issue()]},
        )
        self.send("ui", "A", "QA", "fix", "in_progress")
        self.deliver(artifacts=["outputs/A/result.txt"])
        self.approve()

        self.assertEqual(self.workspace.read()["tasks"]["integration"]["status"], "done")
        with self.assertRaises(FrameworkError):
            self.workspace.validate()
        with self.assertRaises(FrameworkError):
            self.workspace.release_check()
        with self.assertRaises(FrameworkError):
            self.workspace.approve_release("E", "Stale downstream result cannot pass")

        self.send(
            "integration", "QA", "B", "reject", "changes_requested",
            {"issues": [self.issue("B")]},
        )
        self.send("integration", "B", "QA", "fix", "in_progress")
        self.deliver("integration", "B")
        self.approve("integration")
        self.workspace.validate()
        self.workspace.approve_release("E", "Upstream and downstream are reaccepted")
        self.assertTrue(self.workspace.release_check()["ready"])


if __name__ == "__main__":
    unittest.main()
