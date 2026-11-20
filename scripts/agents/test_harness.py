"""Tests for harness.py (provision, fetch, verify). Real git, temporary repos only."""
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness as H  # noqa: E402

TOPIC = "demo"
CODE = "agent/antigravity/demo"
LANE = "agent/antigravity/demo-lane"
BRIEF_NAME = "2026-11-19-antigravity-demo.md"


def write(path, text, newline=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline=newline) as fh:
        fh.write(text)


def sh(cwd, *args, check=True):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise AssertionError("git %s: %s" % (" ".join(args), r.stderr))
    return r.stdout


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="fplh-")
        sh(self.root, "init", "-q", "-b", "main")
        sh(self.root, "config", "user.email", "main@localhost")
        sh(self.root, "config", "user.name", "main")
        write(os.path.join(self.root, "app", "page.tsx"), "export default 1\n")
        write(os.path.join(self.root, "docs", "wiki", "log.md"), "# log\n")
        write(os.path.join(self.root, "AGENTS.md"), "rules\n")
        write(os.path.join(self.root, ".gitignore"), "plans-private/\n.worktrees/\n")
        sh(self.root, "add", "-A")
        sh(self.root, "commit", "-q", "-m", "init")
        self.page_sha = sha("export default 1\n")
        self.brief = os.path.join(self.root, "plans-private", "agents", "briefs", BRIEF_NAME)
        write(self.brief, (
            "# Brief\n\n## Goal\nAdd a button.\n\n## Inputs\n| `app/page.tsx` | `%s` |\n\n"
            "## May touch\n`app/new/` and `components/button.tsx`.\n\n"
            "## Must not touch\n`supabase/`, `.env.local`.\n" % self.page_sha))
        self.clone = Path(self.root) / ".worktrees" / "antigravity-clone-demo"
        self.out = []

    def say(self, line):
        self.out.append(line)

    def provision(self, hashed=("app/new",)):
        return H.provision(self.root, self.brief, hashed_folders=hashed, out=self.say)

    def agent(self, code_files, hashes=None, lane_files=None, code_trailers=True, lane_trailers=True,
              handoff_status="STATUS: DONE", gitattributes=True):
        """Do what the agent does in its clone: commit code on the code branch, handoff on the lane branch."""
        c = str(self.clone)
        trailer = "\n\nAgent: antigravity\nModel: gemini-test"
        for rel, text in code_files.items():
            write(os.path.join(c, rel), text)
        sh(c, "add", "-A")
        sh(c, "commit", "-q", "-m", "code" + (trailer if code_trailers else ""))
        sh(c, "switch", "-q", LANE)
        hashes = hashes if hashes is not None else {r: sha(t) for r, t in code_files.items()}
        lines = ["---", "author: antigravity", "model: gemini-test", "status: draft", "---", handoff_status, "",
                 "## Inputs checked", "- `app/page.tsx`: %s (matches the brief)" % self.page_sha, "",
                 "## Done"] + ["- `%s`: %s" % (r, h) for r, h in hashes.items()]
        write(os.path.join(c, H.LANE_ROOT, TOPIC, "HANDOFF-demo.md"), "\n".join(lines) + "\n")
        for rel, text in (lane_files or {}).items():
            write(os.path.join(c, rel), text)
        sh(c, "add", "-f", "-A")
        sh(c, "commit", "-q", "-m", "lane" + (trailer if lane_trailers else ""))
        sh(c, "switch", "-q", CODE)

    def fetch_and_verify(self):
        code = H.fetch(self.root, TOPIC, out=self.say)
        self.assertEqual(code, 0, "\n".join(self.out))
        return H.verify(self.root, TOPIC)[0]

    def has(self, results, level, needle):
        return any(l == level and needle in "%s %s" % (c, d) for l, c, d in results)


