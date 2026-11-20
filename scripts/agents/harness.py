"""Trimmed agent harness for FPL App (public repo; agent files are local only). Standard library only.

Adapted from the collusion-sprint project's tools/harness.py, cut to the three commands that are safe to run
with no agent CLI: provision, fetch and verify. The headless `run`, `wait`, `report` and `adopt` commands are not
ported. One agent is supported: Antigravity (Gemini model), which works in a local clone.

Layout (see AGENTS.md and plans-private/agents/ROLES.md):
  brief         plans-private/agents/briefs/YYYY-MM-DD-antigravity-<topic>.md   (local, gitignored, read by path)
  clone         .worktrees/antigravity-clone-<topic>                            (no remote, local identity)
  code branch   agent/antigravity/<topic>          the code the brief allows; the main session may merge it
  lane branch   agent/antigravity/<topic>-lane     agent-lanes/antigravity/<topic>/ only: handoff and raw outputs;
                                                   never merged, never pushed (the repo is public)

Subcommands:
  provision <brief>  Creates the clone from the committed main, removes its remote, sets a local identity, creates
                     both branches. Warns if main has uncommitted changes (the clone cannot see them).
  fetch <topic>      The one git write besides provision. Reads the clone's .git/config and hooks as text, refuses
                     on a remote, include, alias, filter, hook path or active hook, then fetches the branches into the
                     main repo with no force. It never runs git inside the clone.
  verify <topic>     Read-only. STATUS line, lane rules for the code branch (May touch, Must not touch, forbidden
                     folders and single-writer files, no delete or rename), the lane branch holds only its own folder,
                     no merge commit, Agent and Model trailers, committed-blob sha256 against hashes posted in the
                     handoff, `* -text` where a hash is posted, BOM and CRLF, input hashes. Prints PASS, FAIL, WARN
                     and INFO lines. It writes nothing.

Git runs only with -C <main repo>; a path under .worktrees/ raises an error. The one exception is `provision`, which
sets up a clone it has just created, before any agent has touched it.

It never writes log.md, docs/wiki/ or plans-private/, never merges and never pushes.

Exit codes: 0 pass (WARN lines can show), 1 at least one FAIL, 2 set-up error, 3 fetch refused.

Usage:
  python scripts/agents/harness.py provision <brief> [--hashed-folder DIR ...] [--dry-run]
  python scripts/agents/harness.py fetch <topic> [--dry-run]
  python scripts/agents/harness.py verify <topic> [--base main] [--brief PATH] [--json]
"""
import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script folder from sys.path
from agent_status import STATUS_RE  # noqa: E402  one STATUS format for both scripts

AGENT = "antigravity"
BRIEF_DIR = ("plans-private", "agents", "briefs")
LANE_ROOT = "agent-lanes/antigravity"
SINGLE_WRITER = ("docs/wiki/log.md", "docs/wiki/index.md", "docs/wiki/.manifest.json", "CLAUDE.md", "AGENTS.md")
FORBIDDEN_PREFIXES = ("supabase/", ".github/", ".claude/", "docs/", "plans-private/", "node_modules/")
NEVER_OPEN = (".env",)
HEX64 = re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")
HEXPREFIX = re.compile(r"(?<![0-9a-fA-F])([0-9a-fA-F]{8,63})(?:…|\.\.\.)")
BACKTICK = re.compile(r"`([^`\n]+)`")
TOPIC_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
BRIEF_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-%s-(.+)\.md$" % AGENT)
IDENTITY = ("antigravity-agent", "antigravity-agent@localhost")

# .git/config of a clone: sections and core keys that let a fetch (upload-pack in the clone) or a later git run
# execute something or reach elsewhere. Any of these refuses the fetch.
DANGER_SECTIONS = ("remote", "include", "includeif", "alias", "filter", "credential", "url", "protocol",
                   "uploadpack", "http", "submodule", "safe", "gpg")
DANGER_CORE_KEYS = ("hookspath", "fsmonitor", "sshcommand", "gitproxy", "askpass", "editor", "pager",
                    "attributesfile", "excludesfile", "worktree")
QUIET_SECTIONS = ("core", "user", "branch", "extensions")

PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "INFO"


class SetupError(Exception):
    """Wrong arguments or missing brief, branch or clone: exit 2."""


class GitError(RuntimeError):
    """A git call failed or was refused."""


# ---------- git ----------

