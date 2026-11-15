"""Print topics from data/economics.json. Usage: view.py 'substr|substr' [top] [random]"""
import json, sys, random
D = json.load(open('../../data/economics.json'))
CAT = {p['id']: p for p in json.load(open('../../data/catalog.json'))['papers']}
CAT.update({p[0]: {'y': p[3], 'a': p[2], 't': p[1]} for t in D['topics'] for p in t['p'] if not isinstance(p, str)})   # a pointer may also name a row here
def show(sub, top=10, rnd=5):
    random.seed(3)
    for t in D['topics']:
        if sub.lower() in t['tp'].lower() or sub.lower() == t['ar'].lower():
            P = t['p']
            print(f"\n### {t['ar']} > {t['tp']}  [{len(P)}; {sum(1 for p in P if isinstance(p, str))} existing]")
            pick = list(enumerate(P[:top])) + sorted(random.sample(list(enumerate(P))[top:], min(rnd, max(0, len(P) - top))))
            for i, p in pick:
                if isinstance(p, str):
                    c = CAT[p]; print(f"  {i+1:3} [listed elsewhere: {p}] {c['y']} {c['a'][:26]:26} {c['t'][:70]}")
                else:
                    print(f"  {i+1:3} {'★'*p[7]:2} {p[6]:6} {p[3]} {p[2][:26]:26} {p[1][:72]}")
for s in sys.argv[1].split('|'):
    show(s, *(int(x) for x in sys.argv[2:4]))
