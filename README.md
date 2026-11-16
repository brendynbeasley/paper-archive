# Paper Archive

A personal archive for tracking papers. Every paper has four buttons, **Printed**, **Read**, **Notes** and **Researched**, and each one records the date you pressed it. The site runs on GitHub Pages and saves your progress back into this repo, so every device that opens the site sees the same archive.

Papers are organised in three levels: **field → area → topic**. The archive holds about 47,900 works:

- **Economics**: 30 areas and 219 topics, in seven groups (table below).
  - **Monopoly & market power** is the original archive: all 6,144 entries from *Monopoly and Market Power: The Extended Bibliography*, plus 41 foundational papers the bibliography leaves out, in 22 topics. Nothing in it has changed.
  - The other 29 areas hold about 16,700 works in 197 topics. Each topic lists up to 80 of the most-cited papers from about 220 economics journals and handbook series, any other paper in those journals cited 800 times or more, and the **landmarks**: about 1,220 books and classic papers chosen individually, each with a one-line note on what it contributed.
- **Econophysics**: 8 areas and 33 topics, about 2,000 works.
- **Mathematics**: 22 areas and 137 topics, about 14,100 works.
- **Statistics**: 18 areas and 107 topics, about 9,600 works.

Econophysics, mathematics and statistics are built the same way as economics, from about 210 journals of their own, papers on these subjects in physics, computer science, medical, psychology and general science journals, and about 4,600 landmarks that reach back to the first printed edition of Euclid's *Elements* (1482). Their areas are listed below, after the economics table.

| Group | Areas (papers and books listed) |
|---|---|
| **Theory & methods** | Microeconomic theory (706), Game theory & market design (709), Behavioral & experimental economics (623), Econometrics & quantitative methods (1,112) |
| **Macroeconomics & international** | Macroeconomics (717), Monetary economics & central banking (527), Economic growth & productivity (528), International trade (702), International finance & open-economy macro (537) |
| **Finance** | Asset pricing & financial markets (1,144), Corporate finance & governance (855), Banking, intermediation & financial crises (391) |
| **Firms, markets & innovation** | Monopoly & market power (6,185), Firms, organizations & entrepreneurship (467), Innovation, technology & the digital economy (471) |
| **Labor, people & public policy** | Labor economics (766), Economics of education (423), Health economics (588), Public economics (677), Inequality, poverty & mobility (356), Population, family & gender (345) |
| **Development, space & environment** | Development economics (862), Urban, regional & spatial economics (596), Environmental, energy & resource economics (615), Agricultural & food economics (346) |
| **Institutions, history & ideas** | Political economy & institutions (719), Law & economics (523), Economic history (629), History of economic thought & methodology (574), Culture, media & society (366) |

About 940 papers from the monopoly bibliography also belong in one of the new topics (Melitz 2003 under trade, for example), and some landmarks belong in two topics. They are listed in both places but are still one paper: tick it in one place and it is ticked in the other.

**Econophysics**

| Group | Areas (papers and books listed) |
|---|---|
| **Financial markets & models** | Statistical properties of markets (346), Market microstructure & order flow (202), Stochastic models & methods (304) |
| **Agents, wealth & networks** | Agent-based models (170), Wealth, income & firm dynamics (184), Networks & systemic risk (373) |
| **Complexity & society** | Complexity economics (244), Sociophysics & collective behavior (271) |

**Mathematics**

| Group | Areas (papers and books listed) |
|---|---|
| **Foundations & history** | Mathematical logic & foundations (579), History & philosophy of mathematics (436) |
| **Algebra & number theory** | Algebra (780), Number theory (812), Algebraic geometry (704) |
| **Geometry & topology** | Differential geometry (588), Topology (688), Geometry: classical, convex & discrete (491) |
| **Analysis** | Real & harmonic analysis (566), Complex analysis (385), Functional analysis & operator theory (468), Partial differential equations (701), Dynamical systems & ergodic theory (594) |
| **Probability & mathematical physics** | Probability theory (795), Mathematical physics (718) |
| **Discrete mathematics & computing** | Combinatorics (496), Graph theory (537), Theoretical computer science (698), Information & coding theory (476) |
| **Applied & computational mathematics** | Numerical analysis & scientific computing (846), Optimization & control (1,054), Applied mathematics & modeling (1,049) |

