"""Tests for agent_status.py. Pure functions and temporary folders only."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent_status as A  # noqa: E402


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def sh(root, *args):
    subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True)


class StatusLine(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def test_status_after_frontmatter(self):
        p = os.path.join(self.d, "h.md")
        write(p, "---\nauthor: x\n---\n\nSTATUS: NEEDS-DECISION\n\n## Done\n")
        self.assertEqual(A.parse_status(p), "NEEDS-DECISION")

    def test_status_with_crlf(self):
        p = os.path.join(self.d, "h.md")
        write(p, "---\r\nauthor: x\r\n---\r\nSTATUS: DONE\r\n")
        self.assertEqual(A.parse_status(p), "DONE")

    def test_no_status_line(self):
        p = os.path.join(self.d, "h.md")
        write(p, "---\nauthor: x\n---\n\n# Title\nSTATUS: DONE later in the file\n")
        self.assertIsNone(A.parse_status(p))

    def test_bad_word_and_missing_file(self):
        p = os.path.join(self.d, "h.md")
        write(p, "STATUS: PENDING\n")
        self.assertIsNone(A.parse_status(p))
        self.assertIsNone(A.parse_status(os.path.join(self.d, "nope.md")))


class Collect(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        sh(self.root, "init", "-q", "-b", "main")
        sh(self.root, "config", "user.email", "t@localhost")
        sh(self.root, "config", "user.name", "t")
        write(os.path.join(self.root, "a.txt"), "a\n")
        sh(self.root, "add", "a.txt")
        sh(self.root, "commit", "-q", "-m", "init")

    def test_nothing_waiting(self):
        self.assertEqual(A.render(A.collect(self.root)), [])

    def test_waiting_handoff_in_main_lane_only_when_blocked(self):
        write(os.path.join(self.root, "plans-private", "agents", "antigravity", "HANDOFF-x.md"),
              "---\nauthor: a\n---\nSTATUS: BLOCKED\n")
        write(os.path.join(self.root, "plans-private", "agents", "antigravity", "HANDOFF-y.md"),
              "STATUS: DONE\n")
        lines = A.render(A.collect(self.root))
        self.assertEqual(len(lines), 1)
        self.assertIn("BLOCKED", lines[0])
        self.assertIn("HANDOFF-x.md", lines[0])

    def test_briefs_are_not_handoffs(self):
        write(os.path.join(self.root, "plans-private", "agents", "briefs", "HANDOFF-fake.md"),
              "STATUS: BLOCKED\n")
        self.assertEqual(A.render(A.collect(self.root)), [])

    def test_handoff_in_clone_lane(self):
        write(os.path.join(self.root, ".worktrees", "antigravity-clone-t", "agent-lanes",
                           "antigravity", "t", "HANDOFF-t.md"), "STATUS: NEEDS-DECISION\n")
        lines = A.render(A.collect(self.root))
        self.assertEqual(len(lines), 1)
        self.assertIn(".worktrees/antigravity-clone-t/agent-lanes", lines[0].replace("\\", "/"))

    def test_ahead_branch_reported_then_kept(self):
        sh(self.root, "switch", "-q", "-c", "agent/antigravity/topic")
        write(os.path.join(self.root, "b.txt"), "b\n")
        sh(self.root, "add", "b.txt")
        sh(self.root, "commit", "-q", "-m", "work")
        sh(self.root, "switch", "-q", "main")
        lines = A.render(A.collect(self.root))
        self.assertEqual(len(lines), 1)
        self.assertIn("agent/antigravity/topic", lines[0])
        write(os.path.join(self.root, "plans-private", "agents", "kept-branches.txt"),
              "agent/antigravity/topic   # kept\n")
        self.assertEqual(A.render(A.collect(self.root)), [])

    def test_hook_output_is_json(self):
        write(os.path.join(self.root, "plans-private", "agents", "HANDOFF-z.md"), "STATUS: BLOCKED\n")
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(A.__file__), "agent_status.py"),
                            "--hook", "--root", self.root], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)
        self.assertIn("BLOCKED", out["hookSpecificOutput"]["additionalContext"])


if __name__ == "__main__":
    unittest.main()
