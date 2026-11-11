"""Step 3: build a short "digest" of each matched paper for the summary workers.

  python3 tools/pipeline/digest.py "Classical theory & history of thought" [--day N | --range A-B | --ids id1,id2] [--redo]

For each paper writes
  $PA_WORK/digest/<id>.md   catalog entry, a page map (headings per PDF page), and the
                            text of the pages that matter most (opening, intro, conclusion),
                            each marked "=== PDF page N ===". Usually 15-25% of the paper.
  $PA_WORK/full/<id>.md     every page, marked the same way, for workers to search when needed.
and $PA_WORK/jobs.json: the papers still to summarise, each routed to a model:
  large  books, ** must-reads, papers over 60 pages, or mostly OCR'd scans
  base   everything else
Papers already in data/summaries.json are skipped unless --redo.
"""
import re
import sys

from common import WORK, DATA, load_json, save_json, topic_papers, is_book

MAX_WORDS = 7000
COVER = re.compile(r"jstor|stable url|terms and conditions of use|this content downloaded", re.I)
REFS = re.compile(r"^\s*(references|bibliography|literature cited|works cited|notes and references)\s*$", re.I | re.M)
KEY_HEAD = re.compile(r"^\s*((?:[ivx]+|\d+)[.)]?\s+)?(introduction|conclusions?|concluding remarks|summary( and conclusions?)?|final remarks|preface|contents)\b", re.I | re.M)
HEAD = re.compile(r"^\s*(?:(?:[IVX]+|\d+(?:\.\d+)?)[.)]\s+[A-Z][^\n]{2,70}|[A-Z][A-Z \-,:']{5,60}|chapter [ivx\d]+[^\n]{0,60})\s*$", re.M)


def wc(s):
    return len(s.split())


def page_heads(text):
    hs = [m.group(0).strip() for m in HEAD.finditer(text)]
    hs += [m.group(0).strip() for m in KEY_HEAD.finditer(text)]
    seen, out = set(), []
    for h in hs:
        if h.lower() not in seen and len(h) < 80:
            seen.add(h.lower())
            out.append(h)
    return out[:4]


def build(p, t):
    pages = t["pages"]
    n = len(pages)
    content = [i for i in range(n) if not (i < 2 and COVER.search(pages[i]) and wc(pages[i]) < 400) and
               not (i >= n - 2 and COVER.search(pages[i]) and wc(pages[i]) < 150)]
    end = n
    for i in content:
        if i > n * 0.5 and REFS.search(pages[i]):
            end = i + 1  # keep the page the references start on (it often ends the conclusion)
            break
    body = [i for i in content if i < end] or content
    book = is_book(p, n)
    total = sum(wc(pages[i]) for i in body)
    if not book and total <= MAX_WORDS:
        chosen = list(body)
    else:
        chosen = set(body[:2] + body[-2:])
        for i in body:
            if KEY_HEAD.search(pages[i]):
                chosen.update({i, i + 1} if i + 1 in body else {i})
        if book:  # books: contents pages and the first page of each chapter the catalog points to
            chosen = {i for i in chosen if i < body[0] + 12 or re.search(r"contents", pages[i], re.I)}
        chosen = sorted(chosen)
        while sum(wc(pages[i]) for i in chosen) > MAX_WORDS and len(chosen) > 3:
            chosen.pop(len(chosen) // 2)  # drop from the middle, keep opening and close
    pmap = []
    for i in range(n):
        tag = "cover" if i not in content else ("refs" if i >= end else "")
        first = next((ln.strip() for ln in pages[i].splitlines() if len(ln.strip()) > 3), "")[:70]
        heads = "; ".join(page_heads(pages[i]))
        pmap.append(f"p{i + 1:>3} {tag:5} {wc(pages[i]):>4}w | {heads or first}")
    head = (f"# {p['id']} · #{p['n_']}\n\nTitle: {p['t']}\nAuthors: {p['a']}\nYear: {p['y']}\nVenue: {p['v']}\n"
            f"Catalog note: {p.get('n', '')}\nStars: {p.get('s', 0)} · Book: {book} · PDF pages: {n} · "
            f"Body pages: {body[0] + 1 if body else '-'}–{body[-1] + 1 if body else '-'} · Body words: {total}\n"
            f"OCR'd pages: {t.get('ocr_pages') or 'none'} · Blank pages: {t.get('low') or 'none'}\n")
    digest = head + "\n## Page map (PDF page, words, headings)\n\n" + "\n".join(pmap) + \
        f"\n\n## Selected pages ({len(chosen)} of {n}; full text in full/{p['id']}.md)\n\n" + \
        "\n\n".join(f"=== PDF page {i + 1} ===\n{pages[i].strip()}" for i in chosen)
    full = head + "\n" + "\n\n".join(f"=== PDF page {i + 1} ===\n{pages[i].strip()}" for i in range(n))
    ocr_heavy = len(t.get("ocr_pages") or []) > n / 3
    model = "large" if (book or p.get("s") == 2 or n > 60 or ocr_heavy) else "base"
    return digest, full, {"id": p["id"], "n": p["n_"], "model": model, "pages": n, "book": book,
                          "digest_words": wc(digest), "full_words": wc(full)}


def main(topic, sel, redo):
    papers = topic_papers(topic)
    matches = load_json(WORK / "matches.json", {})
    by_id = {}
    for key, m in matches.items():
        by_id.setdefault(m["id"], key)
    done = load_json(DATA / "summaries.json", {"s": {}})["s"]
    jobs = []
    for p in papers:
        if sel and not sel(p):
            continue
        if p["id"] not in by_id or (p["id"] in done and not redo):
            continue
        t = load_json(WORK / "text" / f"{by_id[p['id']]}.json")
        digest, full, job = build(p, t)
        (WORK / "digest").mkdir(parents=True, exist_ok=True)
        (WORK / "full").mkdir(parents=True, exist_ok=True)
        (WORK / "digest" / f"{p['id']}.md").write_text(digest, encoding="utf-8")
        (WORK / "full" / f"{p['id']}.md").write_text(full, encoding="utf-8")
        jobs.append(job)
    save_json(WORK / "jobs.json", jobs)
    dw = sum(j["digest_words"] for j in jobs)
    fw = sum(j["full_words"] for j in jobs)
    print(f"{len(jobs)} jobs: {sum(j['model'] == 'base' for j in jobs)} base, {sum(j['model'] == 'large' for j in jobs)} large; "
          f"digests {dw:,} words vs {fw:,} in full ({100 * dw / max(fw, 1):.0f}%)")


if __name__ == "__main__":
    a = sys.argv[1:]
    topic = a[0] if a and not a[0].startswith("--") else "Classical theory & history of thought"
    sel = None
    if "--day" in a:
        d = int(a[a.index("--day") + 1]); sel = lambda p: p["day_"] == d
    elif "--range" in a:
        lo, hi = map(int, a[a.index("--range") + 1].split("-")); sel = lambda p: lo <= p["n_"] <= hi
    elif "--ids" in a:
        ids = set(a[a.index("--ids") + 1].split(",")); sel = lambda p: p["id"] in ids
    main(topic, sel, "--redo" in a)
