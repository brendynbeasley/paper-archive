"""Step 6: copy validated summaries into data/summaries.json (what the site shows).

  python3 tools/pipeline/merge.py [id ...]     (no ids: every output that passed validation)

Evidence quotes stay in $PA_WORK and are never published.
"""
import sys
from datetime import date

from common import WORK, DATA, load_json, save_json


def main(ids):
    val = load_json(WORK / "validation.json", {})
    jobs = {j["id"]: j for j in load_json(WORK / "jobs.json", [])}
    path = DATA / "summaries.json"
    store = load_json(path, {"v": 1, "s": {}})
    ids = ids or [i for i, v in val.items() if v["ok"]]
    added = 0
    for pid in ids:
        if not val.get(pid, {}).get("ok"):
            print(f"skip {pid}: not validated")
            continue
        o = load_json(WORK / "out" / f"{pid}.json")
        store["s"][pid] = {
            "read": o["read"], "why": o["read_why"], "sum": o["summary"], "write": o["write"],
            "terms": o.get("terms", []), "conf": o["confidence"], "flags": o.get("flags", []),
            "model": o.get("model") or jobs.get(pid, {}).get("model", ""), "added": date.today().isoformat(),
        }
        added += 1
    store["s"] = dict(sorted(store["s"].items()))
    save_json(path, store)
    print(f"merged {added}; data/summaries.json now has {len(store['s'])} summaries")


if __name__ == "__main__":
    main(sys.argv[1:])