def under_worktrees(path):
    return ".worktrees" in Path(path).resolve().parts


def _git_env():
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        env.pop(k, None)
    return env


def _run(cwd_flag_path, args):
    cmd = ["git", "-c", "core.quotepath=off", "-C", str(cwd_flag_path), *args]
    try:
        return subprocess.run(cmd, capture_output=True, timeout=120, env=_git_env())
    except (OSError, subprocess.SubprocessError) as e:
        raise GitError("git %s: %s" % (" ".join(args), e))


def git_proc(root, *args):
    """Run git in the main repo and return the CompletedProcess. Refuses a path under .worktrees/."""
    if under_worktrees(root):
        raise GitError("refused: git -C %s (git runs only in the main repo, never inside a clone)" % root)
    return _run(root, args)


def git(root, *args, binary=False):
    """Run git in the main repo; return stdout (text or bytes); raise GitError on a non-zero exit."""
    r = git_proc(root, *args)
    if r.returncode != 0:
        raise GitError("git %s: %s" % (" ".join(args), r.stderr.decode("utf-8", "replace").strip()))
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def _git_in_new_clone(clone, *args):
    """Only for provision: set up a clone this run has just created, before any agent touched it."""
    r = _run(clone, args)
    if r.returncode != 0:
        raise GitError("git %s (new clone): %s" % (" ".join(args), r.stderr.decode("utf-8", "replace").strip()))
    return r.stdout.decode("utf-8", "replace")


def rev_exists(root, rev):
    return git_proc(root, "rev-parse", "--verify", "--quiet", rev + "^{commit}").returncode == 0


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------- briefs and handoffs ----------

def find_brief(root, topic):
    """Return [(date, path)] for plans-private/agents/briefs/YYYY-MM-DD-antigravity-<topic>.md, oldest first."""
    d = Path(root).joinpath(*BRIEF_DIR)
    hits = []
    if d.is_dir():
        for p in d.glob("*.md"):
            m = BRIEF_NAME.match(p.name)
            if m and m.group(2) == topic:
                hits.append((m.group(1), p))
    return sorted(hits)


def sections(text):
    """Map lower-case '## heading' -> body text."""
    out, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            cur = m.group(1).strip().lower()
            out[cur] = []
        elif cur is not None:
            out[cur].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def path_matches(path, token):
    if token.endswith("/"):
        return path.startswith(token)
    if "/" not in token:
        return PurePosixPath(path).name == token
    return path == token or path.startswith(token + "/")


def _norm_token(tok, root):
    """Turn a backticked token into a repo-relative POSIX path, or None if it is not a file or folder path."""
    t = tok.strip().replace("\\", "/")
    if not t or t.startswith("git ") or t.startswith("-") or "--" in t or "<" in t or "*" in t:
        return None
    if re.match(r"^[A-Za-z]:/", t) or t.startswith("/"):
        try:
            rel = Path(t).resolve().relative_to(Path(root).resolve())
        except (ValueError, OSError):
            return None
        t = rel.as_posix() + ("/" if tok.rstrip().endswith(("/", "\\")) else "")
    if t.startswith("./"):
        t = t[2:]
    if t.startswith(".worktrees") or t.startswith("agent/"):
        return None
    if "/" not in t and not re.search(r"\.\w+$", t):
        return None
    return t


def path_tokens(section_text, root):
    out = []
    for tok in BACKTICK.findall(section_text or ""):
        t = _norm_token(tok, root)
        if t and t not in out:
            out.append(t)
    return out


def parse_brief(text, root):
    sec = sections(text)
    inputs = []
    for line in (sec.get("inputs") or "").splitlines():
        toks = BACKTICK.findall(line)
        sha = next((t.lower() for t in toks if HEX64.fullmatch(t.strip())), None)
        path = next((t for t in toks if not HEX64.fullmatch(t.strip())), None)
        if sha and path:
            inputs.append((path, sha))
    may = path_tokens(sec.get("may touch"), root)
    mnt, dropped = [], []
    for t in path_tokens(sec.get("must not touch"), root):
        # "anything outside `lane/`" style prose would otherwise forbid the lane itself
        (dropped if any(path_matches(x.rstrip("/") + "/x", t) or x == t for x in may) else mnt).append(t)
    return {"may_touch": may, "must_not_touch": mnt, "dropped_must_not_touch": dropped, "inputs": inputs}


