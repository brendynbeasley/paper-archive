"""Build data/sciences.json: Econophysics, Mathematics and Statistics.

Usage: python3 tools/sciences/sci_build.py           (after sci_fetch.py, and sci_landmarks.py)

The same recipe as the economics catalog (tools/economics/build.py): read the corpus, drop
what is not a paper and duplicates, sort each paper into a topic of its field
(sci_taxonomy.py and the classifier in tools/economics/classify.py), keep each topic's top
papers by age-adjusted citations, add the landmarks, and write the result.

A work that is already in the archive (data/catalog.json or data/economics.json) is not
copied: the topic points at the existing entry, so one paper has one set of ticks. The same
holds inside this file: a work that belongs to two fields is listed once and pointed to from
the other.

Nothing that has been published is dropped by a rebuild: every paper in the committed
data/sciences.json, and every econophysics paper that used to be in data/economics.json,
stays listed.

Hand-kept files: not_papers.json (ids of records that are not papers), fixes.json
(per-paper corrections as in economics, plus "not": [fields] for a paper that does not belong
in a field it was downloaded for), sci_landmarks.json (books and classics).
"""
import glob
import json
import math
import os
import re
import subprocess
import sys
import statistics
from collections import Counter, defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools', 'economics'))
import build as ebuild  # noqa: E402  (economics build: cleaning rules, journal copies, ranking)
import classify  # noqa: E402
import fmt  # noqa: E402
import landmarks as elm  # noqa: E402
import sci_taxonomy as T  # noqa: E402
import skeleton as K  # noqa: E402

WORK = os.path.join(ROOT, 'work', 'sciences')
OUT = os.path.join(ROOT, 'data', 'sciences.json')
THIS_YEAR = date.today().year
CAP = {'Econophysics': 60, 'Mathematics': 80, 'Statistics': 80}          # papers per topic
KEEP_ABOVE = {'Econophysics': 250, 'Mathematics': 250, 'Statistics': 250}  # listed even in a full topic
MUST, INFLUENTIAL = 8, 16
LM_MUST_MAX = 15          # two-star landmarks per topic; the rest of a longer list get one star
LANGS = {'Mathematics': {'en', 'fr', 'de', 'it', None}, 'Statistics': {'en', 'fr', None}, 'Econophysics': {'en', None}}
KEEP_TYPES = {'article', 'review', 'book-chapter', 'conference-paper', 'letter'}
JUNK = re.compile(
    r'^(erratum|errata|corrigend|correction|addendum|retraction|comments? on|reply|rejoinder|discussion|book reviews?|'
    r'reviews?$|review of|editor|editorial|introduction$|foreword|preface|index|front matter|back matter|contents|'
    r'announcements?|notes?$|news|in memoriam|obituar|list of|referees|report of the|minutes of|proceedings of the|'
    r'abstracts?( of)?|meeting|session|problems?( and solutions)?$|problem section|solutions?$|untitled|'
    r'title pending|a correction|a note$|symposium|colloquium|the [a-z ]+ prize|prizes?$|awards?$|'
    r'(the )?(journal|annals|bulletin|transactions|proceedings) of [a-z ,&()]+$|recent publications|books received|new books)',
    re.I)
FS_OVERRIDE = {           # downloads whose papers may only go to some areas (by file-name prefix)
    'group5': 'E:ep_networks+ep_social',   # network and statistical-mechanics papers from physics journals
}
OLD_EP_TOPICS = {          # the 7 econophysics topics before areas existed -> where their papers go now
    'Power laws, scaling & fat tails': 'Statistical properties of markets > Return distributions & fat tails',
    'Financial market dynamics & stylized facts': 'Statistical properties of markets > Volatility clustering & long memory',
    'Correlations, random matrices & networks': 'Statistical properties of markets > Cross-correlations & random matrix theory',
    'Multifractals, long memory & time-series methods': 'Stochastic models & methods > Fractal & detrended fluctuation analysis',
    'Agent-based models, herding & the minority game': 'Agent-based models > Herding, imitation & Ising-type models',
    'Wealth, income & firm-size distributions': 'Wealth, income & firm dynamics > Income & wealth distributions',
    'Complexity economics & statistical physics of economies': 'Complexity economics > Statistical mechanics of economies',
}


