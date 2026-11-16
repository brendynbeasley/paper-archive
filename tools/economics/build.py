"""Build data/economics.json: the most-cited papers of each topic in the economics taxonomy,
plus the landmark books and classics.

Usage: python3 tools/economics/build.py            (after tools/economics/fetch.py)

Steps: read the corpus, throw out non-papers and duplicates, sort every paper into a topic
(classify.py), keep each topic's top papers by age-adjusted citations, add the landmarks
(landmarks.json), and write everything in the archive's citation style. A paper that is already
in data/catalog.json (the monopoly bibliography) is not copied: the topic just points at the
existing entry, so one paper has one set of ticks wherever it is listed.

Nothing that has been published is dropped by a rebuild: a paper listed in the current
data/economics.json stays listed even if newer papers push it out of its topic's top 80, so
ticks are never orphaned.

Three hand-kept files steer the result:
  not_papers.json  ids of records that are not papers (book reviews, errata, front matter)
  fixes.json       per-paper corrections: "a" authors, "y" year, "t" title, "v" venue,
                   "link" (empty = none), "tp" the topic it belongs in, written "Area > Topic".
                   An entry keyed by a catalog.json id (mp0001) controls that paper's extra
                   listing instead: "tp" names the topic, and an empty "tp" means none.
  landmarks.json   books and classic papers chosen individually, each with a one-line note
                   (see landmarks.py).
"""
import glob
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import classify  # noqa: E402
import crossref  # noqa: E402
import fmt  # noqa: E402
import landmarks  # noqa: E402
import taxonomy as T  # noqa: E402
from journals import JOURNALS, HANDBOOKS  # noqa: E402

WORK = os.path.join(ROOT, 'work', 'economics')
OUT = os.path.join(ROOT, 'data', 'economics.json')
CAP, MUST, INFLUENTIAL = 80, 8, 16          # papers per topic; how many get two stars / one star
KEEP_ABOVE = 250                            # a paper cited this often is listed even in a full topic
THIS_YEAR = date.today().year
KEEP_TYPES = {'article', 'review', 'book-chapter', 'conference-paper', 'letter'}
NOT_A_COPY = {'book-review', 'paratext', 'editorial', 'erratum', 'conference-abstract', 'other', 'dataset',
              'peer-review', 'reference-entry', 'dissertation', 'retraction'}
JUNK = re.compile(
    r'^(erratum|errata|corrigend|correction|comment|reply|rejoinder|book review|review of|editor|introduction$|'
    r'foreword|preface|index|front matter|back matter|announcement|notes?$|contents|volume information|'
    r'discussion$|abstracts?$|in memoriam|obituar|list of|referees|report of the|minutes of|proceedings of the|'
    r'untitled|title pending|a correction|a comment|a reply|a note$|note$|symposium|the [a-z ]+ review$|'
    r'(the )?journal of [a-z ,&()]+$|recent publications|books received|new books|doctoral dissertations)', re.I)
NAMES = {i: n for i, n, _, _ in JOURNALS}
NAMES.update({i: n for i, n, _ in HANDBOOKS})
HANDBOOK_ISSN = {i for i, _, _ in HANDBOOKS}


def load_corpus():
    """Every downloaded record once. Where a paper came back from both pulls, the journal's own record wins."""
    rows = {}
    for f in glob.glob(os.path.join(WORK, 'corpus', '*.jsonl')):
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            old = rows.get(r['id'])
            if old is None or (old.get('alt') and not r.get('alt')) or \
                    (bool(old.get('alt')) == bool(r.get('alt')) and r['c'] > old['c']):
                rows[r['id']] = r
    return list(rows.values())


