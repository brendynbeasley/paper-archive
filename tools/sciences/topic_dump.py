"""Show what the last build put in each topic, for review.

Usage: python3 tools/sciences/topic_dump.py CODES [N]
  For every topic of the given areas (comma-separated area codes): the N papers from the journal
  download listed first (default 40), then 15 picked at random from the rest. Landmarks (the
  entries with a note) are left out. Each line: OpenAlex id, citations, year, title, journal.
"""
import json
import os
import random
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'sciences'))
import skeleton  # noqa: E402

codes = set(sys.argv[1].split(','))
n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
areas = {a['name'] for a in skeleton.AREAS if a['code'] in codes}
data = json.load(open(os.path.join(ROOT, 'data', 'sciences.json'), encoding='utf-8'))
random.seed(2)
for t in data['topics']:
    if t['ar'] not in areas:
        continue
    rows = [p for p in t['p'] if isinstance(p, list) and not (len(p) > 9 and p[9])]
    print(f"\n## {t['ar']} > {t['tp']}  ({len(rows)} journal papers, {len(t['p']) - len(rows)} landmarks or pointers)")
    pick = rows[:n] + sorted(random.sample(rows[n:], min(15, len(rows[n:]))), key=rows.index)
    for k, p in enumerate(pick):
        j = re.match(r'(?:In )?\*([^*]+)\*', p[4] or '')
        print(f"{'  ' if k < n else 'r '}{p[0]} {p[6]:>6} {p[3]} {p[1][:95]} | {(j.group(1) if j else '')[:32]}")
