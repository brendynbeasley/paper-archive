"""Apply topic corrections (work/sciences/review_*.json, made while reading topic_dump.py output) to
tools/sciences/fixes.json and not_papers.json.
Each review file: {"moves": {id: "Area > Topic"}, "drop": [ids that are not papers], "not_in_field": {id: field}}."""
import glob, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'sciences'))
import skeleton
names = set(skeleton.topic_strings())
fp, npp = os.path.join(ROOT, 'tools', 'sciences', 'fixes.json'), os.path.join(ROOT, 'tools', 'sciences', 'not_papers.json')
fixes = json.load(open(fp, encoding='utf-8')) if os.path.exists(fp) else {}
drops = set(json.load(open(npp))) if os.path.exists(npp) else set()
n = {'moves': 0, 'drop': 0, 'not_in_field': 0, 'bad': 0}
for f in sorted(glob.glob(os.path.join(ROOT, 'work', 'sciences', 'review_*.json'))):
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
        if pid.startswith('W'):
            drops.add(pid); n['drop'] += 1
    for pid, field in (r.get('not_in_field') or {}).items():
        if field in skeleton.FIELDS and pid.startswith('W'):
            e = fixes.setdefault(pid, {})
            e['not'] = sorted(set(e.get('not', [])) | {field}); n['not_in_field'] += 1
json.dump(fixes, open(fp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
json.dump(sorted(drops), open(npp, 'w'), indent=0)
print(n, '->', len(fixes), 'fixes,', len(drops), 'non-papers')
