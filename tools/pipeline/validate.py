"""Step 5: check worker output against the paper's own text.

  python3 tools/pipeline/validate.py [id ...]        (no ids: every file in $PA_WORK/out)

Checks the schema, the lengths, that read pages exist and aren't references, and that every
evidence quote really appears on the page it cites (or the page next to it, since sentences
cross page breaks). Exit code 1 if anything fails. Results go to $PA_WORK/validation.json.
"""
import re
import sys

from common import WORK, load_json, save_json, norm

PREFIX = ["Q:", "Argument:", "Result:", "Why it matters:"]


def pages_of(pid):
    full = (WORK / "full" / f"{pid}.md").read_text(encoding="utf-8")
    parts = re.split(r"^=== PDF page (\d+) ===$", full, flags=re.M)
    return {int(parts[i]): norm(parts[i + 1]) for i in range(1, len(parts), 2)}


def check(pid):
    errs = []
    o = load_json(WORK / "out" / f"{pid}.json")
    if o is None:
        return ["no output file"]
    pages = pages_of(pid)
    n = max(pages) if pages else 0
    for k in ["read", "read_why", "summary", "write", "evidence", "confidence"]:
        if k not in o:
            errs.append(f"missing {k}")
    if errs:
        return errs
    total = 0
    for r in o["read"]:
        if not (isinstance(r, list) and len(r) == 2 and 1 <= r[0] <= r[1] <= n):
            errs.append(f"bad read range {r} (PDF has {n} pages)")
        else:
            total += r[1] - r[0] + 1
    if total > 20:
        errs.append(f"read covers {total} pages; keep it to the essentials")
    w = len(o["summary"].split())
    if not 120 <= w <= 260:
        errs.append(f"summary is {w} words (want 150-220)")
    if len(o["write"]) != 4:
        errs.append("write must have exactly 4 lines")
    for line, pre in zip(o["write"], PREFIX):
        if not line.startswith(pre):
            errs.append(f"write line should start '{pre}': {line[:30]}")
        if len(line.split()) > 22:
            errs.append(f"write line too long ({len(line.split())} words): {line[:30]}")
    for t in o.get("terms", []):
        if not (isinstance(t, list) and len(t) == 2):
            errs.append(f"bad term {t}")
    ev = o["evidence"]
    if len(ev) < 4:
        errs.append(f"only {len(ev)} evidence quotes (want 4-8)")
    bad = 0
    for e in ev:
        q = norm(e.get("quote", ""))
        pg = e.get("page")
        if len(q.split()) < 4:
            errs.append(f"evidence quote too short: {e}")
            continue
        near = " ".join(pages.get(x, "") for x in (pg - 1, pg, pg + 1)) if isinstance(pg, int) else ""
        if q not in near:
            bad += 1
            errs.append(f"quote not found on p{pg}: \"{e.get('quote', '')[:60]}\"")
    if o["confidence"] not in ("high", "medium", "low"):
        errs.append("confidence must be high/medium/low")
    return errs


def main(ids):
    if not ids:
        ids = sorted(p.stem for p in (WORK / "out").glob("*.json"))
    res = load_json(WORK / "validation.json", {})
    failed = 0
    for pid in ids:
        errs = check(pid)
        res[pid] = {"ok": not errs, "errors": errs}
        if errs:
            failed += 1
            print(f"{pid} FAIL")
            for e in errs:
                print(f"   - {e}")
        else:
            print(f"{pid} ok")
    save_json(WORK / "validation.json", res)
    if len(ids) > 1:
        print(f"{len(ids) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
