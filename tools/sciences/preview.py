"""Preview how the phrase lists sort the downloaded papers into topics.

Usage (from the repository root):
  python3 tools/sciences/preview.py CODES                 summary for these areas (comma-separated area codes)
  python3 tools/sciences/preview.py CODES --topic "Name"  the 40 most-cited papers that land in one topic
  python3 tools/sciences/preview.py CODES --unmatched     well-cited papers from these areas' own journals
                                                         that no topic claims (phrases you may be missing)
  python3 tools/sciences/preview.py CODES --find "words"  where papers whose title contains these words land

Every run reads the current tools/sciences/phr_*.py files, so edit and rerun.
"""
import os
import pickle
import random
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'sciences'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'economics'))
CACHE = os.path.join(ROOT, 'work', 'sciences', 'preview_rows.pkl')


def rows():
    if os.path.exists(CACHE):
        return pickle.load(open(CACHE, 'rb'))
    import sci_build as B
    _, rs, _ = B.prepare(set())
    keep = [dict(id=r['id'], t=r['t'], kw=r.get('kw') or [], ab=(r.get('ab') or '')[:700], tn=r.get('tn') or [],
                 c=r['c'], y=r['y'], j=(r.get('j') or '')[:40], home=r.get('home', ''), src=r.get('src'), _f=r['_f'])
            for r in rs]
    pickle.dump(keep, open(CACHE + '.tmp', 'wb'))
    os.replace(CACHE + '.tmp', CACHE)
    return keep


def main():
    import classify
    import sci_taxonomy as T
    args = sys.argv[1:]
    codes = set(args[0].split(','))
    unknown = codes - set(T.FIELD_OF)
    if unknown:
        sys.exit(f'unknown area codes: {sorted(unknown)}; known: {sorted(T.FIELD_OF)}')
    fields = {T.FIELD_OF[c] for c in codes}
    clf = classify.Classifier(T)
    rs = rows()
    clf.fit(rs)
    homes = {h for h, areas in T.HOME.items() if areas & codes}
    mine = {i for i, (code, _, _) in enumerate(clf.topics) if code in codes}
    hits, unmatched, finds = defaultdict(list), [], []
    want = args[args.index('--find') + 1].lower() if '--find' in args else None
    for r in rs:
        for field, allowed_codes in r['_f'].items():
            if field not in fields:
                continue
            allowed = T.CODES[field] if allowed_codes is None else (allowed_codes & T.CODES[field])
            if not allowed:
                continue
            ti, score, ti2, s2 = clf.score(r, r['home'], None, allowed)
            if want and want in r['t'].lower():
                finds.append((r, ti, score))
            if ti in mine:
                hits[ti].append((r, score))
            elif ti is None and r['home'] in homes and r['c'] >= 30:
                unmatched.append(r)
    name = {i: f'{clf.topics[i][1]} > {clf.topics[i][2]}' for i in range(len(clf.topics))}
    if want:
        for r, ti, score in sorted(finds, key=lambda x: -x[0]['c'])[:40]:
            print(f"{r['c']:>6} {r['y']} {r['t'][:70]:70} -> {name.get(ti, '(no topic)')[:60]} ({score:.1f})")
        return
    if '--topic' in args:
        t = args[args.index('--topic') + 1]
        ti = next((i for i in mine if clf.topics[i][2] == t), None)
        if ti is None:
            sys.exit('no such topic in these areas')
        for r, score in sorted(hits[ti], key=lambda x: -x[0]['c'])[:40]:
            print(f"{r['c']:>6} {r['y']} {score:4.1f} {r['t'][:80]:80} | {r['j'][:28]}")
        return
    if '--unmatched' in args:
        print(len(unmatched), 'well-cited papers from these areas\' journals that no topic claims; the most cited:')
        for r in sorted(unmatched, key=lambda r: -r['c'])[:60]:
            print(f"{r['c']:>6} {r['y']} {r['t'][:90]:90} | {r['j'][:26]}")
        return
    random.seed(1)
    for ti in sorted(mine):
        lst = sorted(hits[ti], key=lambda x: -x[0]['c'])
        print(f"\n## {name[ti]}: {len(lst)} papers" + ('' if lst else '  <-- EMPTY'))
        for r, score in lst[:6]:
            print(f"   {r['c']:>6} {r['y']} {r['t'][:84]}")
        rest = lst[6:]
        for r, score in random.sample(rest, min(4, len(rest))):
            print(f"   {r['c']:>6} {r['y']} {r['t'][:84]}   (random)")


if __name__ == '__main__':
    main()
