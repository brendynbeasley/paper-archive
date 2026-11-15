"""Hand-picked landmark books and classic papers.

Usage: python3 tools/economics/landmarks.py            look every landmark up, write landmarks_found.json
       python3 tools/economics/landmarks.py check      only check landmarks.json for mistakes

The journal sweep (fetch.py) cannot see books, papers in journals that are not on its list, or
classics that OpenAlex files oddly (Friedman's 1968 address has no journal attached at all).
landmarks.json fills those gaps by hand. Each entry has

  k     a permanent id, "lm" and four digits. Never reuse or renumber one.
  a y t authors, year of first publication, title
  v     where it appeared: "City: Publisher." for a book, "*Journal* 12(3): 45–67." for a paper,
        "In A. Editor (Ed.), *Book* (pp. 1–20). City: Publisher." for a chapter
  tp    the topic it is listed in, written "Area > Topic" ("Econophysics > Topic" for that field)
  also  other topics that list it too (optional)
  n     one line on what the work contributed
  s     stars: 2 (the default) or 1

This script decides which paper each entry is. In order:
  1. a paper already in data/catalog.json: the topic then points at that entry;
  2. a record in the journal download (work/economics/corpus) or in the pool of most-cited
     economics works (pool.py): the entry takes that record's OpenAlex id and citation count;
  3. for papers found in neither, a DOI from Crossref, then OpenAlex's record for that DOI;
  4. otherwise the entry keeps its own "lm" id and has no citation count.
The answers are written to landmarks_found.json, which is committed, so build.py needs no network
and an entry keeps the id it was first given.
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import fmt  # noqa: E402

LIST = os.path.join(HERE, 'landmarks.json')
FOUND = os.path.join(HERE, 'landmarks_found.json')


def load():
    lms = json.load(open(LIST, encoding='utf-8')) if os.path.exists(LIST) else []
    found = json.load(open(FOUND, encoding='utf-8')) if os.path.exists(FOUND) else {}
    return lms, found


def surname(a):
    """The first author's surname as a key: 'von Neumann, J., & Morgenstern, O.' -> 'neumann'."""
    words = fmt.norm_key(re.sub(r'\(eds?\.\)', '', (a or '').split(',')[0], flags=re.I)).split()
    return words[-1] if words else ''


def kind(v):
    """article, chapter, report or book, read off the venue."""
    if v.startswith('*'):
        return 'article'
    if v.startswith('In '):
        return 'chapter'
    if re.search(r'working papers?\b|occasional paper|white paper|document no|discussion paper|reports?\b|mimeo|speech|lecture', v, re.I):
        return 'report'
    return 'book'


def same_journal(a, b):
    """Do two journal names mean the same journal? ("The Journal of X & Y" = "Journal of X and Y")"""
    def key(x):
        x = fmt.norm_key(html.unescape(x or '')).replace(' and ', ' ')
        return re.sub(r'^the ', '', x)
    a, b = key(a), key(b)
    return bool(a and b) and (a == b or a in b or b in a)


def label(L):
    """What the site calls a landmark that is not in a journal or a book of essays: book, report or talk."""
    k = kind(L['v'])
    if k in ('article', 'chapter'):
        return ''
    if re.search(r'^speech|lecture', L['v'], re.I):
        return 'talk'
    if k == 'report' or re.search(r'\b(Committee|Commission|World Bank)\b', L['a']) \
            or re.search(r'^Report\b|\bReport (of|to)\b|\bReport$', L['t']):
        return 'report'
    return 'book'


def journal_of(v):
    m = re.match(r'\*([^*]+)\*', v)
    return m.group(1) if m else ''


def tkey(s):
    """A title as a matching key. Unlike fmt.norm_key it treats every kind of dash as a space and a
    curly apostrophe as a straight one, so that "Long‐Memory", "1861–1957" and "California’s" match
    "Long-Memory", "1861-1957" and "California's"."""
    s = re.sub('[‐-―−]', '-', s or '')
    return fmt.norm_key(re.sub('[‘’ʼ“”]', "'", s))


def title_keys(t):
    """Forms a book's title may take on a record: in full, and without the subtitle."""
    keys = {tkey(t)}
    main = tkey(re.split(r'[:?]', t)[0])
    if len(main.split()) >= 3:
        keys.add(main)
    return keys


PAPER_TYPES = {'article', 'review', 'preprint', 'report', 'book-chapter', 'conference-paper', 'letter', None}
ORIGINAL = {'article': {'article', 'review', 'conference-paper'},
            'chapter': {'article', 'review', 'conference-paper', 'book-chapter'}}


def rec_surnames(r):
    """Surnames of all the authors on a downloaded record, as keys."""
    out = set()
    for raw, display in r['au']:
        words = fmt.norm_key(fmt.split_name(raw or display)[0]).split()
        if words:
            out.add(words[-1])
    return out


def record_key(t):
    return tkey(re.sub(r'^\s*\d+\.\s+', '', fmt.clean_title(t or '')))     # "17. A Value for n-Person Games"


