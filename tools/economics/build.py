"""Build data/economics.json: the most-cited papers of each topic in the economics taxonomy.

Usage: python3 tools/economics/build.py            (after tools/economics/fetch.py)

Steps: read the corpus, throw out non-papers and duplicates, sort every paper into a topic
(classify.py), keep each topic's top papers by age-adjusted citations, and write them in the
archive's citation style. A paper that is already in data/catalog.json (the monopoly
bibliography) is not copied: the topic just points at the existing entry, so one paper has
one set of ticks wherever it is listed.

Two hand-kept files correct what the automatic steps get wrong:
  not_papers.json  ids of records that are not papers (book reviews, errata, front matter)
  fixes.json       per-paper corrections: "a" authors, "y" year, "t" title, "v" venue,
                   "link" (empty = none), "tp" the topic it belongs in, written "Area > Topic".
                   An entry keyed by a catalog.json id (mp0001) controls that paper's extra
                   listing instead: "tp" names the topic, and an empty "tp" means none.
"""
import glob
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import classify  # noqa: E402
import fmt  # noqa: E402
import taxonomy as T  # noqa: E402
from journals import JOURNALS, HANDBOOKS  # noqa: E402

WORK = os.path.join(ROOT, 'work', 'economics')
OUT = os.path.join(ROOT, 'data', 'economics.json')
CAP, MUST, INFLUENTIAL = 80, 8, 16          # papers per topic; how many get two stars / one star
THIS_YEAR = date.today().year
KEEP_TYPES = {'article', 'review', 'book-chapter', 'conference-paper', 'letter'}
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
    rows = {}
    for f in glob.glob(os.path.join(WORK, 'corpus', '*.jsonl')):
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            if r['id'] not in rows or r['c'] > rows[r['id']]['c']:
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
    """OpenAlex sometimes holds one paper twice (a reprint, a second DOI): keep the most cited."""
    best = {}
    for r in rows:
        k = (fmt.norm_key(fmt.clean_title(r['t'])), fmt.first_surname(r['au']))
        if k not in best or r['c'] > best[k]['c']:
            if k in best and not r['doi']:
                r['doi'] = best[k]['doi']
            best[k] = r
    return list(best.values())


def fix_years(rows, corpus):
    """OpenAlex often dates a paper by its first working-paper version (or by the day an old issue
    was scanned), not by the journal issue. Where a journal publishes one volume a year, the volume
    number gives the real year, so use it when the two disagree by more than two years."""
    offsets = defaultdict(Counter)
    for r in corpus:
        v = str(r.get('vol') or '')
        if v.isdigit() and r['y']:
            offsets[r['src']][r['y'] - int(v)] += 1
    regular = {}                       # source -> (year minus volume, how far off counts as wrong)
    for sid, c in offsets.items():
        n, (best, _) = sum(c.values()), c.most_common(1)[0]
        share = sum(k for o, k in c.items() if abs(o - best) <= 1) / n
        if n >= 40 and share >= 0.93:
            regular[sid] = (best, 2)
        elif n >= 40 and share >= 0.7:
            regular[sid] = (best, 8)   # less regular journal: only trust the volume for big gaps
    changed = 0
    for r in rows:
        v = str(r.get('vol') or '')
        if r['src'] in regular and v.isdigit():
            offset, slack = regular[r['src']]
            expected = offset + int(v)
            if abs(r['y'] - expected) > slack and 1850 <= expected <= THIS_YEAR:
                r['y'] = expected
                changed += 1
    return changed


def strength(r):
    """Citations, discounted for age so that recent work can sit beside the classics."""
    return r['c'] / math.sqrt(max(THIS_YEAR - r['y'], 0) + 2)


def floor(y):
    return 40 if y <= 2015 else 20 if y <= 2020 else 8


def catalog_index():
    cat = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    by_doi, by_title = {}, defaultdict(list)
    for p in cat:
        if p.get('link', '').startswith('https://doi.org/'):
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


