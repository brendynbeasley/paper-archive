"""Ask Crossref about the journal DOIs of science papers that OpenAlex files outside their journal.

Usage: python3 tools/sciences/sci_altcheck.py            (after sci_fetch.py; resumes)

The same as tools/economics/altcheck.py, for work/sciences/corpus: where OpenAlex knows the
journal's own DOI of a paper it files under a reprint, Crossref gives the journal's year,
volume and pages, which the build uses. Answers are cached in work/economics/crossref.json.
"""
import glob
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'economics'))
import crossref  # noqa: E402


def main():
    dois = set()
    for f in glob.glob(os.path.join(ROOT, 'work', 'sciences', 'corpus', '*_alt_*.jsonl')):
        for line in open(f, encoding='utf-8'):
            r = json.loads(line)
            if r['c'] >= 15:
                for u in r.get('jurls') or []:
                    if 'doi.org/10.' in u:
                        dois.add(u.split('doi.org/', 1)[1].strip().lower())
    todo = [d for d in sorted(dois) if 'doi:' + d not in crossref.cache()]
    print(f'{len(dois):,} journal DOIs, {len(todo):,} to look up', flush=True)
    with ThreadPoolExecutor(max_workers=4) as ex:
        for n, _ in enumerate(ex.map(crossref.by_doi, todo)):
            if n % 200 == 199:
                crossref.save()
                print(f'  {n + 1}/{len(todo)}', flush=True)
    crossref.save()
    print(f'Crossref knows {sum(1 for d in dois if crossref.cache().get("doi:" + d)):,} of them')


if __name__ == '__main__':
    main()
