"""Find a DOI link for every catalog paper via the Crossref API.

Usage: python3 tools/find_links.py            (resumes from tools/links_cache.json)

A match is accepted only when the title is a close match AND the year agrees
(within 2 years, or 6 when the first author's surname also matches), so a wrong paper is rarely linked. Papers
with no confident match keep no link (the site then falls back to a Google
Scholar search). Results are cached so the script can be stopped and resumed.
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher

CACHE = 'tools/links_cache.json'
UA = 'paper-archive/1.0 (personal bibliography; https://github.com/brendynbeasley/paper-archive)'

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'[^a-z0-9 ]+', ' ', s).split()

def title_sim(a, b):
    a, b = ' '.join(norm(a)), ' '.join(norm(b))
    if not a or not b:
        return 0
    if len(a) > 20 and len(b) > 20 and (b.startswith(a) or a.startswith(b)):
        return 0.95  # one side has a subtitle the other lacks
    return SequenceMatcher(None, a, b).ratio()

def surname(authors):
    first = (authors or '').split(',')[0]
    w = norm(first)
    return w[-1] if w else ''

def lookup(p):
    venue = re.sub(r'\*', '', p.get('v', ''))
    q = f"{p.get('a','')} {p.get('y','')} {p['t']} {venue}"[:400]
    url = 'https://api.crossref.org/works?' + urllib.parse.urlencode({
        'query.bibliographic': q, 'rows': 4,
        'select': 'DOI,title,subtitle,issued,author,container-title,type'})
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                items = json.load(r)['message']['items']
            break
        except Exception as e:  # 429 / timeouts: back off and retry
            time.sleep(2 ** attempt)
    else:
        return None  # give up for now; a rerun retries it
    sn, yr = surname(p.get('a')), int(p['y']) if str(p.get('y', '')).isdigit() else None
    best = None
    for it in items:
        t = ' '.join(it.get('title') or [])
        full = t + (' ' + ' '.join(it['subtitle']) if it.get('subtitle') else '')
        sim = max(title_sim(p['t'], t), title_sim(p['t'], full))
        iy = (it.get('issued', {}).get('date-parts') or [[None]])[0][0]
        gap = abs(iy - yr) if yr is not None and iy is not None else 99
        y_ok, y_near = gap <= 2, gap <= 6  # working papers are often published a few years later
        fams = {w for a in it.get('author') or [] for w in norm(a.get('family', ''))}
        a_ok = bool(sn) and sn in fams
        ok = (sim >= 0.9 and (y_ok or (y_near and a_ok))) or (sim >= 0.8 and y_ok and a_ok)
        if ok and (best is None or sim > best[0]):
            best = (sim, it['DOI'], iy)
    if best:
        return {'doi': best[1], 'sim': round(best[0], 3)}
    return {'doi': None}

def main():
    papers = json.load(open('data/catalog.json', encoding='utf-8'))['papers']
    try:
        cache = json.load(open(CACHE))
    except FileNotFoundError:
        cache = {}
    todo = [p for p in papers if p['id'] not in cache]
    print(f'{len(papers)} papers, {len(todo)} to look up', flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(lookup, p): p for p in todo}
        for f in as_completed(futs):
            p, res = futs[f], f.result()
            if res is not None:
                cache[p['id']] = res
            done += 1
            if done % 200 == 0:
                json.dump(cache, open(CACHE, 'w'), indent=0, sort_keys=True)
                found = sum(1 for v in cache.values() if v.get('doi'))
                print(f'{done}/{len(todo)} looked up, {found} links so far', flush=True)
    json.dump(cache, open(CACHE, 'w'), indent=0, sort_keys=True)
    found = sum(1 for v in cache.values() if v.get('doi'))
    print(f'finished: {found} of {len(papers)} papers have a DOI link', flush=True)

if __name__ == '__main__':
    main()