def usable(r, journal_names, dropped):
    t = (r['t'] or '').strip()
    if r['id'] in dropped or r['type'] not in KEEP_TYPES or r['para'] or r['retr']:
        return False
    if r['lang'] not in ('en', None) or not r['au'] or not r['y'] or not 1850 <= r['y'] <= THIS_YEAR:
        return False
    if len(t) < 8 or JUNK.match(t) or fmt.norm_key(t) in journal_names:
        return False
    one_page = bool(r.get('fp')) and r.get('fp') == r.get('lp')
    if t.endswith('.') and (len(r['ab']) < 100 or one_page) and r['type'] != 'book-chapter':
        return False                                  # how OpenAlex records book reviews

    return True


def dedupe(rows):
    """OpenAlex sometimes holds one paper twice (a reprint, a second DOI). Keep the journal's own record
    where there is one, otherwise the most cited, and give it the highest of the citation counts."""
    groups = defaultdict(list)
    for r in rows:
        groups[(fmt.norm_key(fmt.clean_title(r['t'])), fmt.first_surname(r['au']))].append(r)
    out = []
    for g in groups.values():
        g.sort(key=lambda r: (bool(r.get('alt')), -r['c']))
        best = g[0]
        for o in g[1:]:
            best['c'] = max(best['c'], o['c'])
            for k in ('doi', 'oa', 'ab', 'kw'):
                if not best.get(k) and o.get(k):
                    best[k] = o[k]
        out.append(best)
    return out


def volume_years(corpus):
    """For each journal that publishes one volume a year: (year minus volume, how far off counts as wrong)."""
    offsets = defaultdict(Counter)
    for r in corpus:
        v = str(r.get('vol') or '')
        if v.isdigit() and r['y'] and not r.get('alt'):
            offsets[r['src']][r['y'] - int(v)] += 1
    regular = {}
    for sid, c in offsets.items():
        n, (best, _) = sum(c.values()), c.most_common(1)[0]
        share = sum(k for o, k in c.items() if abs(o - best) <= 1) / n
        if n >= 40 and share >= 0.93:
            regular[sid] = (best, 2)
        elif n >= 40 and share >= 0.7:
            regular[sid] = (best, 8)   # less regular journal: only trust the volume for big gaps
    return regular


def fix_years(rows, regular):
    """OpenAlex often dates a paper by its first working-paper version (or by the day an old issue
    was scanned), not by the journal issue. Where a journal publishes one volume a year, the volume
    number gives the real year, so use it when the two disagree by more than two years."""
    changed = 0
    for r in rows:
        v = str(r.get('vol') or '')
        if r['src'] in regular and v.isdigit() and not r.get('alt'):
            offset, slack = regular[r['src']]
            expected = offset + int(v)
            if abs(r['y'] - expected) > slack and 1850 <= expected <= THIS_YEAR:
                r['y'] = expected
                changed += 1
    return changed


def repec_handle(url):
    """Volume, year, issue and pages from a RePEc article address, which spells them out."""
    u = re.sub(r'_3a', ':', url, flags=re.I)
    m = re.search(r'repec\.org/.*?v:(\d+):y:(\d{4})(?::i:([^:/]+?))?:p:(\d+)(?:-(\d+))?', u, re.I) \
        or re.search(r'repec\.org/a/.*?v(\d+)y(\d{4})i([^p/]+)p(\d+)(?:-(\d+))?', u, re.I)
    if not m:
        return None
    v, y, i, fp, lp = m.groups()
    if lp and len(lp) < len(fp):
        lp = fp[:len(fp) - len(lp)] + lp          # "125-37" means 125 to 137
    return int(v), int(y), i or '', fp, lp or ''


