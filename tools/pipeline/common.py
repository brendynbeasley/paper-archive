"""Shared helpers for the summary pipeline.

Paths:
  repo data lives in   <repo>/data/
  working files live in $PA_WORK (default ~/pa-work), never in the repo,
  because they hold the text of copyrighted papers.
"""
import json
import os
import re
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
WORK = Path(os.environ.get("PA_WORK", Path.home() / "pa-work"))
PER_DAY = 70

BOOK_HINT = re.compile(r"\b(book|press|macmillan|london:|new york:|cambridge, ma|chapters?|ch\.)\b", re.I)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path, obj, indent=1):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write("\n")
    tmp.replace(path)


def catalog():
    return load_json(DATA / "catalog.json")["papers"]


def topic_papers(topic):
    """Papers in a topic, in the site's list order, numbered from 1."""
    out = [p for p in catalog() if p["tp"] == topic]
    for i, p in enumerate(out, 1):
        p["n_"] = i
        p["day_"] = (i - 1) // PER_DAY + 1
    return out


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def norm(s):
    """Lowercase, strip accents and punctuation, join hyphenated line breaks."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"-\s*\n\s*", "", s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


STOP = set("a an the of on in and to for its is as at by with from into de la le les des du et a l una el".split())


def words(s):
    return [w for w in norm(s).split() if w not in STOP and len(w) > 1]


def surnames(authors):
    """'Dupuit, J. & Smith, A. B.' -> ['dupuit', 'smith']"""
    out = []
    for part in re.split(r"&|;| and ", authors or ""):
        part = part.strip()
        if not part:
            continue
        name = part.split(",")[0] if "," in part else part.split()[-1]
        w = norm(name).split()
        if w:
            out.append(w[-1])
    return out


def is_book(p, pages=None):
    if pages and pages > 150:
        return True
    return bool(BOOK_HINT.search(p.get("v", ""))) and not re.search(r"\d+\s*\(\d+\)|\d+:\s*\d+", p.get("v", ""))
