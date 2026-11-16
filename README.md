# Paper Archive

A public reading archive for tracking papers. You pick a **focus** (a field, an area, a single topic, or the market power reading plan) and work through it one topic at a time. Every paper goes through six steps, **Downloaded → Printed → Read → Notes → Researched → Flashcards**, and each button records the date you pressed it. You set weekly goals for each step, and **This week** lines up what to do to meet them. The site runs on GitHub Pages and saves every click back into this repo, so any device that opens it, yours or anyone else's, sees the same archive and can keep working on it.

Papers are organised in three levels: **field → area → topic**. The archive holds about 67,400 works:

- **Economics**: 30 areas and 219 topics, in seven groups (table below).
  - **Monopoly & market power** is the original archive: all 6,144 entries from *Monopoly and Market Power: The Extended Bibliography*, plus 41 foundational papers the bibliography leaves out, in 22 topics. Nothing in it has changed.
  - The other 29 areas hold about 28,100 works in 197 topics. Each topic lists its 80 most-cited papers from about 220 economics journals and handbook series, then every other paper from those journals cited 250 times or more, and the **landmarks**: about 1,220 books and classic papers chosen individually, each with a one-line note on what it contributed.
- **Econophysics**: 8 areas and 33 topics, about 2,300 works.
- **Mathematics**: 22 areas and 137 topics, about 18,700 works.
- **Statistics**: 18 areas and 107 topics, about 13,100 works.

Econophysics, mathematics and statistics are built the same way as economics, from about 210 journals of their own, papers on these subjects in physics, computer science, medical, psychology and general science journals, and about 4,600 landmarks that reach back to the first printed edition of Euclid's *Elements* (1482). Their areas are listed below, after the economics table.

| Group | Areas (papers and books listed) |
|---|---|
| **Theory & methods** | Microeconomic theory (996), Game theory & market design (781), Behavioral & experimental economics (886), Econometrics & quantitative methods (2,001) |
| **Macroeconomics & international** | Macroeconomics (1,163), Monetary economics & central banking (736), Economic growth & productivity (841), International trade (1,041), International finance & open-economy macro (838) |
| **Finance** | Asset pricing & financial markets (2,489), Corporate finance & governance (1,787), Banking, intermediation & financial crises (947) |
| **Firms, markets & innovation** | Monopoly & market power (6,185), Firms, organizations & entrepreneurship (990), Innovation, technology & the digital economy (1,469) |
| **Labor, people & public policy** | Labor economics (1,432), Economics of education (649), Health economics (774), Public economics (845), Inequality, poverty & mobility (589), Population, family & gender (419) |
| **Development, space & environment** | Development economics (1,284), Urban, regional & spatial economics (1,000), Environmental, energy & resource economics (2,151), Agricultural & food economics (597) |
| **Institutions, history & ideas** | Political economy & institutions (909), Law & economics (593), Economic history (643), History of economic thought & methodology (593), Culture, media & society (380) |

About 1,480 papers from the monopoly bibliography also belong in one of the new topics (Melitz 2003 under trade, for example), and some landmarks belong in two topics. They are listed in both places but are still one paper: tick it in one place and it is ticked in the other.

**Econophysics**

| Group | Areas (papers and books listed) |
|---|---|
| **Financial markets & models** | Statistical properties of markets (347), Market microstructure & order flow (203), Stochastic models & methods (308) |
| **Agents, wealth & networks** | Agent-based models (170), Wealth, income & firm dynamics (184), Networks & systemic risk (626) |
| **Complexity & society** | Complexity economics (244), Sociophysics & collective behavior (301) |

**Mathematics**