def main():
    sources = {s['sid']: s for s in json.load(open(os.path.join(WORK, 'sources.json')))}
    journal_names = {fmt.norm_key(n) for n in NAMES.values()} | {'the ' + fmt.norm_key(n) for n in NAMES.values()}
    drop_file = os.path.join(HERE, 'not_papers.json')
    dropped = set(json.load(open(drop_file))) if os.path.exists(drop_file) else set()
    fix_file = os.path.join(HERE, 'fixes.json')
    fixes = json.load(open(fix_file, encoding='utf-8')) if os.path.exists(fix_file) else {}
    corpus = load_corpus()
    rows = dedupe([r for r in corpus if usable(r, journal_names, dropped)])
    redated = fix_years(rows, corpus)
    print(f'{len(corpus):,} records, {len(rows):,} usable papers, {redated} re-dated from their volume number')

    clf = classify.Classifier()
    clf.fit(rows)
    topic_index = {f'{area} > {topic}': i for i, (_, area, topic) in enumerate(clf.topics)}
    by_doi, by_title = catalog_index()
    by_topic = defaultdict(list)
    for r in rows:
        s = sources[r['src']]
        fix = fixes.get(r['id'], {})
        if str(fix.get('y', '')).isdigit():
            r['y'] = int(fix['y'])
        r['_title'] = fix.get('t') or fmt.clean_title(r['t'])
        r['_ex'] = existing_id(r, r['_title'], by_doi, by_title)
        place = fix.get('tp', fixes.get(r['_ex'], {}).get('tp')) if (r['_ex'] or 'tp' in fix) else None
        if place == '':
            continue                                        # an existing paper that should not be listed twice
        ti, score, _, _ = clf.score(r, s['area'], T.FORCED.get(s['issn']))
        if place in topic_index:
            ti, score = topic_index[place], 8.0
        if ti is not None and r['c'] >= floor(r['y']):
            r['_rank'] = strength(r) * (0.6 + 0.4 * min(1.0, score / 8))
            by_topic[ti].append(r)

    used_existing, topics_out, n_new, n_ref = set(), [], 0, 0
    for ti, (code, area, topic) in enumerate(clf.topics):
        cands = sorted(by_topic.get(ti, []), key=lambda r: -r['_rank'])[:CAP]
        entries = []
        for k, r in enumerate(cands):
            s = sources[r['src']]
            fix = fixes.get(r['id'], {})
            title, ex = r['_title'], r['_ex']
            if ex:
                if ex not in used_existing:              # one extra listing per existing paper
                    used_existing.add(ex)
                    entries.append(ex)
                    n_ref += 1
                continue
            stars = 2 if k < MUST else 1 if k < MUST + INFLUENTIAL else 0
            row = [r['id'], title, fix.get('a') or fmt.authors(r['au']), str(r['y']),
                   fix.get('v') or fmt.venue(NAMES[s['issn']], r, s['issn'] in HANDBOOK_ISSN),
                   fix.get('link', link_for(r)), r['c'], stars]
            oa = r.get('oa') or ''
            if oa.startswith('http') and r['doi'] and r['doi'].lower() not in oa.lower():
                row.append(oa)
            entries.append(row)
            n_new += 1
        topics_out.append({'f': T.FIELD, 'ar': area, 'tp': topic, 'p': entries})

    areas = [{'f': T.FIELD, 'name': a['name'], 'group': a['group'], 'blurb': a['blurb']} for a in T.AREAS]
    i = next(k for k, a in enumerate(areas) if a['group'] == 'Firms, markets & innovation')
    areas.insert(i, {'f': T.FIELD, 'name': T.EXISTING_AREA, 'group': 'Firms, markets & innovation',
                     'blurb': 'Monopoly, oligopoly, antitrust and regulation: the original 6,185-paper bibliography.'})
    extra = os.path.join(WORK, 'extra_fields.json')            # other fields built by their own scripts
    if os.path.exists(extra):
        e = json.load(open(extra, encoding='utf-8'))
        areas += e.get('areas', [])
        have = {p[0] for t in topics_out for p in t['p'] if isinstance(p, list)}
        for t in e.get('topics', []):
            kept = []
            for row in t['p']:
                if row[0] in dropped:
                    continue
                fix = fixes.get(row[0], {})
                for k, col in (('t', 1), ('a', 2), ('y', 3), ('v', 4)):
                    if fix.get(k):
                        row[col] = str(fix[k])
                fake = {'doi': row[5] if not str(row[5]).startswith('http') else '', 'y': int(row[3]), 'au': []}
                ex = row[0] if row[0] in have else existing_id(fake, row[1], by_doi, by_title)
                if ex:
                    if ex not in used_existing:
                        used_existing.add(ex)
                        kept.append(ex)
                        n_ref += 1
                    continue
                have.add(row[0])
                kept.append(row)
                n_new += 1
            topics_out.append(dict(t, p=kept))
    out = {'v': 2, 'built': date.today().isoformat(),
           'source': 'OpenAlex (openalex.org): most-cited papers of about 220 economics journals and handbook series',
           'cols': ['id', 't', 'a', 'y', 'v', 'link', 'c', 's', 'pdf'],
           'groups': [{'name': n, 'blurb': b} for n, b in T.GROUPS], 'areas': areas, 'topics': topics_out}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    sizes = [len(t['p']) for t in topics_out]
    print(f'{n_new:,} new papers and {n_ref:,} pointers to existing ones in {len(topics_out)} topics; '
          f'smallest topic {min(sizes)}, {os.path.getsize(OUT) / 1e6:.1f} MB')
    return out, clf, by_topic


if __name__ == '__main__':
    main()
