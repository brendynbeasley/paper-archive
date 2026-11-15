# Paper Archive

A personal archive for tracking papers. Every paper has four buttons, **Printed**, **Read**, **Notes** and **Researched**, and each one records the date you pressed it. The site runs on GitHub Pages and saves your progress back into this repo, so every device that opens the site sees the same archive.

Papers are organised in three levels: **field → area → topic**. The archive holds about 21,300 papers:

- **Economics**: 30 areas and 219 topics, in seven groups (table below).
  - **Monopoly & market power** is the original archive: all 6,144 entries from *Monopoly and Market Power: The Extended Bibliography*, plus 41 foundational papers the bibliography leaves out, in 22 topics. Nothing in it has changed.
  - The other 29 areas hold about 14,900 papers in 197 topics: for each topic, up to 80 of the most-cited papers from about 220 economics journals and handbook series.
- **Econophysics**: about 300 papers in 7 topics.
- **Statistics** and **Mathematics** start empty, ready for you to fill in.

| Group | Areas (papers listed) |
|---|---|
| **Theory & methods** | Microeconomic theory (640), Game theory & market design (640), Behavioral & experimental economics (560), Econometrics & quantitative methods (880) |
| **Macroeconomics & international** | Macroeconomics (640), Monetary economics & central banking (480), Economic growth & productivity (471), International trade (640), International finance & open-economy macro (480) |
| **Finance** | Asset pricing & financial markets (960), Corporate finance & governance (640), Banking, intermediation & financial crises (320) |
| **Firms, markets & innovation** | Monopoly & market power (6,185), Firms, organizations & entrepreneurship (400), Innovation, technology & the digital economy (320) |
| **Labor, people & public policy** | Labor economics (720), Economics of education (400), Health economics (560), Public economics (640), Inequality, poverty & mobility (320), Population, family & gender (320) |
| **Development, space & environment** | Development economics (800), Urban, regional & spatial economics (560), Environmental, energy & resource economics (560), Agricultural & food economics (320) |
| **Institutions, history & ideas** | Political economy & institutions (640), Law & economics (480), Economic history (560), History of economic thought & methodology (480), Culture, media & society (320) |

About 900 papers from the monopoly bibliography also belong in one of the new topics (Melitz 2003 under trade, for example). They are listed in both places but are still one paper: tick it in one place and it is ticked in the other.

## Setup (once)

1. Create a new **public** repo on GitHub, for example `paper-archive`, and push this folder to it.
2. In the repo, go to **Settings → Pages → Build and deployment**. Set the source to **Deploy from a branch**, pick `main` and `/ (root)`, then save. After about a minute the site is live at `https://<your-username>.github.io/paper-archive/`.
3. Create a token for editing: go to **GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → `paper-archive`
   - Permissions → Repository → **Contents: Read and write**
4. Open the site, click **Settings**, paste the token, then click **Test connection** and **Save**.

Do step 4 once on each device you want to edit from. Anyone with the link can view the site without a token.

## How it saves

| File | What it holds | Who writes it |
|---|---|---|
| `data/catalog.json` | The monopoly and market power bibliography | `tools/build_catalog.py` |
| `data/economics.json` | Every other area of economics, and econophysics | `tools/economics/build.py` |
| `data/citations.json` | Citation counts for the papers in `catalog.json` | `tools/economics/cites.py` |
| `data/library.json` | Papers you add, edits (links, notes, research links, moves), new fields and topics | The app |
| `data/progress.json` | Printed / read / notes / researched dates for each paper | The app |

Each change is committed to the repo about two seconds after you click. Quick clicks are batched into one commit, and the commit message lists them, for example `Read: A Theory of Oligopoly`. Your git history is therefore a dated log of everything you've done.

If two devices save at the same moment, the app merges both sets of changes. If you're offline, changes are kept in the browser and pushed the next time you open the site.

The token is stored only in the browser of the device where you entered it. It is never committed.

## Privacy

The repo, and so your progress and notes, is public. GitHub Pages on a private repo needs a paid GitHub plan. The app works the same way with a private repo, but then viewing also needs a token.

## Finding your way around

- **Overview** shows every field and area as a card: how many papers it holds, how many you have read, and a small chart of when its papers were published. It also shows your totals and, once you have ticked something, your last 26 weeks of activity.
- The **sidebar** lists the fields. Click one to open its areas, and an area to open its topics. The box at the top of the sidebar finds an area or topic by name.
- **Search** (press `/`) looks through every paper's title, authors, year and journal, ignoring accents. The best matches come first.
- In any list you can filter by progress (not started, in progress, done), by stars, or to papers with a **Free copy**, and sort by list order, most cited, newest, oldest, author or recently ticked.
- Each view has its own address, so the browser's Back button works and you can bookmark a topic.

## Adding papers

- **Add → One paper** for a single entry.
- **Add → Paste a list** for many papers at once, one per line: `Title | Authors | Year | Link`.
- **+ New field**, **+ New area** and **+ New topic** in the sidebar create groups. An area is optional: a topic can sit directly under a field.
- **⋯** on any paper sets or fixes its link, a research link (for example the repo where you did the research), notes, or moves it to another field, area or topic.

## Next up

**Next up** takes you through papers one at a time. Pick what to follow:

- **Market power reading plan:** the 610 must-reads of the monopoly bibliography in 14 phases, in the order they're best studied (`data/plan.json`). Each paper shows how deeply to read it, and the last paper of each phase shows that phase's task.
- **An area or topic:** any area, or one topic in it, with its must-reads first.
- **Everything, oldest first:** every paper in the archive, by year.

For each paper, the steps go in order: **Printed → Read → Notes → Researched**. Only the next step can be ticked and only the latest one can be undone, both here and in the full lists. When the fourth step is done, the next paper comes up. The Researched step takes the link to your research repo.