def load_corpus():
    """Every downloaded record once, with the union of the fields (and areas) it may go to."""
    rows = {}
    files = glob.glob(os.path.join(WORK, 'corpus', '*.jsonl'))
    extra = os.path.join(ROOT, 'work', 'economics', 'econophysics_raw.json')   # the first econophysics download
    def add(r):
        f = T.parse_fields(r.get('fs'))
        old = rows.get(r['id'])
        if old is None:
            r['_f'] = f
            rows[r['id']] = r
            return
        for k, v in f.items():                           # merge allowed areas: None means every area
            if k not in old['_f']:
                old['_f'][k] = v
            elif old['_f'][k] is not None:
                old['_f'][k] = None if v is None else old['_f'][k] | v
        if old.get('alt') and not r.get('alt'):          # the journal's own record wins over a reprint
            r['_f'] = old['_f']
            rows[r['id']] = r
        elif r.get('home') and not old.get('home'):
            old['home'] = r['home']
        old['c'] = max(old['c'], r['c'])
    for f in files:
        override = next((v for k, v in FS_OVERRIDE.items() if os.path.basename(f).startswith(k + '_')), None)
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            if override:
                r['fs'] = override
            add(r)
    if os.path.exists(extra):
        for r in json.load(open(extra, encoding='utf-8')):
            add(dict(r, fs='E', home=''))
    return list(rows.values())


def usable(r, dropped):
    t = (r['t'] or '').strip()
    if r['id'] in dropped or r['para'] or r['retr'] or not r['au'] or not r['y'] or not 1000 <= r['y'] <= THIS_YEAR:
        return False
    if r['type'] not in KEEP_TYPES and not (r['type'] == 'preprint' and r.get('alt')):
        return False
    if len(t) < 6 or JUNK.match(t):
        return False
    one_page = bool(r.get('fp')) and r.get('fp') == r.get('lp')
    if t.endswith('.') and (len(r['ab']) < 100 or one_page) and r['type'] != 'book-chapter':
        return False                                      # how OpenAlex records book reviews
    return True


def floor(field, y):
    """Fewest citations worth listing, by field and age."""
    if field == 'Mathematics':
        return 15 if y <= 2010 else 8 if y <= 2020 else 3
    if field == 'Econophysics':
        return 20 if y <= 2015 else 10 if y <= 2020 else 4
    return 40 if y <= 2015 else 20 if y <= 2020 else 8


def strength(c, y):
    return c / math.sqrt(max(THIS_YEAR - y, 0) + 2)


def existing_index():
    """Works already in the archive: data/catalog.json and data/economics.json."""
    cat = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    eco = json.load(open(os.path.join(ROOT, 'data', 'economics.json'), encoding='utf-8'))
    papers = [dict(id=p['id'], t=p['t'], a=p.get('a', ''), y=p.get('y', ''), link=p.get('link') or '') for p in cat]
    for t in eco['topics']:
        if t['f'] == 'Econophysics':
            continue                                      # econophysics moves into this file
        for p in t['p']:
            if isinstance(p, list):
                link = p[5] or ''
                papers.append(dict(id=p[0], t=p[1], a=p[2], y=p[3],
                                   link=link if link.startswith('http') else ('https://doi.org/' + link if link else '')))
    by_doi, by_title = {}, defaultdict(list)
    for p in papers:
        if p['link'].startswith('https://doi.org/'):
            by_doi.setdefault(p['link'][16:].lower(), p['id'])
        by_title[fmt.norm_key(p['t'])].append(p)
    return {p['id'] for p in papers}, by_doi, by_title


