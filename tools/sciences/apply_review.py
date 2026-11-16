"""Apply topic corrections to tools/sciences/fixes.json and not_papers.json.

Usage: python3 tools/sciences/apply_review.py [REVIEW.json ...]   (default: work/sciences/review_*.json)
Each review file: {"moves": {id: "Area > Topic"}, "drop": [ids that are not papers], "not_in_field": {id: field}}.
A paper on the live site (in the committed data files) is never dropped this way."""
import glob, json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'sciences'))
import skeleton
names = set(skeleton.topic_strings())
fp, npp = os.path.join(ROOT, 'tools', 'sciences', 'fixes.json'), os.path.join(ROOT, 'tools', 'sciences', 'not_papers.json')
fixes = json.load(open(fp, encoding='utf-8')) if os.path.exists(fp) else {}
live = set()
for path in ('data/economics.json', 'data/sciences.json'):
    try:
        d = json.loads(subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:' + path], capture_output=True, check=True).stdout)
        live |= {p[0] for t in d.get('topics', []) for p in t['p'] if isinstance(p, list)}
    except Exception:
        pass
drops = set(json.load(open(npp))) if os.path.exists(npp) else set()
n = {'moves': 0, 'drop': 0, 'not_in_field': 0, 'bad': 0, 'kept (live)': 0}
for f in sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, 'work', 'sciences', 'review_*.json'))):
    try:
        r = json.load(open(f, encoding='utf-8'))
    except Exception as e:
        print('unreadable', f, e); continue
    for pid, tp in (r.get('moves') or {}).items():
        if tp in names and pid.startswith('W'):
            fixes.setdefault(pid, {})['tp'] = tp; n['moves'] += 1
        else:
            n['bad'] += 1
    for pid in r.get('drop') or []:
        if pid in live:
            n['kept (live)'] += 1
        elif pid.startswith('W'):
            drops.add(pid); n['drop'] += 1
    for pid, field in (r.get('not_in_field') or {}).items():
        if field in skeleton.FIELDS and pid.startswith('W'):
            e = fixes.setdefault(pid, {})
            e['not'] = sorted(set(e.get('not', [])) | {field}); n['not_in_field'] += 1
json.dump(fixes, open(fp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
json.dump(sorted(drops), open(npp, 'w'), indent=0)
print(n, '->', len(fixes), 'fixes,', len(drops), 'non-papers')