## Saving

Every click saves to the browser at once, then to GitHub about two seconds later. It also saves straight away when you switch tabs, lock your phone or close the page, and the site warns you if you try to close it mid-save. Until a token is set on a device, a yellow banner says how many changes are only in that browser. Once you add the token, they're pushed automatically.

## Stars and citation counts

**★★** marks a must-read and **★** an influential paper.

- In **Monopoly & market power** the stars come from the bibliography.
- In every other topic they come from citations: the 8 papers ranked highest in the topic get ★★ and the next 16 get ★. The ranking is the paper's citation count divided by the square root of its age, so that a strong recent paper can sit beside the classics, with a small bonus for papers whose title clearly matches the topic.

**cited N×** is the paper's citation count on [OpenAlex](https://openalex.org), a free index of scholarly works, at the time the catalog was built. Counts on Google Scholar are usually higher.

## Learning guides

Every paper has a **Learn** button. A paper with an interactive guide shows it filled in colour, and clicking it opens the guide. So far: *Dupuit's Bridge* (`learn/mp0001.html`), *Dupuit's Tolls* (`learn/mp0002.html`) and *Hadley's Railroad Lesson* (`learn/mp0004.html`), Hadley (1886). On a paper with no guide yet, the button shows a ready-made prompt to paste into an AI assistant to make one.

To add a guide:

1. Save the HTML file as `learn/<paper id>.html`. The id is shown in the prompt, for example `mp0001`.
2. Add it to `data/learn.json`:

   ```json
   "mp0001": { "file": "learn/mp0001.html", "title": "Dupuit's Bridge", "added": "2026-11-08" }
   ```

3. Commit and push. That paper's Learn button lights up.

## Summaries

A paper with a summary shows a **Summary** button. It opens the PDF pages to read, a 150–220 word summary, key terms and four lines to copy by hand. Summaries live in `data/summaries.json` and are written from the PDF's own text: scripts in `tools/pipeline/` extract and trim each paper, parallel workers summarise it (`tools/pipeline/WORKER.md`), and every claim is checked against an exact quote from the page it cites before it is published. The full routine is in `WORKFLOW.md`. PDFs and extracted text are never committed.

Each topic can have a **Download checklist** (button under the topic's title): every paper in order, 70 a day, with links and a "Copy DOIs for Zotero" button per day. Build one with `python3 tools/pipeline/make_download_list.py "<topic>"`. The pipeline works for any topic in the archive, old or new.

## Links

A paper's title opens its DOI where there is one. Papers without a link show **Search Scholar ↗**, which opens a Google Scholar search instead. **Free copy ↗** appears where OpenAlex knows of a free-to-read copy (an author's page, a repository, an open-access journal).

For the monopoly bibliography, `tools/find_links.py` looked each paper up in Crossref, the public registry of journal DOIs, and kept a link only when the title matched closely and the year (and, for a few years' gap, the first author) agreed. To retry lookups and rebuild:

```bash
python3 tools/find_links.py
python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
```

## Rebuilding the catalogs

### Monopoly & market power

```bash
python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
```

Paper IDs come from the order of entries in the markdown file, so progress stays attached to the right papers as long as that order doesn't change.

The bibliography was compiled from memory and not individually verified. Entries it marked "(verify)" show a **check citation** tag.

### The rest of economics, and econophysics

Everything in `data/economics.json` comes from OpenAlex and is built by the scripts in `tools/economics/`:

```bash
python3 tools/economics/fetch.py          # download the most-cited papers of each journal (resumes if stopped)
python3 tools/economics/econophysics.py   # the same for econophysics, by OpenAlex topic
python3 tools/economics/build.py          # sort into topics, pick the top papers, write data/economics.json
python3 tools/economics/cites.py          # citation counts for the monopoly bibliography
```

How it works:

1. `journals.py` lists the journals and handbook series. `fetch.py` asks OpenAlex for the most-cited papers of each one (about 88,000 records in all) and keeps them in `work/economics/`, which is not committed. Without an account OpenAlex allows about 1,000 requests a day; a full download takes about 510, and the script stops and resumes if it runs out.
2. `taxonomy.py` and the `tax_*.py` files define the areas and topics. Each topic has a list of phrases. `classify.py` scores every paper against every topic by the phrases in its title, keywords and abstract, with extra weight for rarer phrases and for journals that specialise in the area, and gives the paper to the topic that scores highest.
3. `build.py` drops what is not a paper, corrects years that disagree with the journal's volume number, keeps each topic's top 80, and writes the result. A paper already in `catalog.json` is not copied: the topic points at the existing entry.

Paper IDs are OpenAlex work IDs (`W2752617332`), so progress stays attached to a paper across rebuilds, even if it moves to another topic.

To change the result:

- **Add or rename a topic, or change what lands in it:** edit the phrase lists in the `tax_*.py` files and run `build.py` again. It takes about half a minute and needs no download.
- **Add a journal:** add it to `journals.py`, then run `fetch.py` and `build.py`.
- **Remove something that is not a paper** (a book review, an erratum): add its id to `not_papers.json`.
- **Correct one paper** (authors, year, title, or the topic it belongs in): add it to `fixes.json`. You can also move a single paper on the site with **⋯**; that is saved in `data/library.json` and survives rebuilds.

After a rebuild, raise `DATA_V` in `app.js` by one so that browsers fetch the new file.

What to expect from this part of the archive: every entry is a real indexed work with its DOI, but the sorting is automatic. A paper can sit in a topic that is only its second-best home, OpenAlex occasionally lists an incomplete author list for older papers, and books are missing because the source is journals and handbooks. The two-star papers of every topic were reviewed one by one for these problems, and the corrections are in `fixes.json` and `not_papers.json`; the rest were not.
