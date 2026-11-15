"""Turn raw OpenAlex fields into the citation style the archive already uses.

  authors  'Acemoglu, D., Johnson, S., & Robinson, J. A.'
  venue    '*American Economic Review* 91(5): 1369–1401.'
"""
import html
import re
import unicodedata

SMALL = {'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'from',
         'as', 'vs', 'via', 'per', 'into', 'over', 'under', 'between', 'versus', 'is', 'its', 'de', 'la', 'et'}
ACRONYMS = {'US', 'USA', 'UK', 'EU', 'EC', 'EEC', 'EMU', 'ECB', 'EMS', 'GDP', 'GNP', 'OECD', 'IMF', 'WTO', 'GATT',
            'NAFTA', 'FDI', 'CEO', 'CEOS', 'IPO', 'IPOS', 'ARCH', 'GARCH', 'EGARCH', 'ARMA', 'ARIMA', 'GMM', 'VAR',
            'CAPM', 'APT', 'OLS', 'IV', 'II', 'III', 'VI', 'DSGE', 'TFP', 'QMLE', 'MLE', 'LM', 'IS', 'PPP', 'OPEC',
            'NBER', 'CES', 'AIDS', 'HIV', 'NLS', 'PSID', 'CPS', 'FOMC', 'SEC', 'NYSE', 'OTC', 'REIT', 'REITS', 'ESOP',
            'LBO', 'RJR', 'ATM', 'TV', 'IT', 'ICT', 'DEA', 'CGE', 'OLG', 'RBC', 'UI', 'EITC', 'AFDC', 'HMO', 'FDA',
            'R&D', 'M&A', 'S&P', 'NYC', 'USSR', 'GDR', 'FRG', 'LDC', 'LDCS', 'NIC', 'NICS', 'MNC', 'MNCS', 'SME',
            'SMES', 'IQ', 'GLS', 'SUR', 'ML', 'AR', 'MA', 'ECM', 'VECM', 'PCA', 'CDS', 'ETF', 'ETFS', 'VC', 'ESG',
            'CSR', 'AI', 'UN', 'WWI', 'WWII', 'NIH', 'NSF', 'COVID', 'GE', 'IO', 'CV', 'WTP', 'WTA', 'CO2', 'SO2',
            'EPA', 'CAFE', 'IRS', 'VAT', 'TARP', 'TIPS', 'LIBOR', 'CDO', 'CDOS', 'MBS', 'ABS', 'QE', 'ZLB'}
PARTICLES = {'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'du', 'la', 'le', 'ter', 'ten',
             'st', 'st.', 'bin', 'al', 'el', 'das', 'do', 'dal', 'vom', 'zu', 'zur', 'af', 'av', 'mac', 'san'}
