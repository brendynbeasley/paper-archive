"""Download the most-cited papers of each journal in journals.py from OpenAlex.

Usage: python3 tools/economics/fetch.py            (resumes; safe to stop and rerun)

OpenAlex (https://openalex.org) is a free, public index of scholarly works. Without an
account it allows about 1,000 list requests a day per network, so this script asks for
200 papers at a time, most cited first, and keeps what it gets in work/economics/corpus/
(not committed). Each line of those files is one paper: title, authors, year, journal,
DOI, citation count, plus the keywords and abstract used to sort it into a topic.

A second, smaller pull per journal ("alt") asks for papers that have a copy in the journal
but that OpenAlex files somewhere else first: a working-paper series, a repository, a later
reprint in a book. Many classics are recorded that way (Coase 1960 sits under a reprint in
an anthology), and the first pull misses them.

Nothing here writes to the site. tools/economics/build.py turns the corpus into
data/economics.json.
"""
import json, os, sys, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from journals import JOURNALS, HANDBOOKS  # noqa: E402

WORK = os.path.join(ROOT, 'work', 'economics')
CORPUS = os.path.join(WORK, 'corpus')
SOURCES = os.path.join(WORK, 'sources.json')
UA = 'bibliography-builder/1.0'
API = 'https://api.openalex.org'
SELECT = ('id,doi,title,publication_year,type,cited_by_count,authorships,primary_location,biblio,'
          'primary_topic,topics,keywords,abstract_inverted_index,language,is_paratext,is_retracted,open_access')
RECENT_FROM = 2012          # second pull per leading journal: most cited since this year
RESERVE = 40                # stop when this few requests are left in today's allowance
GAP = 0.17                  # seconds between requests (the limit is 10 a second)

lock = threading.Lock()
state = {'remaining': None, 'calls': 0, 'stop': False}


def pace():
    """OpenAlex also allows only 10 requests a second: leave a gap between any two."""
    with lock:
        wait = state.get('next', 0) - time.time()
        state['next'] = max(time.time(), state.get('next', 0)) + GAP
    if wait > 0:
        time.sleep(wait)


def get(path, params):
    url = f'{API}/{path}?' + urllib.parse.urlencode(params)
    for attempt in range(6):
        if state['stop']:
            return None
        pace()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                left = r.headers.get('x-ratelimit-remaining')
                data = json.load(r)
            with lock:
                state['calls'] += 1
                if left is not None:
                    state['remaining'] = int(float(left))
                    if state['remaining'] <= RESERVE:
                        state['stop'] = True
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                body = e.read().decode('utf-8', 'replace')[:300]
                if 'per second' in body.lower():           # too fast, not out of allowance
                    time.sleep(1.5)
                    continue
                if 'budget' in body.lower() or 'credit' in body.lower() or 'limit' in body.lower():
                    print('  allowance used up for today:', body, flush=True)
                    state['stop'] = True
                    return None
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return None


def resolve_sources():
    """Look up each ISSN once and remember its OpenAlex source id."""
    if os.path.exists(SOURCES):
        return json.load(open(SOURCES))
    items = [(i, n, t, a) for i, n, t, a in JOURNALS] + [(i, n, 4, a) for i, n, a in HANDBOOKS]
    found = {}
    for k in range(0, len(items), 50):
        d = get('sources', {'filter': 'issn:' + '|'.join(c[0] for c in items[k:k + 50]), 'per-page': 200,
                            'select': 'id,display_name,issn,works_count'})
        for s in (d or {}).get('results', []):
            for issn in s.get('issn') or []:
                found.setdefault(issn, []).append(s)
    out = []
    for issn, name, tier, area in items:
        hits = sorted(found.get(issn, []), key=lambda s: -s['works_count'])
        if not hits:
            print('  no source for', issn, name)
            continue
        out.append({'issn': issn, 'name': name, 'tier': tier, 'area': area,
                    'sid': hits[0]['id'].rsplit('/', 1)[1], 'works': hits[0]['works_count']})
    json.dump(out, open(SOURCES, 'w'), indent=1)
    return out


def abstract_text(inv, limit=1800):
    if not inv:
        return ''
    words = []
    for w, pos in inv.items():
        for p in pos:
            words.append((p, w))
    words.sort()
    return ' '.join(w for _, w in words)[:limit]


