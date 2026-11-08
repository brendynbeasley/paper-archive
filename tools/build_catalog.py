"""Build data/catalog.json from the monopoly bibliography markdown.

Usage: python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
"""
import json, re, sys

SHORT = {
 1:"Classical theory & history of thought", 2:"Structure–conduct–performance & market structure",
 3:"Welfare, rent-seeking & political economy", 4:"Oligopoly & strategic behavior", 5:"Collusion & cartels",
 6:"Vertical relations, exclusion & buyer power", 7:"Measuring market power & markups",
 8:"Market power in macroeconomics", 9:"Monopsony & labor markets", 10:"Antitrust law & economics",
 11:"Mergers", 12:"Networks, platforms & digital markets", 13:"Innovation & competition",
 14:"Natural monopoly & regulation", 15:"Monopoly pricing", 16:"Health care & pharmaceuticals",
 17:"Finance & banking", 18:"Economic history of monopoly", 19:"International trade",
 20:"Developing & emerging economies", 21:"Other fields & mechanisms", 22:"Surveys & handbooks",
}
ENTRY = re.compile(r'^(?P<a>.+?)\s\((?P<y>\d{4}[^)]*)\)\.\s*(?P<rest>.*)$')

def parse(text):
    t = text.strip()
    stars = 2 if t.startswith('★★') else 1 if t.startswith('★') else 0
    t = t.lstrip('★ ').strip()
    verify = '(verify' in t
    body, _, note = t.partition(' — ')
    m = ENTRY.match(body)
    if not m:
        return dict(t=body, a='', y='', v='', n=note.strip(), s=stars, vf=verify)
    rest = m.group('rest')
    title, venue = rest, ''
    q = re.match(r'^"(.+?)"\s*(.*)$', rest) or re.match(r'^\*(.+?)\*\.?\s*(.*)$', rest)
    if q:
        title, venue = q.group(1).strip(), q.group(2).strip()
    else:
        title, _, venue = rest.partition('. ')
    title = re.sub(r'\s*\[[^\]]*\]$', '', title).rstrip('.').strip().lstrip('"')  # drop translated titles in brackets
    return dict(t=title, a=m.group('a').strip(), y=m.group('y')[:4], v=venue, n=note.strip(), s=stars, vf=verify)

def main(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if re.match(r'^## 1\. ', l))
    sec, sub, out = 0, '', []
    for l in lines[start:]:
        m = re.match(r'^## (\d+)\. ', l)
        if m:
            sec, sub = int(m.group(1)), ''
            continue
        if l.startswith('### '):
            sub = l[4:].strip()
            continue
        if l.startswith('- '):
            e = parse(l[2:])
            e.update(id='mp%04d' % (len(out) + 1), f='Economics', tp=SHORT[sec], st=sub)
            out.append(e)
    # 41 classics that the bibliography leaves out (they sit on its companion curated list)
    out += json.load(open('data/foundations.json', encoding='utf-8'))
    json.dump({'v': 1, 'source': 'Monopoly and Market Power: The Extended Bibliography (1 Nov 2026)', 'papers': out},
              open('data/catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(out), 'papers;', sum(1 for e in out if not e['a']), 'unparsed author/year')

main(sys.argv[1])
