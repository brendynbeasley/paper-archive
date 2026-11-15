"""Fill the Econophysics field: the most-cited econophysics papers on OpenAlex, sorted into topics.

Usage: python3 tools/economics/econophysics.py        (then run build.py, which merges the result)

Econophysics is spread over physics journals, so instead of sweeping journals this asks OpenAlex
for the most-cited works of its topic "Complex Systems and Time Series Analysis", plus works
that mention econophysics, and keeps the ones that are about markets, money or firms.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch  # noqa: E402
import fmt  # noqa: E402
from classify import norm  # noqa: E402

RAW = os.path.join(fetch.WORK, 'econophysics_raw.json')
OUT = os.path.join(fetch.WORK, 'extra_fields.json')
FIELD, CAP, MUST, INFLUENTIAL = 'Econophysics', 70, 8, 16
ECON = re.compile(r'econom|financ|market|stock|price|trading|trader|wealth|income|firm|trade|bank|currenc|'
                  r'exchange rate|investor|portfolio|volatil|returns|money|asset|econophys|gdp|inflation|crisis|'
                  r'crash|business|bitcoin|commodit|oil|gold|credit|debt')
TOPICS = [
 ('Power laws, scaling & fat tails', [
   'power law*', 'scaling', 'fat tail*', 'heavy tail*', 'pareto', 'zipf*', 'levy', 'scale invarian*', 'cubic law',
   'tail exponent*', 'stable distribution*', 'truncated levy', 'universality', 'scaling law*', 'tail index',
   'extreme value*', 'large fluctuation*', 'non gaussian', 'tsallis', 'q gaussian', 'superstatistic*']),
 ('Financial market dynamics & stylized facts', [
   'stylized fact*', 'volatility clustering', 'return distribution*', 'log periodic', 'bubble*', 'crash*',
   'price fluctuation*', 'price dynamics', 'market dynamics', 'order book*', 'limit order*', 'market impact',
   'price impact', 'high frequency', 'financial time series', 'stock market*', 'financial market*', 'foreign exchange',
   'returns', 'volatility', 'trading volume', 'price formation', 'market microstructure', 'option pricing',
   'stock price*', 'stock return*', 'leverage effect', 'bitcoin', 'cryptocurrenc*', 'gold', 'crude oil', 'oil price*']),
 ('Correlations, random matrices & networks', [
   'random matrix', 'cross correlation*', 'correlation matri*', 'minimum spanning tree*', 'hierarchical structure',
   'correlation network*', 'complex network*', 'network*', 'topology', 'interbank', 'systemic risk', 'contagion',
   'cascade*', 'debtrank', 'world trade web', 'trade network*', 'ownership network*', 'core periphery', 'correlation*',
   'planar maximally filtered', 'clustering', 'community structure', 'interdependen*', 'spillover*', 'connectedness']),
 ('Multifractals, long memory & time-series methods', [
   'multifractal*', 'detrended fluctuation', 'hurst', 'long memory', 'long range', 'long term memory', 'fractal*',
   'entropy', 'transfer entropy', 'permutation entropy', 'recurrence', 'wavelet*', 'detrended cross correlation',
   'scaling exponent*', 'self similar*', 'fractional', 'rescaled range', 'market efficiency', 'information flow',
   'complexity measure*', 'time series analysis', 'nonlinear dynamics', 'chaos', 'chaotic', 'persistence',
   'memory', 'dfa', 'mf dfa', 'visibility graph*', 'empirical mode decomposition', 'causality']),
 ('Agent-based models, herding & the minority game', [
   'agent based', 'minority game*', 'herd*', 'heterogeneous agent*', 'artificial stock market*', 'artificial market*',
   'microscopic simulation*', 'multi agent', 'el farol', 'opinion dynamics', 'ising', 'spin model*', 'percolation',
   'zero intelligence', 'chartist*', 'fundamentalist*', 'noise trader*', 'interacting agents', 'self organi*',
   'emergen*', 'social influence', 'imitation', 'voter model', 'opinion formation', 'bounded confidence',
   'evolutionary game*', 'cooperation', 'prisoner s dilemma', 'adaptive agents', 'heterogeneous beliefs',
   'learning', 'inductive reasoning', 'simulation*', 'market model*']),
 ('Wealth, income & firm-size distributions', [
   'wealth distribution*', 'income distribution*', 'kinetic', 'exchange model*', 'money distribution',
   'statistical mechanics of money', 'boltzmann', 'gibbs', 'wealth condensation', 'inequality', 'firm size*',
   'firm growth', 'gibrat', 'city size*', 'growth rate distribution*', 'laplace', 'thermodynamic*',
   'distribution of wealth', 'distribution of income', 'distribution of money', 'company growth', 'growth of firms',
   'business firms', 'wealth', 'income', 'saving propensity', 'gamma distribution']),
 ('Complexity economics & statistical physics of economies', [
   'complexity', 'complex system*', 'complex adaptive', 'economic complexity', 'product space',
   'self organized criticality', 'sandpile', 'evolutionary', 'increasing returns', 'path dependence',
   'nonequilibrium', 'non equilibrium', 'econophysics', 'statistical physics', 'statistical mechanics',
   'sociophysics', 'physics of', 'physicist*', 'economic growth', 'business cycle*', 'macroeconom*', 'crisis',
   'financial crisis', 'economy as', 'economic system*', 'input output', 'supply chain*', 'production network*']),
]


def fetch_raw():
    if os.path.exists(RAW):
        return json.load(open(RAW, encoding='utf-8'))
    src = {'sid': '', 'name': '', 'issn': ''}
    rows = {}
    jobs = [({'filter': 'primary_topic.id:T11270'}, 3), ({'filter': 'title_and_abstract.search:econophysics'}, 1)]
    for params, pages in jobs:
        for page in range(1, pages + 1):
            d = fetch.get('works', dict(params, sort='cited_by_count:desc', **{'per-page': 200}, page=page,
                                        select=fetch.SELECT))
            for w in (d or {}).get('results', []):
                r = fetch.slim(w, src)
                rows[r['id']] = r
    out = list(rows.values())
    json.dump(out, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False)
    return out


def phrase_hit(phrase, text):
    parts = []
    for w in phrase.split():
        star = w.endswith('*')
        core = norm(w.rstrip('*'))
        if core:
            parts.append(r'\s+'.join(re.escape(x) for x in core.split()) + (r'[a-z0-9]*' if star else ''))
    return re.search(r'(?<![a-z0-9])' + r'\s+'.join(parts) + r'(?![a-z0-9])', text) is not None


def main():
    rows = [r for r in fetch_raw()
            if r['type'] in ('article', 'review', 'book-chapter') and r['au'] and r['y'] and r['c'] >= 60
            and not r['para'] and not r['retr'] and r['lang'] in ('en', None)]
    by = {name: [] for name, _ in TOPICS}
    seen = set()
    for r in rows:
        title, kws, ab = norm(r['t']), ' | '.join(norm(k) for k in r['kw']), norm(r['ab'])
        if not ECON.search(title + ' ' + kws + ' ' + ab[:600]):
            continue
        key = fmt.norm_key(r['t'])
        if key in seen:
            continue
        seen.add(key)
        best, best_s = None, 0
        for name, phrases in TOPICS:
            s = sum(4 * phrase_hit(p, title) or 2 * phrase_hit(p, kws) or phrase_hit(p, ab) for p in phrases)
            if s > best_s:
                best, best_s = name, s
        if best and best_s >= 2:
            by[best].append(r)
    topics = []
    for name, _ in TOPICS:
        cands = sorted(by[name], key=lambda r: -r['c'] / (max(2026 - r['y'], 0) + 2) ** 0.5)[:CAP]
        entries = []
        for k, r in enumerate(cands):
            stars = 2 if k < MUST else 1 if k < MUST + INFLUENTIAL else 0
            link = r['doi'] or (r['url'] if r.get('url', '').startswith('http') and 'openalex' not in r['url'] else '')
            row = [r['id'], fmt.clean_title(r['t']), fmt.authors(r['au']), str(r['y']), fmt.venue(r['j'], r), link,
                   r['c'], stars]
            oa = r.get('oa') or ''
            if oa.startswith('http') and r['doi'] and r['doi'].lower() not in oa.lower():
                row.append(oa)
            entries.append(row)
        topics.append({'f': FIELD, 'ar': '', 'tp': name, 'p': entries})
        print(f'  {len(entries):3}  {name}')
    json.dump({'areas': [], 'topics': topics}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(sum(len(t['p']) for t in topics), 'econophysics papers ->', OUT)


if __name__ == '__main__':
    main()