| Group | Areas (papers and books listed) |
|---|---|
| **Foundations & history** | Mathematical logic & foundations (582), History & philosophy of mathematics (437) |
| **Algebra & number theory** | Algebra (929), Number theory (815), Algebraic geometry (711) |
| **Geometry & topology** | Differential geometry (648), Topology (709), Geometry: classical, convex & discrete (500) |
| **Analysis** | Real & harmonic analysis (676), Complex analysis (392), Functional analysis & operator theory (502), Partial differential equations (1,122), Dynamical systems & ergodic theory (835) |
| **Probability & mathematical physics** | Probability theory (1,037), Mathematical physics (1,123) |
| **Discrete mathematics & computing** | Combinatorics (499), Graph theory (547), Theoretical computer science (1,223), Information & coding theory (690) |
| **Applied & computational mathematics** | Numerical analysis & scientific computing (1,662), Optimization & control (1,712), Applied mathematics & modeling (1,693) |

**Statistics**

| Group | Areas (papers and books listed) |
|---|---|
| **Inference & foundations** | Statistical inference (932), Bayesian statistics (687), History, philosophy & teaching of statistics (318) |
| **Models & methods** | Regression & linear models (1,135), Multivariate analysis (739), Nonparametric & semiparametric statistics (592), High-dimensional statistics (570), Time series analysis (695), Spatial & environmental statistics (597) |
| **Design, data & causality** | Design of experiments & quality (574), Survey sampling & measurement (428), Causal inference (526), Missing data & measurement error (411) |
| **Computing & learning** | Statistical computing & graphics (601), Statistical learning & machine learning (1,050) |
| **Applied statistics** | Biostatistics (1,255), Epidemiological statistics & meta-analysis (1,324), Psychometrics & social-science statistics (1,024) |

## Setup (once)

1. Create a new **public** repo on GitHub, for example `paper-archive`, and push this folder to it.
2. In the repo, go to **Settings → Pages → Build and deployment**. Set the source to **Deploy from a branch**, pick `main` and `/ (root)`, then save. After about a minute the site is live at `https://<your-username>.github.io/paper-archive/`.
3. Switch on saving from every device, below. It takes about five minutes, once.

### Saving from every device

A static site cannot write to its repo by itself, and asking for a GitHub token on every phone and laptop is a chore. So a tiny relay holds one token and lets the site read and write exactly two files, `data/progress.json` and `data/library.json`, and nothing else. After that, clicking a button is all it takes, on any device, with no sign-in. The relay is a free Cloudflare Worker (the free plan allows 100,000 requests a day, far more than this needs), and its whole code is `sync/worker.js`.

1. **Make a token.** On GitHub go to **Settings → Developer settings → Fine-grained tokens → Generate new token**. Name it `paper-archive relay`, set **Repository access → Only select repositories → `paper-archive`**, and under **Permissions → Repository** set **Contents: Read and write**. Copy the token.
2. **Make the Worker.** Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (a free account), open **Workers & Pages → Create → Create Worker**, name it `paper-archive-sync` and click **Deploy**. Then click **Edit code**, replace everything with the contents of `sync/worker.js`, and click **Deploy** again.
3. **Give it the token.** In the Worker's **Settings → Variables and Secrets**, click **Add**, choose type **Secret**, name it `GITHUB_TOKEN`, paste the token and save. The token lives only there; it is never in the repo or in anyone's browser.
4. **Point the site at it.** Copy the Worker's address (it looks like `https://paper-archive-sync.<your-name>.workers.dev`), put it between the quotes of `const SYNC_URL = '';` at the top of `app.js`, then commit and push.

That's it. Open the site on any device and tick something: the status at the top right says **Saved · on every device** within a couple of seconds, and the change shows up as a commit in the repo. Whatever a browser saved before the relay existed is pushed the first time that browser opens the site.

If you use a different repo name or GitHub account, change `OWNER` and `REPO` at the top of `sync/worker.js`, and add your site's address to `ORIGINS` there.

Without the relay the site still works: changes are kept in the browser, and a GitHub token under **Settings → Advanced** saves from that one device.

## How it saves