def slim(w, src, alt=False):
    loc = w.get('primary_location') or {}
    b = w.get('biblio') or {}
    extra = {}
    if alt:                 # filed elsewhere: remember where, and where the journal's own copy lives
        mine = [l.get('landing_page_url') or '' for l in w.get('locations') or []
                if ((l.get('source') or {}).get('id') or '').endswith('/' + src['sid'])]
        psrc = loc.get('source') or {}
        extra = {'alt': 1, 'jurls': [u for u in mine if u], 'psrc': psrc.get('display_name') or '',
                 'ptype': psrc.get('type') or ''}
    return dict(extra, **{
        'id': w['id'].rsplit('/', 1)[1],
        'doi': (w.get('doi') or '').replace('https://doi.org/', ''),
        't': w.get('title') or '',
        'y': w.get('publication_year'),
        'type': w.get('type'),
        'c': w.get('cited_by_count') or 0,
        'au': [(a.get('raw_author_name') or '', (a.get('author') or {}).get('display_name') or '') for a in w.get('authorships') or []],
        'src': src['sid'],
        'j': src['name'] if alt else ((loc.get('source') or {}).get('display_name')) or src['name'],
        'vol': b.get('volume'), 'iss': b.get('issue'), 'fp': b.get('first_page'), 'lp': b.get('last_page'),
        'url': loc.get('landing_page_url') or '',
        'oa': (w.get('open_access') or {}).get('oa_url') or '',
        'pt': ((w.get('primary_topic') or {}).get('id') or '').rsplit('/', 1)[-1],
        'tops': [(t['id'].rsplit('/', 1)[1], round(t.get('score') or 0, 3)) for t in w.get('topics') or []],
        'kw': [k['display_name'] for k in w.get('keywords') or []],
        'ab': abstract_text(w.get('abstract_inverted_index')),
        'lang': w.get('language'),
        'para': bool(w.get('is_paratext')), 'retr': bool(w.get('is_retracted')),
    })


def jobs_for(src):
    """(file name, filter, page) for every request this source needs."""
    tier, works = src['tier'], src['works']
    pages = {1: 10, 2: 4, 3: 2 if works > 2500 else 1, 4: 1}[tier]
    recent = {1: 2, 2: 1, 3: 0, 4: 0}[tier]
    base = f"primary_location.source.id:{src['sid']}"
    out = [(f"{src['sid']}_all_{p}", base, p) for p in range(1, pages + 1)]
    out += [(f"{src['sid']}_new_{p}", f"{base},publication_year:>{RECENT_FROM - 1}", p) for p in range(1, recent + 1)]
    elsewhere = f"locations.source.id:{src['sid']},primary_location.source.id:!{src['sid']}"
    out += [(f"{src['sid']}_alt_{p}", elsewhere, p) for p in range(1, (2 if tier == 1 else 1) + 1)]
    return out


def run(job):
    name, flt, page, src = job
    path = os.path.join(CORPUS, name + '.jsonl')
    if os.path.exists(path) or state['stop']:
        return 0
    alt = '_alt_' in name
    d = get('works', {'filter': flt, 'sort': 'cited_by_count:desc', 'per-page': 200, 'page': page,
                      'select': SELECT + (',locations' if alt else '')})
    if d is None:
        return 0
    rows = [slim(w, src, alt) for w in d.get('results', [])]
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(tmp, path)
    return len(rows)


def main():
    os.makedirs(CORPUS, exist_ok=True)
    sources = resolve_sources()
    jobs = [(n, f, p, s) for s in sorted(sources, key=lambda s: s['tier']) for n, f, p in jobs_for(s)]
    todo = [j for j in jobs if not os.path.exists(os.path.join(CORPUS, j[0] + '.jsonl'))]
    print(f'{len(sources)} sources, {len(jobs)} requests in all, {len(todo)} still to do', flush=True)
    got = done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for n in ex.map(run, todo):
            got += n
            done += 1
            if done % 25 == 0:
                print(f'  {done}/{len(todo)} requests, {got:,} papers, {state["remaining"]} requests left today', flush=True)
    left = [j for j in jobs if not os.path.exists(os.path.join(CORPUS, j[0] + '.jsonl'))]
    print(f'finished: {got:,} papers this run; {len(left)} requests not done'
          + (' (daily allowance reached: run again tomorrow)' if left else ''), flush=True)


if __name__ == '__main__':
    main()