def parse_status(text):
    """First non-blank body line after the YAML frontmatter; text version of agent_status.parse_status."""
    lines = text.splitlines()
    i = 0
    if lines and lines[0].strip() == "---":
        for j in range(1, len(lines)):
            if lines[j].strip() == "---":
                i = j + 1
                break
    for line in lines[i:]:
        if line.strip():
            m = STATUS_RE.match(line.strip())
            return m.group(1) if m else None
    return None


def frontmatter(text):
    lines = text.splitlines()
    out = {}
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        m = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return None


def posted_hashes(text, path):
    """Hashes (full or prefix, lower case) on handoff lines that mention path or its file name."""
    base_re = re.compile(r"(?<![\w.-])%s(?![\w.-])" % re.escape(PurePosixPath(path).name))
    out = []
    for line in text.splitlines():
        flat = line.replace("\\", "/")
        if path in flat or base_re.search(flat):
            out += [h.lower() for h in HEX64.findall(line)]
            if "commit" not in line.lower():  # a short hash on a commit line is a commit id, not a blob hash
                out += [h.lower() for h in HEXPREFIX.findall(line)]
    return out


# ---------- clone text checks ----------

def clone_text_checks(clone):
    """Read a clone's .git/config and hooks folder as text. Never runs git."""
    res = []
    gd = Path(clone) / ".git"
    if not gd.exists():
        return [(FAIL, "clone", "%s has no .git" % clone)]
    if not gd.is_dir():
        return [(FAIL, "clone", ".git is a file (a linked worktree), not a clone")]
    for name in ("commondir", "config.worktree", "gitdir"):
        if (gd / name).exists():
            res.append((FAIL, "clone config", ".git/%s exists (redirects git data outside the clone)" % name))
    cfg = gd / "config"
    text = cfg.read_text(encoding="utf-8", errors="replace") if cfg.is_file() else ""
    section, bad, odd = None, [], []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].split(";", 1)[0].strip()
        if not line:
            continue
        m = re.match(r'^\[\s*([A-Za-z0-9.-]+)(?:\s+"[^"]*")?\s*\](.*)$', line)
        if line.startswith("[") and not m:
            bad.append("unparsed header %s" % line)
            section = "?"
            continue
        if m:
            section = m.group(1).split(".")[0].lower()
            if section in DANGER_SECTIONS:
                bad.append(line)
            elif section not in QUIET_SECTIONS:
                odd.append(line)
            line = m.group(2).strip()
            if not line:
                continue
        key = line.split("=", 1)[0].strip().lower()
        if section == "core" and key in DANGER_CORE_KEYS:
            bad.append("core.%s" % key)
    res.append((FAIL, "clone config", "refused entries: %s" % "; ".join(bad)) if bad
               else (PASS, "clone config", "no remote, include, alias, filter or hook path"))
    if odd:
        res.append((WARN, "clone config", "unexpected sections: %s" % "; ".join(odd)))
    hooks = gd / "hooks"
    active = sorted(p.name for p in hooks.iterdir() if p.is_file() and not p.name.endswith(".sample")) if hooks.is_dir() else []
    res.append((FAIL, "clone hooks", "active hooks: %s" % ", ".join(active)) if active
               else (PASS, "clone hooks", "only .sample files"))
    if (gd / "objects" / "info" / "alternates").exists():
        res.append((WARN, "clone objects", "objects/info/alternates exists"))
    return res


def clone_branch_tip(clone, branch):
    """Read refs/heads/<branch> from a clone as text (loose ref or packed-refs). Never runs git."""
    gd = Path(clone) / ".git"
    loose = gd / "refs" / "heads" / Path(*branch.split("/"))
    if loose.is_file():
        return loose.read_text(encoding="ascii", errors="replace").strip()
    packed = gd / "packed-refs"
    if packed.is_file():
        for line in packed.read_text(encoding="ascii", errors="replace").splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1] == "refs/heads/" + branch:
                return parts[0]
    return None


# ---------- verify checks ----------

def ahead_behind(root, base, branch):
    behind, ahead = git(root, "rev-list", "--left-right", "--count", "%s...%s" % (base, branch)).split()
    return int(ahead), int(behind)