| File | What it holds | Who writes it |
|---|---|---|
| `data/catalog.json` | The monopoly and market power bibliography | `tools/build_catalog.py` |
| `data/economics.json` | Every other area of economics | `tools/economics/build.py` |
| `data/sciences.json` | Econophysics, mathematics and statistics | `tools/sciences/sci_build.py` |
| `data/citations.json` | Citation counts for the papers in `catalog.json` | `tools/economics/cites.py` |
| `data/library.json` | Papers you add, edits (links, notes, research links, interactive pages, flashcards, moves), your focus, weekly goals, new fields and topics | The app |
| `data/progress.json` | The date of each of the six steps, for each paper | The app |
| `sync/worker.js` | The save relay (runs on Cloudflare, not on GitHub Pages) | You, once |

Each change is committed to the repo a second or two after you click. Quick clicks are batched into one commit, and the commit message lists them, for example `Read: A Theory of Oligopoly`. Your git history is therefore a dated log of everything you've done.

If two devices save at the same moment, the app merges both sets of changes. If you're offline, changes are kept in the browser and pushed as soon as you're back. An open page also picks up what other devices saved, once a minute.

## Public by design

Anyone with the link can see everything: what's been downloaded, printed, read, noted, researched and turned into flashcards, week by week, with the research links and the cards. Anyone can also click the buttons, and that is intended. Every change is a commit, so nothing is ever lost: to undo a change, revert its commit on GitHub, or restore `data/progress.json` or `data/library.json` from an earlier commit. The relay only accepts files that look like the archive's own, so a stray request cannot break the site or touch its code.

## Finding your way around

- **Overview** is the front page: totals for each step, this week's goals, the next paper in your focus, a square for every day since the archive began (at least the last year) with how many papers have reached each step, papers you've started but not finished, and what was done most recently. Below that, every field and area is a card showing its papers, topics and must-reads, how many have been started and finished, the date of the last step, and the next must-read to start. An area turns green once all its must-reads are done.
- **Next up** is your focus, one topic and one paper at a time (below).
- **This week** shows your focus, the week's goal for each step and how far along it is, a bar for each day, and the plan: exactly which papers from your focus to download, print, read, write notes on, research and make flashcards for this week to meet the goals, with a button on each. The arrows step back to past weeks (what was done) and forward to the next few (what's lined up).
- **Progress** is the public record: the all-time graph, a chart of the last 12 weeks against the goals, progress by field and by area, papers in progress, and every finished paper with its research link, interactive page and flashcards.
- **Flashcards** lets you study the cards made for each paper: click or press space to flip, arrow keys to move, and shuffle. Study this week's cards, your focus's, the current topic's, one field's or every card at once; the list under the cards shows them paper by paper.
- On a phone these five pages sit in a tab bar at the bottom; the menu at the top left opens the fields.
- The **sidebar** lists the fields. Click one to open its areas, and an area to open its topics; a topic that's done shows a ✓. Below the page links it shows your focus and the topic you're on. The box at the top of the sidebar finds an area or topic by name.
- **Search** (press `/`) looks through every paper's title, authors, year and journal, ignoring accents. The best matches come first.
- In any list you can filter by progress (not started, in progress, done), by stars, to **Books**, or to papers with a **Free copy**, and sort by list order, most cited, newest, oldest, author or recently ticked.
- Each view has its own address, so the browser's Back button works and you can bookmark a topic.

## Adding papers

- **Add → One paper** for a single entry.
- **Add → Paste a list** for many papers at once, one per line: `Title | Authors | Year | Link`.
- **+ New field**, **+ New area** and **+ New topic** in the sidebar create groups. An area is optional: a topic can sit directly under a field.
- **⋯** on any paper shows the dates of its six steps and sets or fixes its link, a research link (for example the repo where you did the research), the link to its interactive page, notes and flashcards, or moves it to another field, area or topic.

## Your focus

The first time you open **Next up** or **This week**, a short setup asks three things:

1. **What to master:** a whole field, one area, or a single topic in it, or the **Market power reading plan**: the 610 must-reads of the monopoly bibliography in 14 phases, in the order they're best studied (`data/plan.json`).
2. **How deep, and in what order** (the reading plan has its own): must-reads only, must-reads and influential papers, or every paper; oldest first, most important first, or most cited first. Each choice shows how many papers it is and about how many weeks it takes.
3. **How much each week:** 3, 5 or 10 papers a week through every step, or your own goal for each step, and whether weeks start on Monday or Sunday.

