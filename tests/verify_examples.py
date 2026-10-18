import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from framework.runtime import Workspace


def run():
    project = Path(__file__).resolve().parents[1]
    parsed = {}
    for directory in [project / "schemas", project / "templates"]:
        for path in sorted(directory.glob("*.json")):
            parsed[path.relative_to(project).as_posix()] = json.loads(
                path.read_text(encoding="utf-8-sig")
            )
    assert len(parsed) == 4
    assert parsed["schemas/message.schema.json"]["$schema"].endswith("2020-12/schema")
    assert parsed["schemas/task-board.schema.json"]["$schema"].endswith("2020-12/schema")

    run_root = project / "tests" / ("example-verification-" + uuid4().hex)
    run_root.mkdir()
    sample_root = run_root / "assignment"
    sample = Workspace(sample_root)
    sample.initialize()
    sample.add_task("SAMPLE-A", "A", "Simulated UI", "The example can be assigned")
    assignment = subprocess.run(
        [sys.executable, "-m", "framework", "--root", str(sample_root), "send",
         "--file", str(project / "templates/message.assign.example.json")],
        cwd=project, capture_output=True, check=True,
    )
    assert json.loads(assignment.stdout)["status"] == "assigned"

    example = parsed["templates/end-to-end.example.json"]
    replay_root = run_root / "replay"
    workspace = Workspace(replay_root)
    workspace.initialize()
    prerequisite = example["prerequisite_task"]
    workspace.add_task(
        prerequisite["id"], prerequisite["owner"], prerequisite["title"],
        prerequisite["acceptance"],
    )
    artifact = replay_root / "outputs/A/example.txt"
    artifact.parent.mkdir(parents=True)
    artifact.write_text("Initial simulated artifact", encoding="utf-8")
    delivery_number = 0
    for message in example["messages"]:
        if message["type"] == "deliver":
            delivery_number += 1
            artifact.write_text("Simulated delivery " + str(delivery_number), encoding="utf-8")
        workspace.send(message)
    assert workspace.read()["tasks"][prerequisite["id"]]["status"] == "done"
    validation = workspace.validate()
    print(json.dumps({
        "parsed_json_files": sorted(parsed),
        "schema_validation": "JSON parsed and manually compared; jsonschema is unavailable",
        "assignment_cli": "passed",
        "template_replay": validation,
        "evidence_root": str(run_root),
    }, indent=2))


if __name__ == "__main__":
    run()