def changed_paths(root, base, branch):
    """[(status, path, new_path_or_None)] from git diff --name-status base...branch."""
    out = git(root, "diff", "--name-status", "-z", "--find-renames", "%s...%s" % (base, branch))
    parts = [x for x in out.split("\0") if x != ""]
    res, i = [], 0
    while i < len(parts):
        st = parts[i]
        if st[:1] in ("R", "C"):
            res.append((st[:1], parts[i + 1], parts[i + 2]))
            i += 3
        else:
            res.append((st[:1], parts[i + 1], None))
            i += 2
    return res


def code_lane_checks(changes, brief):
    res = []
    may, mnt = brief["may_touch"], brief["must_not_touch"]
    if not may:
        res.append((FAIL, "lane", "could not read any path from the brief's ## May touch"))
    if brief.get("dropped_must_not_touch"):
        res.append((WARN, "lane", "Must not touch tokens that overlap May touch were ignored: %s (read the brief)"
                    % ", ".join(brief["dropped_must_not_touch"])))
    for st, p, p2 in changes:
        for q in [x for x in (p, p2) if x]:
            if may and not any(path_matches(q, t) for t in may):
                res.append((FAIL, "lane", "outside May touch: %s" % q))
            hit = [t for t in mnt if path_matches(q, t)]
            if hit:
                res.append((FAIL, "lane", "in Must not touch (%s): %s" % (", ".join(hit), q)))
            if q in SINGLE_WRITER:
                res.append((FAIL, "lane", "single-writer file: %s" % q))
            if q.startswith(FORBIDDEN_PREFIXES):
                res.append((FAIL, "lane", "forbidden folder: %s" % q))
            if PurePosixPath(q).name.startswith(NEVER_OPEN):
                res.append((FAIL, "lane", "never-open file touched: %s" % q))
            if q.startswith("agent-lanes/"):
                res.append((FAIL, "lane", "lane file on the code branch (belongs on the lane branch): %s" % q))
        if st == "D":
            res.append((FAIL, "lane", "deleted: %s" % p))
        if st in ("R", "C"):
            res.append((FAIL, "lane", "%s: %s -> %s" % ("renamed" if st == "R" else "copied", p, p2)))
    if not changes:
        res.append((INFO, "lane", "no changed paths against the base"))
    elif not any(r[0] == FAIL for r in res):
        res.append((PASS, "lane", "%d path(s), all inside May touch; none forbidden, single-writer or in Must not touch; "
                    "no delete or rename" % len(changes)))
    return res


def lane_branch_checks(changes, topic):
    prefix = "%s/%s/" % (LANE_ROOT, topic)
    res = []
    for st, p, p2 in changes:
        for q in [x for x in (p, p2) if x]:
            if not q.startswith(prefix):
                res.append((FAIL, "lane branch", "outside %s: %s" % (prefix, q)))
        if st == "D":
            res.append((FAIL, "lane branch", "deleted: %s" % p))
        if st in ("R", "C"):
            res.append((FAIL, "lane branch", "%s: %s -> %s" % ("renamed" if st == "R" else "copied", p, p2)))
    if not changes:
        res.append((FAIL, "lane branch", "no changed paths: the handoff is not committed"))
    elif not any(r[0] == FAIL for r in res):
        res.append((PASS, "lane branch", "%d path(s), all under %s" % (len(changes), prefix)))
    return res


def commits(root, base, branch):
    fmt = ("%H%x1f%(trailers:key=Agent,valueonly,separator=%x2C)%x1f%(trailers:key=Model,valueonly,separator=%x2C)"
           "%x1f%P%x1e")
    out = git(root, "log", "--format=" + fmt, "%s..%s" % (base, branch))
    res = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        h, a, m, parents = (rec.split("\x1f") + [""] * 4)[:4]
        res.append({"hash": h.strip(), "agent": a.strip(), "model": m.strip(), "parents": parents.split()})
    return res


def trailer_checks(cs, label):
    res = []
    for c in cs:
        short = c["hash"][:7]
        if len(c["parents"]) > 1:
            res.append((FAIL, "commits", "%s (%s) is a merge commit" % (short, label)))
        if not c["agent"]:
            res.append((FAIL, "trailers", "%s (%s) has no Agent: trailer" % (short, label)))
        elif c["agent"].lower() != AGENT:
            res.append((FAIL, "trailers", "%s (%s) Agent: %s (expected %s)" % (short, label, c["agent"], AGENT)))
        if not c["model"]:
            res.append((FAIL, "trailers", "%s (%s) has no Model: trailer" % (short, label)))
    if cs and not any(r[0] == FAIL for r in res):
        res.append((PASS, "trailers", "%s: %d commit(s), each with Agent: %s and Model: %s" % (
            label, len(cs), AGENT, "; ".join(sorted({c["model"] for c in cs})))))
    return res


