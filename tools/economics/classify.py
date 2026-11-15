"""Sort corpus papers into taxonomy topics by the words in their title, keywords and abstract.

A phrase scores 4 in the title, 2 in the OpenAlex keywords, 1 in the abstract, times 1.4 for
two-word phrases and 1.7 for longer ones (longer phrases are more specific), times a rarity
weight between 0.5 and 1.5 (a phrase found in few papers says more than one found in
thousands). A topic's score is the sum of its four best phrases, plus 2 when the paper's
journal is at home in the topic's area. The best topic wins if it scores at least 2.6.
"""
import math
import re
import unicodedata
from collections import defaultdict

import taxonomy as T

W_TITLE, W_KW, W_ABS, HOME_BONUS, THRESHOLD, TOP_K = 4.0, 2.0, 1.0, 2.0, 2.6, 4


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = s.replace('&', ' and ')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def norm_phrase(p):
    """'minimum wage*' -> [('minimum', False), ('wage', True)]: the words of a phrase, each with a
    flag saying whether it may be followed by any ending."""
    out = []
    for w in re.sub(r'[^a-z0-9*& ]+', ' ', unicodedata.normalize('NFKD', p).lower()).split():
        parts = norm(w.replace('*', '')).split()           # 'r&d' becomes 'r', 'and', 'd'
        out += [(part, False) for part in parts]
        if out and parts and w.endswith('*'):
            out[-1] = (out[-1][0], True)
    return out


class Classifier:
    def __init__(self):
        self.topics = []                 # (area code, area name, topic name)
        self.phrases = []                # (topic idx, words, factor, home_only)
        self.exact = defaultdict(list)   # first word -> phrase ids
        self.prefix = defaultdict(list)  # first 3 letters -> phrase ids (wildcard first word)
        for area, name, plist in T.topics():
            ti = len(self.topics)
            self.topics.append((area['code'], area['name'], name))
            seen = set()
            for p in plist:
                words = norm_phrase(p)
                key = tuple(words)
                if not words or key in seen:
                    continue
                seen.add(key)
                n = len(words)
                factor = 1.0 if n == 1 else 1.4 if n == 2 else 1.7
                pid = len(self.phrases)
                self.phrases.append((ti, words, factor, T.is_home_only(area['code'], p)))
                w0, pre0 = words[0]
                (self.prefix[w0[:3]] if pre0 else self.exact[w0]).append(pid)
        self.area_topics = defaultdict(list)
        for i, (code, _, _) in enumerate(self.topics):
            self.area_topics[code].append(i)
        self.default = {code: next(i for i in self.area_topics[code] if self.topics[i][2] == name)
                        for code, name in T.DEFAULT_TOPIC.items()}
        self.rarity = [1.0] * len(self.phrases)

    def fit(self, papers):
        """Weight each phrase by how rare it is in titles and keywords across the corpus."""
        df = [0] * len(self.phrases)
        for p in papers:
            for pid in {h[0] for h in self.find(norm(p['t']) + ' | ' + ' | '.join(norm(k) for k in p.get('kw') or []))}:
                df[pid] += 1
        n = max(len(papers), 1000)
        base = math.log(n / 200)
        self.rarity = [min(1.5, max(0.5, math.log(n / (d + 1)) / base)) for d in df]
        return df

    def find(self, text):
        """[(phrase id, start, end)] for every phrase present in normalised text."""
        toks = text.split()
        hits = []
        n = len(toks)
        for i, tok in enumerate(toks):
            cands = self.exact.get(tok, ())
            pc = self.prefix.get(tok[:3], ())
            for pid in (*cands, *pc):
                words = self.phrases[pid][1]
                if i + len(words) > n:
                    continue
                ok = True
                for j, (w, pre) in enumerate(words):
                    t = toks[i + j]
                    if (not t.startswith(w)) if pre else (t != w):
                        ok = False
                        break
                if ok:
                    hits.append((pid, i, i + len(words)))
        return hits

    def longest(self, hits):
        """Drop a phrase that sits inside a longer match of the same topic ('exchange rate'
        inside 'real exchange rate'), so one keyword is not counted twice."""
        keep, spans = set(), {}
        for pid, i, j in sorted(hits, key=lambda h: h[1] - h[2]):
            ti = self.phrases[pid][0]
            if any(a <= i and j <= b for a, b in spans.get(ti, ())):
                continue
            spans.setdefault(ti, []).append((i, j))
            keep.add(pid)
        return keep

    def score(self, paper, home_code, forced_area=None):
        """Return (best topic idx or None, score, runner-up idx, runner-up score)."""
        title = self.longest(self.find(norm(paper['t'])))
        kws = self.longest(self.find(' | '.join(norm(k) for k in paper.get('kw') or [])))
        abst = self.longest(self.find(norm(paper.get('ab') or '')))
        home_areas = T.HOME.get(home_code, set())
        per = defaultdict(dict)                      # topic -> phrase id -> best weight
        for hits, w in ((abst, W_ABS), (kws, W_KW), (title, W_TITLE)):
            for pid in hits:
                ti, _, factor, home_only = self.phrases[pid]
                code = self.topics[ti][0]
                if home_only and code not in home_areas and code != forced_area:
                    continue
                if forced_area and code != forced_area:
                    continue
                per[ti][pid] = max(per[ti].get(pid, 0), w * factor * self.rarity[pid])
        scored = []
        for ti, ph in per.items():
            s = sum(sorted(ph.values(), reverse=True)[:TOP_K])
            if self.topics[ti][0] in home_areas or self.topics[ti][0] == forced_area:
                s += HOME_BONUS
            scored.append((s, -ti, ti))
        scored.sort(reverse=True)
        if scored and scored[0][0] >= THRESHOLD:
            best = scored[0]
            second = scored[1] if len(scored) > 1 else (0, 0, None)
            return best[2], best[0], second[2], second[0]
        if forced_area and forced_area in self.default:
            return self.default[forced_area], 0.0, None, 0.0
        return None, scored[0][0] if scored else 0.0, None, 0.0
