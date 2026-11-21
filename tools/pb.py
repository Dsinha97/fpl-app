"""project-brain: agent-neutral installer and session runner. Standard library only.

    python pb.py init   [--target DIR] [--name N] [--unit WORD] [--modules wiki,agents,decisions,selfimprove,council,gates]
                        [--agents hermes,antigravity] [--adapters claude,gemini,cursor,copilot] [--append-agents-md]
                        [--analysis-models claude] [--dry-run] [--yes]
    python pb.py audit  [--target DIR ...] [--scan-root DIR] [--deep] [--no-fetch] [--json]   read-only gap report per project
    python pb.py doctor [--target DIR]        read-only check that a project has what its modules need
    python pb.py start  [--hook]              session start: waiting handoffs, decision inbox, due revisits
    python pb.py end    [--hook]              session end: auto-commit an ingested wiki, scan the log

Rules: init never overwrites a file (existing files are skipped and listed), never deletes, never pushes.
`init --dry-run` prints the plan and writes nothing. Without --yes, init shows the plan and asks.
`start` and `end` work from the project's own tools/ folder, so any agent can run them without hooks.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
MODULES = ("wiki", "agents", "decisions", "selfimprove", "council", "gates")
DEFAULT_MODULES = ("wiki", "agents", "decisions", "selfimprove")  # council and gates are optional: council sends text to outside vendors; gates blocks commands until the user approves
ADAPTERS = ("claude", "gemini", "cursor", "copilot")
TOOLS_BY_MODULE = {
    "wiki": ["lint_wiki.py"],
    "agents": ["agent_status.py"],
    "decisions": ["decisions.py"],
    "selfimprove": ["auto_commit_ingest.sh"],
    "council": ["council.py"],
    "gates": ["gate.py"],
}
GITIGNORE_MARK = "# project-brain"
GITIGNORE_BLOCK = (
    f"{GITIGNORE_MARK}\n"
    "plans/Decisions/private/\n"
    ".worktrees/\n"
    ".council/\n"
    ".pb/\n"
    "__pycache__/\n"
)
# Agent names that get a gitignore-free lane folder README. Any name is allowed.
LANE_README = """# {name} lane

Everything this agent writes goes here (and in the folders a brief assigns). Rules: [AGENTS.md](../../../AGENTS.md).
Return work as `HANDOFF-<topic>.md` (first line `STATUS: DONE | NEEDS-DECISION | BLOCKED`). Never edit another lane.
"""


def csv(s):
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def subst(text, v):
    for k, val in v.items():
        text = text.replace("{{%s}}" % k, val)
    return text


def read_tmpl(path):
    return Path(path).read_text(encoding="utf-8")


def walk_tmpl(root):
    """Yield (relative dest path, source path) for every file under a template folder."""
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if p.is_file():
            yield p.relative_to(root).as_posix(), p


def agents_sections(v, modules):
    """AGENTS.md sections in order: [(name, text)], each opened by a marker comment so a later audit
    or append can tell which module's rules are already present."""
    order = {"wiki": "10-wiki.md", "agents": "20-agents.md", "decisions": "30-decisions.md", "selfimprove": "40-selfimprove.md", "council": "50-council.md", "gates": "60-gates.md"}
    secs = [("base", read_tmpl(TEMPLATES / "AGENTS.d" / "00-base.md"))]
    for m in MODULES:
        if m in modules:
            secs.append((m, read_tmpl(TEMPLATES / "AGENTS.d" / order[m])))
    return [(n, "<!-- project-brain:%s -->\n%s" % (n, subst(t, v))) for n, t in secs]