def commit_hash_check(cs, handoff_text):
    low = handoff_text.lower()
    missing = [c["hash"][:7] for c in cs if c["hash"][:7].lower() not in low]
    if not missing:
        return [(PASS, "commit hash", "handoff states %s" % ", ".join(c["hash"][:7] for c in cs))]
    return [(WARN, "commit hash", "handoff does not state %s (a handoff committed in that same commit cannot contain "
             "its hash; ask for it in the final message or a later file)" % ", ".join(missing))]


def gitattributes_text_off(root, rev, path):
    """True if the .gitattributes files at rev turn text conversion off for path (-text or binary)."""
    parts = PurePosixPath(path).parts
    state = False
    for depth in range(len(parts)):
        d = "/".join(parts[:depth])
        ga = (d + "/.gitattributes") if d else ".gitattributes"
        r = git_proc(root, "cat-file", "blob", "%s:%s" % (rev, ga))
        if r.returncode != 0:
            continue
        rel = "/".join(parts[depth:])
        for line in r.stdout.decode("utf-8", "replace").splitlines():
            toks = line.split()
            if not toks or toks[0].startswith("#"):
                continue
            pat, attrs = toks[0], toks[1:]
            ok = (fnmatch.fnmatchcase(rel, pat.lstrip("/")) if "/" in pat
                  else fnmatch.fnmatchcase(PurePosixPath(path).name, pat))
            if not ok:
                continue
            if "-text" in attrs or "binary" in attrs:
                state = True
            elif any(a == "text" or a.startswith("text=") for a in attrs):
                state = False
    return state


def blob_checks(root, base, branch, changes, handoff_text):
    res = []
    for st, p, p2 in changes:
        path = p2 or p
        if st == "D":
            continue
        data = git(root, "cat-file", "blob", "%s:%s" % (branch, path), binary=True)
        digest = hashlib.sha256(data).hexdigest()
        posted = posted_hashes(handoff_text, path)
        if posted:
            if digest in posted:
                res.append((PASS, "blob hash", "%s MATCH %s" % (path, digest)))
            elif any(len(h) < 64 and digest.startswith(h) for h in posted):
                res.append((PASS, "blob hash", "%s PREFIX %s… (full %s)" % (
                    path, next(h for h in posted if digest.startswith(h)), digest)))
            else:
                res.append((FAIL, "blob hash", "%s MISMATCH: committed %s, posted %s" % (path, digest, ", ".join(posted))))
            added = git(root, "log", "--diff-filter=A", "--format=%H", "%s..%s" % (base, branch), "--", path).split()
            rev = added[-1] if added else branch
            if not gitattributes_text_off(root, rev, path):
                res.append((FAIL, "gitattributes", "%s has a posted hash but no `* -text` in effect when it was added" % path))
        else:
            res.append((INFO, "blob hash", "%s no hash posted; committed %s" % (path, digest)))
        if data.startswith(b"\xef\xbb\xbf"):
            res.append((WARN, "encoding", "%s starts with a UTF-8 BOM" % path))
        elif data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
            res.append((WARN, "encoding", "%s starts with a UTF-16 BOM (PowerShell > output)" % path))
        if b"\0" not in data and b"\r\n" in data:
            res.append((WARN, "encoding", "%s has CRLF line endings in the committed blob" % path))
        if path.endswith(".md"):
            fm = frontmatter(data.decode("utf-8", "replace"))
            if fm is None or not fm.get("author") or not fm.get("model"):
                res.append((WARN, "frontmatter", "%s has no author/model frontmatter" % path))
            elif not fm["model"].lower().startswith("claude"):
                res.append((INFO, "report rights", "%s model %r is not Claude-family: only code, raw outputs and "
                            "handoffs; content not checked" % (path, fm["model"])))
    return res