**Change focus** (on Next up, on This week, or in Settings) runs the setup again, and **Focus on this** on any field, area or topic page starts it with that one picked. The focus is saved with the archive, so every device follows the same one. Changing it never touches what's been done.

## Next up

**Next up** works through your focus one topic at a time. A strip across the top lists the topics: done ones are green with a ✓, the one you're on is outlined, and each shows how many of its papers are done. Click a topic to work on it next. Below the strip is the paper to do now, with its six steps in order. Only the next step can be ticked and only the latest one undone, here and in every list:

1. **Download.** Open the paper or its free copy and save the PDF, then copy the prompt Next up gives you and paste it into an AI assistant with the PDF attached. The prompt asks for everything the next steps need: a copy of the PDF with the important passages highlighted (or a list of them with page numbers), which pages to read closely and which to skip, a five-to-seven-line summary to copy by hand onto the first page, a page or two of bullet notes to choose from, 5 to 10 flashcards, a short research brief, and a small interactive page about the paper.
2. **Print** the highlighted PDF, or the pages the answer lists.
3. **Read** the highlights and the marked pages. In the reading plan each paper also says how deeply.
4. **Notes.** Copy the summary onto the front page and write down the notes worth keeping, then tick.
5. **Research.** Work through the research brief and paste a link to your write-up.
6. **Flashcards.** Paste the cards (the lines starting with `Q:` and `A:`) and they're added to the paper, at most 10 per paper so the archive stays small.

The link to the interactive page goes in the box under the steps, and the paper's **Learn** button opens it from then on. When every paper of a topic is done, the topic turns green on Next up, on its card and in the sidebar, and the next topic comes up. A paper listed in two topics of your focus is read once, in the first.

The same order drives **This week**: papers you've started come first, then the next ones in your focus.

## Weekly goals

The setup's last step, or **Settings → Weekly goals**, sets how many papers a week you want to get through each step, for example 5 downloaded, 5 printed, 5 read, 5 with notes, 3 researched and 3 with flashcards. The goals are saved with the archive, so every device uses the same ones. **This week** turns them into a list: what's left to download, print, read, note, research and make cards for, paper by paper, with the flashcards of everything worked on that week one click away. A paper downloaded early in the week shows up again later that week for printing, and so on.

## Saving

Every click saves to the browser at once, then to the repo a second or two later. It also saves straight away when you switch tabs, lock your phone or close the page, and the site warns you if you try to close it mid-save. The dot at the top right shows where things stand. Until the relay is set up, a yellow banner says how many changes are only in that browser; once it is, they're pushed automatically.

## Stars and citation counts

**★★** marks a must-read and **★** an influential paper.

- In **Monopoly & market power** the stars come from the bibliography.
- In every other topic, ★★ goes to the landmarks and to the papers ranked highest by citations: 8 of them in a topic with no landmarks, fewer where there are landmarks, but never fewer than 4. The papers ranked after those, down to the 24th, get ★. The rest of the list, which in many topics runs well past 80 papers, carries no star. The ranking is the paper's citation count divided by the square root of its age, so that a strong recent paper can sit beside the classics, with a small bonus for papers whose title clearly matches the topic.
- A landmark that is a textbook or a survey rather than a first statement of an idea gets ★.
- In econophysics, mathematics and statistics a topic shows at most 15 two-star landmarks. Where a topic has more, the best-cited 15 keep ★★ and the rest get ★.

**cited N×** is the paper's citation count on [OpenAlex](https://openalex.org), a free index of scholarly works, at the time the catalog was built. Counts on Google Scholar are usually higher. A book shows a count only where OpenAlex has a well-cited record of it, and that count is usually too low, because citations to a book are spread over its editions.

## Learning guides

