# Paper Archive

A personal archive for tracking papers. Every paper has four buttons, **Printed**, **Read**, **Notes** and **Researched**, and each one records the date you pressed it. Papers are grouped by field and topic. The site runs on GitHub Pages and saves your progress back into this repo, so every device that opens the site sees the same archive.

It comes preloaded with 6,185 papers in **Economics**: all 6,144 entries from *Monopoly and Market Power: The Extended Bibliography*, plus 41 foundational papers that the bibliography leaves out (listed under "Foundations" in each topic). **Econophysics**, **Statistics** and **Mathematics** start empty, ready for you to fill in.

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
- **+ New field** and **+ New topic** in the sidebar create groups.
- **Edit** on any paper sets its real link (the preloaded papers link to a Google Scholar search until you do), a research link (for example the repo where you did the research), notes, or moves it to another field or topic.

## Rebuilding the catalog

```bash
python3 tools/build_catalog.py path/to/All-Monopoly_Papers.md
```

Paper IDs come from the order of entries in the markdown file, so progress stays attached to the right papers as long as that order doesn't change.

The bibliography was compiled from memory and not individually verified. Entries it marked "(verify)" show a **check citation** tag.
