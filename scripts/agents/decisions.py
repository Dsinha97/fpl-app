"""Decision register helper for FPL App. Standard library only, no LLM, promotes nothing.

Ported from the collusion-sprint project's tools/decisions.py. Two changes: the register lives in the gitignored
plans-private/Decisions/ (the repo is public), and the log, docs/wiki/log.md, is newest-first, so the scan keys
its cursor on the newest entry instead of on a line count.

    python scripts/agents/decisions.py lint [--strict] [--today YYYY-MM-DD] [--ack-days N]
    python scripts/agents/decisions.py scan [--baseline] [--since N] [--dry-run] [--hook]
    python scripts/agents/decisions.py cursor --end
    python scripts/agents/decisions.py show LABEL [LABEL ...]
    python scripts/agents/decisions.py digest [--hook]
    Global flags: --root DIR, --log PATH (default docs/wiki/log.md), --order newest-first|oldest-first (default newest-first)

lint   Read-only. Checks entries, register and gotchas in plans-private/Decisions/ (see CONVENTIONS.md there).
       Prints ERROR and WARN lines. Exits 0 unless --strict is given and there are errors.
scan   Reads the log entries after the cursor, matches patterns.txt and appends candidates to inbox.md. Copies no log
       text: a row holds only a label, so a private wording never lands in a file by accident. The label is
       log.md@<12 hex> (the hash of the entry line; stable when new entries are added on top) in newest-first
       mode, and log.md:<line> in oldest-first mode. Never promotes anything.
       With no cursor it refuses (run --baseline first, then `cursor --end` after the backfill).
       --baseline writes staging/scan-baseline.md and nothing else.
       --since N rescans: oldest-first, from line N; newest-first, the newest N entries. It skips entries already
       queued and then moves the cursor.
       --hook is quiet: it prints one systemMessage JSON line only for new rows or a warning.
show   Prints the log line for each label, so the reviewer can read it. Writes nothing.
digest Prints up to three lines (inbox and pending acknowledgements, revisits due, recurring gotchas not
       escalated), or nothing when all is clear. --hook wraps them as SessionStart additionalContext JSON.
cursor Sets the scan cursor to the newest log entry without scanning (use only when nothing is unscanned).

Reads: the log and plans-private/Decisions/** only. Writes: inbox.md, .scan-cursor, staging/scan-baseline.md only.
Never opens .env* files.
"""
import argparse, hashlib, json, os, re, sys, urllib.parse
from datetime import date
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG = Path('docs') / 'wiki' / 'log.md'
ENTRY_RE = re.compile(r'^- \d{4}-\d{2}-\d{2}')
LABEL_RE = re.compile(r'^log\.md(?::(\d+)|@([0-9a-f]{12}))$')
STATUS = {'active', 'superseded', 'rejected', 'reversed'}
ACK = {'accepted', 'pending', 'rejected'}
EVIDENCE = {'conversation-record', 'file-read'}
VISIBILITY = {'team', 'private'}
GOTCHA_FIELDS = ['Symptom', 'Cause', 'Fix', 'Location', 'Guarded by', 'Sprint / date', 'Evidence',
                 'Source', 'Match', 'Recurrence', 'Escalation']
KIND_PRIORITY = ['claude-decision', 'decision', 'gotcha']


class Paths:
    def __init__(self, root, log=None, order='newest-first'):
        self.root = Path(root).resolve()
        self.dec = self.root / 'plans-private' / 'Decisions'
        self.log = self.root / (log or DEFAULT_LOG)
        self.order = order
        self.inbox = self.dec / 'inbox.md'
        self.cursor = self.dec / '.scan-cursor'
        self.baseline = self.dec / 'staging' / 'scan-baseline.md'
        self.patterns = self.dec / 'patterns.txt'
        self.register = self.dec / 'register.md'

    def check_write(self, p):
        """Allow-list: refuse any write outside the three files this script owns."""
        p = Path(p).resolve()
        if p not in {self.inbox.resolve(), self.cursor.resolve(), self.baseline.resolve()}:
            raise RuntimeError(f'refusing to write outside the allow-list: {p}')
        return p