**Statistics**

| Group | Areas (papers and books listed) |
|---|---|
| **Inference & foundations** | Statistical inference (615), Bayesian statistics (672), History, philosophy & teaching of statistics (315) |
| **Models & methods** | Regression & linear models (801), Multivariate analysis (588), Nonparametric & semiparametric statistics (555), High-dimensional statistics (565), Time series analysis (663), Spatial & environmental statistics (573) |
| **Design, data & causality** | Design of experiments & quality (554), Survey sampling & measurement (420), Causal inference (491), Missing data & measurement error (328) |
| **Computing & learning** | Statistical computing & graphics (490), Statistical learning & machine learning (783) |
| **Applied statistics** | Biostatistics (606), Epidemiological statistics & meta-analysis (419), Psychometrics & social-science statistics (591) |

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
| `data/economics.json` | Every other area of economics | `tools/economics/build.py` |
| `data/sciences.json` | Econophysics, mathematics and statistics | `tools/sciences/sci_build.py` |
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
- In any list you can filter by progress (not started, in progress, done), by stars, to **Books**, or to papers with a **Free copy**, and sort by list order, most cited, newest, oldest, author or recently ticked.
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
- In every other topic, ★★ goes to the landmarks and to the papers ranked highest by citations: 8 of them in a topic with no landmarks, fewer where there are landmarks, but never fewer than 4. The papers ranked after those, down to the 24th, get ★. The ranking is the paper's citation count divided by the square root of its age, so that a strong recent paper can sit beside the classics, with a small bonus for papers whose title clearly matches the topic.
- A landmark that is a textbook or a survey rather than a first statement of an idea gets ★.
- In econophysics, mathematics and statistics a topic shows at most 15 two-star landmarks. Where a topic has more, the best-cited 15 keep ★★ and the rest get ★.

**cited N×** is the paper's citation count on [OpenAlex](https://openalex.org), a free index of scholarly works, at the time the catalog was built. Counts on Google Scholar are usually higher. A book shows a count only where OpenAlex has a well-cited record of it, and that count is usually too low, because citations to a book are spread over its editions.

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

A paper's title opens its DOI where there is one. Papers without a link show **Search Scholar ↗**, which opens a Google Scholar search instead. **Free copy ↗** appears where OpenAlex knows of a free-to-read copy (an author's page, a repository, an open-access journal). Nothing is stored in this repo but the listing: every paper and book is a link.

Most books have no link, because a book has no single address. A book's title opens the publisher's page only where OpenAlex and Crossref agree on one.

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

### The rest of economics

Everything in `data/economics.json` is built by the scripts in `tools/economics/`:

```bash
python3 tools/economics/fetch.py          # list the most-cited papers of each journal (resumes if stopped)
python3 tools/economics/altcheck.py       # journal details for papers filed under a working paper or reprint
python3 tools/economics/pool.py           # the 10,000 most-cited works in economics, whatever their source
python3 tools/economics/landmarks.py      # work out which record each landmark is
python3 tools/economics/build.py          # sort into topics, pick the top papers, write data/economics.json
python3 tools/economics/cites.py          # citation counts for the monopoly bibliography
```

The scripts fetch catalogue information only (titles, authors, journals, DOIs, citation counts), never the papers themselves. It is kept in `work/economics/`, which is not committed and can be deleted: it only saves asking again.

How it works:

1. `journals.py` lists the journals and handbook series. `fetch.py` asks OpenAlex for the most-cited papers of each one (about 88,000 records). A second, smaller request per journal asks for papers that have a copy in the journal but that OpenAlex files somewhere else first, such as a working-paper series or a later reprint. Many classics are recorded that way, and `altcheck.py` and `build.py` trace them back to the journal's year, volume and pages. Without an account OpenAlex allows about 1,000 requests a day; a full download takes about 790, and the scripts stop and resume if they run out.
2. `taxonomy.py` and the `tax_*.py` files define the areas and topics. Each topic has a list of phrases. `classify.py` scores every paper against every topic by the phrases in its title, keywords and abstract, with extra weight for rarer phrases and for journals that specialise in the area, and gives the paper to the topic that scores highest.
3. `build.py` drops what is not a paper, corrects years that disagree with the journal's volume number, keeps each topic's top 80 and any other paper cited 800 times or more, adds the landmarks, and writes the result. A paper already in `catalog.json` is not copied: the topic points at the existing entry.