def build_plan(target, v, modules, agents, adapters, append_agents_md=False):
    """Return a list of actions: (kind, dest_rel, payload). kinds: write, copy, append, agents_append, mkdir."""
    plan = []
    secs = agents_sections(v, modules)
    existing_md = target / "AGENTS.md"
    if append_agents_md and existing_md.exists():
        have = existing_md.read_text(encoding="utf-8")
        missing = [t for n, t in secs if n != "base" and "<!-- project-brain:%s -->" % n not in have]
        if missing:
            plan.append(("agents_append", "AGENTS.md", "".join(missing)))
    else:
        plan.append(("write", "AGENTS.md", "".join(t for _, t in secs)))
    plan.append(("write", "log.md", "# Log\n\nOne line per action, newest last. Only the main session writes this file.\n\n"
                 f"{v['TODAY']} [main] project-brain installed (modules: {', '.join(modules)}).\n"))
    for m in modules:
        for rel, src in walk_tmpl(TEMPLATES / m):
            plan.append(("write", rel, subst(read_tmpl(src), v)))
        for t in TOOLS_BY_MODULE.get(m, []):
            plan.append(("copy", f"tools/{t}", HERE / "tools" / t))
    plan.append(("copy", "tools/pb.py", HERE / "pb.py"))
    if "agents" in modules:
        rows = ["| Agent | Role | Writes | Report rights |", "|---|---|---|---|",
                "| Main session | Orchestrator: roadmap, briefs, shared files, merges, promotion | everything, per lane rules | yes |"]
        for a in agents:
            rows.append(f"| {a} | (set role) | `plans/agents/{a}/`, folders a brief assigns | per `model` (see below) |")
            plan.append(("write", f"plans/agents/{a}/README.md", LANE_README.format(name=a)))
        roles = (f"---\ntitle: \"Agent roles and rotation\"\nstatus: draft\nupdated: {v['TODAY']}\n---\n\n"
                 "> Who does what. Rules: [AGENTS.md](../../AGENTS.md). The main session updates this file when roles change.\n\n"
                 "## Roles\n\n" + "\n".join(rows) + "\n\n"
                 f"## Report rights\n\nModels on this list may write analysis, drafts and reports in their lane: {v['ANALYSIS_MODELS']}. "
                 "Any other model writes only code, raw outputs, logs and the status handoff.\n\n"
                 f"## Current and future {v['UNIT']}s\n\n(State which {v['UNIT']} is current and which agents are on it. A rotation date here overrides defaults.)\n")
        plan.append(("write", "plans/agents/ROLES.md", roles))
    for a in adapters:
        for rel, src in walk_tmpl(TEMPLATES / "adapters" / a):
            plan.append(("write", rel, subst(read_tmpl(src), v)))
    plan.append(("append", ".gitignore", GITIGNORE_BLOCK))
    if "decisions" in modules:
        for d in ("entries", "staging", "private"):
            plan.append(("mkdir", f"plans/Decisions/{d}", None))
    return plan


def apply_plan(target, plan, dry):
    created, skipped, appended = [], [], []
    for kind, rel, payload in plan:
        dest = target / rel
        if kind == "mkdir":
            if not dry:
                dest.mkdir(parents=True, exist_ok=True)
                (dest / ".gitkeep").touch()
            created.append(rel + "/")
            continue
        if kind == "append":
            existing = dest.read_text(encoding="utf-8") if dest.exists() else ""
            if GITIGNORE_MARK in existing:
                have = {l.strip() for l in existing.splitlines()}
                missing = [l for l in payload.splitlines()[1:] if l.strip() and l.strip() not in have]
                if not missing:
                    skipped.append(rel + " (block already present)")
                    continue
                # an older install: add only the lines its block lacks (for example .council/)
                if not dry:
                    sep = "" if existing.endswith("\n") else "\n"
                    dest.write_text(existing + sep + "\n".join(missing) + "\n", encoding="utf-8", newline="\n")
                appended.append(rel + " (missing lines: " + ", ".join(missing) + ")")
                continue
            if not dry:
                sep = "" if not existing or existing.endswith("\n") else "\n"
                dest.write_text(existing + sep + ("\n" if existing else "") + payload, encoding="utf-8", newline="\n")
            appended.append(rel)
            continue
        if kind == "agents_append":
            if not dry:
                cur = dest.read_text(encoding="utf-8")
                sep = "" if cur.endswith("\n") else "\n"
                dest.write_text(cur + sep + "\n" + payload, encoding="utf-8", newline="\n")
            appended.append(rel + " (missing module sections)")
            continue
        if dest.exists():
            skipped.append(rel)
            continue
        if not dry:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if kind == "copy":
                shutil.copyfile(payload, dest)
                if dest.suffix == ".sh":
                    dest.chmod(0o755)
            else:
                dest.write_text(payload, encoding="utf-8", newline="\n")
        created.append(rel)
    return created, skipped, appended