def read(p):
    return Path(p).read_text(encoding='utf-8', errors='replace').replace('\r\n', '\n')


def write(paths, p, text):
    """Replace a file atomically: write a sibling temp file, then os.replace."""
    p = paths.check_write(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_text(text, encoding='utf-8', newline='\n')
    os.replace(tmp, p)


def append(paths, p, text):
    """Append without rewriting the file, so edits made meanwhile are not lost."""
    p = paths.check_write(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    lead = '\n' if p.exists() and p.stat().st_size > 0 and p.read_bytes()[-1:] != b'\n' else ''
    with open(p, 'a', encoding='utf-8', newline='\n') as f:
        f.write(lead + text)


def sha(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


# ---------- frontmatter and tables ----------

def parse_frontmatter(text):
    m = re.match(r'---\n(.*?)\n---\n?', text, re.S)
    if not m:
        return None, text
    fm = {}
    for line in m.group(1).split('\n'):
        mm = re.match(r'^([A-Za-z_]+):\s*(.*?)\s*$', line)
        if not mm:
            continue
        raw = mm.group(2)
        if raw[:1] in ('"', "'"):  # quoted: keep everything inside the quotes, '#' included
            end = raw.find(raw[0], 1)
            val = raw[1:end] if end > 0 else raw.strip(raw[0])
        elif raw.startswith('['):  # list: drop a trailing comment after the closing bracket
            val = raw[:raw.rfind(']') + 1] if ']' in raw else raw
        else:
            val = re.sub(r'\s+#.*$', '', raw).strip()
        fm[mm.group(1)] = val
    return fm, text[m.end():]


def parse_list(val):
    if val is None:
        return []
    val = val.strip()
    if val.startswith('['):
        val = val[1:val.rfind(']')] if ']' in val else val[1:]
    return [x.strip().strip('"').strip("'") for x in val.split(',') if x.strip().strip('"').strip("'")]


def table_cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def register_rows(text):
    """Yield (table_number, cells) for each table row whose first cell is an id."""
    table = 0
    for line in text.split('\n'):
        mh = re.match(r'^##\s+(\d)\.', line)
        if mh:
            table = int(mh.group(1))
            continue
        if not line.startswith('|'):
            continue
        cells = table_cells(line)
        if cells and re.match(r'^(DEC-\d+|G-\d+)$', cells[0]):
            yield table, cells


def valid_date(s):
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', s or ''):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


# ---------- lint ----------

def load_entries(paths):
    out = []
    for folder in ('entries', 'private'):
        d = paths.dec / folder
        if not d.is_dir():
            continue
        for f in sorted(d.glob('DEC-*.md')):
            text = read(f)
            fm, body = parse_frontmatter(text)
            out.append({'path': f, 'folder': folder, 'fm': fm, 'body': body})
    return out


def parse_gotchas(text):
    blocks = []
    parts = re.split(r'(?m)^(?=### G-)', text)
    for part in parts:
        mh = re.match(r'### (G-\d+):\s*(.*)', part)
        if not mh:
            continue
        fields = {}
        for line in part.split('\n')[1:]:
            mf = re.match(r'^- ([A-Za-z /]+):\s*(.*)$', line)
            if mf:
                fields[mf.group(1).strip()] = mf.group(2).strip()
        blocks.append({'id': mh.group(1), 'title': mh.group(2).strip(), 'fields': fields})
    return blocks


def lint(paths, today, ack_days, strict):
    errors, warns = [], []
    rel = lambda p: Path(p).resolve().relative_to(paths.root).as_posix()
    err = lambda p, m: errors.append(f'ERROR {rel(p)}: {m}')
    warn = lambda p, m: warns.append(f'WARN  {rel(p)}: {m}')
    root_log = paths.log.resolve()

    entries = load_entries(paths)
    by_id = {}
    for e in entries:
        p, fm = e['path'], e['fm']
        if fm is None:
            err(p, 'missing frontmatter')
            continue
        eid = fm.get('id', '')
        if not re.match(r'^DEC-\d{3,}$', eid):
            err(p, f'bad id {eid!r}')
        elif not p.name.startswith(eid + '-') and p.stem != eid:
            err(p, f'id {eid} does not match the filename')
        if eid in by_id:
            err(p, f'duplicate id {eid}')
        by_id[eid] = e
        for key, allowed in (('status', STATUS), ('user_ack', ACK), ('evidence', EVIDENCE), ('visibility', VISIBILITY)):
            if fm.get(key) not in allowed:
                err(p, f'{key} {fm.get(key)!r} is not one of {sorted(allowed)}')
        db = fm.get('decided_by', '')
        if not (db in ('user', 'claude', 'unknown') or re.match(r'^teammate:\S+', db)):
            err(p, f'decided_by {db!r} must be user, claude, unknown or teammate:<name>')
        if not valid_date(fm.get('date')):
            err(p, f'bad date {fm.get("date")!r}')
        if fm.get('visibility') == 'private' and e['folder'] != 'private':
            err(p, 'visibility private but the file is outside private/')
        if fm.get('visibility') == 'team' and e['folder'] == 'private':
            err(p, 'file is under private/ but visibility is team')
        if fm.get('status') == 'superseded' and not parse_list(fm.get('superseded_by')):
            err(p, 'status superseded but superseded_by is empty')
        ro = fm.get('revisit_on', 'none')
        if ro != 'none':
            d = valid_date(ro)
            if not d:
                err(p, f'bad revisit_on {ro!r}')
            elif fm.get('status') == 'active' and d <= today:
                warn(p, f'revisit due ({ro})')
        if db == 'claude' and fm.get('user_ack') == 'pending':
            d = valid_date(fm.get('date'))
            if d and (today - d).days > ack_days:
                warn(p, f'Claude-made decision waiting for acknowledgement for {(today - d).days} days')
        # relative links in the body
        for m in re.finditer(r'\]\(([^)\s]+)', e['body']):
            t = m.group(1)
            if t.startswith(('http', 'mailto:', '#')):
                continue
            t = urllib.parse.unquote(t.split('#')[0])
            if not t:
                continue
            target = (p.parent / t).resolve()
            if not target.exists():
                err(p, f'dead link {t}')
            elif target.name == 'log.md' and target != root_log:
                want = os.path.relpath(root_log, p.parent).replace(os.sep, '/')
                err(p, f'link {t} points at a log.md that is not the project log; from {p.parent.name}/ the project log is {want}')

    for eid, e in by_id.items():
        fm = e['fm']
        for other in parse_list(fm.get('supersedes')):
            o = by_id.get(other)
            if o is None:
                err(e['path'], f'supersedes {other}, which does not exist')
            elif eid not in parse_list(o['fm'].get('superseded_by')):
                err(e['path'], f'supersedes {other}, but {other} does not list {eid} in superseded_by')
        for other in parse_list(fm.get('superseded_by')):
            o = by_id.get(other)
            if o is None:
                err(e['path'], f'superseded_by {other}, which does not exist')
            elif eid not in parse_list(o['fm'].get('supersedes')):
                err(e['path'], f'superseded_by {other}, but {other} does not list {eid} in supersedes')

    # register
    reg_ids, claude_rows = {}, set()
    if paths.register.exists():
        reg_text = read(paths.register)
        private_titles = {e['fm'].get('title', '') for e in entries
                          if e['folder'] == 'private' and e['fm'] and e['fm'].get('title')}
        for t in private_titles:
            if t and t in reg_text:
                err(paths.register, f'a private entry title appears in the tracked register: {t[:40]!r}')
        gotcha_ids = set()
        for gf in (paths.dec / 'gotchas.md', paths.dec / 'private' / 'gotchas-private.md'):
            if gf.exists():
                gotcha_ids |= {b['id'] for b in parse_gotchas(read(gf))}
        for table, cells in register_rows(reg_text):
            rid = cells[0]
            is_private_row = any(c.lower() == 'private' for c in cells[1:])
            if rid.startswith('G-'):
                if table == 3 and rid not in gotcha_ids and not is_private_row:
                    err(paths.register, f'gotcha row {rid} has no entry in gotchas.md')
                continue
            if table == 1:
                reg_ids[rid] = is_private_row
                if rid not in by_id and not is_private_row:
                    err(paths.register, f'row {rid} has no entry file')
            elif table == 2:
                claude_rows.add(rid)
                e = by_id.get(rid)
                if e is None and not is_private_row:
                    err(paths.register, f'table 2 row {rid} has no entry file')
                elif e and not (e['fm'].get('decided_by') == 'claude' and e['fm'].get('user_ack') == 'pending'):
                    err(paths.register, f'table 2 row {rid} is not a pending Claude-made decision')
        for eid, e in by_id.items():
            if e['folder'] == 'entries' and eid not in reg_ids:
                err(e['path'], f'{eid} has no row in register.md table 1')
            if e['folder'] == 'private' and eid not in reg_ids:
                err(e['path'], f'{eid} has no stub row in register.md table 1 (ID, date, status, "private")')
            fm = e['fm']
            if fm.get('decided_by') == 'claude' and fm.get('user_ack') == 'pending' and eid not in claude_rows \
                    and e['folder'] == 'entries':
                err(e['path'], f'{eid} is a pending Claude-made decision but has no row in register.md table 2')
    elif entries:
        err(paths.register, 'register.md is missing')

    # gotchas
    for gf in (paths.dec / 'gotchas.md', paths.dec / 'private' / 'gotchas-private.md'):
        if not gf.exists():
            continue
        seen = set()
        for b in parse_gotchas(read(gf)):
            if b['id'] in seen:
                err(gf, f'duplicate {b["id"]}')
            seen.add(b['id'])
            for fld in GOTCHA_FIELDS:
                if fld not in b['fields']:
                    err(gf, f'{b["id"]} is missing the field {fld!r}')
            ev = b['fields'].get('Evidence')
            if ev is not None and ev not in EVIDENCE:
                err(gf, f'{b["id"]} Evidence {ev!r} is not one of {sorted(EVIDENCE)}')
            mr = re.match(r'^(\d+)', b['fields'].get('Recurrence', ''))
            if 'Recurrence' in b['fields'] and not mr:
                err(gf, f'{b["id"]} Recurrence must start with a number')
            elif mr and int(mr.group(1)) >= 2 and b['fields'].get('Escalation', 'none').startswith('none'):
                warn(gf, f'{b["id"]} recurred {mr.group(1)} times and is not escalated')

    for line in errors + warns:
        print(line)
    print(f'decisions lint: {len(entries)} entries, {len(errors)} errors, {len(warns)} warnings')
    return 1 if (strict and errors) else 0


# ---------- scan ----------

def load_patterns(paths):
    pats = []
    if not paths.patterns.exists():
        return pats
    for line in read(paths.patterns).split('\n'):
        if not line.strip() or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) != 3:
            print(f'patterns.txt: skipped malformed line {line[:60]!r}', file=sys.stderr)
            continue
        try:
            pats.append((parts[0], re.compile(parts[1]), parts[2].strip()))
        except re.error as ex:
            print(f'patterns.txt: bad regex in {parts[0]}: {ex}', file=sys.stderr)
    return pats


def read_cursor(paths):
    if not paths.cursor.exists():
        return None
    try:
        c = json.loads(read(paths.cursor))
        return int(c['line']), str(c['sha256'])
    except (ValueError, KeyError, TypeError):
        return 'bad'


def known_sources(paths):
    """Labels already queued, read from the Source cell of inbox rows only, plus the highest row id."""
    seen, max_row = set(), 0
    files = [paths.inbox] + sorted((paths.dec / 'staging').glob('inbox-archive-*.md'))
    for f in files:
        if not f.exists():
            continue
        for line in read(f).split('\n'):
            if not line.startswith('|'):
                continue
            cells = table_cells(line)
            if cells and re.match(r'^I-\d{4}$', cells[0]):
                max_row = max(max_row, int(cells[0][2:]))
                if len(cells) > 2 and LABEL_RE.match(cells[2]):
                    seen.add(cells[2])
    return seen, max_row


def label(order, n, line):
    return f'log.md:{n}' if order == 'oldest-first' else f'log.md@{sha(line)[:12]}'


def entry_numbers(lines, order):
    """1-based line numbers that count as log entries: every line (oldest-first) or the '- YYYY-MM-DD' lines."""
    return [n for n, ln in enumerate(lines, 1) if order == 'oldest-first' or ENTRY_RE.match(ln)]


def entry_text(lines, n, order):
    """The text a pattern is matched against. Newest-first: the entry's first line plus its continuation lines
    (the following non-blank lines that do not start a new entry). Oldest-first: the single line."""
    if order == 'oldest-first':
        return lines[n - 1]
    end = n
    while end < len(lines) and lines[end].strip() and not ENTRY_RE.match(lines[end]):
        end += 1
    return '\n'.join(lines[n - 1:end])


def find_candidates(lines, start, pats, skip, order='oldest-first', end=None):
    """Return (label, pattern names, kind). No log text is returned. Newest-first, the label is the hash of the
    entry's first line, so an entry keeps its label when new entries are added above it."""
    out = []
    stop = len(lines) if end is None else end
    for n in range(start, stop + 1):
        line = lines[n - 1]
        if order == 'newest-first' and not ENTRY_RE.match(line):
            continue
        lab = label(order, n, line)
        if lab in skip:
            continue
        text = entry_text(lines, n, order)
        hits = [(name, kind) for name, rx, kind in pats if rx.search(text)]
        if not hits:
            continue
        kinds = {h[1] for h in hits}
        kind = next((k for k in KIND_PRIORITY if k in kinds), hits[0][1])
        out.append((lab, '+'.join(h[0] for h in hits), kind))
    return out


def cursor_payload(lines, order):
    """Cursor for the end of the log: the last line (oldest-first) or the newest entry (newest-first)."""
    if order == 'oldest-first':
        return {'line': len(lines), 'sha256': sha(lines[-1]) if lines else ''}
    ents = entry_numbers(lines, order)
    return {'line': ents[0], 'sha256': sha(lines[ents[0] - 1])} if ents else {'line': 0, 'sha256': ''}


def scan(paths, baseline, dry, hook, since=None):
    order = paths.order

    def note(msg, warn=False):
        if not hook:
            print(msg)
        elif warn:
            print(json.dumps({'systemMessage': 'decisions: ' + msg}))

    if not paths.log.exists():
        note(f'scan: {paths.log.name} not found', warn=True)
        return 0
    lines = read(paths.log).split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    pats = load_patterns(paths)
    if not pats:
        note('scan: no patterns loaded (check plans-private/Decisions/patterns.txt; fields are separated by tabs)', warn=True)
        return 0
    today = date.today().isoformat()

    if baseline:
        cands = find_candidates(lines, 1, pats, set(), order)
        counts = {}
        for _, name, _ in cands:
            for nm in name.split('+'):
                counts[nm] = counts.get(nm, 0) + 1
        out = ['# Baseline scan', '',
               f'Generated {today} from the log ({len(entry_numbers(lines, order))} entries, {len(lines)} lines). '
               'Not an inbox: nothing here has a verdict. Labels only; read each entry with `decisions.py show LABEL`. '
               'See [CONVENTIONS.md](../CONVENTIONS.md).', '',
               '## Hits per pattern', '', '| Pattern | Hits |', '|---|---|']
        out += [f'| {k} | {v} |' for k, v in sorted(counts.items())]
        out += ['', f'## Entries ({len(cands)})', '', '| Source | Pattern | Kind |', '|---|---|---|']
        out += [f'| {lab} | {nm} | {k} |' for lab, nm, k in cands]
        text = '\n'.join(out) + '\n'
        if dry:
            print(text)
        else:
            write(paths, paths.baseline, text)
            print(f'scan --baseline: {len(cands)} entries written to {paths.baseline.relative_to(paths.root).as_posix()}')
        return 0

    start, end = 1, None
    if since is not None:
        ents = entry_numbers(lines, order)
        if order == 'oldest-first':
            if since < 1 or since > len(lines) + 1:
                note(f'scan: --since {since} is outside the log (1 to {len(lines) + 1})', warn=True)
                return 0
            start = since
        else:
            if since < 1 or since > len(ents):
                note(f'scan: --since {since} is outside the log (1 to {len(ents)} entries)', warn=True)
                return 0
            end = ents[since - 1]
    else:
        cur = read_cursor(paths)
        if cur is None:
            note('scan: no cursor yet. Run `scan --baseline`, finish the backfill, then `cursor --end`. Nothing scanned.')
            return 0
        if cur == 'bad':
            note('scan: .scan-cursor is unreadable. Nothing scanned. Check the file, then run `scan --since N`.', warn=True)
            return 0
        n_cur, h_cur = cur
        if order == 'oldest-first':
            if n_cur > len(lines) or (n_cur > 0 and sha(lines[n_cur - 1]) != h_cur):
                note('scan: the log changed above the cursor (shorter, or the cursor line differs). Nothing scanned. '
                     f'Check the change, then run `scan --since {n_cur + 1}` to catch up; it skips lines already queued.', warn=True)
                return 0
            start = n_cur + 1
        else:
            ents = entry_numbers(lines, order)
            hit = next((n for n in ents if sha(lines[n - 1]) == h_cur), None)
            if hit is None:
                note('scan: the entry the cursor points at is gone or was edited. Nothing scanned. Check the change, then run '
                     '`scan --since N` to rescan the newest N entries; it skips entries already queued.', warn=True)
                return 0
            end = hit - 1
    skip, max_row = known_sources(paths)
    cands = find_candidates(lines, start, pats, skip, order, end) if (end is None or end >= start) else []
    rows = [f'| I-{max_row + i:04d} | {today} | {lab} | {nm} | {k} |  |  |' for i, (lab, nm, k) in enumerate(cands, 1)]
    if dry:
        print('\n'.join(rows) if rows else 'scan: no new candidates')
        return 0
    if rows:  # rows first, cursor second: a failed inbox write must not lose the entries
        append(paths, paths.inbox, '\n'.join(rows) + '\n')
    if lines:
        write(paths, paths.cursor, json.dumps(cursor_payload(lines, order)) + '\n')
    if not rows:
        note('scan: no new candidates')
    elif hook:
        print(json.dumps({'systemMessage': f'decisions: {len(rows)} new inbox candidate(s) in plans-private/Decisions/inbox.md'}))
    else:
        print(f'scan: {len(rows)} new candidate(s) added to inbox.md')
    return 0


def show(paths, labels):
    """Print the log line for each label. Read-only; the output goes to the terminal, not to a file."""
    lines = read(paths.log).split('\n')
    rc = 0
    for lab in labels:
        m = LABEL_RE.match(lab)
        text = None
        if m and m.group(1):
            n = int(m.group(1))
            text = lines[n - 1] if 1 <= n <= len(lines) else None
        elif m:
            n = next((i for i, ln in enumerate(lines, 1) if ENTRY_RE.match(ln) and sha(ln)[:12] == m.group(2)), None)
            text = entry_text(lines, n, 'newest-first') if n else None
        if text is None:
            print(f'{lab}: not found')
            rc = 1
        else:
            print(f'{lab}: {text}')
    return rc


def digest(paths, today, hook):
    """Up to three short lines: inbox and pending acks, revisits due, recurring gotchas. Silent when all clear."""
    waiting, oldest = 0, None
    if paths.inbox.exists():
        for line in read(paths.inbox).split('\n'):
            if not line.startswith('|'):
                continue
            cells = table_cells(line)
            if len(cells) >= 7 and re.match(r'^I-\d{4}$', cells[0]) and not cells[5]:
                waiting += 1
                if valid_date(cells[1]) and (oldest is None or cells[1] < oldest):
                    oldest = cells[1]
    pending, due = [], []
    for e in load_entries(paths):
        fm = e['fm'] or {}
        if fm.get('decided_by') == 'claude' and fm.get('user_ack') == 'pending':
            pending.append(fm.get('id', '?'))
        d = valid_date(fm.get('revisit_on', 'none'))
        if d and d <= today and fm.get('status') == 'active':
            due.append(fm.get('id', '?'))
    recurring = []
    for gf in (paths.dec / 'gotchas.md', paths.dec / 'private' / 'gotchas-private.md'):
        if gf.exists():
            for b in parse_gotchas(read(gf)):
                mr = re.match(r'^(\d+)', b['fields'].get('Recurrence', ''))
                if mr and int(mr.group(1)) >= 2 and b['fields'].get('Escalation', 'none').startswith('none'):
                    recurring.append(b['id'])
    lines = []
    parts = []
    if waiting:
        parts.append(f'{waiting} inbox candidate(s) waiting' + (f' (oldest {oldest})' if oldest else ''))
    if pending:
        parts.append(f'{len(pending)} Claude-made decision(s) awaiting acknowledgement')
    if parts:
        lines.append('decisions: ' + '; '.join(parts))
    if due:
        lines.append('decisions: revisits due: ' + ', '.join(sorted(due)))
    if recurring:
        lines.append('decisions: recurring gotchas not escalated: ' + ', '.join(sorted(recurring)))
    if not lines:
        return 0
    text = '\n'.join(lines)
    if hook:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': text}}))
    else:
        print(text)
    return 0


def set_cursor_end(paths, dry):
    lines = read(paths.log).split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    payload = json.dumps(cursor_payload(lines, paths.order)) + '\n'
    if dry:
        print(payload.strip())
    else:
        write(paths, paths.cursor, payload)
        what = 'the last line' if paths.order == 'oldest-first' else 'the newest entry'
        print(f'cursor: set to {what} of {paths.log.name}')
    return 0


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='Decision register helper')
    ap.add_argument('--root', default=str(DEFAULT_ROOT), help='project root (default: two levels above this script)')
    ap.add_argument('--log', default=None, help='log path relative to the root (default docs/wiki/log.md)')
    ap.add_argument('--order', choices=('newest-first', 'oldest-first'), default='newest-first',
                    help='which end of the log gets new entries (default newest-first)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    pl = sub.add_parser('lint')
    pl.add_argument('--strict', action='store_true', help='exit 1 when there are errors')
    pl.add_argument('--today', default=None, help='YYYY-MM-DD, for tests')
    pl.add_argument('--ack-days', type=int, default=7)
    ps = sub.add_parser('scan')
    ps.add_argument('--baseline', action='store_true')
    ps.add_argument('--since', type=int, default=None,
                    help='rescan: from this line (oldest-first) or the newest N entries (newest-first), ignoring the cursor')
    ps.add_argument('--dry-run', action='store_true')
    ps.add_argument('--hook', action='store_true', help='quiet; one systemMessage line only for new rows or a warning')
    pd = sub.add_parser('digest')
    pd.add_argument('--hook', action='store_true', help='SessionStart hook output (JSON additionalContext); silent when all clear')
    pd.add_argument('--today', default=None, help='YYYY-MM-DD, for tests')
    psh = sub.add_parser('show')
    psh.add_argument('labels', nargs='+')
    pc = sub.add_parser('cursor')
    pc.add_argument('--end', action='store_true', required=True)
    pc.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)
    paths = Paths(args.root, args.log, args.order)
    if args.cmd == 'lint':
        today = valid_date(args.today) if args.today else date.today()
        if today is None:
            ap.error('--today must be YYYY-MM-DD')
        return lint(paths, today, args.ack_days, args.strict)
    if args.cmd == 'scan':
        return scan(paths, args.baseline, args.dry_run, args.hook, args.since)
    if args.cmd == 'show':
        return show(paths, args.labels)
    if args.cmd == 'digest':
        today = valid_date(args.today) if args.today else date.today()
        if today is None:
            ap.error('--today must be YYYY-MM-DD')
        return digest(paths, today, args.hook)
    return set_cursor_end(paths, args.dry_run)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as ex:  # a hook must never break a session
        if '--hook' in sys.argv:
            print(json.dumps({'systemMessage': f'decisions.py failed: {ex}'}))
            sys.exit(0)
        print(f'decisions.py: {ex}', file=sys.stderr)
        sys.exit(1)
