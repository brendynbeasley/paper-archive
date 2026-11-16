"""Landmark books and classic papers for Econophysics, Mathematics and Statistics.

Usage: python3 tools/sciences/sci_landmarks.py            look every new landmark up
       python3 tools/sciences/sci_landmarks.py check      only check sci_landmarks.json for mistakes

sci_landmarks.json has the same entries as tools/economics/landmarks.json (see that file's
docstring): k (a permanent id: 'ls' and four digits for new entries; econophysics entries
that moved here from the economics list keep their 'lm' ids), a, y, t, v, tp, also, n, s.

This script decides which record each entry is, in order:
  1. a work already in the archive (data/catalog.json or data/economics.json): the topic then
     points at that entry;
  2. a record in the science download (work/sciences/corpus): the entry takes that record's
     OpenAlex id and citation count;
  3. for papers found in neither, a DOI from Crossref and OpenAlex's record of that DOI;
  4. otherwise the entry keeps its own id and has no citation count.
The answers go to sci_landmarks_found.json, which is committed.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'economics'))
import fmt  # noqa: E402
import landmarks as elm  # noqa: E402
import skeleton  # noqa: E402

LIST = os.path.join(HERE, 'sci_landmarks.json')
FOUND = os.path.join(HERE, 'sci_landmarks_found.json')


def load():
    lms = json.load(open(LIST, encoding='utf-8')) if os.path.exists(LIST) else []
    found = json.load(open(FOUND, encoding='utf-8')) if os.path.exists(FOUND) else {}
    return lms, found


def check(lms):
    names = set(skeleton.topic_strings())
    econ_ids = {L['k'] for L in json.load(open(os.path.join(ROOT, 'tools', 'economics', 'landmarks.json'), encoding='utf-8'))}
    bad, seen = [], set()
    for L in lms:
        if not re.fullmatch(r'l[ms]\d{4}', L.get('k', '')) or L['k'] in seen or L['k'] in econ_ids:
            bad.append(f"{L.get('k')}: id missing, malformed, used twice or used by an economics landmark")
        seen.add(L.get('k'))
        for tp in [L.get('tp')] + list(L.get('also', [])):
            if tp not in names:
                bad.append(f"{L.get('k')}: no topic called {tp!r}")
        if not (L.get('a') and L.get('t') and L.get('v') and isinstance(L.get('y'), int)):
            bad.append(f"{L.get('k')}: needs authors, an integer year, a title and a venue")
    return bad


TYPED = re.compile(r'\*([^*]+)\*\s*([\d/]+)?(?:\(([^)]+)\))?(?::\s*([A-Za-z]?\d+)(?:[–-]([A-Za-z]?\d+))?)?')


ROMAN = {'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'}


def close_title(a, b):
    """Two title keys that differ only in how a symbol or a word was typed (TeX, a Greek letter, a typo):
    at least three quarters of the words shared, and the same part numbers (so Part I never matches Part II)."""
    A, B = set(a.split()), set(b.split())
    return len(A) >= 4 and A & ROMAN == B & ROMAN and len(A & B) / max(len(A), len(B)) >= 0.75


def typed_differs(v, h):
    """Do the volume or first page typed in a venue disagree with Crossref's record?"""
    m = TYPED.match(v or '')
    if not m:
        return False
    vol, fp = m.group(2), m.group(4)
    return bool((vol and h.get('vol') and vol != str(h['vol'])) or (fp and h.get('fp') and fp != str(h['fp'])))


def existing():
    """Works already in the archive, by title key: (id, year, first-author surname, citations)."""
    cat = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    eco = json.load(open(os.path.join(ROOT, 'data', 'economics.json'), encoding='utf-8'))
    out = defaultdict(list)
    for p in cat:
        out[elm.tkey(p['t'])].append((p['id'], p.get('y', ''), elm.surname(p.get('a', '')), 0))
    for t in eco['topics']:
        if t['f'] == 'Econophysics':
            continue
        for p in t['p']:
            if isinstance(p, list):
                out[elm.tkey(p[1])].append((p[0], p[3], elm.surname(p[2]), p[6] or 0))
    return out


