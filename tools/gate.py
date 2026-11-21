"""gate.py: approval gates and a checkpointed ingest. Standard library only. Part of the optional `gates` module.

Why: rules written in AGENTS.md ("never push", "never delete without a yes", "manifest last") are prose, and a
model can skip prose. This tool turns the two most important kinds of rule into code that runs outside the model.

    python tools/gate.py approve ACTION [--ttl MIN] [--uses N] [--note TEXT]   the USER runs this, in their own terminal
    python tools/gate.py revoke [ACTION]
    python tools/gate.py status
    python tools/gate.py check "COMMAND"        exit 1 if the command needs an approval that is not there (consumes one use)
    python tools/gate.py check --hook           Claude Code PreToolUse hook: reads the tool call as JSON on stdin
    python tools/gate.py require ACTION         exit 1 unless an approval exists (used by the git pre-push hook)
    python tools/gate.py install-git-hook       write .git/hooks/pre-push so `git push` needs a push approval, for any agent
    python tools/gate.py ingest start SOURCE... | step NAME [--note T] | status | finish [--no-lint]

Limits, stated plainly. This is a guard rail, not a security boundary. The hook matches command text, so a script, an
alias or an indirect call can get past it; an agent with shell access outside the hook is not stopped. The git pre-push
hook is the stronger layer for pushes. The hook fails open: if it cannot parse its input it allows the call. Approvals
live in a file, so the hook also refuses an agent's attempts to write that file or to run `approve` itself, but a human
at a terminal is the only party that is truly outside the model's reach.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

STEPS = ("hash", "triage", "screen", "plan", "write", "link", "index", "manifest", "log")
NOTE_REQUIRED = ("screen",)  # a step that must state what was found, even "none found"
PROTECTED = (".pb/approvals.json", "plans/gates.json", "tools/gate.py")
NEVER = "_never"  # action that no approval can satisfy

# Built-in rules cannot be removed by plans/gates.json: an agent must not approve itself.
BUILTIN_RULES = [
    {"action": NEVER, "pattern": r"gate\.py['\"]?\s+approve\b|\.pb[/\\]approvals",
     "message": "Approvals are created by the user in their own terminal, never by an agent."},
]
DEFAULT_RULES = [
    {"action": "push", "pattern": r"\bgit\s+(?:-C\s+\S+\s+)?push\b",
     "message": "git push needs the user's approval."},
    {"action": "delete", "pattern": r"(?:^|[;&|(]\s*|\s)(?:rm|rmdir|unlink|del|erase|Remove-Item)\s|\bgit\s+(?:rm|clean|worktree\s+remove)\b",
     "message": "Deleting files needs the user's approval."},
    {"action": "move", "pattern": r"(?:^|[;&|(]\s*|\s)(?:mv|move|ren|rename|Move-Item|Rename-Item)\s|\bgit\s+mv\b",
     "message": "Moving or renaming files needs the user's approval."},
    {"action": "discard", "pattern": r"\bgit\s+(?:reset\s+--hard|branch\s+-D\b|checkout\s+--\s|restore\s)", "case_sensitive": True,
     "message": "Discarding work needs the user's approval."},
]


def now():
    return datetime.now(timezone.utc)


def find_root(start=None):
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    here = Path(start or env or Path.cwd()).resolve()
    for p in [here, *here.parents]:
        if (p / "tools" / "gate.py").exists() or (p / "plans" / "gates.json").exists():
            return p
    return here


def load_rules(root):
    rules = []
    f = Path(root) / "plans" / "gates.json"
    try:
        rules = json.loads(f.read_text(encoding="utf-8")).get("rules", []) if f.exists() else DEFAULT_RULES
    except (OSError, ValueError):
        rules = DEFAULT_RULES
    return BUILTIN_RULES + [r for r in rules if r.get("action") != NEVER]


def matches(root, command):
    """Return [(action, message)] for every rule the command text matches."""
    hits = []
    for r in load_rules(root):
        try:
            if re.search(r["pattern"], command, 0 if r.get("case_sensitive") else re.I):
                hits.append((r["action"], r.get("message", "")))
        except (re.error, KeyError):
            continue
    return hits


def _approvals_path(root):
    return Path(root) / ".pb" / "approvals.json"


def load_approvals(root):
    try:
        data = json.loads(_approvals_path(root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    live = []
    for a in data if isinstance(data, list) else []:
        try:
            if a["uses"] > 0 and datetime.fromisoformat(a["expires"]) > now():
                live.append(a)
        except (KeyError, ValueError, TypeError):
            continue
    return live


def save_approvals(root, items):
    p = _approvals_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(items, indent=2), encoding="utf-8", newline="\n")


def decide(root, command, consume=True):
    """Return (allowed, reason). Consumes one use of each approval the command needs."""
    hits = matches(root, command)
    if not hits:
        return True, ""
    actions = []
    for a, msg in hits:
        if a not in [x for x, _ in actions]:
            actions.append((a, msg))
    never = [m for a, m in actions if a == NEVER]
    if never:
        return False, never[0]
    approvals = load_approvals(root)
    missing = [(a, m) for a, m in actions if not any(x["action"] == a for x in approvals)]
    if missing:
        names = ", ".join(a for a, _ in missing)
        msgs = " ".join(m for _, m in missing if m)
        return False, (f"{msgs} Blocked by gate.py: no live approval for: {names}. Stop and ask the user. "
                       f"The user approves by running `python tools/gate.py approve <action>` in their own terminal.").strip()
    if consume:
        for a, _ in actions:
            for x in approvals:
                if x["action"] == a:
                    x["uses"] -= 1
                    break
        save_approvals(root, [x for x in approvals if x["uses"] > 0])
    return True, ""


def hook_decision(root, payload):
    """payload: parsed PreToolUse JSON. Return a deny reason, or '' to allow."""
    tool = payload.get("tool_name", "")
    inp = payload.get("tool_input") or {}
    if tool in ("Bash", "PowerShell"):
        ok, reason = decide(root, inp.get("command", ""))
        return "" if ok else reason
    if tool in ("Write", "Edit", "NotebookEdit", "MultiEdit"):
        path = str(inp.get("file_path") or inp.get("notebook_path") or "").replace("\\", "/")
        try:
            rel = Path(path).resolve().relative_to(Path(root).resolve()).as_posix()
        except (ValueError, OSError):
            rel = path
        if any(rel == p or rel.endswith("/" + p) for p in PROTECTED):
            return f"{rel} is protected by gate.py; only the user changes it."
    return ""


# ---- ingest checkpoint -------------------------------------------------------------------------------------------

def _ingest_path(root):
    return Path(root) / ".pb" / "ingest.json"


def load_ingest(root):
    try:
        return json.loads(_ingest_path(root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_ingest(root, st):
    p = _ingest_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, indent=2), encoding="utf-8", newline="\n")


def sha_variants(path):
    raw = Path(path).read_bytes()
    return {hashlib.sha256(raw).hexdigest(), hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()}


def lint_ok(root):
    """Run tools/lint_wiki.py if present. Return (ok, summary). Blocks on dead links, missing frontmatter or
    sources sections, and links absent from related:. Orphans are reported but do not block."""
    lint = Path(root) / "tools" / "lint_wiki.py"
    if not lint.exists():
        return True, "lint_wiki.py not installed; lint skipped"
    r = subprocess.run([sys.executable, "-B", str(lint)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", cwd=root, env=dict(os.environ, PYTHONUTF8="1"), timeout=120)
    out = r.stdout
    bad = []
    m = re.search(r"dead links (\d+)", out)
    if m and m.group(1) != "0":
        bad.append("dead links " + m.group(1))
    for label in ("missing frontmatter", "no ## Sources"):
        m = re.search(re.escape(label) + r" (\[.*\])", out)
        if m and m.group(1) != "[]":
            bad.append(label)
    m = re.search(r"body links missing from related: (\d+)", out)
    if m and m.group(1) != "0":
        bad.append("links missing from related: " + m.group(1))
    return (not bad), ("; ".join(bad) if bad else "lint clean")


def cmd_ingest(args, root):
    st = load_ingest(root)
    if args.sub == "start":
        if st and not args.force:
            print(f"An ingest is already open ({', '.join(st['sources'])}), at step '{next_step(st)}'. "
                  "Finish it, or pass --force to abandon it.", file=sys.stderr)
            return 1
        missing = [s for s in args.sources if not (Path(root) / s).is_file()]
        if missing:
            print("No such source file: " + ", ".join(missing), file=sys.stderr)
            return 2
        save_ingest(root, {"started": now().isoformat(), "sources": args.sources, "done": {}, "notes": {}})
        print(f"Ingest open for {len(args.sources)} source(s). Next step: hash. Steps: {' > '.join(STEPS)}")
        return 0
    if st is None:
        print("No ingest is open. Run: gate.py ingest start <source...>", file=sys.stderr)
        return 1
    if args.sub == "status":
        for s in STEPS:
            print(("[x] " if s in st["done"] else "[ ] ") + s + (f"  ({st['notes'][s]})" if s in st["notes"] else ""))
        print("sources: " + ", ".join(st["sources"]))
        return 0
    if args.sub == "step":
        if args.name not in STEPS:
            print(f"Unknown step. Steps: {' > '.join(STEPS)}", file=sys.stderr)
            return 2
        idx = STEPS.index(args.name)
        undone = [s for s in STEPS[:idx] if s not in st["done"]]
        if undone:
            print(f"Cannot record '{args.name}': earlier step(s) not recorded: {', '.join(undone)}.", file=sys.stderr)
            return 1
        if args.name in NOTE_REQUIRED and not (args.note or "").strip():
            print(f"Step '{args.name}' needs --note stating what was found (write 'none found' if so).", file=sys.stderr)
            return 1
        st["done"][args.name] = now().isoformat()
        if args.note:
            st["notes"][args.name] = args.note
        save_ingest(root, st)
        nxt = next_step(st)
        print(f"Recorded {args.name}. " + (f"Next: {nxt}." if nxt else "All steps recorded. Run: gate.py ingest finish"))
        return 0
    if args.sub == "finish":
        undone = [s for s in STEPS if s not in st["done"]]
        if undone:
            print("Cannot finish: steps not recorded: " + ", ".join(undone), file=sys.stderr)
            return 1
        try:
            manifest = json.loads((Path(root) / "wiki" / ".manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            print("Cannot finish: wiki/.manifest.json is missing or not valid JSON.", file=sys.stderr)
            return 1
        problems = []
        for s in st["sources"]:
            ent = manifest.get(s)
            if not ent:
                problems.append(f"{s}: no manifest entry")
                continue
            if not (Path(root) / s).is_file():
                problems.append(f"{s}: file is gone")
                continue
            if str(ent.get("hash", "")).replace("sha256:", "") not in sha_variants(Path(root) / s):
                problems.append(f"{s}: manifest hash does not match the file")
        if problems:
            print("Cannot finish:\n  " + "\n  ".join(problems), file=sys.stderr)
            return 1
        if not args.no_lint:
            ok, summary = lint_ok(root)
            if not ok:
                print("Cannot finish: lint failed (" + summary + "). Fix the pages, then run finish again.", file=sys.stderr)
                return 1
        hist = Path(root) / ".pb" / "ingest-history.jsonl"
        with hist.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({**st, "finished": now().isoformat()}) + "\n")
        _ingest_path(root).unlink()
        print("Ingest finished: every step recorded, manifest hashes match, lint clean.")
        return 0
    return 2


def next_step(st):
    return next((s for s in STEPS if s not in st["done"]), "")


# ---- other commands ----------------------------------------------------------------------------------------------

def cmd_approve(args, root):
    known = {r["action"] for r in load_rules(root)} - {NEVER}
    if args.action not in known:
        print(f"Unknown action '{args.action}'. Actions in plans/gates.json: {', '.join(sorted(known))}", file=sys.stderr)
        return 2
    items = load_approvals(root)
    items.append({"action": args.action, "uses": args.uses, "note": args.note or "",
                  "created": now().isoformat(), "expires": (now() + timedelta(minutes=args.ttl)).isoformat()})
    save_approvals(root, items)
    print(f"Approved '{args.action}': {args.uses} use(s), {args.ttl} minute(s).")
    return 0


def cmd_status(args, root):
    items = load_approvals(root)
    if not items:
        print("No live approvals.")
    for a in items:
        print(f"{a['action']}: {a['uses']} use(s), expires {a['expires']}" + (f" ({a['note']})" if a["note"] else ""))
    st = load_ingest(root)
    if st:
        print(f"Ingest open: {', '.join(st['sources'])}; next step: {next_step(st) or 'finish'}")
    return 0


def cmd_check(args, root):
    if args.hook:
        try:
            payload = json.loads(sys.stdin.read() or "{}")
            reason = hook_decision(root, payload)
        except Exception:  # fail open: a broken guard must not wedge the session
            return 0
        if reason:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                      "permissionDecisionReason": reason}}))
        return 0
    ok, reason = decide(root, args.command or "")
    if not ok:
        print(reason, file=sys.stderr)
    return 0 if ok else 1


def cmd_require(args, root):
    items = load_approvals(root)
    hit = next((a for a in items if a["action"] == args.action), None)
    if not hit:
        print(f"gate.py: '{args.action}' needs the user's approval. In your own terminal: python tools/gate.py approve {args.action}",
              file=sys.stderr)
        return 1
    hit["uses"] -= 1
    save_approvals(root, [a for a in items if a["uses"] > 0])
    return 0


HOOK_SCRIPT = """#!/bin/sh
# project-brain gates: git push needs a live approval (python tools/gate.py approve push).
PY=python3; command -v "$PY" >/dev/null 2>&1 || PY=python
PYTHONUTF8=1 "$PY" tools/gate.py require push || exit 1
"""


def cmd_install_git_hook(args, root):
    hooks = Path(root) / ".git" / "hooks"
    if not hooks.is_dir():
        print("No .git/hooks folder: not a git repository (or a worktree; run this in the main checkout).", file=sys.stderr)
        return 1
    dest = hooks / "pre-push"
    if dest.exists():
        print(f"{dest} already exists; not overwriting it. Add this line to it yourself:\n  PYTHONUTF8=1 python tools/gate.py require push || exit 1")
        return 1
    dest.write_text(HOOK_SCRIPT, encoding="utf-8", newline="\n")
    try:
        dest.chmod(0o755)
    except OSError:
        pass
    print(f"Wrote {dest}. Every `git push` in this checkout now needs a push approval, whoever runs it.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="approval gates and checkpointed ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("approve")
    p.add_argument("action")
    p.add_argument("--ttl", type=int, default=10, help="minutes the approval lasts (default 10)")
    p.add_argument("--uses", type=int, default=1, help="how many commands it covers (default 1)")
    p.add_argument("--note")
    p = sub.add_parser("revoke")
    p.add_argument("action", nargs="?")
    sub.add_parser("status")
    p = sub.add_parser("check")
    p.add_argument("command", nargs="?")
    p.add_argument("--hook", action="store_true")
    p = sub.add_parser("require")
    p.add_argument("action")
    sub.add_parser("install-git-hook")
    pi = sub.add_parser("ingest")
    isub = pi.add_subparsers(dest="sub", required=True)
    s = isub.add_parser("start")
    s.add_argument("sources", nargs="+")
    s.add_argument("--force", action="store_true")
    s = isub.add_parser("step")
    s.add_argument("name")
    s.add_argument("--note")
    isub.add_parser("status")
    s = isub.add_parser("finish")
    s.add_argument("--no-lint", action="store_true")
    args = ap.parse_args(argv)
    root = find_root()
    if args.cmd == "revoke":
        keep = [a for a in load_approvals(root) if args.action and a["action"] != args.action]
        save_approvals(root, keep)
        print("Revoked " + (args.action or "all approvals") + ".")
        return 0
    fn = {"approve": cmd_approve, "status": cmd_status, "check": cmd_check, "require": cmd_require,
          "install-git-hook": cmd_install_git_hook, "ingest": cmd_ingest}[args.cmd]
    return fn(args, root)


if __name__ == "__main__":
    sys.exit(main())
