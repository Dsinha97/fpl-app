"""Read-only status of agent work for the main Claude session. Standard library only.

Adapted from the collusion-sprint project for a public repo whose agent files are local only (gitignored).
It lists what is waiting for the main session:
  - handoffs whose first status line is NEEDS-DECISION or BLOCKED, in plans-private/agents/ (main tree) and in
    each clone or worktree under .worktrees/ at agent-lanes/ (read as files; git is never run inside a clone);
  - agent branches ahead of main whose patches are not yet on main, and not listed in
    plans-private/agents/kept-branches.txt.
It writes nothing. With --hook it prints one SessionStart JSON object, and nothing when nothing is waiting.

Usage: python scripts/agents/agent_status.py [--hook] [--root PATH]
"""
import argparse
import json
import os
import re
import subprocess
import sys

STATUS_RE = re.compile(r"^STATUS:\s*(DONE|NEEDS-DECISION|BLOCKED)\s*$")
WAITING = ("NEEDS-DECISION", "BLOCKED")
LANE_DIR = os.path.join("plans-private", "agents")
CLONE_LANE_DIR = "agent-lanes"
KEPT_FILE = os.path.join(LANE_DIR, "kept-branches.txt")
SKIP_DIRS = ("briefs", "runs", "__pycache__", "node_modules", ".git")


def git(root, *args):
    """Run git in root and return stdout text; return '' on any failure."""
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout if r.returncode == 0 else ""


def parse_status(path):
    """Return the status word of a handoff file, or None. The frontmatter is skipped."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().replace("\r\n", "\n").split("\n")
    except OSError:
        return None
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1
    for line in lines[i:]:
        if line.strip() == "":
            continue
        m = STATUS_RE.match(line.strip())
        return m.group(1) if m else None
    return None


def kept_branches(root):
    """Branch names listed in plans-private/agents/kept-branches.txt (comments with #)."""
    try:
        with open(os.path.join(root, KEPT_FILE), encoding="utf-8") as fh:
            return {ln.split("#", 1)[0].strip() for ln in fh if ln.split("#", 1)[0].strip()}
    except OSError:
        return set()


def handoff_files(top):
    """HANDOFF*.md files under top (any depth, not in briefs, runs or dependency folders)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith("HANDOFF") and fn.endswith(".md"):
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


def clones(root):
    """Folders directly under <root>/.worktrees (clones and linked worktrees), skipping logs."""
    base = os.path.join(root, ".worktrees")
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return []
    return [os.path.join(base, n) for n in names if n != "logs" and os.path.isdir(os.path.join(base, n))]


def applied(root, ref):
    """True when every commit the branch has beyond main has an equivalent patch on main."""
    out = git(root, "cherry", "main", ref)
    return not any(line.startswith("+") for line in out.splitlines())


def collect(root):
    data = {"waiting": [], "ahead": []}
    for path in handoff_files(os.path.join(root, LANE_DIR)):
        st = parse_status(path)
        if st in WAITING:
            data["waiting"].append((os.path.relpath(path, root).replace("\\", "/"), st))
    for clone in clones(root):
        for path in handoff_files(os.path.join(clone, CLONE_LANE_DIR)):
            st = parse_status(path)
            if st in WAITING:
                rel = os.path.relpath(path, root).replace("\\", "/")
                data["waiting"].append((rel, st))
    kept = kept_branches(root)
    for ref in git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/agent/").split("\n"):
        ref = ref.strip()
        if not ref or ref in kept:
            continue
        n = git(root, "rev-list", "--count", "main.." + ref).strip()
        if n.isdigit() and int(n) > 0 and not applied(root, ref):
            data["ahead"].append((ref, int(n)))
    return data


def render(data):
    """Short text lines for what is waiting; an empty list when nothing is."""
    lines = []
    for rel, st in data["waiting"]:
        lines.append(f"agents: handoff {st}: {rel}")
    for ref, n in data["ahead"]:
        lines.append(f"agents: branch {ref} is {n} commit(s) ahead of main and not merged")
    return lines[:8] + ([f"agents: ... and {len(lines) - 8} more"] if len(lines) > 8 else [])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--hook", action="store_true")
    ap.add_argument("--root", default=None)
    a = ap.parse_args(argv)
    root = a.root or git(os.path.dirname(os.path.abspath(__file__)), "rev-parse", "--show-toplevel").strip()
    if not root:
        return 0
    lines = render(collect(root))
    if a.hook:
        if lines:
            text = "Agent work waiting for the main session:\n" + "\n".join(lines)
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}))
    else:
        print("\n".join(lines) if lines else "No agent items waiting.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # a status helper must never break a session
        if "--hook" not in sys.argv:
            print(f"agent_status: {exc}", file=sys.stderr)
        sys.exit(0)