def input_checks(root, brief, handoff_text):
    res = []
    low = handoff_text.lower()
    for path, sha in brief["inputs"]:
        flat = path.replace("\\", "/")
        name = PurePosixPath(flat).name
        if sha in low:
            res.append((PASS, "input hash", "%s: handoff echoes the brief's hash" % name))
        else:
            res.append((WARN, "input hash", "%s: handoff does not echo the brief's hash %s…" % (name, sha[:12])))
        if name.startswith(NEVER_OPEN):
            res.append((INFO, "input hash", "%s: never-open file, not opened" % name))
            continue
        p = Path(path) if re.match(r"^[A-Za-z]:[\\/]", path) or path.startswith("/") else Path(root) / path
        if p.is_file():
            now = sha256_file(p)
            if now != sha:
                res.append((WARN, "input hash", "%s in the main tree now hashes %s, not the brief's hash" % (name, now)))
        else:
            res.append((INFO, "input hash", "%s not found in the main tree; not recomputed" % name))
    return res


def verify(root, topic, base="main", brief_path=None):
    """Return (results, info). Raises SetupError."""
    topic = check_topic(topic)
    results = []
    if brief_path:
        bp = Path(brief_path) if Path(brief_path).is_absolute() else Path(root) / brief_path
        if not bp.is_file():
            raise SetupError("brief not found: %s" % brief_path)
    else:
        hits = find_brief(root, topic)
        if not hits:
            raise SetupError("no brief %s/YYYY-MM-DD-%s-%s.md" % ("/".join(BRIEF_DIR), AGENT, topic))
        bp = hits[-1][1]
        if len(hits) > 1:
            results.append((WARN, "brief", "%d dated briefs for this topic; using the newest" % len(hits)))
    brief = parse_brief(bp.read_text(encoding="utf-8", errors="replace"), root)
    results.append((INFO, "brief", "%s (May touch: %s)" % (bp.name, ", ".join(brief["may_touch"]) or "none")))
    code, lane = "agent/%s/%s" % (AGENT, topic), "agent/%s/%s-lane" % (AGENT, topic)
    if not rev_exists(root, code):
        raise SetupError("branch %s is not in the main repo (run: harness.py fetch %s)" % (code, topic))
    if not rev_exists(root, base):
        raise SetupError("base %s does not exist" % base)

    handoff_text = ""
    if rev_exists(root, lane):
        hpath = "%s/%s/HANDOFF-%s.md" % (LANE_ROOT, topic, topic)
        r = git_proc(root, "cat-file", "blob", "%s:%s" % (lane, hpath))
        if r.returncode == 0:
            handoff_text = r.stdout.decode("utf-8", "replace")
            st = parse_status(handoff_text)
            results.append((PASS, "handoff", "%s:%s STATUS: %s" % (lane, hpath, st)) if st
                           else (FAIL, "handoff", "%s:%s has no STATUS line after the frontmatter" % (lane, hpath)))
        else:
            results.append((FAIL, "handoff", "no %s on branch %s" % (hpath, lane)))
    else:
        results.append((FAIL, "handoff", "lane branch %s is not in the main repo" % lane))

    ahead, behind = ahead_behind(root, base, code)
    results.append((FAIL, "commits", "code branch has no commits ahead of %s (merged already? pass --base)" % base)
                   if ahead == 0 else (INFO, "commits", "code branch %d ahead, %d behind %s" % (ahead, behind, base)))
    changes = changed_paths(root, base, code)
    clone = Path(root) / ".worktrees" / ("antigravity-clone-%s" % topic)
    if clone.exists():
        results += clone_text_checks(clone)
    else:
        results.append((INFO, "clone", "%s not on disk; config and hooks not checked" % clone.relative_to(root).as_posix()))
    results += code_lane_checks(changes, brief)
    cs = commits(root, base, code)
    results += trailer_checks(cs, "code")
    if cs and handoff_text:
        results += commit_hash_check(cs, handoff_text)
    results += blob_checks(root, base, code, changes, handoff_text)

    if rev_exists(root, lane):
        lchanges = changed_paths(root, base, lane)
        results += lane_branch_checks(lchanges, topic)
        results += trailer_checks(commits(root, base, lane), "lane")
        results += blob_checks(root, base, lane, lchanges, handoff_text)
    results += input_checks(root, brief, handoff_text)
    return results, {"branch": code, "lane_branch": lane, "base": base, "brief": str(bp)}


# ---------- fetch ----------

