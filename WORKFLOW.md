# Paper archive: summary workflow

Brendyn reads about 70 papers a day from this archive. He prints each paper, reads only the pages
the summary points to, and copies four "write down" lines by hand. The pipeline does the heavy lifting:
turning his PDFs into summaries on the site and a printable packet. The site itself is described in README.md.

## "Next batch": the summary routine

A batch is about 35 papers (two batches = one day of 70). Start each batch in a NEW chat so costs stay flat.
He will say something like "next batch" or "do #36–70". Papers are numbered in the site's list order
within a topic (#1 = first paper in the topic). The current topic is **Classical theory & history of thought**
(382 papers, #1–382). Work out the next range from `data/summaries.json`: the first numbers with no summary.

### 1. Get the PDFs (his computer, not the repo)

- The PDFs live in a folder on his computer, e.g. `Desktop/Classical Theory & History of Thought`
  (his computer is Windows). Get access to that folder and list it.
- After the first matching run, files are renamed `NNN <id> - <title>.pdf`, so stage only the batch's
  numbers (max 50 files at a time). Unrenamed files: stage them all and match.
- NEVER commit PDFs, extracted text or anything from `$PA_WORK` to this repo: it is public and the papers are copyrighted.

### 2. Prepare (scripts only, no reading)

```bash
export PA_WORK=~/pa-work
cd tools/pipeline
python3 extract.py <pdf-folder> --ocr     # text per page; OCRs image-only pages
python3 match.py                                            # which PDF is which paper; prints doubtful ones
python3 digest.py --range 36-70                              # short digests + jobs.json with a model per paper
```

- Settle DOUBTFUL matches by looking at the first lines of those texts only, then
  `python3 match.py --assign <key>=<id>`. Report papers with no PDF; don't guess.
- Then rename the matched files on his computer, using `$PA_WORK/renames.json` with `mv`.

### 3. Summarise with parallel workers

- Group `jobs.json` by model. Base model: about 8 papers per worker. Large model (books, ★★ must-reads, long or OCR'd papers): about 4 per worker.
- Run at most 5 workers at a time in parallel (model set from jobs.json). Prompt:
  `Follow tools/pipeline/WORKER.md exactly. Repo: <repo path>. PA_WORK=<path>. Papers: <ids>.`
- The orchestrator does NOT read digests, full texts or summaries itself. Workers report one line per paper.

### 4. Check, publish, print

```bash
python3 validate.py                 # every quote must be on the page it cites
```
- Re-run each failure once with a large-model worker. If it fails again, leave it out and list it for Brendyn.
- `python3 merge.py` copies passing summaries into `data/summaries.json` (quotes are never published).
- `python3 print_packet.py --range 36-70` makes the packet PDF in `$PA_WORK/packets/`. Share the packet.
- Commit `data/summaries.json` as `Summaries: #36–70 (<topic>)` and push to main. The site picks it up.
- Finish with: how many done, which were flagged or missing, and the packet.

## Other topics

`python3 tools/pipeline/make_download_list.py "<topic>"` builds a download checklist page for any topic,
and every pipeline script takes the topic name as its first argument.
