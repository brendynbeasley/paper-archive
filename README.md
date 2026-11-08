# Paper Archive

A personal archive for tracking papers. Every paper has four buttons, **Printed**, **Read**, **Notes** and **Researched**, and each one records the date you pressed it. The site runs on GitHub Pages and saves your progress back into this repo, so every device that opens the site sees the same archive.

Papers are organised in three levels: **field → area → topic**. It comes preloaded with 6,185 papers under **Economics → Monopoly & market power**, in 22 topics: all 6,144 entries from *Monopoly and Market Power: The Extended Bibliography*, plus 41 foundational papers that the bibliography leaves out (listed under "Foundations" in each topic). **Econophysics**, **Statistics** and **Mathematics** start empty, ready for you to fill in.

Stars come from the bibliography: **★★** marks a must-read, **★** an influential paper.

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
| `data/catalog.json` | The preloaded bibliography | `tools/build_catalog.py` |
| `data/library.json` | Papers you add, edits (links, notes, research links, moves), new fields and topics | The app |
| `data/progress.json` | Printed / read / notes / researched dates for each paper | The app |

Each change is committed to the repo about two seconds after you click. Quick clicks are batched into one commit, and the commit message lists them, for example `Read: A Theory of Oligopoly`. Your git history is therefore a dated log of everything you've done.

If two devices save at the same moment, the app merges both sets of changes. If you're offline, changes are kept in the browser and pushed the next time you open the site.

The token is stored only in the browser of the device where you entered it. It is never committed.

## Privacy

The repo, and so your progress and notes, is public. GitHub Pages on a private repo needs a paid GitHub plan. The app works the same way with a private repo, but then viewing also needs a token.

## Adding papers

- **Add papers → One paper** for a single entry.
- **Add papers → Paste a list** for many papers at once, one per line: `Title | Authors | Year | Link`.
- **+ New field**, **+ New area** and **+ New topic** in the sidebar create groups. An area is optional: a topic can sit directly under a field.
- **⋯** on any paper sets or fixes its link, a research link (for example the repo where you did the research), notes, or moves it to another field, area or topic.

## Next up

**Next up** (top of the sidebar, and the page the site opens on) takes you through papers one at a time, in order:

- **Reading plan:** the 610 must-reads in 14 phases, in the order they're best studied (`data/plan.json`). Each paper shows how deeply to read it, and the last paper of each phase shows that phase's task.
- **Oldest first:** every paper in the archive, by year.

For each paper, the steps go in order: **Printed → Read → Notes → Researched**. Only the next step can be ticked and only the latest one can be undone, both here and in the full lists. When the fourth step is done, the next paper comes up. The Researched step takes the link to your research repo.

## Saving

Every click saves to the browser at once, then to GitHub about two seconds later. It also saves straight away when you switch tabs, lock your phone or close the page, and the site warns you if you try to close it mid-save. Until a token is set on a device, a yellow banner says how many changes are only in that browser. Once you add the token, they're pushed automatically.

## Learning guides

Every paper has a **Learn** button. A paper with an interactive guide shows it filled in colour, and clicking it opens the guide. So far only Dupuit (1844) has one: *Dupuit's Bridge*, `learn/mp0001.html`. On a paper with no guide yet, the button shows a ready-made prompt to paste into an AI assistant to make one.

To add a guide:

1. Save the HTML file as `learn/<paper id>.html`. The id is shown in the prompt, for example `mp0001`.
2. Add it to `data/learn.json`:

   ```json
   "mp0001": { "file": "learn/mp0001.html", "title": "Dupuit's Bridge", "added": "2026-11-08" }
   ```

3. Commit and push. That paper's Learn button lights up.

## Links

Preloaded papers link to their DOI where one was found. `tools/find_links.py` looked each paper up in Crossref, the public registry of journal DOIs, and kept a link only when the title matched closely and the year (and, for a few years' gap, the first author) agreed. Papers without a confident match show **Search Scholar ↗**, which opens a Google Scholar search instead. To retry lookups and rebuild:

```bash
python3 tools/find_links.py
python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
```

## Rebuilding the catalog

```bash
python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
```

Paper IDs come from the order of entries in the markdown file, so progress stays attached to the right papers as long as that order doesn't change.

The bibliography was compiled from memory and not individually verified. Entries it marked "(verify)" show a **check citation** tag.
