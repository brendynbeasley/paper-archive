"""Download the most-cited works in economics as a whole, whatever journal or book they are in.

Usage: python3 tools/economics/pool.py            (resumes; safe to stop and rerun)

fetch.py goes journal by journal, so it cannot see a book, a paper in a journal that is not
on the list, or a classic that OpenAlex files under a reprint. This pulls the 10,000 most-cited
works that OpenAlex places in "Economics, Econometrics and Finance" (50 requests) into
work/economics/pool/. Nothing from the pool enters the archive by itself. It is used for two
things:

  * landmarks.py looks a landmark up here first, to get its OpenAlex id, DOI and
    citation count;
  * `python3 tools/economics/pool.py gaps` lists the most-cited works that are not in the
    archive, which is how the landmark list was checked for omissions.
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch  # noqa: E402
import fmt  # noqa: E402

POOL = os.path.join(fetch.WORK, 'pool')
FIELD = 20                  # OpenAlex field: Economics, Econometrics and Finance
PAGES = 50                  # 200 works a page; OpenAlex stops plain paging at 10,000


def download():
    os.makedirs(POOL, exist_ok=True)
    got = 0
    for page in range(1, PAGES + 1):
        path = os.path.join(POOL, f'field{FIELD}_{page}.jsonl')
        if os.path.exists(path):
            continue
        d = fetch.get('works', {'filter': f'primary_topic.field.id:{FIELD}', 'sort': 'cited_by_count:desc',
                                'per-page': 200, 'page': page, 'select': fetch.SELECT})
        if d is None:
            print('  stopped early: daily allowance reached; run again tomorrow', flush=True)
            break
        with open(path + '.tmp', 'w', encoding='utf-8') as f:
            for w in d.get('results', []):
                f.write(json.dumps(fetch.slim(w, {'sid': '', 'name': ''}), ensure_ascii=False) + '\n')
        os.replace(path + '.tmp', path)
        got += len(d.get('results', []))
        if page % 10 == 0:
            print(f'  page {page}/{PAGES}, {fetch.state["remaining"]} requests left today', flush=True)
    print(f'{got:,} works downloaded this run; {len(glob.glob(os.path.join(POOL, "*.jsonl")))} of {PAGES} pages on disk')


def load():
    rows = {}
    for f in sorted(glob.glob(os.path.join(POOL, '*.jsonl'))):
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            rows.setdefault(r['id'], r)
    return list(rows.values())


def archive_keys():
    """Normalised titles of everything already in the archive."""
    keys = set()
    for p in json.load(open(os.path.join(fetch.ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']:
        keys.add(fmt.norm_key(p['t']))
    eco = os.path.join(fetch.ROOT, 'data', 'economics.json')
    if os.path.exists(eco):
        for t in json.load(open(eco, encoding='utf-8'))['topics']:
            for row in t['p']:
                if isinstance(row, list):
                    keys.add(fmt.norm_key(row[1]))
    return keys


def gaps(limit=400):
    have = archive_keys()
    seen = set()
    n = 0
    for r in sorted(load(), key=lambda r: -r['c']):
        k = fmt.norm_key(fmt.clean_title(r['t'] or ''))
        if not k or k in have or k in seen:
            continue
        seen.add(k)
        who = fmt.first_surname(r['au'])
        print(f"{r['c']:>6}  {r['y']}  {r['type'][:12]:12}  {who[:14]:14}  {(r['t'] or '')[:80]:80}  {(r['j'] or '')[:36]}")
        n += 1
        if n >= limit:
            break


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'gaps':
        gaps(int(sys.argv[2]) if len(sys.argv) > 2 else 400)
    else:
        download()