def check(lms, topic_names):
    bad, seen = [], set()
    for L in lms:
        if not re.fullmatch(r'lm\d{4}', L.get('k', '')) or L['k'] in seen:
            bad.append(f"{L.get('k')}: id missing, malformed or used twice")
        seen.add(L.get('k'))
        for tp in [L.get('tp')] + list(L.get('also', [])):
            if tp not in topic_names:
                bad.append(f"{L.get('k')}: no topic called {tp!r}")
        if not (L.get('a') and L.get('t') and L.get('v') and isinstance(L.get('y'), int)):
            bad.append(f"{L.get('k')}: needs authors, an integer year, a title and a venue")
        if L.get('s', 2) not in (1, 2):
            bad.append(f"{L.get('k')}: stars must be 1 or 2")
    return bad


def topic_names():
    import taxonomy as T
    names = {f"{a['name']} > {tp}" for a in T.AREAS for tp, _ in a['topics']}
    extra = os.path.join(ROOT, 'work', 'economics', 'extra_fields.json')
    if os.path.exists(extra):
        names |= {f"{t.get('ar') or t['f']} > {t['tp']}" for t in json.load(open(extra, encoding='utf-8'))['topics']}
    return names


def resolve(refresh=False):
    import build
    import crossref
    import fetch
    import pool
    from collections import Counter
    from journals import JOURNALS, HANDBOOKS

    lms, found = load()
    bad = check(lms, topic_names())
    if bad:
        sys.exit('landmarks.json has mistakes:\n  ' + '\n  '.join(bad))
    cat = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    cat_titles = {}
    for p in cat:
        cat_titles.setdefault(tkey(p['t']), []).append(p)
    names = {i: n for i, n, _, _ in JOURNALS}
    names.update({i: n for i, n, _ in HANDBOOKS})
    journal_names = {fmt.norm_key(n) for n in names.values()} | {'the ' + fmt.norm_key(n) for n in names.values()}
    drop_file = os.path.join(HERE, 'not_papers.json')
    dropped = set(json.load(open(drop_file))) if os.path.exists(drop_file) else set()
    usable = build.prepare(journal_names, dropped)                       # what build.py will list
    by_key = {}
    for origin, rows in (('corpus', usable), ('pool', pool.load())):
        for r in rows:
            by_key.setdefault(record_key(r['t']), []).append((origin, r))
    book_keys = {(tkey(L['t']), surname(L['a'])) for L in lms if kind(L['v']) in ('book', 'report')}

    def in_catalog(L):
        for p in cat_titles.get(tkey(L['t']), ()):
            y = int(p['y']) if str(p.get('y', '')).isdigit() else None
            first = fmt.norm_key((p.get('a') or '').split(',')[0]).split()
            if (y is not None and abs(y - L['y']) <= 2) or (first and first[-1] == surname(L['a'])):
                return p['id']
        return None

    def local_paper(L):
        """The best downloaded record for a paper or chapter: (origin, record, is it the original?)."""
        what, sn, key = kind(L['v']), surname(L['a']), tkey(L['t'])
        distinctive = len(key.split()) >= 6
        best = None
        for origin, r in by_key.get(key, []):
            if r['type'] not in PAPER_TYPES and not (r['type'] == 'book' and (key, sn) not in book_keys):
                continue
            near = r['y'] is not None and abs(r['y'] - L['y']) <= 3
            if not (sn in rec_surnames(r) or near or distinctive):
                continue
            mine = journal_of(L['v'])                 # a record in another journal or series is a reprint or a draft
            orig = near and r['type'] in ORIGINAL[what] and \
                (origin == 'corpus' or not mine or not r.get('j') or same_journal(mine, r['j']))
            score = (origin == 'corpus', bool(orig), r['c'])
            if best is None or score > best[0]:
                best = (score, origin, r, bool(orig))
        return best and best[1:]

    def crossref_hits(L):
        """Crossref records that are this paper: same title, same first author, within two years."""
        what, sn, key = kind(L['v']), surname(L['a']), tkey(L['t'])
        m = re.search(r'\):?\s*([A-Za-z]?\d+)|\*\s*\d+:\s*([A-Za-z]?\d+)', L['v'])
        page = (m.group(1) or m.group(2)) if m else ''                   # the first page, when the venue gives one
        years = [L['y']] + [int(y) for y in re.findall(r'\((1[89]\d\d|20\d\d) translation', L['v'])]
        hits = crossref.search(L['t'], f"{sn} {journal_of(L['v'])} {years[-1]}".strip(), rows=10)
        if hits is None:
            return None
        out = []
        for h in hits:
            ht = tkey(fmt.clean_title(h['t']))
            wordy = len(key.split()) >= 4          # then a longer title that starts or ends with ours also counts
            if not (ht == key or (wordy and (ht.startswith(key + ' ') or ht.endswith(' ' + key)))):
                continue
            if not h['y'] or min(abs(h['y'] - y) for y in years) > 2 or not h['doi']:
                continue
            if h['type'] not in (('journal-article',) if what == 'article' else ('book-chapter', 'journal-article')):
                continue
            if h['au'] and sn not in [w[-1] for w in (fmt.norm_key(x).split() for x in h['au']) if w]:
                continue
            if what == 'article' and not same_journal(journal_of(L['v']), h['j']) and not (page and page == h['fp']):
                continue                             # same title in another journal: a review or a translation
            out.append(h)
        return out[:4]

    plans = {}                                       # landmark id -> what is known before asking OpenAlex
    asked = 0
    for L in lms:
        k = L['k']
        if found.get(k) and not refresh:
            continue
        ex = in_catalog(L)
        if ex:
            found[k] = {'ex': ex, 'src': 'catalog'}
            continue
        what, sn = kind(L['v']), surname(L['a'])
        if what in ('book', 'report'):
            # Only the pool is trusted for a book's count: a small count in the journal download
            # belongs to a review of the book, not to the book.
            cands = [r for key in title_keys(L['t']) for origin, r in by_key.get(key, []) if origin == 'pool']
            wordy = len(tkey(L['t']).split()) >= 4
            ok = [r for r in cands if wordy or sn in rec_surnames(r)]
            d = {'src': 'pool' if ok else 'none'}
            if ok:
                d['c'] = max(r['c'] for r in ok)
                for r in sorted(ok, key=lambda r: -r['c']):                  # a publisher's page for the book itself
                    if r['type'] != 'book' or not r['doi'] or record_key(r['t']) not in title_keys(L['t']):
                        continue
                    cr = crossref.by_doi(r['doi']) or {}
                    names_ok = sn in [w[-1] for w in (fmt.norm_key(x).split() for x in cr.get('au') or []) if w] \
                        or (not cr.get('au') and '(Ed' in L['a'])
                    if cr.get('type') in ('book', 'monograph', 'edited-book', 'reference-book') and names_ok \
                            and tkey(fmt.clean_title(cr.get('t'))) in title_keys(L['t']):
                        d['link'] = r['doi']
                        break
            found[k] = d
            continue
        local = local_paper(L)
        d = {'src': 'none'}
        if local:
            origin, r, orig = local
            d = {'id': r['id'], 'c': r['c'], 'src': origin}
            link = (build.link_for(r) if origin == 'corpus' else r['doi']) if orig else ''
            if link.startswith('http') and not re.search(r'//[^/]*(jstor\.org|repec\.org|aeaweb\.org|doi\.org)/', link):
                link = ''                            # some page that happens to host a copy: not a lasting address
            if link:
                d['link'] = link
            oa = r.get('oa') or ''
            if oa.startswith('http') and oa != link and not (orig and r['doi'] and r['doi'].lower() in oa.lower()):
                d['pdf'] = oa
            elif not orig and re.match(r'10\.(3386|17016|2139)/', r['doi'] or ''):
                d['pdf'] = 'https://doi.org/' + r['doi']        # the working-paper version: a free copy
            j = journal_of(L['v'])
            if orig and j and L['v'].strip() == f'*{j}*.' and r.get('vol'):          # venue typed without details
                d['v'] = fmt.venue(j, r)
        hits = [] if d.get('link') else crossref_hits(L)
        if hits is None:
            print('  Crossref could not be reached; run again later', flush=True)
            break
        asked += not d.get('link')
        if asked % 40 == 39:
            crossref.save()
            print(f'  {asked} papers looked up on Crossref', flush=True)
        plans[k] = (L, d, hits)
    crossref.save()

    # OpenAlex's records for the DOIs Crossref gave: the id and the citation count.
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
    for k, (L, d, hits) in plans.items():
        if hits and not reached:
            continue                                 # leave it for the next run rather than guess
        if hits:
            h = max(hits, key=lambda h: (by_doi.get(h['doi'], {}).get('c', -1), not h['doi'].startswith('10.2307/')))
            w = by_doi.get(h['doi'])
            d['link'] = h['doi']
            j = journal_of(L['v'])
            if j and L['v'].strip() == f'*{j}*.' and h.get('vol'):
                d['v'] = fmt.venue(j, h)
            if w:
                if d.get('src') != 'corpus' and w['c'] >= d.get('c', 0):
                    d['id'] = w['id']                # the record of the work itself, not of a reprint
                d['c'] = max(d.get('c', 0), w['c'])
                if w['oa'].startswith('http') and h['doi'] not in w['oa'].lower():
                    d.setdefault('pdf', w['oa'])
            if d['src'] == 'none':
                d['src'] = 'crossref'
        old = found.get(k) or {}
        if old.get('id'):
            d['id'] = old['id']                      # an id, once given, is kept
        found[k] = d
    with open(FOUND, 'w', encoding='utf-8') as f:
        json.dump({k: found[k] for k in sorted(found)}, f, ensure_ascii=False, indent=0, sort_keys=True)
    live = {L['k'] for L in lms}
    print(Counter(v.get('src', '?') for k, v in found.items() if k in live),
          sum(1 for k, v in found.items() if k in live and v.get('link')), 'with a link,',
          sum(1 for k, v in found.items() if k in live and v.get('c')), 'with a citation count')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'check':
        problems = check(load()[0], topic_names())
        print('\n'.join(problems) if problems else 'landmarks.json is fine')
    else:
        resolve(refresh='--refresh' in sys.argv)
