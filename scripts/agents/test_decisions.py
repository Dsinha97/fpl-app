"""Tests for scripts/agents/decisions.py. Builds fake roots in a temp dir and never touches the real repo.
Run: python scripts/agents/test_decisions.py   (exit 0 = all pass)
The first half is the ported oldest-first suite (run with --order oldest-first); the second half covers the
newest-first mode FPL uses for docs/wiki/log.md.
"""
import contextlib, io, json, re, shutil, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decisions as D

FAILS = []
INBOX_HEAD = ('# Inbox\n\n| Row | Found | Source | Pattern | Kind | Verdict | Reviewed |\n'
              '|---|---|---|---|---|---|---|\n')


def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def entry(id_, title, links=(), **kw):
    fm = dict(id=id_, title=title, status='active', date='2026-11-01', sprint='swarm', visibility='team',
              decided_by='user', user_ack='accepted', evidence='conversation-record', affects='[]', artifact='[]',
              supersedes='[]', superseded_by='[]', revisit_on='none', revisit_when='none', capture='manual',
              updated='2026-11-14')
    fm.update(kw)
    lines = ['---'] + [f'{k}: {v}' for k, v in fm.items()] + ['---', '> Why: test.', '## Decision', '## Evidence',
                                                                 '- log.md:1', '## Links'] + list(links) + ['']
    return '\n'.join(lines)


def build(root):
    dec = root / 'plans-private' / 'Decisions'
    for d in ('entries', 'private', 'staging', 'tickets'):
        (dec / d).mkdir(parents=True)
    (root / 'docs' / 'wiki').mkdir(parents=True)
    (root / 'docs' / 'wiki' / 'log.md').write_text('2026-11-01 start\n', encoding='utf-8')
    (dec / 'patterns.txt').write_text(
        '# header\ndecision-marker\tDecision \\(\tdecision\nclaude-decision\tDecision \\(Claude\\)\tclaude-decision\n'
        'correction\tCorrection\tgotcha\nfrozen\tfrozen\tdecision\n', encoding='utf-8')
    (dec / 'inbox.md').write_text(INBOX_HEAD, encoding='utf-8', newline='\n')  # LF, as the script writes it
    return dec


def run(args):
    if '--order' not in args:
        args = ['--order', 'oldest-first'] + list(args)
    buf, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
        rc = D.main(args)
    return rc, buf.getvalue(), err.getvalue()


def LOG(root):
    return Path(root) / 'docs' / 'wiki' / 'log.md'


