"""Step 2: work out which paper each extracted PDF is.

  python3 tools/pipeline/match.py "Classical theory & history of thought" [--assign KEY=ID ...]

A file whose name already starts with a paper id (e.g. "007 mp0012 - ....pdf") is matched
by name. Otherwise the first pages are compared with every paper in the topic:
title-word coverage, author surname and year. Confident matches go to
$PA_WORK/matches.json; doubtful ones are listed for a person to settle with
--assign. Also writes $PA_WORK/renames.json: new file names "<#> <id> - <title>.pdf",
so later sessions can match by name alone.
"""
import re
import sys
from pathlib import Path

from common import WORK, load_json, save_json, topic_papers, words, surnames, norm, slug

ID_RE = re.compile(r"\b(mp\d{4}|fd\d{2})\b", re.I)


def score(p, head_words, head_norm):
    tw = set(words(p["t"]))
    if not tw:
        return 0.0
    cover = len(tw & head_words) / len(tw)
    sn = surnames(p["a"])
    auth = 1.0 if sn and all(s in head_norm for s in sn[:2]) else (0.5 if sn and sn[0] in head_norm else 0.0)
    year = 1.0 if p["y"][:4] and p["y"][:4] in head_norm else 0.0
    return cover * 0.7 + auth * 0.2 + year * 0.1


def main(topic, assigns):
    papers = topic_papers(topic)
    by_id = {p["id"]: p for p in papers}
    matches = load_json(WORK / "matches.json", {})
    for a in assigns:
        k, i = a.split("=", 1)
        matches[k] = {"id": i, "how": "manual", "score": 1.0}
    doubtful = []
    for f in sorted((WORK / "text").glob("*.json")):
        t = load_json(f)
        key = t["key"]
        if key in matches and matches[key].get("how") in ("manual", "name"):
            matches[key]["file"] = t["file"]
            continue
        m = ID_RE.search(t.get("name", ""))
        if m and m.group(1).lower() in by_id:
            matches[key] = {"id": m.group(1).lower(), "how": "name", "score": 1.0, "file": t["file"]}
            continue
        head = " ".join(t["pages"][:3]) + " " + Path(t.get("name", "")).stem
        head_norm = " " + norm(head) + " "
        head_words = set(words(head))
        ranked = sorted(((score(p, head_words, head_norm), p["id"]) for p in papers), reverse=True)
        (s1, id1), (s2, id2) = ranked[0], ranked[1]
        if s1 >= 0.6 and s1 - s2 >= 0.12:
            matches[key] = {"id": id1, "how": "auto", "score": round(s1, 3), "file": t["file"]}
        else:
            matches.pop(key, None)
            doubtful.append((key, t.get("name"), [(round(s, 2), i, by_id[i]["t"][:60]) for s, i in ranked[:3]]))
    # The same paper matched twice: keep both but report it.
    seen = {}
    for k, m in matches.items():
        seen.setdefault(m["id"], []).append(k)
    dups = {i: ks for i, ks in seen.items() if len(ks) > 1}
    save_json(WORK / "matches.json", matches)
    renames = []
    for k, m in matches.items():
        p = by_id.get(m["id"])
        if not p or not m.get("file"):
            continue
        new = f'{p["n_"]:03d} {p["id"]} - {slug(p["t"])[:50]}.pdf'
        if Path(m["file"]).name != new:
            renames.append({"from": Path(m["file"]).name, "to": new})
    save_json(WORK / "renames.json", renames)
    have = {m["id"] for m in matches.values()}
    missing = [p for p in papers if p["id"] not in have]
    print(f"matched {len(matches)} files to {len(have)} of {len(papers)} papers; {len(doubtful)} doubtful; {len(dups)} duplicates")
    for key, name, top in doubtful:
        print(f"  DOUBTFUL {key} {name}")
        for s, i, t in top:
            print(f"      {s:4} {i} {t}")
    for i, ks in dups.items():
        print(f"  DUPLICATE {i}: {ks}")
    save_json(WORK / "missing.json", [{"n": p["n_"], "id": p["id"], "t": p["t"]} for p in missing])
    print(f"  {len(missing)} papers have no PDF yet (see {WORK/'missing.json'})")


if __name__ == "__main__":
    args = sys.argv[1:]
    assigns = []
    if "--assign" in args:
        i = args.index("--assign")
        assigns = args[i + 1:]
        args = args[:i]
    main(args[0] if args else "Classical theory & history of thought", assigns)