SUFFIX = {'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'ph.d.', 'md'}


def squash(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def smart_title(s):
    """Title-case a string that arrived in ALL CAPS."""
    out, start = [], True
    for raw in s.split(' '):
        m = re.match(r'^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$', raw)
        pre, core, post = m.groups()
        up = core.upper()
        if up in ACRONYMS or re.fullmatch(r'(?:[A-Z]\.)+[A-Z]?', up):
            w = up
        elif '-' in core:
            w = '-'.join(p.upper() if p.upper() in ACRONYMS or len(p) == 1 else p.capitalize() for p in core.split('-'))
        elif core.lower() in SMALL and not start:
            w = core.lower()
        else:
            w = core[:1].upper() + core[1:].lower()
        out.append(pre + w + post)
        start = raw.endswith((':', '?', '.', '!', '—'))
    return ' '.join(out)


def clean_title(t):
    t = html.unescape(t or '')
    t = re.sub(r'<[^>]+>', '', t)
    t = squash(t.replace('­', '').replace('​', ''))
    t = re.sub(r'^chapter\s+\d+[.:]?\s+', '', t, flags=re.I)
    t = re.sub(r'\s*[*†‡☆§¶]+\s*$', '', t)
    t = re.sub(r'\s*:$', '', t)
    t = re.sub(r'(?<=[a-z])\d$', '', t)                  # footnote digit glued to the last word
    letters = [c for c in t if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8 and len(letters) > 6:
        t = smart_title(t)
    if t.endswith('.') and not t.endswith('..') and not re.search(r'\b[A-Z]\.$', t):
        t = t[:-1]
    t = t.strip()
    if re.match(r'^[a-z]{2,}\s', t):                     # a sentence-case title that lost its capital
        t = t[0].upper() + t[1:]
    return t


def norm_key(s):
    s = unicodedata.normalize('NFKD', (s or '').replace('\u0131', 'i')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def split_name(name):
    """-> (surname, [given names]) from 'First M. Last', 'Last, First M.' or 'LAST, FIRST'."""
    name = squash(html.unescape(name or '')).strip(' ,;')
    name = re.sub(r'\s*\(.*?\)\s*', ' ', name).strip()
    if not name:
        return '', []
    letters = [c for c in name if c.isalpha()]
    if letters and all(c.isupper() for c in letters) and len(letters) > 3:
        name = ' '.join(p.capitalize() if len(p.strip('.')) > 1 else p for p in name.split(' '))
    if ',' in name:
        last, _, first = name.partition(',')
        first = first.strip()
        if first.lower().strip('.') in {s.strip('.') for s in SUFFIX}:      # 'Lucas, Jr.'
            parts = last.split()
            return (parts[-1], parts[:-1]) if len(parts) > 1 else (last.strip(), [])
        first = re.sub(r',?\s*(jr\.?|sr\.?|ii|iii|iv)$', '', first, flags=re.I)
        return last.strip(), first.split()
    parts = name.split()
    while len(parts) > 1 and parts[-1].lower() in SUFFIX:
        parts.pop()
    if len(parts) == 1:
        return parts[0], []
    i = len(parts) - 1
    while i > 1 and parts[i - 1].lower() in PARTICLES:
        i -= 1
    if i == 1 and parts[0].lower() in PARTICLES:
        i = 0
    return ' '.join(parts[i:]), parts[:i]


def initials(given):
    out = []
    for g in given:
        bits = [b for b in re.split(r'[-‐‑]', g) if b]
        ini = '-'.join(b[0].upper() + '.' for b in bits if b[0].isalpha())
        if ini:
            out.append(ini)
    return ' '.join(out)


def apa_name(raw, display):
    """OpenAlex gives the name as printed (raw) and its own tidy version (display). The tidy one
    is used unless it names somebody else, which happens when OpenAlex mixes up two authors."""
    raw, display = squash(unicodedata.normalize('NFC', raw or '')), squash(unicodedata.normalize('NFC', display or ''))
    name = display or raw
    if raw and display:
        d_last, _ = split_name(display)
        d_key = norm_key(d_last).split()
        if d_key and not any(t[:4] == d_key[-1][:4] for t in norm_key(raw).split()):
            name = raw
    last, given = split_name(name)
    if not given:
        l2, g2 = split_name(raw if name == display else display)
        if g2:
            last, given = l2, g2
    # Spell the surname as the paper printed it: OpenAlex's tidy names sometimes add accents the
    # author never used ('Römer' for Romer, 'Baumöl' for Baumol).
    if raw and ' ' not in last:
        for tok in re.split(r'[\s,]+', raw):
            if norm_key(tok) == norm_key(last) and not tok.isupper() and tok[:1].isupper():
                last = tok
                break
    last = unicodedata.normalize('NFC', re.sub('\u0131(?=[\u0300-\u036f])', 'i', unicodedata.normalize('NFD', last)))
    last = last.replace('‐', '-').replace('‑', '-')
    if last and last.islower():
        last = last.capitalize()
    ini = initials(given)
    return f'{last}, {ini}' if ini else last


def authors(au, limit=5):
    names, seen = [], set()
    for raw, display in au:
        n = apa_name(raw, display)
        k = norm_key(n)
        if n and k not in seen:
            seen.add(k)
            names.append(n)
    if not names:
        return ''
    if len(names) > limit:
        return ', '.join(names[:3]) + ', et al.'
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ', & ' + names[-1]


def first_surname(au):
    for raw, display in au:
        last, _ = split_name(raw or display)
        if last:
            return norm_key(last).split()[-1] if norm_key(last) else ''
    return ''


def venue(journal, r, handbook=False):
    vol, iss, fp, lp = (re.sub(r'[<>]', '', squash(str(r.get(k) or ''))) for k in ('vol', 'iss', 'fp', 'lp'))
    pages = f'{fp}–{lp}' if fp and lp and fp != lp else fp
    if handbook:
        s = f'In *{journal}*'
        if vol:
            s += f', vol. {vol}'
        return s + (f': {pages}.' if pages else '.')
    s = f'*{journal}*'
    if vol:
        s += f' {vol}' + (f'({iss})' if iss else '')
    return s + (f': {pages}.' if pages else '.')