tmp = Path(tempfile.mkdtemp(prefix='dectest_'))
try:
    # ---------- lint: clean root ----------
    root = tmp / 'clean'
    dec = build(root)
    (dec / 'entries' / 'DEC-001-ok.md').write_text(entry('DEC-001', 'Fallback F stands'), encoding='utf-8')
    (dec / 'register.md').write_text(
        '# R\n\n## 1. All\n\n| ID | Date | Status |\n|---|---|---|\n| DEC-001 | 2026-11-01 | active |\n\n'
        '## 2. Claude\n\n| ID |\n|---|\n\n## 3. Gotchas\n\n| G ID |\n|---|\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14'])
    check('lint clean root: 0 errors 0 warnings', '0 errors, 0 warnings' in out, out)

    # ---------- frontmatter parsing ----------
    fm, _ = D.parse_frontmatter(entry('DEC-011', '"Use prompt #2 for pass 2"', revisit_when='none  # trailing comment'))
    check('quoted title keeps " #"', fm['title'] == 'Use prompt #2 for pass 2', fm['title'])
    check('unquoted value drops trailing comment', fm['revisit_when'] == 'none', fm['revisit_when'])
    fm, _ = D.parse_frontmatter(entry('DEC-012', 'x', affects='["root:a.py"]   # note'))
    check('list drops trailing comment', D.parse_list(fm['affects']) == ['root:a.py'], fm['affects'])

    # ---------- lint: bad cases ----------
    root = tmp / 'bad'
    dec = build(root)
    (root / 'plans-private' / 'log.md').write_text('side log\n', encoding='utf-8')
    (dec / 'entries' / 'DEC-001-ok.md').write_text(
        entry('DEC-001', 'Valid one', links=['[project log](../../../docs/wiki/log.md)']), encoding='utf-8')
    (dec / 'entries' / 'DEC-002-badstatus.md').write_text(entry('DEC-002', 'Bad status', status='pending'), encoding='utf-8')
    (dec / 'entries' / 'DEC-003-orphan.md').write_text(
        entry('DEC-003', 'Orphan successor', status='superseded', superseded_by='[DEC-099]'), encoding='utf-8')
    (dec / 'entries' / 'DEC-004-norow.md').write_text(entry('DEC-004', 'No register row'), encoding='utf-8')
    (dec / 'entries' / 'DEC-005-leak.md').write_text(entry('DEC-005', 'Private in tracked folder', visibility='private'), encoding='utf-8')
    (dec / 'private' / 'DEC-007-priv.md').write_text(entry('DEC-007', 'Secret teammate matter', visibility='private'), encoding='utf-8')
    (dec / 'entries' / 'DEC-006-revisit.md').write_text(entry('DEC-006', 'Revisit due', revisit_on='2026-11-01'), encoding='utf-8')
    (dec / 'entries' / 'DEC-008-claude.md').write_text(
        entry('DEC-008', 'Claude chose', decided_by='claude', user_ack='pending', date='2026-11-01'), encoding='utf-8')
    (dec / 'entries' / 'DEC-010-wronglog.md').write_text(
        entry('DEC-010', 'Wrong log link', links=['[log](../../log.md)']), encoding='utf-8')
    (dec / 'register.md').write_text(
        '# R\n\n## 1. All\n\n| ID | Date | Status | Decision |\n|---|---|---|---|\n'
        '| DEC-001 | 2026-11-01 | active | Valid one |\n| DEC-002 | 2026-11-01 | active | x |\n'
        '| DEC-003 | 2026-11-01 | superseded | x |\n| DEC-005 | 2026-11-01 | active | x |\n'
        '| DEC-006 | 2026-11-01 | active | x |\n| DEC-007 | 2026-11-01 | active | Secret teammate matter |\n'
        '| DEC-008 | 2026-11-01 | active | x |\n| DEC-009 | 2026-11-01 | active | ghost row |\n'
        '| DEC-010 | 2026-11-01 | active | x |\n\n'
        '## 2. Claude\n\n| ID |\n|---|\n\n## 3. Gotchas\n\n| G ID |\n|---|\n', encoding='utf-8')
    (dec / 'gotchas.md').write_text('# G\n\n### G-01: Tokens\n- Symptom: x\n- Evidence: hearsay\n- Recurrence: 2 (2026-10-29)\n- Escalation: none\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14'])
    check('bad status caught', 'DEC-002-badstatus.md: status' in out)
    check('orphan successor caught', 'superseded_by DEC-099, which does not exist' in out)
    check('missing register row caught', 'DEC-004 has no row in register.md table 1' in out)
    check('private visibility in entries/ caught', 'visibility private but the file is outside private/' in out)
    check('private title in tracked register caught', 'private entry title appears in the tracked register' in out)
    check('ghost register row caught', 'row DEC-009 has no entry file' in out)
    check('revisit due warned', 'revisit due (2026-11-01)' in out)
    check('claude pending ack warned (13 days)', 'waiting for acknowledgement for 13 days' in out)
    check('claude pending without table 2 row caught', 'DEC-008 is a pending Claude-made decision but has no row' in out)
    check('gotcha missing field caught', "G-01 is missing the field 'Cause'" in out)
    check('gotcha bad evidence caught', "Evidence 'hearsay'" in out)
    check('gotcha recurrence warned', 'G-01 recurred 2 times and is not escalated' in out)
    check('link to a log.md that is not the project log caught', 'DEC-010-wronglog.md: link ../../log.md' in out, out)
    check('link to root log passes', 'DEC-001-ok.md' not in out, out)
    check('lint exits 0 without --strict', rc == 0)
    rc2, _, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14', '--strict'])
    check('lint --strict exits 1 with errors', rc2 == 1)
    check('lint is read-only', not (dec / '.scan-cursor').exists())
    (dec / 'entries' / 'DEC-011-unknown.md').write_text(entry('DEC-011', 'Unknown decider', decided_by='unknown'), encoding='utf-8')
    rc3, out3, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14'])
    check('decided_by unknown raises no decided_by error', 'DEC-011-unknown.md: decided_by' not in out3, out3)
    (dec / 'entries' / 'DEC-012-baddecider.md').write_text(entry('DEC-012', 'Bad decider', decided_by='nobody'), encoding='utf-8')
    rc4, out4, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14'])
    check('decided_by nobody is an error', "DEC-012-baddecider.md: decided_by 'nobody'" in out4, out4)

    # ---------- private stub row with no private file (fresh clone) ----------
    root = tmp / 'clone'
    dec = build(root)
    shutil.rmtree(dec / 'private')
    (dec / 'register.md').write_text(
        '# R\n\n## 1. All\n\n| ID | Date | Status | Decision |\n|---|---|---|---|\n| DEC-010 | 2026-11-02 | active | private |\n\n'
        '## 2. Claude\n\n| ID |\n|---|\n\n## 3. Gotchas\n\n| G ID |\n|---|\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'lint', '--today', '2026-11-14'])
    check('private stub row without private file is not an error', '0 errors' in out, out)

    # ---------- scan ----------
    root = tmp / 'scan'
    dec = build(root)
    log = LOG(root)
    log.write_text('2026-11-01 start\n2026-11-02 Decision (told in session): keep F\n2026-11-03 nothing here\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('scan without cursor refuses', 'no cursor yet' in out and 'I-0' not in (dec / 'inbox.md').read_text(encoding='utf-8'), out)
    rc, out, _ = run(['--root', str(root), 'scan', '--hook'])
    check('scan without cursor is silent in hook mode', out.strip() == '', out)
    rc, out, _ = run(['--root', str(root), 'scan', '--baseline'])
    base = (dec / 'staging' / 'scan-baseline.md').read_text(encoding='utf-8')
    check('baseline lists the marker line', 'log.md:2' in base and 'log.md:3' not in base, base)
    check('baseline copies no log text', 'keep F' not in base, base)
    check('baseline leaves inbox and cursor alone', not (dec / '.scan-cursor').exists() and 'I-0' not in (dec / 'inbox.md').read_text(encoding='utf-8'))
    run(['--root', str(root), 'cursor', '--end'])
    cur = json.loads((dec / '.scan-cursor').read_text(encoding='utf-8'))
    check('cursor --end sets the last line', cur['line'] == 3, str(cur))
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('scan right after cursor adds nothing', 'no new candidates' in out, out)
    with open(log, 'a', encoding='utf-8') as f:
        f.write('2026-11-04 Decision (Claude): used LF\n2026-11-04 Correction: cap was 4000, not 400\n2026-11-04 frozen at 23:59 | pipe test\n')
    rc, out, _ = run(['--root', str(root), 'scan'])
    inbox = (dec / 'inbox.md').read_text(encoding='utf-8')
    check('scan adds 3 rows', out.strip() == 'scan: 3 new candidate(s) added to inbox.md' and inbox.count('| I-000') == 3, out + inbox)
    check('claude-decision kind wins over decision', re.search(r'log\.md:4 \| \S*claude-decision\S* \| claude-decision', inbox) is not None, inbox)
    check('inbox copies no log text', 'used LF' not in inbox and 'pipe test' not in inbox, inbox)
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('second scan adds 0 rows', 'no new candidates' in out and (dec / 'inbox.md').read_text(encoding='utf-8').count('| I-000') == 3, out)

    # a failed inbox write must not move the cursor
    with open(log, 'a', encoding='utf-8') as f:
        f.write('2026-11-05 Decision (user): lock test\n')
    before = (dec / '.scan-cursor').read_text(encoding='utf-8')
    real_append = D.append
    def boom(*a, **k):
        raise OSError('locked')
    D.append = boom
    raised = False
    try:
        run(['--root', str(root), 'scan'])
    except OSError:
        raised = True
    finally:
        D.append = real_append
    check('failed inbox write raises', raised)
    check('failed inbox write leaves the cursor alone', (dec / '.scan-cursor').read_text(encoding='utf-8') == before)
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('the lost-write lines are picked up on the next scan', 'log.md:6' in (dec / 'inbox.md').read_text(encoding='utf-8'), out)

    # dedup reads the Source cell only
    root = tmp / 'dedup'
    dec = build(root)
    log = LOG(root)
    log.write_text('a\nb\nc\nd\ne\n', encoding='utf-8')
    (dec / 'inbox.md').write_text(INBOX_HEAD + '| I-0001 | 2026-11-01 | log.md:2 | frozen | decision | see log.md:5 |  |\n', encoding='utf-8')
    run(['--root', str(root), 'cursor', '--end'])
    with open(log, 'a', encoding='utf-8') as f:
        f.write('Decision (user): new\n')
    rc, out, _ = run(['--root', str(root), 'scan', '--since', '5'])
    check('--since scans from the given line', 'log.md:6' in (dec / 'inbox.md').read_text(encoding='utf-8'), out)
    seen, mx = D.known_sources(D.Paths(root))
    check('dedup reads only the Source cell', seen == {'log.md:2', 'log.md:6'} and mx == 2, f'{seen} {mx}')

    # cursor check and recovery
    root = tmp / 'recover'
    dec = build(root)
    log = LOG(root)
    log.write_text('l1\nl2\nl3 frozen\n', encoding='utf-8')
    run(['--root', str(root), 'cursor', '--end'])
    log.write_text('l1\nl2\nl3 frozen!\nl4 Decision (user): late\n', encoding='utf-8')
    before = (dec / 'inbox.md').read_text(encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('changed cursor line: one warning, 0 rows', 'changed above the cursor' in out and 'scan --since 4' in out
          and (dec / 'inbox.md').read_text(encoding='utf-8') == before, out)
    rc, out, _ = run(['--root', str(root), 'scan', '--hook'])
    check('hook mode turns the warning into a systemMessage', 'changed above the cursor' in json.loads(out.strip())['systemMessage'], out)
    rc, out, _ = run(['--root', str(root), 'scan', '--since', '4'])
    inbox = (dec / 'inbox.md').read_text(encoding='utf-8')
    check('--since recovers the unscanned lines', 'log.md:4' in inbox and 'log.md:3' not in inbox, out + inbox)
    check('--since moves the cursor to the end', json.loads((dec / '.scan-cursor').read_text(encoding='utf-8'))['line'] == 4)
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('after recovery the normal scan works', 'no new candidates' in out, out)
    log.write_text('l1\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'scan'])
    check('shorter log: warning, 0 rows', 'changed above the cursor' in out, out)
    rc, out, _ = run(['--root', str(root), 'scan', '--since', '99'])
    check('--since outside the log is refused', 'outside the log' in out, out)

    # hook mode
    root = tmp / 'hook'
    dec = build(root)
    log = LOG(root)
    log.write_text('start\n', encoding='utf-8')
    run(['--root', str(root), 'cursor', '--end'])
    with open(log, 'a', encoding='utf-8') as f:
        f.write('2026-11-06 Decision (x): one\n')
    rc, out, _ = run(['--root', str(root), 'scan', '--hook'])
    check('hook mode prints a systemMessage for new rows', json.loads(out.strip())['systemMessage'].startswith('decisions: 1 new'), out)
    rc, out, _ = run(['--root', str(root), 'scan', '--hook'])
    check('hook mode silent when nothing new', out.strip() == '', out)

    # allow-list and line endings
    p = D.Paths(root)
    for target, name in ((LOG(root), 'log.md'), (dec / 'register.md', 'register.md')):
        try:
            p.check_write(target)
            check(f'allow-list refuses {name}', False)
        except RuntimeError:
            check(f'allow-list refuses {name}', True)
    check('no CR in written files', b'\r' not in (dec / 'inbox.md').read_bytes())
    check('no temp files left behind', not list(dec.rglob('*.tmp')))

    # ---------- digest ----------
    root = tmp / 'digest'
    dec = build(root)
    (dec / 'inbox.md').write_text(
        INBOX_HEAD + '| I-0001 | 2026-11-10 | log.md:2 | frozen | decision |  |  |\n| I-0002 | 2026-11-12 | log.md:3 | frozen | decision |  |  |\n'
        '| I-0003 | 2026-11-01 | log.md:1 | frozen | decision | reject | 2026-11-02 |\n', encoding='utf-8', newline='\n')
    (dec / 'entries' / 'DEC-001-c.md').write_text(entry('DEC-001', 'Claude chose', decided_by='claude', user_ack='pending'), encoding='utf-8')
    (dec / 'entries' / 'DEC-002-r.md').write_text(entry('DEC-002', 'Revisit now', revisit_on='2026-11-01'), encoding='utf-8')
    (dec / 'entries' / 'DEC-003-n.md').write_text(entry('DEC-003', 'Revisit later', revisit_on='2026-12-01'), encoding='utf-8')
    (dec / 'gotchas.md').write_text('### G-01: x\n- Recurrence: 2 (2026-11-01)\n- Escalation: none\n\n### G-02: y\n- Recurrence: 3 (2026-11-01)\n- Escalation: done\n', encoding='utf-8')
    rc, out, _ = run(['--root', str(root), 'digest', '--today', '2026-11-14'])
    dl = out.strip().split('\n')
    check('digest prints three lines', len(dl) == 3, out)
    check('digest counts waiting rows and the oldest', '2 inbox candidate(s) waiting (oldest 2026-11-10)' in dl[0], out)
    check('digest counts a pending acknowledgement', '1 Claude-made decision(s) awaiting acknowledgement' in dl[0], out)
    check('digest lists only revisits that are due', 'revisits due: DEC-002' in dl[1] and 'DEC-003' not in dl[1], out)
    check('digest lists unescalated recurring gotchas only', 'G-01' in dl[2] and 'G-02' not in dl[2], out)
    rc, out, _ = run(['--root', str(root), 'digest', '--hook', '--today', '2026-11-14'])
    payload = json.loads(out)
    check('digest --hook emits SessionStart additionalContext', payload['hookSpecificOutput']['hookEventName'] == 'SessionStart'
          and 'inbox candidate' in payload['hookSpecificOutput']['additionalContext'], out)
    clean = tmp / 'digest_clean'
    cdec = build(clean)
    rc, out, _ = run(['--root', str(clean), 'digest', '--hook'])
    check('digest is silent when all is clear', out.strip() == '', out)
    check('digest writes nothing', not (cdec / '.scan-cursor').exists() and not list(cdec.rglob('*.tmp')))

    # ---------- newest-first (the mode FPL uses) ----------
    root = tmp / 'newest'
    dec = build(root)
    log = LOG(root)
    HEAD = '# Log\n\nOne line per entry, most recent first.\n\n'
    E3, E2, E1 = '- 2026-11-03 nothing here', '- 2026-11-02 Decision (told in session): keep F', '- 2026-11-01 start'
    log.write_text(HEAD + '\n\n'.join([E3, E2, E1]) + '\n', encoding='utf-8', newline='\r\n')  # CRLF, as FPL's file is
    lab2 = 'log.md@' + D.sha(E2)[:12]
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: scan without a cursor refuses', 'no cursor yet' in out, out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan', '--baseline'])
    base = (dec / 'staging' / 'scan-baseline.md').read_text(encoding='utf-8')
    check('newest-first: baseline lists the marker entry by hash label', lab2 in base and base.count('| log.md@') == 1, base)
    check('newest-first: baseline copies no log text', 'keep F' not in base, base)
    run(['--root', str(root), '--order', 'newest-first', 'cursor', '--end'])
    cur = json.loads((dec / '.scan-cursor').read_text(encoding='utf-8'))
    check('newest-first: cursor --end points at the newest entry', cur['line'] == 5 and cur['sha256'] == D.sha(E3), str(cur))
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: scan right after the cursor adds nothing', 'no new candidates' in out, out)

    N1, N2 = '- 2026-11-05 Decision (Claude): used LF', '- 2026-11-05 Correction: cap was 4000, not 400'
    log.write_text(HEAD + '\n\n'.join([N2, N1, E3, E2, E1]) + '\n', encoding='utf-8', newline='\r\n')
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    inbox = (dec / 'inbox.md').read_text(encoding='utf-8')
    check('newest-first: scan adds the 2 entries above the cursor', out.strip() == 'scan: 2 new candidate(s) added to inbox.md'
          and inbox.count('| I-000') == 2, out + inbox)
    check('newest-first: claude-decision kind wins', re.search(r'log\.md@' + D.sha(N1)[:12] + r' \| \S*claude-decision', inbox) is not None, inbox)
    check('newest-first: old entries are not requeued', lab2 not in inbox, inbox)
    check('newest-first: inbox copies no log text', 'used LF' not in inbox and 'cap was' not in inbox, inbox)
    cur = json.loads((dec / '.scan-cursor').read_text(encoding='utf-8'))
    check('newest-first: cursor moved to the new top entry', cur['sha256'] == D.sha(N2), str(cur))
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: second scan adds 0 rows', 'no new candidates' in out and inbox.count('| I-000') == 2, out)

    # labels stay valid when more entries are added on top (line numbers would not)
    N3 = '- 2026-11-06 frozen the model at v1.7.1'
    log.write_text(HEAD + '\n\n'.join([N3, N2, N1, E3, E2, E1]) + '\n', encoding='utf-8', newline='\r\n')
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: a later scan picks up only the new top entry', 'added to inbox.md' in out and '1 new' in out, out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'show', lab2, 'log.md@000000000000'])
    check('show prints the entry for a label and reports an unknown one', E2 in out and 'log.md@000000000000: not found' in out and rc == 1, out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'show', 'log.md:5'])
    check('show also reads a line-number label', N3 in out and rc == 0, out)
    seen, mx = D.known_sources(D.Paths(root))
    check('newest-first: dedup reads hash labels from the Source cell', 'log.md@' + D.sha(N1)[:12] in seen and mx == 3, f'{seen} {mx}')

    # an edited cursor entry: warn, queue nothing, recover with --since
    before = (dec / 'inbox.md').read_text(encoding='utf-8')
    log.write_text(HEAD + '\n\n'.join(['- 2026-11-07 Decision (user): late', N3 + ' (edited)', N2, N1, E3, E2, E1]) + '\n',
                   encoding='utf-8', newline='\r\n')
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: edited cursor entry gives a warning and 0 rows', 'gone or was edited' in out
          and (dec / 'inbox.md').read_text(encoding='utf-8') == before, out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan', '--hook'])
    check('newest-first: the warning becomes a systemMessage in hook mode', 'gone or was edited' in json.loads(out.strip())['systemMessage'], out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan', '--since', '2'])
    inbox = (dec / 'inbox.md').read_text(encoding='utf-8')
    check('newest-first: --since 2 rescans the newest 2 entries and queues the new one',
          'log.md@' + D.sha('- 2026-11-07 Decision (user): late')[:12] in inbox, out + inbox)
    check('newest-first: --since skips entries already queued', inbox.count('log.md@' + D.sha(N3)[:12]) == 1, inbox)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan'])
    check('newest-first: after recovery the normal scan works', 'no new candidates' in out, out)
    rc, out, _ = run(['--root', str(root), '--order', 'newest-first', 'scan', '--since', '99'])
    check('newest-first: --since beyond the entry count is refused', 'outside the log' in out, out)
    check('newest-first: written files have no CR', b'\r' not in (dec / 'inbox.md').read_bytes()
          and b'\r' not in (dec / '.scan-cursor').read_bytes())

    # multi-line entries: the pattern is matched against the whole entry, the label is the first line's hash
    root = tmp / 'multiline'
    dec = build(root)
    log = LOG(root)
    M1 = '- 2026-11-02 Landed the price gate.'
    M1_CONT = ['  The owner decided to keep the 0.3 margin.', '  Second continuation line.']
    M2 = '- 2026-11-01 start'
    NF = ['--root', str(root), '--order', 'newest-first']
    log.write_text(HEAD + M1 + '\n' + '\n'.join(M1_CONT) + '\n\n' + M2 + '\n', encoding='utf-8', newline='\r\n')
    (dec / 'patterns.txt').write_text('# header\ndecided\t\\bdecid\tdecision\n', encoding='utf-8')
    run(NF + ['scan', '--baseline'])
    base = (dec / 'staging' / 'scan-baseline.md').read_text(encoding='utf-8')
    check('multi-line: a marker on a continuation line is found', 'log.md@' + D.sha(M1)[:12] in base, base)
    check('multi-line: the plain start entry is not', 'log.md@' + D.sha(M2)[:12] not in base, base)
    rc, out, _ = run(NF + ['show', 'log.md@' + D.sha(M1)[:12]])
    check('multi-line: show prints the first line and its continuation', M1 in out and 'keep the 0.3 margin' in out
          and 'Second continuation line.' in out and M2 not in out, out)
    run(NF + ['cursor', '--end'])
    log.write_text(HEAD + '- 2026-11-03 A new entry\n  that mentions we decided something.\n\n' + M1 + '\n' + '\n'.join(M1_CONT)
                   + '\n\n' + M2 + '\n', encoding='utf-8', newline='\r\n')
    rc, out, _ = run(NF + ['scan'])
    check('multi-line: only the new entry is scanned, its continuation counted', '1 new' in out, out)

    # defaults: newest-first and docs/wiki/log.md
    p = D.Paths(root)
    check('defaults: newest-first, docs/wiki/log.md, plans-private/Decisions',
          p.order == 'newest-first' and p.log == (root / 'docs' / 'wiki' / 'log.md').resolve()
          and p.dec == (root / 'plans-private' / 'Decisions').resolve(), f'{p.order} {p.log} {p.dec}')
    try:
        p.check_write(LOG(root))
        refused = False
    except RuntimeError:
        refused = True
    check('allow-list refuses the log in newest-first mode too', refused)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print('\nFAILED:', FAILS if FAILS else 'none')
sys.exit(1 if FAILS else 0)
