#!/usr/bin/env python3
"""Copy the changes saved on the site into data/library.json and data/progress.json.

The site posts each change to a public channel on ntfy.sh (no account needed). This script reads
every change still on the channel (it keeps them 12 hours), checks each one, and applies it to the
two files with the same rule the site uses: for each paper, the version changed last wins. Applying
a change twice does nothing, so the script can run as often as you like.

Run by .github/workflows/save.yml every 10 minutes. Usage:
    python3 tools/save_sync.py [MESSAGE_FILE]
MESSAGE_FILE, if given, receives a commit message listing what changed.
Environment: PA_CHANNEL (default: the site's channel), PA_ROOT (default: this repo).
"""
import json
import os
import re
import sys
import time
import urllib.request

CHANNEL = os.environ.get('PA_CHANNEL', 'paper-archive-sync-q7v3k9x2m4')   # the same name as CHANNEL in app.js
ROOT = os.environ.get('PA_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FILES = {'library': 'data/library.json', 'progress': 'data/progress.json'}
MAX_CARDS = 10
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
STEP = re.compile(r'^[a-z]{2}$')
KEY = re.compile(r'^[a-zA-Z]{1,24}$')
URL_KEYS = {'link', 'research', 'learn', 'deck', 'pdf'}


def is_obj(x):
    return isinstance(x, dict)


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def newer(a, b):
    if not a:
        return b
    if not b:
        return a
    return b if (b.get('u') or 0) > (a.get('u') or 0) else a


def future(e):
    # A change dated in the future would outrank every later edit, so it is ignored.
    return num(e.get('u')) and e['u'] > time.time() * 1000 + 86400000


def clean_entry(e):
    if not is_obj(e) or future(e):
        return None
    out = {}
    for k, v in e.items():
        if k == 'u':
            if num(v):
                out['u'] = v
        elif STEP.match(k) and isinstance(v, str) and DAY.match(v):
            out[k] = v
    return out


def clean_paper(e):
    if not is_obj(e) or future(e):
        return None
    out = {}
    for k, v in e.items():
        if not KEY.match(k):
            continue
        if k == 'cards':
            if isinstance(v, list):
                out['cards'] = [{'q': str(c.get('q') or '')[:400], 'a': str(c.get('a') or '')[:600]}
                                for c in v if is_obj(c)][:MAX_CARDS]
        elif k in URL_KEYS:
            if isinstance(v, str) and (not v or re.match(r'^https?://', v, re.I)):
                out[k] = v[:2000]
        elif isinstance(v, str):
            out[k] = v[:5000]
        elif num(v) or isinstance(v, bool):
            out[k] = v
    return out


def clean_setting(e):
    if not is_obj(e) or future(e):
        return None
    return {k: v for k, v in e.items() if KEY.match(k) and (num(v) or (isinstance(v, str) and len(v) <= 300))}


def apply_delta(lib, prog, d):
    if not is_obj(d):
        return
    for pid, e in (d.get('p') or {}).items() if is_obj(d.get('p')) else []:
        c = clean_entry(e)
        if c is not None and len(pid) <= 64:
            prog['p'][pid] = newer(prog['p'].get(pid), c)
    for pid, e in (d.get('e') or {}).items() if is_obj(d.get('e')) else []:
        c = clean_paper(e)
        if c is not None and len(pid) <= 64:
            lib['edits'][pid] = newer(lib['edits'].get(pid), c)
    for e in d.get('a') or [] if isinstance(d.get('a'), list) else []:
        c = clean_paper(e)
        if not c or not isinstance(c.get('id'), str) or len(c['id']) > 64 or not c.get('t'):
            continue
        for i, x in enumerate(lib['added']):
            if x.get('id') == c['id']:
                lib['added'][i] = newer(x, c)
                break
        else:
            lib['added'].append(c)
    for k in ('removed', 'fields', 'areas', 'topics'):
        if isinstance(d.get(k), list):
            lib.setdefault(k, [])
            for x in d[k]:
                if isinstance(x, str) and len(x) <= 300 and x not in lib[k]:
                    lib[k].append(x)
    if lib['removed']:
        gone = set(lib['removed'])
        lib['added'] = [x for x in lib['added'] if x.get('id') not in gone]
    for k in ('goals', 'focus'):
        c = clean_setting(d.get(k))
        if c:
            v = newer(lib.get(k), c)
            if v:
                lib[k] = v


def read_channel():
    url = f'https://ntfy.sh/{CHANNEL}/json?poll=1&since=all'
    req = urllib.request.Request(url, headers={'User-Agent': 'paper-archive-save'})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode('utf-8')
    parts, out = {}, []
    for line in text.splitlines():
        try:
            m = json.loads(line)
            d = json.loads(m['message'])
        except (ValueError, KeyError, TypeError):
            continue
        if m.get('event') != 'message' or not is_obj(d) or d.get('pa') != 1:
            continue
        if isinstance(d.get('c'), str):
            n, i, s = d.get('n'), d.get('i'), d.get('s')
            if not (num(n) and num(i) and 0 < n <= 200 and 0 <= i < n and isinstance(s, str)):
                continue
            g = parts.setdefault(d['c'], {'n': int(n), 's': {}, 't': m.get('time', 0)})
            g['s'][int(i)] = s
            if len(g['s']) == g['n']:
                try:
                    out.append((g['t'], json.loads(''.join(g['s'][k] for k in range(g['n'])))))
                except ValueError:
                    pass
                del parts[d['c']]
        else:
            out.append((m.get('time', 0), d))
    out.sort(key=lambda x: x[0])
    return [d for _, d in out]


def load(path, empty):
    try:
        with open(os.path.join(ROOT, path), encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {}
    for k, v in empty.items():
        data.setdefault(k, v)
    return data


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + '\n'


def main():
    lib = load(FILES['library'], {'v': 1, 'fields': [], 'areas': [], 'topics': [], 'added': [], 'edits': {}, 'removed': []})
    prog = load(FILES['progress'], {'v': 1, 'p': {}})
    before = {k: dump(x) for k, x in (('library', lib), ('progress', prog))}
    changes = read_channel()
    messages = []
    state = dump([lib, prog])
    for d in changes:
        apply_delta(lib, prog, d)
        now = dump([lib, prog])
        if now != state and isinstance(d.get('m'), list):   # only changes not already in the files
            messages += [str(x)[:200] for x in d['m'] if isinstance(x, str)]
        state = now
    after = {'library': dump(lib), 'progress': dump(prog)}
    changed = [k for k in after if after[k] != before[k]]
    for k in changed:
        with open(os.path.join(ROOT, FILES[k]), 'w', encoding='utf-8') as f:
            f.write(after[k])
    print(f'{len(changes)} changes on the channel; updated: {", ".join(changed) or "nothing"}')
    if len(sys.argv) > 1 and changed:
        uniq = list(dict.fromkeys(messages))
        if len(uniq) == 1:
            msg = uniq[0]
        else:
            msg = f'Save progress ({len(uniq)} changes)' if uniq else 'Save progress'
            if uniq:
                msg += '\n\n' + '\n'.join('- ' + x for x in uniq[:60])
        with open(sys.argv[1], 'w', encoding='utf-8') as f:
            f.write(msg + '\n')


if __name__ == '__main__':
    main()