def journal_copy(r, regular):
    """For a paper that OpenAlex files under a working-paper series or a reprint (fetch.py's second
    pull): the year, volume, pages and link of the copy in the journal itself, or None when they
    cannot be established, in which case the record is left out."""
    off = regular.get(r['src'])
    vol = str(r.get('vol') or '')
    implied = off[0] + int(vol) if off and vol.isdigit() else None
    urls = r.get('jurls') or []
    doi = next((u.split('doi.org/', 1)[1].strip().lower() for u in urls if 'doi.org/10.' in u), '')
    if doi:                                         # the journal's DOI: Crossref has the details (altcheck.py)
        cr = crossref.cache().get('doi:' + doi) or {}
        if cr.get('y') and cr.get('type') == 'journal-article':
            return {'y': cr['y'], 'vol': cr['vol'], 'iss': cr['iss'], 'fp': cr['fp'], 'lp': cr['lp'], 'doi': doi, 'url': ''}
    for u in urls:
        h = repec_handle(u)
        if h and ((off and abs(h[1] - (off[0] + h[0])) <= 1) or (not off and vol == str(h[0]))):
            return {'y': h[1], 'vol': str(h[0]), 'iss': h[2], 'fp': h[3], 'lp': h[4], 'doi': doi, 'url': '' if doi else u}
    jstor = next((re.sub(r'/stable/(?:pdf(?:plus)?/)?(\d+)(?:\.pdf)?.*$', r'/stable/\1', u)
                  for u in urls if 'jstor.org/stable' in u), '')
    if implied and 1850 <= implied <= THIS_YEAR and (-1 <= implied - r['y'] <= 8 or (implied < r['y'] and jstor)):
        own = r['doi'] if r.get('ptype') in ('repository', '') and r['type'] in ('preprint', 'report', 'article') else ''
        return {'y': implied, 'vol': vol, 'iss': r.get('iss') or '', 'fp': r.get('fp') or '', 'lp': r.get('lp') or '',
                'doi': doi, 'url': '' if doi else jstor or (f'https://doi.org/{own}' if own else '')}
    return None


def strength(c, y):
    """Citations, discounted for age so that recent work can sit beside the classics."""
    return c / math.sqrt(max(THIS_YEAR - y, 0) + 2)


def floor(y):
    return 40 if y <= 2015 else 20 if y <= 2020 else 8


def catalog_index(cat):
    by_doi, by_title = {}, defaultdict(list)
    for p in cat:
        if (p.get('link') or '').startswith('https://doi.org/'):
            by_doi[p['link'][16:].lower()] = p['id']
        by_title[fmt.norm_key(p['t'])].append(p)
    return by_doi, by_title


def existing_id(r, title, by_doi, by_title):
    if r['doi'] and r['doi'].lower() in by_doi:
        return by_doi[r['doi'].lower()]
    key = fmt.norm_key(title)
    if len(key) < 12:
        return None
    sn = fmt.first_surname(r['au'])
    for p in by_title.get(key, ()):
        y = int(p['y']) if str(p.get('y', '')).isdigit() else None
        first = fmt.norm_key((p.get('a') or '').split(',')[0])
        fs = first.split()
        if (y is not None and abs(y - r['y']) <= 2) or (sn and fs and sn == fs[-1]):
            return p['id']
    return None


def link_for(r):
    if r['doi']:
        return r['doi']                                     # the site adds https://doi.org/
    u = r.get('url') or ''
    return u if u.startswith('http') and 'openalex.org' not in u else ''


def free_copy(r, link):
    """A free-to-read copy, when OpenAlex knows one that is not simply the link itself."""
    oa = r.get('oa') or ''
    if not oa.startswith('http') or oa == link or (r['doi'] and r['doi'].lower() in oa.lower()):
        return ''
    return oa if (r['doi'] or r.get('alt')) else ''


def prepare(journal_names, dropped):
    """The usable papers: the corpus without non-papers and duplicates, with years put right."""
    corpus = load_corpus()
    regular = volume_years(corpus)
    alt_in = alt_ok = 0
    keep = []
    for r in corpus:
        if r.get('alt'):
            alt_in += 1
            jc = journal_copy(r, regular) if r['type'] not in NOT_A_COPY else None
            if not jc or (r['type'] == 'book' and (not jc['lp'] or jc['fp'] == jc['lp'])):
                continue                                    # no journal copy, or a one-page review of a book
            r.update(jc)
            r['type'] = 'article'
            alt_ok += 1
        if usable(r, journal_names, dropped):
            keep.append(r)
    rows = dedupe(keep)
    redated = fix_years(rows, regular)
    print(f'{len(corpus):,} records, {len(rows):,} usable papers, {redated} re-dated from their volume number; '
          f'{alt_ok:,} of {alt_in:,} records filed outside their journal could be traced back to it')
    return rows