def fetch(root, topic, dry_run=False, out=print):
    """Return an exit code: 0 done, 2 set-up error, 3 refused."""
    topic = check_topic(topic)
    code, lane = "agent/%s/%s" % (AGENT, topic), "agent/%s/%s-lane" % (AGENT, topic)
    clone = Path(root) / ".worktrees" / ("antigravity-clone-%s" % topic)
    if not clone.is_dir():
        raise SetupError("clone not found: %s" % clone)
    checks = clone_text_checks(clone)
    for lvl, name, detail in checks:
        out("%-4s  %s: %s" % (lvl, name, detail))
    if any(lvl == FAIL for lvl, _, _ in checks):
        out("REFUSED: the clone's config or hooks failed the text check; nothing fetched.")
        return 3
    refspecs = []
    for branch, required in ((code, True), (lane, False)):
        tip = clone_branch_tip(clone, branch)
        if not tip:
            if required:
                out("REFUSED: %s not found in the clone's refs (read as text)." % branch)
                return 3
            out("WARN  %s not found in the clone; the handoff cannot be verified without it" % branch)
            continue
        out("clone tip %s %s" % (branch, tip))
        refspecs.append("refs/heads/%s:refs/heads/%s" % (branch, branch))  # no leading +: no force
    if dry_run:
        out("DRY RUN: would run git -C <main repo> fetch --no-tags --no-write-fetch-head %s %s" % (clone, " ".join(refspecs)))
        return 0
    before = {b: git_proc(root, "rev-parse", "--verify", "--quiet", "refs/heads/" + b).stdout.decode().strip()
              for b in (code, lane)}
    r = git_proc(root, "fetch", "--no-tags", "--no-write-fetch-head", str(clone), *refspecs)
    if r.returncode != 0:
        out("REFUSED by git (no force is used): %s" % r.stderr.decode("utf-8", "replace").strip())
        return 3
    for b in (code, lane):
        after = git_proc(root, "rev-parse", "--verify", "--quiet", "refs/heads/" + b).stdout.decode().strip()
        if after:
            out("fetched %s: %s -> %s" % (b, before[b] or "(new)", after))
    out("next: harness.py verify %s" % topic)
    return 0


# ---------- provision ----------

def check_topic(topic):
    if not TOPIC_RE.match(topic) or ".." in topic or topic.endswith(("-lane", "-feedback")):
        raise SetupError("refused topic %r (letters, digits, . _ - only; not ending in -lane or -feedback)" % topic)
    return topic


def check_write(root, target):
    """Allow-list: only a new folder directly under <root>/.worktrees/."""
    wt = (Path(root) / ".worktrees").resolve()
    t = Path(target).resolve()
    if t.parent != wt:
        raise SetupError("refused: %s is not directly under %s" % (target, wt))
    if t.exists():
        raise SetupError("refused: %s already exists" % t)
    return t