def run_py(root, script, *args):
    """Run a project tool with the current interpreter. Return stdout text ('' on failure)."""
    path = Path(root) / "tools" / script
    if not path.exists():
        return ""
    env = dict(os.environ, PYTHONUTF8="1")
    try:
        r = subprocess.run([sys.executable, "-B", str(path), *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=45, cwd=root, env=env)
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout.strip()


def project_root():
    here = Path.cwd()
    for p in [here, *here.parents]:
        if (p / "tools" / "pb.py").exists() or (p / "AGENTS.md").exists():
            return p
    return here


def hook_texts(outputs):
    """Reduce tool outputs to plain text lines. Tools in --hook mode print JSON; unwrap it."""
    lines = []
    for out in outputs:
        out = out.strip()
        if not out:
            continue
        for chunk in out.splitlines():
            chunk = chunk.strip()
            if chunk.startswith("{"):
                try:
                    obj = json.loads(chunk)
                except ValueError:
                    lines.append(chunk)
                    continue
                txt = obj.get("systemMessage") or (obj.get("hookSpecificOutput") or {}).get("additionalContext")
                if txt:
                    lines.append(txt)
            elif chunk:
                lines.append(chunk)
    return lines


def cmd_start(args):
    root = project_root()
    outs = [run_py(root, "decisions.py", "digest"), run_py(root, "agent_status.py")]
    lines = [l for l in hook_texts(outs) if l]
    if args.hook:
        if lines:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "\n".join(lines)}}))
    else:
        print("\n".join(lines) if lines else "project-brain: nothing waiting.")
    return 0


def cmd_end(args):
    root = project_root()
    outs = []
    sh = root / "tools" / "auto_commit_ingest.sh"
    if sh.exists() and shutil.which("bash"):
        try:
            r = subprocess.run(["bash", str(sh)], capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=45, cwd=root)
            outs.append(r.stdout)
        except (OSError, subprocess.SubprocessError):
            pass
    outs.append(run_py(root, "decisions.py", "scan", "--hook"))
    lines = hook_texts(outs)
    if args.hook:
        if lines:
            print(json.dumps({"systemMessage": " | ".join(lines)}))
    else:
        print("\n".join(lines) if lines else "project-brain: nothing to commit or scan.")
    return 0


def kit_modules(root):
    """Modules this kit installed in root: its tool script is present, or AGENTS.md carries its marker.
    A folder that merely shares a name (a hand-made wiki/, plans/agents/) does not count."""
    root = Path(root)
    md = (root / "AGENTS.md").read_text(encoding="utf-8", errors="replace") if (root / "AGENTS.md").is_file() else ""
    return {m for m in MODULES
            if (root / "tools" / TOOLS_BY_MODULE[m][0]).exists() or "<!-- project-brain:%s -->" % m in md}


def cmd_doctor(args):
    target = Path(args.target or project_root()).resolve()
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + msg)
        ok = ok and cond

    check((target / "AGENTS.md").exists(), "AGENTS.md exists")
    check((target / "tools" / "pb.py").exists(), "tools/pb.py exists")
    has = lambda p: (target / p).exists()
    installed = kit_modules(target)
    print("modules installed by the kit: " + (", ".join(sorted(installed)) or "none"))
    if "wiki" in installed:
        check(has("sources") and has("wiki/index.md") and has("wiki/.manifest.json"), "wiki module: sources/, wiki/index.md, wiki/.manifest.json")
        check(has("tools/lint_wiki.py"), "wiki module: tools/lint_wiki.py")
    if "agents" in installed:
        check(has("plans/agents/ROLES.md") and has("plans/agents/TEMPLATE-brief.md") and has("plans/agents/TEMPLATE-handoff.md"), "agents module: ROLES.md and templates")
        check(has("tools/agent_status.py"), "agents module: tools/agent_status.py")
    if "council" in installed:
        check(has("plans/agents/council.json") and has("tools/council.py"), "council module: plans/agents/council.json and tools/council.py")
        gi_c = (target / ".gitignore").read_text(encoding="utf-8") if has(".gitignore") else ""
        check(".council/" in gi_c, "council module: .council/ is gitignored")
    if "gates" in installed:
        check(has("plans/gates.json") and has("tools/gate.py"), "gates module: plans/gates.json and tools/gate.py")
        gi_g = (target / ".gitignore").read_text(encoding="utf-8") if has(".gitignore") else ""
        check(".pb/" in gi_g, "gates module: .pb/ is gitignored")
    if "decisions" in installed:
        check(has("plans/Decisions/CONVENTIONS.md") and has("plans/Decisions/register.md") and has("plans/Decisions/.scan-cursor"), "decisions module: conventions, register, scan cursor")
        check(has("tools/decisions.py"), "decisions module: tools/decisions.py")
        gi = (target / ".gitignore").read_text(encoding="utf-8") if has(".gitignore") else ""
        check("plans/Decisions/private/" in gi, "decisions module: private/ is gitignored")
    print("doctor: " + ("all checks passed" if ok else "some checks failed"))
    return 0 if ok else 1


