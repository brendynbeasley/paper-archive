"""Apply topic corrections for economics to tools/economics/fixes.json and not_papers.json.

Usage: python3 tools/economics/apply_review.py REVIEW.json [REVIEW.json ...]

Each review file: {"moves": {id: "Area > Topic"}, "not_economics": [ids], "drop": [ids]}.
  moves          the paper is listed under that topic instead ("tp" in fixes.json)
  not_economics  the paper is not listed at all ("tp": "" in fixes.json)
  drop           the record is not a paper (not_papers.json)
A paper that is on the live site (in the committed data files) is never removed this way, so no
tick can lose its paper; moves apply to it as usual.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def committed_ids():
    ids = set()
    for path in ('data/economics.json', 'data/sciences.json'):
        try:
            d = json.loads(subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:' + path], capture_output=True,
                                          check=True).stdout.decode('utf-8'))
        except Exception:
            continue
        ids |= {p[0] for t in d.get('topics', []) for p in t['p'] if isinstance(p, list)}
    return ids


def main(files):
    eco = json.load(open(os.path.join(ROOT, 'data', 'economics.json'), encoding='utf-8'))
    topics = {f"{t['ar']} > {t['tp']}" for t in eco['topics']}
    live = committed_ids()
    fp, npp = os.path.join(HERE, 'fixes.json'), os.path.join(HERE, 'not_papers.json')
    fixes = json.load(open(fp, encoding='utf-8'))
    drops = set(json.load(open(npp)))
    n = {'moves': 0, 'not_economics': 0, 'drop': 0, 'kept (live)': 0, 'bad': 0}
    for f in files:
        r = json.load(open(f, encoding='utf-8'))
        for pid, tp in (r.get('moves') or {}).items():
            if tp in topics and pid.startswith('W'):
                fixes.setdefault(pid, {})['tp'] = tp
                n['moves'] += 1
            else:
                n['bad'] += 1
        for pid in r.get('not_economics') or []:
            if pid in live:
                n['kept (live)'] += 1
            elif pid.startswith('W'):
                fixes.setdefault(pid, {})['tp'] = ''
                n['not_economics'] += 1
        for pid in r.get('drop') or []:
            if pid in live:
                n['kept (live)'] += 1
            elif pid.startswith('W'):
                drops.add(pid)
                n['drop'] += 1
    json.dump(fixes, open(fp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    json.dump(sorted(drops), open(npp, 'w'), indent=0)
    print(n, '->', len(fixes), 'fixes,', len(drops), 'non-papers')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
