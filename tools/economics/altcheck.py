"""Ask Crossref about the journal DOIs of papers that OpenAlex files outside their journal.

Usage: python3 tools/economics/altcheck.py            (after fetch.py; resumes)

fetch.py's second pull brings back papers whose main OpenAlex record is a working paper or a
reprint. Where OpenAlex also knows the journal's own DOI, Crossref gives the journal's year,
volume and pages for it, which build.py then uses (journal_copy). Answers are cached in
work/economics/crossref.json.
"""
import glob
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import crossref  # noqa: E402
import fetch  # noqa: E402


def main():
    dois = set()
    for f in glob.glob(os.path.join(fetch.CORPUS, '*_alt_*.jsonl')):
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            if r['c'] >= 20:
                for u in r.get('jurls') or []:
                    if 'doi.org/10.' in u:
                        dois.add(u.split('doi.org/', 1)[1].strip().lower())
    todo = [d for d in sorted(dois) if 'doi:' + d not in crossref.cache()]
    print(f'{len(dois):,} journal DOIs, {len(todo):,} to look up', flush=True)
    with ThreadPoolExecutor(max_workers=4) as ex:
        for n, _ in enumerate(ex.map(crossref.by_doi, todo)):
            if n % 100 == 99:
                crossref.save()
                print(f'  {n + 1}/{len(todo)}', flush=True)
    crossref.save()
    known = sum(1 for d in dois if crossref.cache().get('doi:' + d))
    print(f'Crossref knows {known:,} of them')


if __name__ == '__main__':
    main()