SECRET_NAMES = re.compile(r"(^|/)(\.env(\..+)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|credentials\.json)$")
NOTE_DIRS = ("docs", "notes", "knowledge", "research", "reading", "papers", "references")
HANDOFF_STATUS = re.compile(r"^STATUS:\s*(DONE|NEEDS-DECISION|BLOCKED)\s*$")


def _git(root, *a):
    try:
        r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def _plugin_enabled():
    """True if user settings list project-brain among enabled plugins (best effort; read-only)."""
    p = Path.home() / ".claude" / "settings.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return any("project-brain" in k and v for k, v in (data.get("enabledPlugins") or {}).items())


def audit_one(root, deep=False, fetch=True):
    root = Path(root).resolve()
    has = lambda p: (root / p).exists()
    rd = lambda p: (root / p).read_text(encoding="utf-8", errors="replace") if (root / p).is_file() else ""
    out = {"path": str(root), "git": has(".git"), "modules": {}, "findings": [], "manual": [], "recommend": None}
    agents_md = rd("AGENTS.md")
    gi = rd(".gitignore")

    def status(checks):
        got = [ok for _, ok in checks]
        return "complete" if all(got) else ("missing" if not any(got) else "partial"), [n for n, ok in checks if not ok]

    mods = {
        "wiki": [("sources/", has("sources")), ("wiki/index.md", has("wiki/index.md")),
                 ("wiki/.manifest.json", has("wiki/.manifest.json")), ("tools/lint_wiki.py", has("tools/lint_wiki.py"))],
        "agents": [("plans/agents/ROLES.md", has("plans/agents/ROLES.md")),
                   ("TEMPLATE-brief.md", has("plans/agents/TEMPLATE-brief.md")),
                   ("TEMPLATE-handoff.md", has("plans/agents/TEMPLATE-handoff.md")),
                   ("tools/agent_status.py", has("tools/agent_status.py"))],
        "decisions": [("plans/Decisions/CONVENTIONS.md", has("plans/Decisions/CONVENTIONS.md")),
                      ("register.md", has("plans/Decisions/register.md")),
                      (".scan-cursor", has("plans/Decisions/.scan-cursor")),
                      ("tools/decisions.py", has("tools/decisions.py"))],
        "selfimprove": [("log.md", has("log.md")), ("tools/pb.py", has("tools/pb.py")),
                        ("tools/auto_commit_ingest.sh", has("tools/auto_commit_ingest.sh"))],
        "council": [("plans/agents/council.json", has("plans/agents/council.json")),
                    ("tools/council.py", has("tools/council.py"))],
        "gates": [("plans/gates.json", has("plans/gates.json")), ("tools/gate.py", has("tools/gate.py"))],
    }
    kit = kit_modules(root)
    for m, checks in mods.items():
        st, missing = status(checks)
        if st == "partial" and m not in kit:
            st = "foreign"  # same-named files exist but the kit did not install them
        out["modules"][m] = {"status": st, "missing": missing}

    # rules files
    rules = {"AGENTS.md": bool(agents_md), "CLAUDE.md": has("CLAUDE.md"), "GEMINI.md": has("GEMINI.md")}
    out["rules_files"] = rules
    if not agents_md:
        out["findings"].append("No AGENTS.md: agents have no shared rule set.")
    else:
        marked = [m for m in MODULES if "<!-- project-brain:%s -->" % m in agents_md]
        out["agents_md_markers"] = marked
        n = len(agents_md.splitlines())
        if not marked:
            out["manual"].append(f"AGENTS.md exists ({n} lines) without project-brain sections: review overlap, then add the missing sections with `init --append-agents-md`.")
    if has("CLAUDE.md") and "AGENTS.md" not in rd("CLAUDE.md"):
        out["manual"].append("CLAUDE.md does not point to AGENTS.md: add a line so Claude reads the shared rules.")
    n_claude = len(rd("CLAUDE.md").splitlines())
    if n_claude > 200:
        out["findings"].append(f"CLAUDE.md is {n_claude} lines; move detail into AGENTS.md or the wiki (target under 200).")

    # existing notes that could become sources
    if not has("sources"):
        notes = [d for d in NOTE_DIRS if has(d) and (root / d).is_dir()]
        if notes:
            out["findings"].append("Existing note folders that could be ingested as sources: " + ", ".join(notes) + " (copy, never move, without a plan and a yes).")

    # handoffs without a STATUS line
    bad = []
    resolved = set()
    for l in rd("plans/agents/resolved-handoffs.txt").splitlines():
        l = l.split("#", 1)[0].strip()
        if l:
            resolved.add(l.replace("\\", "/"))
    for p in (root / "plans" / "agents").rglob("HANDOFF*.md") if has("plans/agents") else []:
        rel = p.relative_to(root).as_posix()
        if rel in resolved:
            continue  # already dispositioned by the user; its STATUS line is never edited
        lines = p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n").split("\n")
        i = 0
        if lines and lines[0].strip() == "---":  # skip the whole frontmatter block, whatever keys it holds
            i = 1
            while i < len(lines) and lines[i].strip() != "---":
                i += 1
            i += 1
        first = next((l.strip() for l in lines[i:] if l.strip()), "")
        if not HANDOFF_STATUS.match(first):
            bad.append(rel)
    if bad:
        out["findings"].append("Handoffs without a STATUS first line (a handoff is never edited; list it in plans/agents/resolved-handoffs.txt once dispositioned): " + ", ".join(bad[:5]))

    # hooks / gitignore / secrets
    wired = "pb.py" in rd(".claude/settings.json") or "auto_commit_ingest" in rd(".claude/settings.json")
    plug = _plugin_enabled()
    out["hooks"] = {"project_settings": wired, "plugin_enabled": plug}
    if out["modules"]["selfimprove"]["status"] != "missing" and not wired and not plug:
        out["manual"].append("No session hooks wired (neither .claude/settings.json nor the project-brain plugin enabled): non-Claude agents run `python tools/pb.py start` and `end` by hand.")
    # skills: they come from the plugin, not from init, so report whether this machine has the plugin
    local = [n for n in ("wiki", "second-brain") if has(f".claude/skills/{n}/SKILL.md")]
    out["skills"] = {"from_plugin": plug, "project_copies": local}
    if out["modules"]["wiki"]["status"] != "missing":
        if plug is False and not local:
            out["manual"].append("The wiki skills (`second-brain`, `wiki`) come from the project-brain plugin, which is not enabled here: Claude will not load them. Enable the plugin, or work from AGENTS.md by hand.")
        if local:
            out["manual"].append("Project copies of skills (" + ", ".join(local) + ") in .claude/skills/ can shadow or duplicate the plugin's: keep one copy.")
    if has("plans/Decisions") and "plans/Decisions/private/" not in gi:
        out["findings"].append("plans/Decisions/private/ is not in .gitignore: private decisions could be committed.")
    if out["git"]:
        tracked = _git(root, "ls-files") or ""
        secrets = [f for f in tracked.splitlines() if SECRET_NAMES.search(f) and not f.endswith((".example", ".sample"))]
        if secrets:
            out["findings"].append("Tracked files that look like secrets: " + ", ".join(secrets[:5]) + ". Do not touch them without the user; report only.")
        up = _git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        if up is None or not up.strip():
            out["findings"].append("No upstream branch: cannot tell whether a remote copy has newer work.")
        else:
            up = up.strip()
            fetched = True
            if fetch:
                try:
                    r = subprocess.run(["git", "-C", str(root), "fetch", "--quiet"], capture_output=True, text=True,
                                       timeout=40, env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
                    fetched = r.returncode == 0
                except (OSError, subprocess.SubprocessError):
                    fetched = False
            counts = (_git(root, "rev-list", "--left-right", "--count", "HEAD...@{u}") or "").split()
            if len(counts) == 2:
                ahead, behind = int(counts[0]), int(counts[1])
                out["remote"] = {"upstream": up, "ahead": ahead, "behind": behind, "fetched": fetched}
                if behind:
                    out["findings"].append(f"Behind {up} by {behind} commit(s): this audit describes a stale copy. Pull or rebase first, then re-run.")
                if ahead:
                    out["findings"].append(f"Ahead of {up} by {ahead} unpushed commit(s).")
            if not fetched:
                out["findings"].append("Could not fetch the remote (offline, or no access): ahead/behind may be out of date.")
        wt = _git(root, "status", "--porcelain")
        if wt and wt.strip():
            out["findings"].append("Working tree has uncommitted changes: commit or stash before installing so the install diff is readable.")
    else:
        out["findings"].append("Not a git repository: agent branches, worktrees and the auto-commit hook need one (`git init`).")

    if deep:
        deep_out = {}
        for script, args_ in (("lint_wiki.py", []), ("decisions.py", ["lint"])):
            txt = run_py(root, script, *args_)
            if txt:
                deep_out[script] = txt.splitlines()[:12]
        out["deep"] = deep_out

    foreign = [m for m, d in out["modules"].items() if d["status"] == "foreign"]
    if foreign:
        out["manual"].append("Existing structure that the kit did not install (" + ", ".join(foreign)
                             + "): review it before installing that module, to avoid a second copy or conflicting rules.")
    todo = [m for m, d in out["modules"].items() if d["status"] not in ("complete", "foreign")
            and not (m not in DEFAULT_MODULES and d["status"] == "missing")]  # optional modules are never recommended
    if todo:
        agents_lanes = sorted(p.name for p in (root / "plans" / "agents").iterdir()
                              if p.is_dir() and p.name not in ("briefs", "prompts")) if has("plans/agents") else []
        out["recommend"] = ("python <plugin>/core/pb.py init --target . --modules " + ",".join(todo)
                            + (" --agents " + ",".join(agents_lanes) if agents_lanes else "")
                            + (" --append-agents-md" if agents_md else "") + " --dry-run")
    return out


def find_projects(targets, scan_root):
    found = [Path(t).resolve() for t in targets]
    if scan_root:
        for d in sorted(Path(scan_root).resolve().iterdir()):
            if d.is_dir() and not d.name.startswith((".", "_")) and d.name not in ("node_modules", "venv", "env") \
                    and any((d / m).exists() for m in (".git", "AGENTS.md", "CLAUDE.md", "GEMINI.md")):
                found.append(d)
    return found or [Path.cwd()]


def cmd_audit(args):
    projects = [audit_one(p, args.deep, not args.no_fetch) for p in find_projects(args.target or [], args.scan_root)]
    if args.json:
        print(json.dumps(projects, indent=2))
        return 0
    for r in projects:
        print(f"== {r['path']}")
        print("   modules: " + " | ".join(f"{m}: {d['status']}" for m, d in r["modules"].items()))
        print("   rules files: " + ", ".join(f"{k} {'yes' if v else 'no'}" for k, v in r["rules_files"].items()))
        for m, d in r["modules"].items():
            if d["status"] == "partial":
                print(f"   - {m} partial, missing: {', '.join(d['missing'])}")
        for f in r["findings"]:
            print("   ! " + f)
        for f in r["manual"]:
            print("   > " + f)
        for script, lines in (r.get("deep") or {}).items():
            print(f"   deep {script}: " + " / ".join(lines[:4]))
        print("   recommend: " + (r["recommend"] or "nothing to install; setup is complete"))
    return 0


def cmd_init(args):
    target = Path(args.target or ".").resolve()
    modules = csv(args.modules) or list(DEFAULT_MODULES)
    bad = [m for m in modules if m not in MODULES]
    if bad:
        print("unknown module(s): " + ", ".join(bad) + f"  (choose from {', '.join(MODULES)})", file=sys.stderr)
        return 2
    adapters = csv(args.adapters) if args.adapters is not None else ["claude", "gemini"]
    badad = [a for a in adapters if a not in ADAPTERS]
    if badad:
        print("unknown adapter(s): " + ", ".join(badad) + f"  (choose from {', '.join(ADAPTERS)}; every agent also reads AGENTS.md)", file=sys.stderr)
        return 2
    agents = csv(args.agents)
    for a in agents:
        if not re.match(r"^[a-z0-9][a-z0-9_-]*$", a):
            print(f"agent name must be lowercase letters, digits, - or _: {a}", file=sys.stderr)
            return 2
    if agents and "agents" not in modules:
        modules.append("agents")
    if "selfimprove" in modules and "decisions" not in modules:
        print("note: selfimprove uses the decision scanner; adding the decisions module", file=sys.stderr)
        modules.append("decisions")
    v = {"PROJECT": args.name or target.name, "UNIT": args.unit, "TODAY": date.today().isoformat(),
         "ANALYSIS_MODELS": args.analysis_models}
    plan = build_plan(target, v, modules, agents, adapters, args.append_agents_md)
    created, skipped, appended = apply_plan(target, plan, dry=True)
    print(f"Target: {target}")
    print(f"Modules: {', '.join(modules)} | agent lanes: {', '.join(agents) or 'none'} | adapters: {', '.join(adapters) or 'none'}")
    print(f"Would create {len(created)} item(s):")
    for c in created:
        print("  + " + c)
    for a in appended:
        print("  ~ append marked block to " + a)
    for s in skipped:
        print("  = skip (exists) " + s)
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    if not args.yes:
        if not sys.stdin.isatty():
            print("Not writing: no --yes and no terminal to confirm. Re-run with --yes after reviewing the plan.")
            return 3
        if input("Write these files? Type yes: ").strip().lower() != "yes":
            print("Cancelled.")
            return 3
    created, skipped, appended = apply_plan(target, plan, dry=False)
    if "decisions" in modules and not (target / "plans/Decisions/.scan-cursor").exists():
        run_py(target, "decisions.py", "cursor", "--end")
    print(f"Done: {len(created)} created, {len(appended)} appended, {len(skipped)} skipped (already existed).")
    print("Next: run `python tools/lint_wiki.py` and `python tools/decisions.py lint`, then `git add` and commit (no push).")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="project-brain installer and session runner")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pi = sub.add_parser("init")
    pi.add_argument("--target")
    pi.add_argument("--name")
    pi.add_argument("--unit", default="workstream", help="word for one unit of work: sprint, milestone, workstream")
    pi.add_argument("--modules", help="comma list; default: " + ",".join(DEFAULT_MODULES) + "; optional: council, gates")
    pi.add_argument("--agents", help="lane agents, e.g. hermes,antigravity,codex")
    pi.add_argument("--adapters", help="comma list from: " + ",".join(ADAPTERS) + " (default claude,gemini)")
    pi.add_argument("--analysis-models", default="claude", help="model-name prefixes allowed to write analysis")
    pi.add_argument("--append-agents-md", action="store_true",
                    help="if AGENTS.md exists, append only the module sections it lacks (marked <!-- project-brain:NAME -->)")
    pi.add_argument("--dry-run", action="store_true")
    pi.add_argument("--yes", action="store_true")
    pa = sub.add_parser("audit")
    pa.add_argument("--target", action="append", help="project folder; repeat for several")
    pa.add_argument("--scan-root", help="audit every project folder directly under this one")
    pa.add_argument("--deep", action="store_true", help="also run the project's own lint scripts (read-only)")
    pa.add_argument("--no-fetch", action="store_true", help="skip `git fetch`; ahead/behind then uses the last fetched state")
    pa.add_argument("--json", action="store_true")
    pd = sub.add_parser("doctor")
    pd.add_argument("--target")
    for n in ("start", "end"):
        p = sub.add_parser(n)
        p.add_argument("--hook", action="store_true")
    args = ap.parse_args(argv)
    return {"init": cmd_init, "audit": cmd_audit, "doctor": cmd_doctor, "start": cmd_start, "end": cmd_end}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
