"""Look up citation counts for the papers in data/catalog.json (the monopoly bibliography).

Usage: python3 tools/economics/cites.py

Papers in data/economics.json already carry a count. This fills in the rest, for every
catalog paper that has a DOI link, by asking OpenAlex for 50 DOIs at a time (about 110
requests). The result, data/citations.json, lets the site sort the whole archive by
"Most cited" and show "cited N×" on every paper with a DOI.
"""
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch  # noqa: E402

OUT = os.path.join(fetch.ROOT, 'data', 'citations.json')
BATCH = 50


def main():
    papers = json.load(open(os.path.join(fetch.ROOT, 'data', 'catalog.json'), encoding='utf-8'))['papers']
    by_doi = {}
    for p in papers:
        link = p.get('link', '')
        if link.startswith('https://doi.org/'):
            doi = link[16:].lower()
            if ',' not in doi and '|' not in doi:
                by_doi.setdefault(doi, []).append(p['id'])
    old = json.load(open(OUT))['c'] if os.path.exists(OUT) else {}
    todo = [d for d, ids in by_doi.items() if any(i not in old for i in ids)]
    print(f'{len(by_doi):,} DOIs, {len(todo):,} to look up', flush=True)
    counts = dict(old)
    for k in range(0, len(todo), BATCH):
        chunk = todo[k:k + BATCH]
        d = fetch.get('works', {'filter': 'doi:' + '|'.join(chunk), 'per-page': 100, 'select': 'doi,cited_by_count'})
        if d is None:
            print('  stopped early: daily allowance reached; run again tomorrow', flush=True)
            break
        best = {}
        for w in d.get('results', []):
            doi = (w.get('doi') or '').replace('https://doi.org/', '').lower()
            best[doi] = max(best.get(doi, 0), w.get('cited_by_count') or 0)
        for doi in chunk:
            for pid in by_doi[doi]:
                counts[pid] = best.get(doi, 0)
        if (k // BATCH) % 20 == 19:
            print(f'  {k + BATCH:,} looked up, {fetch.state["remaining"]} requests left today', flush=True)
    counts = {k: v for k, v in counts.items() if v}
    json.dump({'v': 1, 'source': 'OpenAlex cited_by_count', 'date': date.today().isoformat(), 'c': counts},
              open(OUT, 'w'), separators=(',', ':'), sort_keys=True)
    print(f'{len(counts):,} papers with a citation count -> data/citations.json', flush=True)


if __name__ == '__main__':
    main()
