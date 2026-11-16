"""List the most-cited papers of the journals in sci_sources.py from OpenAlex (catalogue data only).

Usage: python3 tools/sciences/sci_fetch.py            (resumes; safe to stop and rerun)

Each request asks for 200 works, most cited first, and the answer is kept in
work/sciences/corpus/ (not committed): title, authors, year, journal, DOI, citation count,
plus the keywords, topics and abstract used to sort the work into a topic. Nothing here
writes to the site; tools/sciences/sci_build.py turns the corpus into data/sciences.json.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'economics'))
import fetch as efetch  # noqa: E402  (the economics downloader: request pacing and the daily allowance)
import sci_sources as J  # noqa: E402

WORK = os.path.join(ROOT, 'work', 'sciences')
CORPUS = os.path.join(WORK, 'corpus')
SOURCES = os.path.join(WORK, 'sources.json')
SELECT = efetch.SELECT


def resolve():
    """OpenAlex source ids for the journals given by ISSN (looked up once, then cached)."""
    cache = json.load(open(SOURCES)) if os.path.exists(SOURCES) else {}
    issns = sorted({k for k, *_ in J.SOURCES if not k.startswith('S')} |
                   {k for g in J.GROUPS for k in g[1] if not k.startswith('S')})
    todo = [i for i in issns if i not in cache]
    for k in range(0, len(todo), 50):
        d = efetch.get('sources', {'filter': 'issn:' + '|'.join(todo[k:k + 50]), 'per-page': 200,
                                   'select': 'id,display_name,issn,works_count'})
        found = {}
        for s in (d or {}).get('results', []):
            for i in s.get('issn') or []:
                found.setdefault(i, []).append(s)
        for i in todo[k:k + 50]:
            hits = sorted(found.get(i, []), key=lambda s: -(s.get('works_count') or 0))
            cache[i] = hits[0]['id'].rsplit('/', 1)[1] if hits else None
    json.dump(cache, open(SOURCES, 'w'), indent=1)
    missing = [i for i in issns if not cache.get(i)]
    if missing:
        print('  no OpenAlex source for:', ', '.join(missing))
    return cache


def sid(key, cache):
    return key if key.startswith('S') else cache.get(key)


def jobs(cache):
    """(file name, filter, page, fields, home, journal name or '') for every request."""
    out = []
    for key, name, fields, tier, home in J.SOURCES:
        s = sid(key, cache)
        if not s:
            continue
        top, recent, alt = J.TIERS[tier]
        base = f'primary_location.source.id:{s}'
        out += [(f'{s}_all_{p}', base, p, fields, home, name) for p in range(1, top + 1)]
        out += [(f'{s}_new_{p}', f'{base},publication_year:>{J.RECENT_FROM - 1}', p, fields, home, name)
                for p in range(1, recent + 1)]
        out += [(f'{s}_alt_{p}', f'locations.source.id:{s},primary_location.source.id:!{s}', p, fields, home, name)
                for p in range(1, alt + 1)]
    for gi, (gname, keys, fields, flt, pages, home) in enumerate(J.GROUPS):
        ids = [sid(k, cache) for k in keys]
        base = 'primary_location.source.id:' + '|'.join(i for i in ids if i) + ',' + flt
        out += [(f'group{gi}_{p}', base, p, fields, home, '') for p in range(1, pages + 1)]
    for name, flt, pages, fields in J.SEARCHES:
        out += [(f'search_{name}_{p}', flt, p, fields, '', '') for p in range(1, pages + 1)]
    for name, flt, pages, fields in J.POOLS:
        out += [(f'pool_{name}_{p}', flt, p, fields, '', '') for p in range(1, pages + 1)]
    return out


def slim(w, fields, home, journal, alt_of=None):
    loc = w.get('primary_location') or {}
    src = loc.get('source') or {}
    r = efetch.slim(w, {'sid': (src.get('id') or '').rsplit('/', 1)[-1], 'name': journal or src.get('display_name') or ''},
                    alt=bool(alt_of))
    if alt_of:                                   # filed elsewhere: the journal it was asked for is the one that counts
        r['src'] = alt_of
    r['tn'] = [t.get('display_name') or '' for t in w.get('topics') or []]
    r['fs'] = fields
    r['home'] = home
    return r


def run(job):
    name, flt, page, fields, home, journal = job
    path = os.path.join(CORPUS, name + '.jsonl')
    if os.path.exists(path) or efetch.state['stop']:
        return 0
    alt = '_alt_' in name
    d = efetch.get('works', {'filter': flt, 'sort': 'cited_by_count:desc', 'per-page': 200, 'page': page,
                             'select': SELECT + (',locations' if alt else '')})
    if d is None:
        return 0
    alt_of = name.split('_')[0] if alt else None
    rows = [slim(w, fields, home, journal, alt_of) for w in d.get('results', [])]
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(path + '.tmp', path)
    return len(rows)


def main():
    os.makedirs(CORPUS, exist_ok=True)
    cache = resolve()
    todo = [j for j in jobs(cache) if not os.path.exists(os.path.join(CORPUS, j[0] + '.jsonl'))]
    print(f'{len(jobs(cache))} requests in all, {len(todo)} still to do; {efetch.state["remaining"]} left today', flush=True)
    got = done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for n in ex.map(run, todo):
            got += n
            done += 1
            if done % 50 == 0:
                print(f'  {done}/{len(todo)} requests, {got:,} works, {efetch.state["remaining"]} requests left today', flush=True)
    left = [j for j in jobs(cache) if not os.path.exists(os.path.join(CORPUS, j[0] + '.jsonl'))]
    print(f'finished: {got:,} works this run; {len(left)} requests not done', flush=True)


if __name__ == '__main__':
    main()
