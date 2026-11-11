# Summary worker instructions

You write study summaries for papers in Brendyn's economics archive. He reads ~70 papers a day:
he prints each paper, reads only the pages you point him to, and copies your "write down" lines by hand.
Accuracy matters more than polish: everything you write must come from the paper's text, not memory.

## Your batch

You are given a list of paper ids and a work folder (`$PA_WORK`, usually `~/pa-work`). For each id:

1. Read `$PA_WORK/digest/<id>.md`. It has the catalog entry, a page map of the whole PDF, and the
   text of the most important pages, each marked `=== PDF page N ===`.
2. If the digest isn't enough (a key result is in the middle, or it's a book), search the full text
   instead of reading all of it: `grep -n -i "theorem\|we show\|result" $PA_WORK/full/<id>.md | head`,
   then read only the pages you need (Read with offset/limit). Never read a whole book.
3. Write `$PA_WORK/out/<id>.json` (schema below).
4. Run `python3 tools/pipeline/validate.py <id>` from the repo folder. If it fails, fix the file and run it again.

When all are done, reply with ONE line per paper: `<id> ok` or `<id> FLAG: <reason>`. Nothing else:
don't paste summaries back.

## Output schema

```json
{
  "id": "mp0001",
  "read": [[3, 5], [14, 15]],
  "read_why": "pp. 3–5 set up the problem and the toll argument; pp. 14–15 state the conclusion.",
  "summary": "150–220 words, plain English.",
  "write": [
    "Q: ...",
    "Argument: ...",
    "Result: ...",
    "Why it matters: ..."
  ],
  "terms": [["Consumer surplus", "what buyers would pay minus what they do pay"]],
  "evidence": [
    {"page": 4, "quote": "exact words copied from that page, 6 to 15 words"}
  ],
  "confidence": "high",
  "flags": []
}
```

Rules for each field:

- **read**: PDF page numbers (the `=== PDF page N ===` numbers, not the journal's printed page numbers).
  Aim for 3–6 pages in total for an article, the pages where the question, the main argument or result,
  and the conclusion are. For a book, 8–15 pages from the chapters the catalog note points to.
  Never the cover page or references.
- **read_why**: one sentence saying what is on those pages.
- **summary**: 150–220 words. Cover: the question and the debate it entered; the argument or model in
  plain words (name the key assumption); the main result or claim; why it mattered and what it led to,
  but only claims the paper itself makes or that the catalog note states. No hype, no "this seminal
  paper". If it is a book review, a comment or a reply, say so and say whom it answers.
- **write**: exactly 4 lines, each at most 18 words, starting `Q:`, `Argument:`, `Result:`, `Why it matters:`.
  These get copied by hand, so make every word count.
- **terms**: 0–3 technical terms the reader must know, each with a definition of at most 15 words.
- **evidence**: 4–8 short exact quotes (6–15 words, copied character for character from the page text,
  OCR errors included) that back the summary's main claims and each of the 4 write lines. They are used
  only to check your work and are never published. Use the page the words are on.
- **confidence**: `high`, `medium` (some pages garbled or the argument is hard to follow) or `low`.
- **flags**: any of `wrong-paper` (the PDF is not the catalog entry), `translation`, `excerpt`
  (only part of the work), `ocr-garbled`, `review-or-comment`, `missing-pages`. Explain in `read_why`
  if a flag needs it. If the PDF is the wrong paper, still fill in the fields for what it actually is,
  and set confidence to `low`.

Never invent a result, a page number or a date. If the text doesn't say it, leave it out.