A rebuild never removes a paper that is on the live site. `build.py` reads the last committed `data/economics.json` and keeps every paper in it, even one that newer papers have pushed out of its topic's top 80, so a tick can never be left without its paper. The one exception is an entry you add to `not_papers.json` because it is not a paper at all.

Paper IDs are OpenAlex work IDs (`W2752617332`), so progress stays attached to a paper across rebuilds, even if it moves to another topic. A landmark that OpenAlex has no usable record of has an ID of its own (`lm0123`).

### Landmark books and classics

The journal download cannot see books, papers in journals that are not on the list, or classics that OpenAlex has no journal for (Friedman's 1968 presidential address, for example). `tools/economics/landmarks.json` adds them one entry at a time: about 690 books and reports, from *The Wealth of Nations* to recent texts, and about 530 papers and chapters, such as Hardin's "The Tragedy of the Commons" in *Science* or Gale and Shapley's matching paper in the *American Mathematical Monthly*. On the site each one shows its note under the title, and a book is labelled **Book**. One entry looks like this:

```json
{"k": "lm0345", "a": "Friedman, M.", "y": 1968, "t": "The Role of Monetary Policy",
 "v": "*American Economic Review* 58(1): 1–17.",
 "tp": "Monetary economics & central banking > Monetary policy rules & central banks",
 "also": ["Monetary economics & central banking > Inflation & the Phillips curve"],
 "n": "Presidential address: monetary policy cannot hold unemployment below its natural rate without ever-rising inflation."}
```

`k` is the entry's permanent ID: give a new entry the next free number and never renumber. `v` is the publisher for a book (`"Princeton: Princeton University Press."`) and the journal in asterisks for a paper. `tp` is the topic, written `Area > Topic`, and `also` lists other topics that should show it too. `"s": 1` gives one star in place of two.

`landmarks.py` then decides which record each entry is: a paper already in the monopoly bibliography (the topic points at it), a record in the journal download or in the pool of most-cited works (the entry takes its OpenAlex ID and citation count), or, for a paper found in neither, a DOI from Crossref. A match needs the same title, and the same first author or a nearby year; a Crossref match also needs the same journal or the same first page. What it finds is saved in `landmarks_found.json`, which is committed, so an entry keeps the ID it was first given. After editing `landmarks.json`, run `landmarks.py` and then `build.py`.

To change the result:

- **Add or rename a topic, or change what lands in it:** edit the phrase lists in the `tax_*.py` files and run `build.py` again. It takes about a minute and needs no download.
- **Add a journal:** add it to `journals.py`, then run `fetch.py` and `build.py`.
- **Add a book or a classic paper:** add it to `landmarks.json`, then run `landmarks.py` and `build.py`.
- **Remove something that is not a paper** (a book review, an erratum): add its id to `not_papers.json`.
- **Correct one paper** (authors, year, title, or the topic it belongs in): add it to `fixes.json`. You can also move a single paper on the site with **⋯**; that is saved in `data/library.json` and survives rebuilds.

After a rebuild, raise `DATA_V` in `app.js` by one so that browsers fetch the new file.

What to expect from this part of the archive:

- Every paper from the journal download is a real indexed work with its DOI, but the sorting is automatic. A paper can sit in a topic that is only its second-best home, and OpenAlex occasionally lists an incomplete author list for older papers. The two-star papers of every topic were reviewed one by one for these problems, and the corrections are in `fixes.json` and `not_papers.json`; the rest were not.
- The landmark list was chosen entry by entry. Its papers were matched to a Crossref or OpenAlex record wherever one exists, and a typed citation that disagreed with Crossref was corrected. Its books, and the papers with no record (97 of them, mostly old *American Economic Review* articles and book chapters), were not checked against a catalogue, so a publisher, a year or a page number may be off.
- The choice of landmarks is a judgement, and so is the one-line note on each.
- About 75 entries that were on the site before the landmarks were added have been removed: they were reviews of books, listed under the book's title with the reviewer and the book's author as joint authors. The books themselves are now in the landmark list.

### Econophysics, mathematics and statistics

`data/sciences.json` is built the same way by the scripts in `tools/sciences/`, which reuse the classifier and cleaning rules in `tools/economics/`:

```bash
python3 tools/economics/econophysics.py   # econophysics papers in physics journals, by OpenAlex topic
python3 tools/sciences/sci_fetch.py       # list the most-cited papers of each journal and subject (resumes if stopped)
python3 tools/sciences/sci_altcheck.py    # journal details for papers filed under a preprint or reprint
python3 tools/sciences/sci_landmarks.py   # work out which record each landmark is
python3 tools/sciences/sci_build.py       # sort into topics, pick the top papers, write data/sciences.json
```

How it differs from economics:

- `skeleton.py` defines the 15 groups, 48 areas and 277 topics. Each topic's phrases are in the `phr_*.py` files, and `sci_taxonomy.py` puts the two together. Besides the title, keywords and abstract, the sorting gives a little weight to the subject labels OpenAlex attaches to each paper.
- `sci_sources.py` lists the journals: 133 in mathematics and 78 in statistics, some in both, in three tiers that decide how deep each download goes. It also asks for papers on these subjects wherever they appear: mathematics in physics, computer science and biology journals, statistics in medical, psychology and general science journals, and econophysics in physics journals, each picked out by OpenAlex's subject labels. Last, it lists the most-cited works in mathematics and in statistics, whatever their source. The whole download is about 580 requests.
- Each topic keeps up to 80 papers (60 in econophysics), plus any other paper cited more than 700 times in mathematics, 2,500 times in statistics or 600 times in econophysics. The bar is highest in statistics because methods papers used in medicine are cited very heavily.
- A paper can belong to two fields, such as a probability paper that is also statistics. It is listed in both but is still one paper. A work that is already in `catalog.json` or `economics.json` is not copied: the topic points at the existing entry.
- `sci_landmarks.json` holds about 4,600 books and classic papers in the same format as the economics list, from the first printed Euclid, Cardano's *Ars magna* and Newton's *Principia* to recent monographs. New entries have IDs `ls0001` and up. The econophysics landmarks that used to be in the economics list keep their `lm` IDs. `econ_also` lists topics in `economics.json` that should show an entry too, and `tools/economics/build.py` adds them.
- Corrections go in `tools/sciences/fixes.json` and `tools/sciences/not_papers.json`, as for economics. In `fixes.json`, `"not": ["Statistics"]` takes a paper out of a field it was downloaded for.
- Three helpers in `tools/sciences/` take area codes from `skeleton.py`, comma-separated. `preview.py CODES` shows how the current phrase lists sort those areas' papers, in about ten seconds and without a rebuild. `topic_dump.py CODES` lists what the last build put in each of their topics. `audit.py` checks, before you publish, that every paper on the live site still has its entry and that every cross-listing points at a real one.
- `sci_build.py` never removes a paper that is on the live site. That includes the econophysics papers that used to be in `economics.json`, which keep their IDs and ticks.

After a rebuild, raise `SCI_V` in `app.js` by one.

What to expect from this part:

- As in economics, every paper from the download is a real indexed work, but the sorting is automatic. The first 40 papers of every topic and a random sample of the rest were reviewed, and the corrections are in `fixes.json` and `not_papers.json`.
- The landmark papers were matched to a Crossref or OpenAlex record wherever one could be found: 3,041 of the 3,511. The books (about 1,080), and the papers with no record, mostly old ones in journals that have no DOIs, were not checked against a catalogue, so a publisher, a year or a page number may be off. Most old books have no link and show **Search Scholar ↗** instead.
- The choice of landmarks is a judgement, and so is the one-line note on each.