def last_published():
    """Ids published in the committed data/sciences.json (id -> 'Area > Topic'), and the published rows
    themselves (id -> (topic, row)): the econophysics rows of the committed data/economics.json under
    their old topic names, and every row of the committed data/sciences.json."""
    def show(path):
        try:
            return json.loads(subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:' + path], capture_output=True,
                                             check=True, timeout=30).stdout.decode('utf-8'))
        except Exception:
            return {}
    sci, eco = show('data/sciences.json'), show('data/economics.json')
    published = {}
    for t in sci.get('topics', []):
        for p in t['p']:
            if isinstance(p, list):
                published[p[0]] = f"{t['ar'] or t['f']} > {t['tp']}"
    old_ep = {}
    for t in eco.get('topics', []):
        if t['f'] == 'Econophysics':
            for p in t['p']:
                if isinstance(p, list):
                    old_ep[p[0]] = (t['tp'], p)
    for t in sci.get('topics', []):
        for p in t['p']:
            if isinstance(p, list):
                old_ep.setdefault(p[0], (published[p[0]], p))
    return published, old_ep


def prepare(dropped):
    corpus = load_corpus()
    regular = ebuild.volume_years(corpus)
    keep = []
    for r in corpus:
        if r.get('alt'):
            jc = ebuild.journal_copy(r, regular) if r['type'] not in ebuild.NOT_A_COPY else None
            if not jc or (r['type'] == 'book' and (not jc['lp'] or jc['fp'] == jc['lp'])):
                continue
            r.update(jc)
            r['type'] = 'article'
        if usable(r, dropped):
            keep.append(r)
    rows = ebuild.dedupe(keep)
    redated = ebuild.fix_years(rows, regular)
    return corpus, rows, redated


def classify_all(rows, clf, forced_by_src, fixes, topic_index):
    """For every paper and every field it may go to: (field, topic index, score)."""
    out = defaultdict(list)                               # topic idx -> papers
    field_of_topic = [T.FIELD_OF[code] for code, _, _ in clf.topics]
    for r in rows:
        fix = fixes.get(r['id'], {})
        place = fix.get('tp')
        for field, codes in r['_f'].items():
            if field in fix.get('not', []):            # a reviewer said it does not belong in this field
                continue
            allowed = T.CODES[field] if codes is None else (codes & T.CODES[field])
            if not allowed:
                continue
            ti, score, _, _ = clf.score(r, r.get('home', ''), forced_by_src.get(r.get('src')), allowed)
            if place in topic_index and field_of_topic[topic_index[place]] == field:
                ti, score = topic_index[place], 8.0
            if ti is not None:
                out[ti].append((r, score))
    return out