class Parse(unittest.TestCase):
    def test_parse_brief(self):
        text = ("## Inputs\n| `app/page.tsx` | `%s` |\n- `lib/x.ts`: `%s`\n\n## May touch\n`app/new/`, `lib/y.ts`\n\n"
                "## Must not touch\n`supabase/`, anything outside `app/new/`\n" % ("a" * 64, "b" * 64))
        b = H.parse_brief(text, "C:/nowhere")
        self.assertEqual(b["may_touch"], ["app/new/", "lib/y.ts"])
        self.assertEqual(b["must_not_touch"], ["supabase/"])
        self.assertEqual(b["dropped_must_not_touch"], ["app/new/"])
        self.assertEqual(b["inputs"], [("app/page.tsx", "a" * 64), ("lib/x.ts", "b" * 64)])

    def test_status_and_topics(self):
        self.assertEqual(H.parse_status("---\na: b\n---\n\nSTATUS: BLOCKED\n"), "BLOCKED")
        self.assertIsNone(H.parse_status("# Title\nSTATUS: DONE\n"))
        for bad in ("a/b", "x-lane", "x-feedback", "..", ""):
            with self.assertRaises(H.SetupError):
                H.check_topic(bad)

    def test_git_refused_under_worktrees(self):
        with self.assertRaises(H.GitError):
            H.git(os.path.join(tempfile.gettempdir(), ".worktrees", "antigravity-clone-x"), "status")


class Provision(Base):
    def test_dry_run_writes_nothing(self):
        self.assertEqual(H.provision(self.root, self.brief, dry_run=True, out=self.say), 0)
        self.assertFalse(self.clone.exists())
        self.assertTrue(any("DRY RUN" in x for x in self.out))

    def test_creates_clone_without_remote_with_both_branches(self):
        self.assertEqual(self.provision(), 0)
        self.assertTrue((self.clone / "app" / "page.tsx").is_file())
        self.assertEqual(sh(self.clone, "remote").strip(), "")
        self.assertEqual(sh(self.clone, "branch", "--show-current").strip(), CODE)
        self.assertIn(LANE, sh(self.clone, "branch", "--list"))
        self.assertEqual(sh(self.clone, "config", "user.email").strip(), "antigravity-agent@localhost")
        self.assertEqual((self.clone / "app" / "new" / ".gitattributes").read_text(), "* -text\n")
        self.assertTrue(any("PASS  clone config" in x for x in self.out))
        self.assertFalse(any(x.startswith("FAIL") for x in self.out))

    def test_clone_checkout_is_not_crlf_converted(self):
        # a global core.autocrlf=true would otherwise check the clone out with CRLF and change every
        # frozen input's hash against the brief's
        gc = os.path.join(self.root, "..", "fplh-global-%d.cfg" % os.getpid())
        with open(gc, "w", encoding="utf-8", newline="") as fh:
            fh.write("[core]\n\tautocrlf = true\n")
        self.addCleanup(os.remove, gc)
        env = {"GIT_CONFIG_GLOBAL": gc}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            self.assertEqual(self.provision(), 0)
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.assertNotIn(b"\r", (self.clone / "app" / "page.tsx").read_bytes())
        self.assertEqual(sh(self.clone, "config", "--local", "core.autocrlf").strip(), "false")

    def test_refuses_second_run_and_bad_hashed_folder(self):
        self.provision()
        with self.assertRaises(H.SetupError):
            self.provision()

    def test_refuses_hashed_folder_outside_may_touch(self):
        with self.assertRaises(H.SetupError):
            self.provision(hashed=("supabase",))
        self.assertFalse(self.clone.exists())

    def test_warns_when_main_is_dirty(self):
        write(os.path.join(self.root, "AGENTS.md"), "changed\n")
        self.provision()
        self.assertTrue(any(x.startswith("WARN") and "uncommitted" in x for x in self.out))


