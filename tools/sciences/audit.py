"""Site-wide check before publishing: every paper id that is live now is still defined after the
rebuild (in catalog.json, economics.json or sciences.json), ids are defined once, and every
pointer names a defined id."""
import json
import os
import subprocess
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def committed(path):
    try:
        return json.loads(subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:' + path], capture_output=True,
                                         check=True).stdout.decode('utf-8'))
    except Exception:
        return {}


def rows(d):
    return [p for t in d.get('topics', []) for p in t['p']]


cat_ids = {p['id'] for p in json.load(open(os.path.join(ROOT, 'data', 'catalog.json')))['papers']}
old_eco, new_eco = committed('data/economics.json'), json.load(open(os.path.join(ROOT, 'data', 'economics.json')))
old_sci = committed('data/sciences.json')
new_sci = json.load(open(os.path.join(ROOT, 'data', 'sciences.json'))) if os.path.exists(os.path.join(ROOT, 'data', 'sciences.json')) else {}
before = {p[0] for p in rows(old_eco) + rows(old_sci) if isinstance(p, list)}
defined = Counter(p[0] for p in rows(new_eco) + rows(new_sci) if isinstance(p, list))
after = set(defined) | cat_ids
dropped = set(json.load(open(os.path.join(ROOT, 'tools', 'economics', 'not_papers.json'))))
sp = os.path.join(ROOT, 'tools', 'sciences', 'not_papers.json')
if os.path.exists(sp):
    dropped |= set(json.load(open(sp)))
lost = before - after
print(f'live ids before: {len(before):,}; defined after: {len(after):,}')
print(f'lost: {len(lost)} (marked as not papers: {len(lost & dropped)}; other: {sorted(lost - dropped)[:20]})')
print('ids defined twice:', [k for k, v in defined.items() if v > 1][:20], '| also in catalog.json:', sorted(set(defined) & cat_ids)[:10])
pointers = [p for p in rows(new_eco) + rows(new_sci) if isinstance(p, str)]
print(f'pointers: {len(pointers):,}; naming no defined id: {[p for p in pointers if p not in after][:20]}')
