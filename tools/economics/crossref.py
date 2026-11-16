"""Small Crossref client: look a DOI up, or find the DOI of a paper from its title.

Crossref (https://www.crossref.org) is the public registry of journal DOIs. It needs no key.
Answers are kept in work/economics/crossref.json so that nothing is asked twice.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(ROOT, 'work', 'economics', 'crossref.json')
UA = 'bibliography-builder/1.0'
API = 'https://api.crossref.org'

_lock = threading.Lock()
_cache = None
_next = [0.0]


def cache():
    global _cache
    if _cache is None:
        _cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    return _cache


def save():
    with _lock:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        tmp = CACHE + '.tmp'
        json.dump(cache(), open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
        os.replace(tmp, CACHE)


GAP = 1.05          # seconds between requests: Crossref allows anonymous clients about one a second


def _get(url):
    tries = 0
    while tries < 4:
        with _lock:                                   # at most about one request a second
            wait = _next[0] - time.time()
            _next[0] = max(time.time(), _next[0]) + GAP
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            if e.code == 429:                         # too fast: wait and try again, without counting it as a failure
                time.sleep(3)
                continue
            time.sleep(2 ** tries)
            tries += 1
        except Exception:
            time.sleep(2 ** tries)
            tries += 1
    return None


def slim(m):
    """The fields the archive uses, from a Crossref work record."""
    year = None
    for k in ('published-print', 'issued', 'published-online', 'published'):
        parts = ((m.get(k) or {}).get('date-parts') or [[None]])[0]
        if parts and parts[0]:
            year = parts[0]
            break
    page = str(m.get('page') or '')
    fp, _, lp = page.partition('-')
    return {'doi': (m.get('DOI') or '').lower(), 't': (m.get('title') or [''])[0], 'y': year,
            'j': (m.get('container-title') or [''])[0], 'vol': m.get('volume') or '', 'iss': m.get('issue') or '',
            'fp': fp.strip(), 'lp': lp.strip(), 'type': m.get('type') or '',
            'au': [a.get('family') or a.get('name') or '' for a in m.get('author') or []]}


def by_doi(doi):
    """Crossref's record for a DOI ({} when Crossref does not know it, None when it could not be asked)."""
    key = 'doi:' + doi.lower()
    c = cache()
    if key in c:
        return c[key]
    d = _get(f'{API}/works/{urllib.parse.quote(doi, safe="/")}')
    if d is None:
        return None
    out = slim(d['message']) if d.get('message') else {}
    with _lock:
        c[key] = out
    return out


def search(title, surname='', rows=10):
    """Crossref's best matches for a title (and first author's surname)."""
    key = f'q{rows}:' + title.lower() + '|' + surname.lower()
    c = cache()
    if key in c:
        return c[key]
    q = {'query.bibliographic': f'{title} {surname}'.strip(), 'rows': rows,
         'select': 'DOI,title,author,issued,published-print,container-title,volume,issue,page,type'}
    d = _get(f'{API}/works?' + urllib.parse.urlencode(q))
    if d is None:
        return None
    out = [slim(m) for m in (d.get('message') or {}).get('items', [])]
    with _lock:
        c[key] = out
    return out


def plain(s):
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()