class Flow(Base):
    def setUp(self):
        super().setUp()
        self.provision()

    def test_clean_run_passes(self):
        self.agent({"app/new/x.ts": "export const x = 1\n", "app/new/.gitattributes": "* -text\n"})
        res = self.fetch_and_verify()
        self.assertFalse(any(l == H.FAIL for l, _, _ in res), res)
        self.assertTrue(self.has(res, H.PASS, "MATCH"))
        self.assertTrue(self.has(res, H.PASS, "lane branch"))
        self.assertTrue(self.has(res, H.PASS, "input hash"))

    def test_outside_may_touch_fails(self):
        self.agent({"components/other.tsx": "x\n"})
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "outside May touch: components/other.tsx"))

    def test_forbidden_and_single_writer_fail(self):
        self.agent({"supabase/migrations/1.sql": "select 1;\n", "AGENTS.md": "edited\n"})
        res = self.fetch_and_verify()
        self.assertTrue(self.has(res, H.FAIL, "forbidden folder: supabase/migrations/1.sql"))
        self.assertTrue(self.has(res, H.FAIL, "single-writer file: AGENTS.md"))
        self.assertTrue(self.has(res, H.FAIL, "in Must not touch"))

    def test_missing_trailer_fails(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"}, code_trailers=False)
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "no Agent: trailer"))

    def test_hash_mismatch_fails(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"},
                   hashes={"app/new/x.ts": "0" * 64})
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "MISMATCH"))

    def test_posted_hash_without_text_off_fails(self):
        # provisioned with a hashed folder, but the agent leaves the .gitattributes out of its commit
        os.remove(os.path.join(str(self.clone), "app", "new", ".gitattributes"))
        self.agent({"app/new/x.ts": "a\n"})
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "no `* -text`"))

    def test_code_on_lane_branch_fails(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"},
                   lane_files={"app/new/sneaky.ts": "b\n"})
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "outside agent-lanes/antigravity/demo/"))

    def test_lane_file_on_code_branch_fails(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n",
                    "agent-lanes/antigravity/demo/notes.md": "n\n"})
        self.assertTrue(self.has(self.fetch_and_verify(), H.FAIL, "lane file on the code branch"))

    def test_missing_lane_branch_fails_handoff(self):
        c = str(self.clone)
        write(os.path.join(c, "app", "new", "x.ts"), "a\n")
        sh(c, "add", "-A")
        sh(c, "commit", "-q", "-m", "code\n\nAgent: antigravity\nModel: m")
        sh(c, "branch", "-D", LANE)
        self.assertEqual(H.fetch(self.root, TOPIC, out=self.say), 0)
        self.assertTrue(self.has(H.verify(self.root, TOPIC)[0], H.FAIL, "lane branch"))

    def test_blocked_status_is_read(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"}, handoff_status="STATUS: BLOCKED")
        self.assertTrue(self.has(self.fetch_and_verify(), H.PASS, "STATUS: BLOCKED"))

    def test_bom_and_crlf_warn(self):
        self.agent({"app/new/x.ts": "\ufeffa\r\nb\r\n", "app/new/.gitattributes": "* -text\n"})
        res = self.fetch_and_verify()
        self.assertTrue(self.has(res, H.WARN, "UTF-8 BOM"))
        self.assertTrue(self.has(res, H.WARN, "CRLF"))

    def test_fetch_refused_when_clone_has_remote(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"})
        sh(self.clone, "remote", "add", "origin", "https://example.invalid/x.git")
        self.assertEqual(H.fetch(self.root, TOPIC, out=self.say), 3)
        self.assertIn("REFUSED", "\n".join(self.out))
        self.assertEqual(sh(self.root, "branch", "--list", CODE).strip(), "")

    def test_fetch_refused_when_clone_has_active_hook(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"})
        write(str(self.clone / ".git" / "hooks" / "pre-commit"), "#!/bin/sh\nexit 0\n")
        self.assertEqual(H.fetch(self.root, TOPIC, out=self.say), 3)

    def test_fetch_never_forces(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"})
        self.assertEqual(H.fetch(self.root, TOPIC, out=self.say), 0)
        tip = sh(self.root, "rev-parse", CODE).strip()
        sh(self.clone, "commit", "-q", "--amend", "-m", "rewritten\n\nAgent: antigravity\nModel: m")
        self.assertEqual(H.fetch(self.root, TOPIC, out=self.say), 3)
        self.assertEqual(sh(self.root, "rev-parse", CODE).strip(), tip)

    def test_cli_exit_codes(self):
        self.assertEqual(H.main(["--root", self.root, "verify", "nope"]), 2)
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"})
        self.assertEqual(H.main(["--root", self.root, "fetch", TOPIC]), 0)
        self.assertEqual(H.main(["--root", self.root, "verify", TOPIC, "--json"]), 0)

    def test_nothing_written_into_main_tree_by_verify(self):
        self.agent({"app/new/x.ts": "a\n", "app/new/.gitattributes": "* -text\n"})
        H.fetch(self.root, TOPIC, out=self.say)
        before = sh(self.root, "status", "--porcelain")
        H.verify(self.root, TOPIC)
        self.assertEqual(sh(self.root, "status", "--porcelain"), before)


if __name__ == "__main__":
    unittest.main()