def last_published():
    """data/economics.json as last committed (what the live site has), else as it is on disk."""
    try:
        text = subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:data/economics.json'], capture_output=True,
                              check=True, timeout=30).stdout.decode('utf-8')
        return json.loads(text)
    except Exception:
        return json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}


def touched_ids():
    """Papers that a rebuild never drops: (everything the user has ticked or edited plus everything
    already published, the papers published with an entry of their own)."""
    ids, published = set(), {}
    for name, key in (('progress.json', 'p'), ('library.json', 'edits')):
        f = os.path.join(ROOT, 'data', name)
        if os.path.exists(f):
            ids |= set((json.load(open(f, encoding='utf-8')).get(key) or {}).keys())
    for t in last_published().get('topics', []):
        published.update({p[0]: f"{t.get('ar') or t['f']} > {t['tp']}" for p in t['p'] if isinstance(p, list)})
    return ids | set(published), published                  # published: id -> the topic it was listed in


def main():
    sources = {s['sid']: s for s in json.load(open(os.path.join(WORK, 'sources.json')))}
    journal_names = {fmt.norm_key(n) for n in NAMES.values()} | {'the ' + fmt.norm_key(n) for n in NAMES.values()}
    drop_file = os.path.join(HERE, 'not_papers.json')
    dropped = set(json.load(open(drop_file))) if os.path.exists(drop_file) else set()
    fix_file = os.path.join(HERE, 'fixes.json')
    fixes = json.load(open(fix_file, encoding='utf-8')) if os.path.exists(fix_file) else {}
    sticky, published = touched_ids()
    rows = prepare(journal_names, dropped)

    clf = classify.Classifier()
    clf.fit(rows)
    extra = {}            # econophysics, once merged in here, is built with the other sciences (tools/sciences)
    topics = [(T.FIELD, area, topic) for _, area, topic in clf.topics] + \
             [(t['f'], t.get('ar', ''), t['tp']) for t in extra.get('topics', [])]
    topic_index = {f'{ar or f} > {tp}': i for i, (f, ar, tp) in enumerate(topics)}
    cat = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    cat_by_id = {p['id']: p for p in cat}
    by_doi, by_title = catalog_index(cat)

    # Landmarks: where each goes, and which downloaded records they replace.
    lms, found = landmarks.load()
    lm_ids = {found[L['k']]['id'] for L in lms if found.get(L['k'], {}).get('id')}
    lm_titles = {(landmarks.tkey(L['t']), landmarks.surname(L['a'])) for L in lms
                 if landmarks.kind(L['v']) in ('article', 'chapter')}
    used_existing = {found[L['k']]['ex'] for L in lms if found.get(L['k'], {}).get('ex')}

    by_topic = defaultdict(list)
    for r in rows:
        s = sources[r['src']]
        fix = fixes.get(r['id'], {})
        if str(fix.get('y', '')).isdigit():
            r['y'] = int(fix['y'])
        r['_title'] = fix.get('t') or fmt.clean_title(r['t'])
        if r['id'] in lm_ids or (landmarks.tkey(r['_title']), fmt.first_surname(r['au'])) in lm_titles:
            continue                                        # listed as a landmark instead
        r['_ex'] = existing_id(r, r['_title'], by_doi, by_title)
        if r['_ex'] and r['id'] in published:
            r['_ex'] = None                                 # it has been published with its own id: keep that id alive
        place = fix.get('tp', fixes.get(r['_ex'], {}).get('tp')) if (r['_ex'] or 'tp' in fix) else None
        if place == '':
            continue                                        # an existing paper that should not be listed twice
        ti, score, _, _ = clf.score(r, s['area'], T.FORCED.get(s['issn']))
        if place in topic_index:
            ti, score = topic_index[place], 8.0
        elif ti is None and published.get(r['id']) in topic_index:
            ti, score = topic_index[published[r['id']]], classify.THRESHOLD   # no topic claims it now: leave it where it was
        if ti is not None and (r['c'] >= floor(r['y']) or r['id'] in sticky):
            r['_rank'] = strength(r['c'], r['y']) * (0.6 + 0.4 * min(1.0, score / 8))
            by_topic[ti].append(r)

    # items[topic] = (stars, rank, row or id): sorted at the end, two-star entries first, then by rank.
    # Two stars go to a topic's landmarks and to its most-cited papers: 8 of the latter, fewer where
    # there are landmarks, but never fewer than 4.
    items = defaultdict(list)
    lm_musts = Counter(topic_index[L['tp']] for L in lms if L.get('s', 2) == 2 and not found.get(L['k'], {}).get('ex'))
    have, n_new, n_ref, n_extra = set(), 0, 0, 0
    for ti in range(len(clf.topics)):
        ranked = sorted(by_topic.get(ti, []), key=lambda r: -r['_rank'])
        for k, r in enumerate(ranked):
            if k >= CAP and r['c'] < KEEP_ABOVE and r['id'] not in sticky:
                continue
            n_extra += k >= CAP
            s = sources[r['src']]
            fix = fixes.get(r['id'], {})
            must = max(MUST // 2, MUST - lm_musts[ti])
            stars = 2 if k < must else 1 if k < MUST + INFLUENTIAL else 0
            ex = r['_ex']
            if ex:
                if ex not in used_existing:              # one extra listing per existing paper
                    used_existing.add(ex)
                    items[ti].append((stars, r['_rank'], ex))
                    n_ref += 1
                continue
            link = fix.get('link', link_for(r))
            row = [r['id'], r['_title'], fix.get('a') or fmt.authors(r['au']), str(r['y']),
                   fix.get('v') or fmt.venue(NAMES[s['issn']], r, s['issn'] in HANDBOOK_ISSN), link, r['c'], stars]
            pdf = free_copy(r, link)
            if pdf:
                row.append(pdf)
            items[ti].append((stars, r['_rank'], row))
            have.add(r['id'])
            n_new += 1

    for t in extra.get('topics', []):                       # econophysics
        ti = topic_index[f"{t.get('ar') or t['f']} > {t['tp']}"]
        for row in t['p']:
            if row[0] in dropped or row[0] in lm_ids or (landmarks.tkey(row[1]), landmarks.surname(row[2])) in lm_titles:
                continue
            fix = fixes.get(row[0], {})
            for k, col in (('t', 1), ('a', 2), ('y', 3), ('v', 4)):
                if fix.get(k):
                    row[col] = str(fix[k])
            rank = strength(row[6] or 0, int(row[3]))
            fake = {'doi': row[5] if not str(row[5]).startswith('http') else '', 'y': int(row[3]), 'au': []}
            ex = row[0] if row[0] in have else existing_id(fake, row[1], by_doi, by_title)
            if ex:
                if ex not in used_existing:
                    used_existing.add(ex)
                    items[ti].append((row[7], rank, ex))
                    n_ref += 1
                continue
            have.add(row[0])
            items[ti].append((row[7], rank, row))
            n_new += 1

    counts_file = os.path.join(ROOT, 'data', 'citations.json')
    cat_cites = json.load(open(counts_file))['c'] if os.path.exists(counts_file) else {}
    notes, n_lm, n_lm_ref = {}, 0, 0
    for L in lms:
        F = found.get(L['k'], {})
        ti = topic_index[L['tp']]
        if F.get('ex'):                                     # already in the monopoly bibliography: point at it
            p = cat_by_id[F['ex']]
            y = int(p['y']) if str(p.get('y', '')).isdigit() else L['y']
            c = cat_cites.get(p['id'], 0)
            entry, stars, rank = p['id'], p.get('s') or 0, strength(c, y) if c else -1
            if L['n'] and not p.get('n'):
                notes[p['id']] = L['n']
            n_lm_ref += 1
        else:
            pid, c, stars = F.get('id') or L['k'], F.get('c') or 0, L.get('s', 2)
            rank = strength(c, L['y']) if c else -1
            kind = landmarks.label(L)
            entry = [pid, L['t'], L['a'], str(L['y']), F.get('v') or L['v'], F.get('link') or '', c, stars,
                     F.get('pdf') or '', L['n']] + ([kind] if kind else [])
            have.add(pid)
            n_lm += 1
        items[ti].append((stars, rank, entry))
        for also in L.get('also', []):
            items[topic_index[also]].append((stars, rank, entry if isinstance(entry, str) else entry[0]))

    # Science landmarks (tools/sciences) that economics topics list too: a pointer to the science entry.
    sci_list = os.path.join(ROOT, 'tools', 'sciences', 'sci_landmarks.json')
    if os.path.exists(sci_list):
        sfound = json.load(open(os.path.join(ROOT, 'tools', 'sciences', 'sci_landmarks_found.json'), encoding='utf-8'))
        for L in json.load(open(sci_list, encoding='utf-8')):
            for also in L.get('econ_also', []):
                if also in topic_index:
                    F = sfound.get(L['k'], {})
                    rank = strength(F['c'], int(F.get('y') or L['y'])) if F.get('c') else -1
                    items[topic_index[also]].append((L.get('s', 2), rank, F.get('ex') or F.get('id') or L['k']))

    topics_out = []
    for ti, (f, ar, tp) in enumerate(topics):
        seen, entries = set(), []
        for stars, rank, e in sorted(items.get(ti, []), key=lambda x: (-x[0], -x[1])):
            pid = e if isinstance(e, str) else e[0]
            if pid not in seen:
                seen.add(pid)
                entries.append(e)
        topics_out.append({'f': f, 'ar': ar, 'tp': tp, 'p': entries})

    areas = [{'f': T.FIELD, 'name': a['name'], 'group': a['group'], 'blurb': a['blurb']} for a in T.AREAS]
    i = next(k for k, a in enumerate(areas) if a['group'] == 'Firms, markets & innovation')
    areas.insert(i, {'f': T.FIELD, 'name': T.EXISTING_AREA, 'group': 'Firms, markets & innovation',
                     'blurb': 'Monopoly, oligopoly, antitrust and regulation: the original 6,185-paper bibliography.'})
    areas += extra.get('areas', [])
    out = {'v': 2, 'built': date.today().isoformat(),
           'source': 'OpenAlex (openalex.org): most-cited papers of about 220 economics journals and handbook series, '
                     'plus individually chosen landmark books and classics',
           'cols': ['id', 't', 'a', 'y', 'v', 'link', 'c', 's', 'pdf', 'n', 'k'],
           'groups': [{'name': n, 'blurb': b} for n, b in T.GROUPS], 'areas': areas, 'topics': topics_out,
           'notes': notes}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    sizes = [len(t['p']) for t in topics_out]
    print(f'{n_new:,} papers from the journals ({n_extra:,} beyond a topic\'s first {CAP}), {n_lm:,} landmarks, and '
          f'{n_ref + n_lm_ref:,} pointers to papers in the monopoly bibliography, in {len(topics_out)} topics; '
          f'smallest topic {min(sizes)}, largest {max(sizes)}, {os.path.getsize(OUT) / 1e6:.1f} MB')
    return out, clf, by_topic


if __name__ == '__main__':
    main()