def main():
    dropped = set(json.load(open(os.path.join(HERE, 'not_papers.json')))) if os.path.exists(os.path.join(HERE, 'not_papers.json')) else set()
    fixes = json.load(open(os.path.join(HERE, 'fixes.json'), encoding='utf-8')) if os.path.exists(os.path.join(HERE, 'fixes.json')) else {}
    corpus, rows, redated = prepare(dropped)
    print(f'{len(corpus):,} records, {len(rows):,} usable papers, {redated} re-dated from their volume number')
    for r in rows:
        fix = fixes.get(r['id'], {})
        if str(fix.get('y', '')).isdigit():
            r['y'] = int(fix['y'])
        r['_title'] = fix.get('t') or fmt.clean_title(r['t'])

    clf = classify.Classifier(T)
    clf.fit(rows)
    topics = [(T.FIELD_OF[code], area, topic) for code, area, topic in clf.topics]
    topic_index = {f'{ar} > {tp}': i for i, (_, ar, tp) in enumerate(topics)}
    import sci_sources as J
    import sci_fetch
    cache = json.load(open(sci_fetch.SOURCES)) if os.path.exists(sci_fetch.SOURCES) else {}
    forced_by_src = {}
    for key, name, *_ in J.SOURCES:
        if name in T.FORCED_BY_NAME:
            forced_by_src[key if key.startswith('S') else cache.get(key)] = T.FORCED_BY_NAME[name]

    existing, by_doi, by_title = existing_index()
    published, old_ep = last_published()
    sticky = set(published) | set(old_ep)
    lms, found = load_landmarks()
    demote, lm_rank = landmark_stars(lms, found)
    lm_ids = {found[L['k']]['id'] for L in lms if found.get(L['k'], {}).get('id')}
    lm_titles = {(elm.tkey(L['t']), elm.surname(L['a'])) for L in lms if elm.kind(L['v']) in ('article', 'chapter')}
    candidates = classify_all([r for r in rows if r['id'] not in lm_ids and
                               (elm.tkey(r['_title']), fmt.first_surname(r['au'])) not in lm_titles],
                              clf, forced_by_src, fixes, topic_index)

    # Published papers that no topic claims now stay where they were.
    claimed = {r['id'] for lst in candidates.values() for r, _ in lst}
    by_id = {r['id']: r for r in rows}
    for pid in sticky - claimed - lm_ids:
        r = by_id.get(pid)
        where = published.get(pid) or OLD_EP_TOPICS.get(old_ep.get(pid, ('',))[0])
        if r is not None and where in topic_index:
            candidates[topic_index[where]].append((r, classify.THRESHOLD))

    items = defaultdict(list)                     # topic idx -> (stars, rank, row or id)
    listed, used_existing = {}, set()
    lm_musts = Counter(topic_index[L['tp']] for L in lms
                       if L.get('s', 2) == 2 and L['k'] not in demote and not found.get(L['k'], {}).get('ex'))
    n_new = n_ptr = n_extra = 0
    for ti, (field, area, topic) in enumerate(topics):
        ranked = []
        for r, score in candidates.get(ti, []):
            if r['c'] >= floor(field, r['y']) or r['id'] in sticky:
                ranked.append((strength(r['c'], r['y']) * (0.6 + 0.4 * min(1.0, score / 8)), r))
        ranked.sort(key=lambda x: -x[0])
        must = max(MUST // 2, MUST - lm_musts[ti])
        for k, (rank, r) in enumerate(ranked):
            if k >= CAP[field] and r['c'] < KEEP_ABOVE[field] and r['id'] not in sticky:
                continue
            n_extra += k >= CAP[field]
            stars = 2 if k < must else 1 if k < MUST + INFLUENTIAL else 0
            ex = r['id'] if r['id'] in existing else ebuild.existing_id(r, r['_title'], by_doi, by_title)
            if ex and ex != r['id'] and r['id'] in sticky:
                ex = None                                 # published with its own id: keep that id alive
            if ex or r['id'] in listed:
                pid = ex or r['id']
                if (pid, ti) not in used_existing:
                    used_existing.add((pid, ti))
                    items[ti].append((stars, rank, pid))
                    n_ptr += 1
                continue
            fix = fixes.get(r['id'], {})
            link = fix.get('link', ebuild.link_for(r))
            journal = r.get('j') or ''
            venue = fix.get('v') or (fmt.venue(journal, r) if journal else '')
            row = [r['id'], r['_title'], fix.get('a') or fmt.authors(r['au']), str(r['y']), venue, link, r['c'], stars]
            pdf = ebuild.free_copy(r, link)
            if pdf:
                row.append(pdf)
            items[ti].append((stars, rank, row))
            listed[r['id']] = ti
            n_new += 1

    # Published rows that are no longer in the corpus at all keep their old row (unless economics.json
    # now lists the paper itself, in which case the id lives on there).
    for pid, (old_tp, row) in old_ep.items():
        if pid not in listed and pid not in lm_ids and pid not in existing and not pid.startswith(('lm', 'ls')):
            where = OLD_EP_TOPICS.get(old_tp, old_tp)
            if where in topic_index:
                items[topic_index[where]].append((row[7], -1, row))
                listed[pid] = topic_index[where]
                n_new += 1

    notes, n_lm, n_lm_ptr = {}, 0, 0
    for L in lms:
        F = found.get(L['k'], {})
        if not F.get('ex') and F.get('id') in existing:      # economics lists this record already: point at it
            F = dict(F, ex=F['id'])
        ti = topic_index[L['tp']]
        if F.get('ex'):
            entry, stars, rank = F['ex'], L.get('s', 2), lm_rank[L['k']]
            if L['n']:
                notes[F['ex']] = L['n']
            n_lm_ptr += 1
        else:
            pid, c, stars = F.get('id') or L['k'], F.get('c') or 0, 1 if L['k'] in demote else L.get('s', 2)
            if pid in listed:                             # the journal pass listed it too: the landmark wins
                for t2 in items:
                    items[t2] = [x for x in items[t2] if (x[2] if isinstance(x[2], str) else x[2][0]) != pid]
            rank = lm_rank[L['k']]
            kind = elm.label(L)
            entry = [pid, L['t'], L['a'], str(F.get('y') or L['y']), F.get('v') or L['v'], F.get('link') or '', c, stars,
                     F.get('pdf') or '', L['n']] + ([kind] if kind else [])
            listed[pid] = ti
            n_lm += 1
        items[ti].append((stars, rank, entry))
        for also in L.get('also', []):
            if also in topic_index:
                items[topic_index[also]].append((stars, rank, entry if isinstance(entry, str) else entry[0]))

    topics_out = []
    for ti, (field, area, topic) in enumerate(topics):
        seen, entries, home_row = set(), [], None
        for stars, rank, e in sorted(items.get(ti, []), key=lambda x: (-x[0], -x[1])):
            pid = e if isinstance(e, str) else e[0]
            if pid in seen:
                continue
            seen.add(pid)
            entries.append(e)
        topics_out.append({'f': field, 'ar': area, 'tp': topic, 'p': entries})
    # A row must appear once in the file; any second listing of it becomes a pointer.
    first = {}
    for t in topics_out:
        for k, e in enumerate(t['p']):
            if isinstance(e, list):
                if e[0] in first:
                    t['p'][k] = e[0]
                else:
                    first[e[0]] = True

    areas = [{'f': a['field'], 'name': a['name'], 'group': a['group'], 'blurb': a['blurb']} for a in K.AREAS]
    out = {'v': 1, 'built': date.today().isoformat(),
           'source': 'OpenAlex (openalex.org): most-cited papers of the leading journals of each field, '
                     'plus individually chosen landmark books and classics',
           'cols': ['id', 't', 'a', 'y', 'v', 'link', 'c', 's', 'pdf', 'n', 'k'],
           'groups': [{'f': f, 'name': g, 'blurb': b} for f, g, b in K.GROUPS], 'areas': areas,
           'topics': topics_out, 'notes': notes}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    sizes = Counter()
    for t in topics_out:
        sizes[t['f']] += len(t['p'])
    print(f'{n_new:,} papers from the journals ({n_extra:,} beyond a topic\'s first papers), {n_lm:,} landmarks, '
          f'{n_ptr + n_lm_ptr:,} listings that point at a paper listed elsewhere; '
          + ', '.join(f'{f} {n:,}' for f, n in sizes.items()) + f'; {os.path.getsize(OUT) / 1e6:.1f} MB')
    return out, clf, candidates


def landmark_stars(lms, found):
    """Which two-star landmarks drop to one star (a topic keeps at most LM_MUST_MAX), and each
    landmark's rank for ordering. A landmark without a citation count ranks at its topic's median."""
    def imp(L):
        F = found.get(L['k'], {})
        return strength(F['c'], int(F.get('y') or L['y'])) if F.get('c') else None
    by_topic = defaultdict(list)
    for L in lms:
        by_topic[L['tp']].append(L)
    demote, rank = set(), {}
    for tp, lst in by_topic.items():
        known = [x for x in (imp(L) for L in lst) if x is not None]
        med = statistics.median(known) if known else 0
        for L in lst:
            x = imp(L)
            rank[L['k']] = med if x is None else x
        musts = [L for L in lst if L.get('s', 2) == 2 and not found.get(L['k'], {}).get('ex')]
        if len(musts) > LM_MUST_MAX:
            musts.sort(key=lambda L: -rank[L['k']])
            demote |= {L['k'] for L in musts[LM_MUST_MAX:]}
    return demote, rank


def load_landmarks():
    path = os.path.join(HERE, 'sci_landmarks.json')
    fpath = os.path.join(HERE, 'sci_landmarks_found.json')
    lms = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []
    found = json.load(open(fpath, encoding='utf-8')) if os.path.exists(fpath) else {}
    return lms, found


if __name__ == '__main__':
    main()
