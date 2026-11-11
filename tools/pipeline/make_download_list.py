"""Build a download checklist page for one topic.

  python3 tools/pipeline/make_download_list.py "Classical theory & history of thought"

Writes downloads/<slug>.html: every paper in list order, grouped by day (70 a day),
with its link, a Scholar search, a tick box, and a "Copy DOIs" button per day
for Zotero's "Add Item by Identifier".
"""
import html
import json
import sys
from urllib.parse import quote_plus

from common import REPO, DATA, PER_DAY, slug, topic_papers, is_book, load_json, save_json


def main(topic):
    papers = topic_papers(topic)
    rows = []
    for p in papers:
        doi = p["link"].split("doi.org/", 1)[1] if "doi.org/" in p.get("link", "") else ""
        scholar = "https://scholar.google.com/scholar?q=" + quote_plus(f'{p["t"]} {p["a"].split(",")[0]}')
        rows.append({
            "n": p["n_"], "d": p["day_"], "id": p["id"], "t": p["t"], "a": p["a"], "y": p["y"],
            "v": p["v"].replace("*", ""), "link": p.get("link", ""), "doi": doi, "sch": scholar,
            "book": is_book(p), "s": p.get("s", 0),
        })
    days = rows[-1]["d"] if rows else 0
    data = json.dumps(rows, ensure_ascii=False)
    title = f"Downloads · {topic}"
    page = TEMPLATE.replace("__TITLE__", html.escape(title)).replace("__TOPIC__", html.escape(topic)) \
        .replace("__N__", str(len(rows))).replace("__DAYS__", str(days)).replace("__PER__", str(PER_DAY)) \
        .replace("__KEY__", "pa-dl-" + slug(topic)).replace("__DATA__", data.replace("</", "<\\/"))
    out = REPO / "downloads" / f"{slug(topic)}.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8")
    reg = load_json(DATA / "downloads.json", {"v": 1, "lists": {}})
    reg["lists"][topic] = f"downloads/{slug(topic)}.html"
    save_json(DATA / "downloads.json", reg)
    print(f"{out.relative_to(REPO)}: {len(rows)} papers, {days} days, {sum(1 for r in rows if r['doi'])} with DOIs")


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--ink:#1c1830;--muted:#6b6680;--line:#e4e1ee;--soft:#f4f2fa;--acc:#5b4bd6;--ok:#1f9d6b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ink:#ece9f7;--muted:#a19cb6;--line:#2f2b42;--soft:#211e30;--acc:#9b8cff;--ok:#43c690}body{background:#16141f}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink)}
main{max-width:920px;margin:0 auto;padding:24px 16px 80px}
a{color:var(--acc)}h1{font-size:26px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 18px}
.bar{position:sticky;top:0;background:inherit;backdrop-filter:blur(8px);padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:2}
.pbar{flex:1;min-width:160px;height:8px;border-radius:9px;background:var(--soft);overflow:hidden}.pbar i{display:block;height:100%;background:var(--ok)}
button,select{font:inherit;border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:999px;padding:6px 12px;cursor:pointer}
h2{font-size:18px;margin:26px 0 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}h2 small{color:var(--muted);font-weight:500}
ol{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:28px 44px 1fr;gap:8px;padding:9px 4px;border-bottom:1px solid var(--line);align-items:start}
li.done{opacity:.5}li input{width:20px;height:20px;margin-top:2px}.n{color:var(--muted);font-variant-numeric:tabular-nums}
.t{font-weight:600}.m{color:var(--muted);font-size:13px}.links{font-size:13px;display:flex;gap:12px;margin-top:2px}
.tag{font-size:11px;border:1px solid var(--line);border-radius:6px;padding:0 5px;margin-left:6px;color:var(--muted)}
.hide-done li.done{display:none}.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--soft);padding:8px 14px;border-radius:10px}
</style></head><body><main>
<a href="../index.html">← Paper archive</a>
<h1>__TOPIC__</h1>
<p class="sub">__N__ papers in list order, __PER__ a day over __DAYS__ days. Save the PDFs into one folder with any file names; the matching script works out which is which. Tick each one as you save it (ticks are kept in this browser only).</p>
<div class="bar"><div class="pbar"><i id="pb"></i></div><span id="cnt"></span><button id="hide">Hide downloaded</button></div>
<div id="list"></div>
</main>
<script>
const ROWS=__DATA__, KEY="__KEY__";
let got={};try{got=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(got))}catch(e){}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function toast(m){const t=document.createElement("div");t.className="toast";t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),2200)}
function render(){
  const days={};ROWS.forEach(r=>(days[r.d]=days[r.d]||[]).push(r));
  document.getElementById("list").innerHTML=Object.entries(days).map(([d,rs])=>{
    const n=rs.filter(r=>got[r.id]).length, dois=rs.filter(r=>r.doi).length;
    return `<h2>Day ${d} <small>#${rs[0].n}–${rs[rs.length-1].n} · ${n}/${rs.length} downloaded</small>${dois?`<button data-copy="${d}">Copy ${dois} DOIs for Zotero</button>`:""}</h2><ol>`+rs.map(r=>`
    <li class="${got[r.id]?"done":""}"><input type="checkbox" data-id="${r.id}" ${got[r.id]?"checked":""} aria-label="Downloaded"><span class="n">#${r.n}</span>
    <div><div class="t">${esc(r.t)}${r.s===2?'<span class="tag">★★</span>':""}${r.book?'<span class="tag">book</span>':""}</div>
    <div class="m">${esc(r.a)} · ${esc(r.y)} · ${esc(r.v)}</div>
    <div class="links">${r.link?`<a href="${esc(r.link)}" target="_blank" rel="noopener">Open DOI ↗</a>`:""}<a href="${esc(r.sch)}" target="_blank" rel="noopener">Search Scholar ↗</a><span class="m">${r.id}</span></div></div></li>`).join("")+"</ol>";
  }).join("");
  const n=ROWS.filter(r=>got[r.id]).length;document.getElementById("cnt").textContent=`${n} / ${ROWS.length}`;
  document.getElementById("pb").style.width=(100*n/ROWS.length)+"%";
}
document.addEventListener("change",e=>{const id=e.target.dataset.id;if(!id)return;if(e.target.checked)got[id]=Date.now();else delete got[id];save();render()});
document.addEventListener("click",e=>{
  const d=e.target.dataset.copy;
  if(d){const txt=ROWS.filter(r=>r.d==d&&r.doi).map(r=>r.doi).join("\n");
    navigator.clipboard.writeText(txt).then(()=>toast("Copied. In Zotero: magic wand → paste → Add, then select all → Find Available PDF."),()=>prompt("Copy these DOIs:",txt));}
  if(e.target.id==="hide"){document.body.classList.toggle("hide-done");e.target.textContent=document.body.classList.contains("hide-done")?"Show all":"Hide downloaded"}
});
render();
</script></body></html>
"""

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Classical theory & history of thought")
