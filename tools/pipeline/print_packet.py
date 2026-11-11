"""Step 7: build the printable packet for a day.

  python3 tools/pipeline/print_packet.py "Classical theory & history of thought" --day 1
  (or --range 1-35, or --ids mp0001,mp0002)

Writes $PA_WORK/packets/<name>.html and, with Chrome available, <name>.pdf.
Page 1 is a checklist of the day; then one block per paper with the pages to read,
the summary, the lines to copy and space for your own takeaway.
"""
import html
import shutil
import subprocess
import sys

from common import WORK, DATA, load_json, topic_papers

E = html.escape


def pages_str(read):
    parts = [f"{a}" if a == b else f"{a}–{b}" for a, b in read]
    return ("p. " if len(read) == 1 and read[0][0] == read[0][1] else "pp. ") + ", ".join(parts)


def n_pages(read):
    return sum(b - a + 1 for a, b in read)


def main(topic, sel, name):
    sums = load_json(DATA / "summaries.json", {"s": {}})["s"]
    papers = [p for p in topic_papers(topic) if sel(p)]
    have = [p for p in papers if p["id"] in sums]
    missing = [p for p in papers if p["id"] not in sums]
    total = sum(n_pages(sums[p["id"]]["read"]) for p in have)
    rows = "".join(
        f"<tr><td>☐</td><td>#{p['n_']}</td><td>{E(p['t'][:80])}</td><td>{E(p['a'].split(',')[0])} {E(p['y'])}</td>"
        f"<td>{pages_str(sums[p['id']]['read']) if p['id'] in sums else '<i>no summary yet</i>'}</td></tr>"
        for p in papers)
    blocks = []
    for p in have:
        s = sums[p["id"]]
        terms = "".join(f"<li><b>{E(a)}</b>: {E(b)}</li>" for a, b in s.get("terms", []))
        flags = f"<span class='flag'>{E(', '.join(s['flags']))}</span>" if s.get("flags") else ""
        blocks.append(f"""<section class="paper">
<div class="hd"><span class="num">#{p['n_']}</span><div><div class="t">{E(p['t'])}</div>
<div class="m">{E(p['a'])} · {E(p['y'])} · {E(p['v'].replace('*', ''))} · <span class="id">{p['id']}</span>{flags}</div></div></div>
<div class="read"><b>Read PDF {pages_str(s['read'])}</b> ({n_pages(s['read'])} pages). {E(s['why'])}</div>
<p class="sum">{E(s['sum'])}</p>
{f'<ul class="terms">{terms}</ul>' if terms else ''}
<div class="write"><div class="lbl">Write down</div>{''.join(f'<div>{E(w)}</div>' for w in s['write'])}</div>
<div class="mine"><div class="lbl">My takeaway</div><i></i><i></i><i></i></div>
</section>""")
    doc = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{E(name)}</title><style>
@page {{ size: letter; margin: 0.5in 0.55in; }}
body {{ font: 10pt/1.38 Georgia, 'Times New Roman', serif; color: #111; margin: 0; }}
h1 {{ font: 700 17pt/1.2 system-ui, sans-serif; margin: 0 0 2pt; }} .sub {{ color: #555; margin: 0 0 10pt; font-family: system-ui, sans-serif; font-size: 9pt; }}
table {{ border-collapse: collapse; width: 100%; font: 8.5pt/1.3 system-ui, sans-serif; }} td {{ border-bottom: 0.5pt solid #ccc; padding: 2.5pt 4pt; vertical-align: top; }}
.cover {{ break-after: page; }}
.paper {{ break-inside: avoid; border-top: 1.2pt solid #111; padding: 7pt 0 9pt; }}
.hd {{ display: flex; gap: 8pt; }} .num {{ font: 700 14pt system-ui, sans-serif; min-width: 34pt; }}
.t {{ font: 700 11pt/1.25 system-ui, sans-serif; }} .m {{ font: 8.5pt system-ui, sans-serif; color: #444; margin-top: 1pt; }}
.id {{ color: #888; }} .flag {{ margin-left: 6pt; padding: 0 4pt; border: 0.6pt solid #b00; color: #b00; border-radius: 3pt; }}
.read {{ margin: 5pt 0 3pt; padding: 3pt 6pt; background: #f1f1f1; font: 9pt/1.3 system-ui, sans-serif; }}
.sum {{ margin: 4pt 0; text-align: justify; }}
.terms {{ margin: 2pt 0 4pt 14pt; padding: 0; font-size: 9pt; }}
.write {{ border: 1pt solid #111; padding: 4pt 7pt; font: 9.5pt/1.4 system-ui, sans-serif; }}
.lbl {{ font: 700 7.5pt system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; color: #555; }}
.mine {{ margin-top: 5pt; }} .mine i {{ display: block; height: 17pt; border-bottom: 0.6pt solid #999; }}
</style></head><body>
<div class="cover"><h1>{E(topic)} · {E(name)}</h1>
<p class="sub">{len(papers)} papers · {len(have)} with summaries · about {total} pages to read in all{f' · {len(missing)} still need a PDF or summary' if missing else ''}</p>
<table>{rows}</table></div>
{''.join(blocks)}
</body></html>"""
    out = WORK / "packets"
    out.mkdir(parents=True, exist_ok=True)
    fn = out / f"{name}.html"
    fn.write_text(doc, encoding="utf-8")
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if chrome:
        pdf = out / f"{name}.pdf"
        subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf}", fn.as_uri()], capture_output=True, timeout=180)
        print(f"{pdf}  ({len(have)} papers, about {total} pages to read)")
    else:
        print(f"{fn}  (open in a browser and print to PDF)")


if __name__ == "__main__":
    a = sys.argv[1:]
    topic = a[0] if a and not a[0].startswith("--") else "Classical theory & history of thought"
    if "--day" in a:
        d = int(a[a.index("--day") + 1]); sel = lambda p: p["day_"] == d; name = f"day-{d:02d}"
    elif "--range" in a:
        r = a[a.index("--range") + 1]; lo, hi = map(int, r.split("-")); sel = lambda p: lo <= p["n_"] <= hi; name = f"papers-{lo:03d}-{hi:03d}"
    else:
        ids = set(a[a.index("--ids") + 1].split(",")); sel = lambda p: p["id"] in ids; name = "selected"
    main(topic, sel, name)