def provision(root, brief_path, hashed_folders=(), dry_run=False, out=print):
    bp = Path(brief_path) if Path(brief_path).is_absolute() else Path(root) / brief_path
    if not bp.is_file():
        raise SetupError("brief not found: %s" % brief_path)
    m = BRIEF_NAME.match(bp.name)
    if not m:
        raise SetupError("brief name is not YYYY-MM-DD-%s-<topic>.md: %s" % (AGENT, bp.name))
    topic = check_topic(m.group(2))
    brief = parse_brief(bp.read_text(encoding="utf-8", errors="replace"), root)
    code, lane = "agent/%s/%s" % (AGENT, topic), "agent/%s/%s-lane" % (AGENT, topic)
    for b in (code, lane):
        if rev_exists(root, "refs/heads/" + b):
            raise SetupError("branch %s already exists in the main repo" % b)
    if not rev_exists(root, "main"):
        raise SetupError("no branch main in the main repo")
    target = check_write(root, Path(root) / ".worktrees" / ("antigravity-clone-%s" % topic))
    folders = []
    for d in hashed_folders:
        d = d.replace("\\", "/").strip("/")
        if not d or ".." in PurePosixPath(d).parts or re.match(r"^[A-Za-z]:", d):
            raise SetupError("refused hashed folder: %r (repo-relative, no ..)" % d)
        if not any(path_matches(d + "/x", t) for t in brief["may_touch"]) and not (d + "/").startswith(LANE_ROOT + "/"):
            raise SetupError("hashed folder %s is not inside the brief's May touch or the lane folder" % d)
        folders.append(d)
    steps = ["git -C <main repo> clone --no-hardlinks --no-tags --single-branch --branch main . %s" % target,
             "git -C %s remote remove origin" % target,
             "git -C %s switch -c %s" % (target, code),
             "git -C %s branch %s" % (target, lane),
             "git -C %s config user.name %s" % (target, IDENTITY[0]),
             "git -C %s config user.email %s" % (target, IDENTITY[1])]
    steps += ["write %s/%s/.gitattributes: * -text (not committed; the agent commits it first)" % (target, d)
              for d in folders]
    dirty = [ln for ln in git(root, "status", "--porcelain").splitlines() if ln.strip()]
    if dirty:
        out("WARN  the main working tree has %d uncommitted change(s); the clone starts from committed main and "
            "cannot see them" % len(dirty))
    if dry_run:
        out("DRY RUN: clone for %s and %s" % (code, lane))
        for s in steps:
            out("  " + s)
        return 0
    exclude = Path(root) / ".git" / "info" / "exclude"
    if not (exclude.is_file() and ".worktrees" in exclude.read_text(encoding="utf-8", errors="replace")):
        out("WARN  .worktrees/ is not in .git/info/exclude")
    target.parent.mkdir(exist_ok=True)
    try:
        git(root, "clone", "--no-hardlinks", "--no-tags", "--single-branch", "--branch", "main", ".", str(target))
        _git_in_new_clone(target, "remote", "remove", "origin")  # first, so a later failure leaves no remote
        _git_in_new_clone(target, "switch", "-c", code)
        _git_in_new_clone(target, "branch", lane)
        _git_in_new_clone(target, "config", "user.name", IDENTITY[0])
        _git_in_new_clone(target, "config", "user.email", IDENTITY[1])
        for d in folders:
            p = target / d
            p.mkdir(parents=True, exist_ok=True)
            with open(p / ".gitattributes", "w", encoding="utf-8", newline="\n") as f:
                f.write("* -text\n")
    except (GitError, OSError) as e:
        if target.exists():
            out("INCOMPLETE: %s was left in place half set up. Do not give it to an agent; "
                "remove it only with the user's yes, then run provision again." % target)
        raise SetupError("provision failed: %s" % e)
    for s in steps:
        out("done  " + s)
    for lvl, name_, detail in clone_text_checks(target):
        out("%-4s  %s: %s" % (lvl, name_, detail))
    out("NOTE  node_modules is not in the clone; the brief's steps say when to run npm ci.")
    out("Prompt for the agent: brief %s; clone %s; code on branch %s, handoff and raw outputs under %s/%s/ on branch "
        "%s; git writes only in your clone, no merge, no push, no remote." % (bp, target, code, LANE_ROOT, topic, lane))
    return 0


# ---------- output and entry point ----------

def render(results, info, as_json=False):
    if as_json:
        return json.dumps({"info": info, "results": [{"level": l, "check": c, "detail": d} for l, c, d in results]},
                          indent=2)
    lines = ["%-4s  %s: %s" % (lvl, name, detail) for lvl, name, detail in results]
    fails = sum(1 for r in results if r[0] == FAIL)
    warns = sum(1 for r in results if r[0] == WARN)
    lines.append("")
    lines.append("%s: %d FAIL, %d WARN (automated checks only; content is not reviewed)" % (
        "FAIL" if fails else "PASS", fails, warns))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Trimmed agent harness: provision, fetch, verify")
    ap.add_argument("--root", default=None, help="main repo (default: the repo containing this script)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="read-only checks of an agent's branches")
    v.add_argument("topic")
    v.add_argument("--base", default="main")
    v.add_argument("--brief", default=None)
    v.add_argument("--json", action="store_true")
    f = sub.add_parser("fetch", help="fetch an Antigravity clone's branches into the main repo, no force")
    f.add_argument("topic")
    f.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("provision", help="create the task's clone from main")
    p.add_argument("brief")
    p.add_argument("--hashed-folder", action="append", default=[])
    p.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    root = a.root or str(Path(__file__).resolve().parents[2])
    try:
        if a.cmd == "verify":
            results, info = verify(root, a.topic, base=a.base, brief_path=a.brief)
            print(render(results, info, as_json=a.json))
            return 1 if any(r[0] == FAIL for r in results) else 0
        if a.cmd == "fetch":
            return fetch(root, a.topic, dry_run=a.dry_run)
        return provision(root, a.brief, hashed_folders=a.hashed_folder, dry_run=a.dry_run)
    except SetupError as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 2
    except GitError as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
