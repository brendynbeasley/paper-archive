"""Step 1: pull the text out of every PDF in a folder, page by page.

  python3 tools/pipeline/extract.py /path/to/pdfs [--ocr]

For each PDF writes $PA_WORK/text/<key>.json = {file, key, n, pages: [...], ocr_pages: [...]}.
<key> is a hash of the file's bytes, so re-running skips files already done.
Pages with almost no text (scans with no text layer) are listed in `low`;
with --ocr they are run through tesseract instead.
"""
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

from common import WORK, load_json, save_json

LOW_CHARS = 150  # a page with fewer characters than this is treated as image-only


def key_of(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def pdftotext(path):
    r = subprocess.run(["pdftotext", "-enc", "UTF-8", str(path), "-"], capture_output=True, text=True, errors="replace")
    pages = r.stdout.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def ocr_page(path, page_no):
    with tempfile.TemporaryDirectory() as d:
        base = Path(d) / "p"
        subprocess.run(["pdftoppm", "-r", "250", "-gray", "-png", "-f", str(page_no), "-l", str(page_no), str(path), str(base)],
                       capture_output=True)
        imgs = sorted(Path(d).glob("p*.png"))
        if not imgs:
            return ""
        r = subprocess.run(["tesseract", str(imgs[0]), "-", "--psm", "1"], capture_output=True, text=True, errors="replace")
        return r.stdout


def main(folder, ocr=False):
    out_dir = WORK / "text"
    pdfs = sorted(p for p in Path(folder).rglob("*") if p.suffix.lower() == ".pdf")
    done = skipped = flagged = 0
    for pdf in pdfs:
        key = key_of(pdf)
        target = out_dir / f"{key}.json"
        old = load_json(target)
        if old and (not ocr or not old.get("low")):
            old["file"] = str(pdf)
            save_json(target, old, indent=None)
            skipped += 1
            continue
        pages = pdftotext(pdf)
        low = [i + 1 for i, t in enumerate(pages) if len(t.strip()) < LOW_CHARS]
        ocr_pages = []
        if ocr and low:
            for n in low:
                pages[n - 1] = ocr_page(pdf, n)
                ocr_pages.append(n)
            low = [i + 1 for i, t in enumerate(pages) if len(t.strip()) < LOW_CHARS]
        save_json(target, {"file": str(pdf), "name": pdf.name, "key": key, "n": len(pages), "pages": pages,
                           "low": low, "ocr_pages": ocr_pages}, indent=None)
        done += 1
        if len(low) > max(2, len(pages) // 3):
            flagged += 1
            print(f"  needs OCR ({len(low)}/{len(pages)} pages blank): {pdf.name}")
    print(f"extracted {done}, already done {skipped}, needing OCR {flagged}  -> {out_dir}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], ocr="--ocr" in sys.argv)