def resolve(refresh=False):
    import crossref
    import fetch
    import sci_build as B

    lms, found = load()
    bad = check(lms)
    if bad:
        sys.exit('sci_landmarks.json has mistakes:\n  ' + '\n  '.join(bad[:30]))
    ex_index = existing()
    corpus, usable, _ = B.prepare(set())
    by_key = defaultdict(list)
    for origin, rows in (('corpus', usable), ('raw', corpus)):
        for r in rows:
            by_key[elm.record_key(r['t'])].append((origin, r))
    book_keys = {(elm.tkey(L['t']), elm.surname(L['a'])) for L in lms if elm.kind(L['v']) in ('book', 'report')}

    def in_archive(L):
        sn, words = elm.surname(L['a']), len(elm.tkey(L['t']).split())
        for pid, y, s, c in ex_index.get(elm.tkey(L['t']), ()):
            near = str(y).isdigit() and abs(int(y) - L['y']) <= 2
            if s == sn or (near and words >= 4):
                return pid, c
        return None

    def local_paper(L):
        what, sn, key = elm.kind(L['v']), elm.surname(L['a']), elm.tkey(L['t'])
        best = None
        for origin, r in by_key.get(key, []):
            if r['type'] not in elm.PAPER_TYPES and not (r['type'] == 'book' and (key, sn) not in book_keys):
                continue
            near = r['y'] is not None and abs(r['y'] - L['y']) <= 3
            if not (sn in elm.rec_surnames(r) or near or len(key.split()) >= 6):
                continue
            mine = elm.journal_of(L['v'])
            orig = near and r['type'] in elm.ORIGINAL[what] and (not mine or not r.get('j') or elm.same_journal(mine, r['j']))
            score = (origin == 'corpus', bool(orig), r['c'])
            if best is None or score > best[0]:
                best = (score, origin, r, bool(orig))
        return best and best[1:]

    def crossref_hits(L):
        what, sn, key = elm.kind(L['v']), elm.surname(L['a']), elm.tkey(L['t'])
        hits = crossref.search(L['t'], f"{sn} {elm.journal_of(L['v'])} {L['y']}".strip(), rows=10)
        if hits is None:
            return None
        m = re.search(r'\):?\s*([A-Za-z]?\d+)|\*\s*\d+:\s*([A-Za-z]?\d+)', L['v'])
        page = (m.group(1) or m.group(2)) if m else ''
        out, near = [], []
        for h in hits:
            ht = elm.tkey(fmt.clean_title(h['t']))
            wordy = len(key.split()) >= 4
            exact = ht == key or (wordy and (ht.startswith(key + ' ') or ht.endswith(' ' + key)))
            close = (not exact and close_title(key, ht) and h['y'] and abs(h['y'] - L['y']) <= 1
                     and elm.same_journal(elm.journal_of(L['v']), h['j']))
            if not (exact or close):
                continue
            if not h['y'] or abs(h['y'] - L['y']) > 2 or not h['doi']:
                continue
            if h['type'] not in (('journal-article', 'proceedings-article') if what == 'article' else
                                 ('book-chapter', 'journal-article', 'proceedings-article')):
                continue
            if h['au'] and sn not in [w[-1] for w in (fmt.norm_key(x).split() for x in h['au']) if w]:
                continue
            if what == 'article' and not elm.same_journal(elm.journal_of(L['v']), h['j']) and not (page and page == h['fp']):
                continue
            (out if exact else near).append(h)
        return (out or near)[:4]

    plans = {}
    for L in lms:
        k = L['k']
        if found.get(k) and not refresh:
            continue
        hit = in_archive(L)
        if hit:
            found[k] = {'ex': hit[0], 'src': 'archive'}
            if hit[1]:
                found[k]['c'] = hit[1]
            continue
        what, sn = elm.kind(L['v']), elm.surname(L['a'])
        if what in ('book', 'report'):
            cands = [r for key in elm.title_keys(L['t']) for origin, r in by_key.get(key, []) if origin == 'raw']
            wordy = len(elm.tkey(L['t']).split()) >= 4
            ok = [r for r in cands if (wordy or sn in elm.rec_surnames(r)) and r['type'] in ('book', 'book-chapter')]
            d = {'src': 'pool' if ok else 'none'}
            if ok:
                d['c'] = max(r['c'] for r in ok)
            found[k] = d
            continue
        local = local_paper(L)
        d = {'src': 'none'}
        if local:
            origin, r, orig = local
            d = {'id': r['id'], 'c': r['c'], 'src': origin}
            link = (r['doi'] or '') if orig else ''
            if link:
                d['link'] = link
            oa = r.get('oa') or ''
            if oa.startswith('http') and oa != link and not (orig and r['doi'] and r['doi'].lower() in oa.lower()):
                d['pdf'] = oa
            j = elm.journal_of(L['v'])
            if orig and j and L['v'].strip() == f'*{j}*.' and r.get('vol'):
                d['v'] = fmt.venue(j, r)
            if r['id'] in {pid for lst in ex_index.values() for pid, *_ in lst}:
                d = {'ex': r['id'], 'src': 'archive', 'c': r['c']}
        plans[k] = (L, d, None if (d.get('link') or d.get('ex')) else 'ask')

    # Crossref, several questions at a time (answers are cached in work/economics/crossref.json).
    from concurrent.futures import ThreadPoolExecutor
    ask = [k for k, (_, _, h) in plans.items() if h == 'ask']
    print(f'{len(ask)} papers to look up on Crossref', flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for n, (k, hits) in enumerate(zip(ask, pool.map(lambda k: crossref_hits(plans[k][0]), ask))):
            L, d, _ = plans[k]
            plans[k] = (L, d, hits if hits is not None else [])
            if n % 200 == 199:
                crossref.save()
                print(f'  {n + 1}/{len(ask)}', flush=True)
    crossref.save()
    plans = {k: (L, d, h or []) for k, (L, d, h) in plans.items()}

    dois = sorted({h['doi'] for _, _, hits in plans.values() for h in hits})
    by_doi, reached = {}, True
    for i in range(0, len(dois), 50):
        res = fetch.get('works', {'filter': 'doi:' + '|'.join(dois[i:i + 50]), 'per-page': 100,
                                  'select': 'id,doi,cited_by_count,open_access'})
        if res is None:
            reached = False
            print('  OpenAlex could not be reached for the citation counts; run again later', flush=True)
            break
        for w in res.get('results', []):
            doi = (w.get('doi') or '').replace('https://doi.org/', '').lower()
            if doi not in by_doi or (w.get('cited_by_count') or 0) > by_doi[doi]['c']:
                by_doi[doi] = {'id': w['id'].rsplit('/', 1)[1], 'c': w.get('cited_by_count') or 0,
                               'oa': (w.get('open_access') or {}).get('oa_url') or ''}
    ex_ids = {pid for lst in ex_index.values() for pid, *_ in lst}
    for k, (L, d, hits) in plans.items():
        if hits and not reached:
            continue
        if hits:
            h = max(hits, key=lambda h: (by_doi.get(h['doi'], {}).get('c', -1), not h['doi'].startswith('10.2307/')))
            w = by_doi.get(h['doi'])
            d['link'] = h['doi']
            j = elm.journal_of(L['v'])
            if j and h.get('vol') and (L['v'].strip() == f'*{j}*.' or typed_differs(L['v'], h)):
                d['v'] = fmt.venue(j, h)                 # the journal's own volume and pages, as Crossref has them
            if h.get('y') and h['y'] != L['y'] and j and elm.same_journal(j, h['j']):
                d['y'] = h['y']
            if w:
                if d.get('src') != 'corpus' and w['c'] >= d.get('c', 0):
                    d['id'] = w['id']
                d['c'] = max(d.get('c', 0), w['c'])
                if w['oa'].startswith('http') and h['doi'] not in w['oa'].lower():
                    d.setdefault('pdf', w['oa'])
            if d['src'] == 'none':
                d['src'] = 'crossref'
            if d.get('id') in ex_ids:
                d = {'ex': d['id'], 'src': 'archive', 'c': d.get('c', 0)}
        old = found.get(k) or {}
        if old.get('id') and not d.get('ex'):
            d['id'] = old['id']
        found[k] = d
    with open(FOUND, 'w', encoding='utf-8') as f:
        json.dump({k: found[k] for k in sorted(found)}, f, ensure_ascii=False, indent=0, sort_keys=True)
    live = {L['k'] for L in lms}
    print(Counter(v.get('src', '?') for k, v in found.items() if k in live),
          sum(1 for k, v in found.items() if k in live and (v.get('link') or v.get('ex'))), 'with a link or an existing entry,',
          sum(1 for k, v in found.items() if k in live and v.get('c')), 'with a citation count')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'check':
        problems = check(load()[0])
        print('\n'.join(problems) if problems else 'sci_landmarks.json is fine')
    else:
        resolve(refresh='--refresh' in sys.argv)