Every paper has a **Learn** button. A paper with an interactive page shows it filled in colour, and clicking it opens the page. On a paper with no page yet, the button shows a ready-made prompt to paste into an AI assistant (the paper's main prompt asks for one too) and a box for the link it gives you. Once the link is saved, the button opens it, on every device. A link keeps the archive small; nothing is uploaded.

Guides can also live in this repo. So far: *Dupuit's Bridge* (`learn/mp0001.html`), *Dupuit's Tolls* (`learn/mp0002.html`) and *Hadley's Railroad Lesson* (`learn/mp0004.html`), Hadley (1886). To add one:

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
3. `build.py` drops what is not a paper, corrects years that disagree with the journal's volume number, keeps each topic's top 80 and every other paper cited 250 times or more, adds the landmarks, and writes the result. A paper already in `catalog.json` is not copied: the topic points at the existing entry.

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
- **Correct many papers at once:** write the corrections as JSON (the format is at the top of `apply_review.py`) and run `python3 tools/economics/apply_review.py corrections.json`. It never removes a paper that is on the live site.
- **Correct one paper** (authors, year, title, or the topic it belongs in): add it to `fixes.json`. You can also move a single paper on the site with **⋯**; that is saved in `data/library.json` and survives rebuilds.

After a rebuild, raise `DATA_V` in `app.js` by one so that browsers fetch the new file.

What to expect from this part of the archive:

- Every paper from the journal download is a real indexed work with its DOI, but the sorting is automatic. A paper can sit in a topic that is only its second-best home, and OpenAlex occasionally lists an incomplete author list for older papers. The two-star papers of every topic were reviewed one by one for these problems, and every paper listed past a topic's first 80 was checked for its topic. The corrections are in `fixes.json` and `not_papers.json`.
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
- Each topic keeps its 80 most-cited papers (60 in econophysics), then every other paper cited 250 times or more, as in economics.
- A paper can belong to two fields, such as a probability paper that is also statistics. It is listed in both but is still one paper. A work that is already in `catalog.json` or `economics.json` is not copied: the topic points at the existing entry.
- `sci_landmarks.json` holds about 4,600 books and classic papers in the same format as the economics list, from the first printed Euclid, Cardano's *Ars magna* and Newton's *Principia* to recent monographs. New entries have IDs `ls0001` and up. The econophysics landmarks that used to be in the economics list keep their `lm` IDs. `econ_also` lists topics in `economics.json` that should show an entry too, and `tools/economics/build.py` adds them.
- Corrections go in `tools/sciences/fixes.json` and `tools/sciences/not_papers.json`, as for economics. In `fixes.json`, `"not": ["Statistics"]` takes a paper out of a field it was downloaded for.
- Three helpers in `tools/sciences/` take area codes from `skeleton.py`, comma-separated. `preview.py CODES` shows how the current phrase lists sort those areas' papers, in about ten seconds and without a rebuild. `topic_dump.py CODES` lists what the last build put in each of their topics. `audit.py` checks, before you publish, that every paper on the live site still has its entry and that every cross-listing points at a real one. `apply_review.py` takes corrections for many papers at once, in the same JSON form as the economics one.
- `sci_build.py` never removes a paper that is on the live site. That includes the econophysics papers that used to be in `economics.json`, which keep their IDs and ticks.

After a rebuild, raise `SCI_V` in `app.js` by one.

What to expect from this part:

- As in economics, every paper from the download is a real indexed work, but the sorting is automatic. The first 40 papers of every topic and a random sample of the rest were reviewed, and every paper listed past a topic's first 80 (60 in econophysics) was checked for its topic and field. The corrections are in `fixes.json` and `not_papers.json`.
- The landmark papers were matched to a Crossref or OpenAlex record wherever one could be found: 3,041 of the 3,511. The books (about 1,080), and the papers with no record, mostly old ones in journals that have no DOIs, were not checked against a catalogue, so a publisher, a year or a page number may be off. Most old books have no link and show **Search Scholar ↗** instead.
- The choice of landmarks is a judgement, and so is the one-line note on each.
