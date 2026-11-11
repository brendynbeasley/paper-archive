/* Paper Archive — a static GitHub Pages app.
 *
 * Data lives in three files in this repo:
 *   data/catalog.json   the seeded bibliography (read-only from the app)
 *   data/library.json   papers you add, edits to any paper, extra fields/topics
 *   data/progress.json  printed / read / notes / researched dates per paper
 * The app reads library + progress through the GitHub API (so changes show up
 * on every device straight away) and writes them back as commits using a token
 * stored only in this browser.
 */
(() => {
'use strict';

const STATUSES = [['pr', 'Printed'], ['rd', 'Read'], ['nt', 'Notes'], ['rs', 'Researched']];
const FILES = { progress: 'data/progress.json', library: 'data/library.json' };
const CFG_KEY = 'pa-config-v1';
const CACHE_KEY = 'pa-cache-v1';
const VIEW_KEY = 'pa-view-v1';
const PAGE = 150;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>');
const today = () => new Date().toISOString().slice(0, 10);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

/* ---------- state ---------- */
const emptyLibrary = () => ({ v: 1, fields: [], areas: [], topics: [], added: [], edits: {}, removed: [] });
const emptyProgress = () => ({ v: 1, p: {} });
const S = {
  catalog: [],
  library: emptyLibrary(),
  progress: emptyProgress(),
  sha: { progress: null, library: null },
  dirty: { progress: 0, library: 0 },  // change counters not yet pushed
  messages: [],                         // commit message fragments
  cfg: Object.assign({ owner: '', repo: '', branch: 'main', token: '' }, store.get(CFG_KEY) || {}),
  guides: {},
  summaries: {},
  downloads: {},
  plan: null,
  view: Object.assign({ mode: 'next', path: 'plan', field: null, area: null, topic: null, status: 'any', stars: '0', sort: 'order' }, store.get(VIEW_KEY) || {}),
  shown: PAGE,
  papers: [], byId: new Map(),
};

// Work out owner/repo automatically when hosted at <owner>.github.io/<repo>/
(function detectRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return;
  if (!S.cfg.owner) S.cfg.owner = m[1];
  if (!S.cfg.repo) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    S.cfg.repo = seg && !seg.includes('.') ? seg : `${m[1]}.github.io`;
  }
})();
const hasRepo = () => !!(S.cfg.owner && S.cfg.repo);
const canWrite = () => hasRepo() && !!S.cfg.token;

/* ---------- GitHub contents API ---------- */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function apiUrl(path) {
  return `https://api.github.com/repos/${encodeURIComponent(S.cfg.owner)}/${encodeURIComponent(S.cfg.repo)}/contents/${path}`;
}
function headers() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (S.cfg.token) h.Authorization = `Bearer ${S.cfg.token}`;
  return h;
}
class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function ghGet(path) {
  const url = `${apiUrl(path)}?ref=${encodeURIComponent(S.cfg.branch || 'main')}&t=${Date.now()}`;
  const r = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new GhError(r.status, await errText(r));
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function ghPut(path, obj, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(obj, null, 1) + '\n'), branch: S.cfg.branch || 'main' };
  if (sha) body.sha = sha;
  const json = JSON.stringify(body);
  // keepalive lets the save finish even if the tab is closing (browsers cap it at 64 KB)
  const r = await fetch(apiUrl(path), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: json, keepalive: json.length < 60000 });
  if (!r.ok) throw new GhError(r.status, await errText(r));
  return (await r.json()).content.sha;
}
async function errText(r) { try { return (await r.json()).message || r.statusText; } catch { return r.statusText; } }

/* ---------- merging (two devices edited at once) ---------- */
const newer = (a, b) => (!a ? b : !b ? a : (b.u || 0) > (a.u || 0) ? b : a);
function mergeProgress(remote, local) {
  const out = emptyProgress();
  const r = (remote && remote.p) || {}, l = (local && local.p) || {};
  for (const id of new Set([...Object.keys(r), ...Object.keys(l)])) out.p[id] = newer(r[id], l[id]);
  return out;
}
function mergeLibrary(remote, local) {
  remote = Object.assign(emptyLibrary(), remote || {});
  local = Object.assign(emptyLibrary(), local || {});
  const out = emptyLibrary();
  out.fields = [...new Set([...remote.fields, ...local.fields])];
  out.topics = [...new Set([...remote.topics, ...local.topics])];
  out.areas = [...new Set([...(remote.areas || []), ...(local.areas || [])])];
  out.removed = [...new Set([...remote.removed, ...local.removed])];
  const gone = new Set(out.removed);
  const added = new Map();
  for (const p of [...remote.added, ...local.added]) if (!gone.has(p.id)) added.set(p.id, newer(added.get(p.id), p));
  out.added = [...added.values()];
  for (const id of new Set([...Object.keys(remote.edits), ...Object.keys(local.edits)])) out.edits[id] = newer(remote.edits[id], local.edits[id]);
  return out;
}

/* ---------- local cache ---------- */
function saveCache() {
  store.set(CACHE_KEY, { library: S.library, progress: S.progress, sha: S.sha, dirty: S.dirty, messages: S.messages, repo: `${S.cfg.owner}/${S.cfg.repo}` });
}
function loadCache() {
  const c = store.get(CACHE_KEY);
  if (!c || c.repo !== `${S.cfg.owner}/${S.cfg.repo}`) return false;
  S.library = Object.assign(emptyLibrary(), c.library);
  S.progress = Object.assign(emptyProgress(), c.progress);
  S.sha = c.sha || S.sha; S.dirty = c.dirty || S.dirty; S.messages = c.messages || [];
  return true;
}

/* ---------- loading ---------- */
async function fetchStatic(path, fallback, fresh = true) {
  try { const r = await fetch(fresh ? `${path}?t=${Date.now()}` : path, fresh ? { cache: 'no-store' } : {}); if (r.ok) return await r.json(); } catch { /* offline */ }
  return fallback;
}
async function pull() {
  if (!hasRepo()) {
    // Not on GitHub Pages and no repo configured: use the files next to the page.
    if (!S.dirty.library) S.library = Object.assign(emptyLibrary(), await fetchStatic(FILES.library, S.library));
    if (!S.dirty.progress) S.progress = Object.assign(emptyProgress(), await fetchStatic(FILES.progress, S.progress));
    return;
  }
  for (const kind of ['library', 'progress']) {
    const { data, sha } = await ghGet(FILES[kind]);
    const merge = kind === 'library' ? mergeLibrary : mergeProgress;
    S[kind] = S.dirty[kind] ? merge(data, S[kind]) : merge(data, null);
    S.sha[kind] = sha;
  }
}

/* ---------- saving ---------- */
let syncTimer = null, syncing = false, again = false;
function changed(kind, message) {
  S.dirty[kind]++;
  if (message) S.messages.push(message);
  saveCache();
  rebuild(); render();
  setSync(canWrite() ? 'Unsaved changes…' : hasRepo() ? 'Saved on this device. Add a token in Settings to sync.' : 'Saved on this device');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 2000);
}
function commitMessage() {
  const m = S.messages;
  if (m.length === 1) return m[0];
  if (!m.length) return 'Update archive';
  return `Update archive (${m.length} changes)\n\n${m.slice(0, 40).map((x) => '- ' + x).join('\n')}`;
}
async function sync() {
  if (!canWrite() || !(S.dirty.progress || S.dirty.library)) return;
  if (syncing) { again = true; return; }
  syncing = true;
  setSync('Saving…');
  const message = commitMessage();
  const msgCount = S.messages.length;
  try {
    for (const kind of ['library', 'progress']) {
      const ver = S.dirty[kind];
      if (!ver) continue;
      try {
        S.sha[kind] = await ghPut(FILES[kind], S[kind], S.sha[kind], message);
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        // Another device saved first: fetch its version, merge, try once more.
        const remote = await ghGet(FILES[kind]);
        S[kind] = (kind === 'library' ? mergeLibrary : mergeProgress)(remote.data, S[kind]);
        S.sha[kind] = await ghPut(FILES[kind], S[kind], remote.sha, message);
        rebuild(); render();
      }
      S.dirty[kind] = Math.max(0, S.dirty[kind] - ver);
    }
    S.messages = S.messages.slice(msgCount);
    saveCache();
    setSync('Saved to GitHub ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    saveCache();
    const why = e.status === 401 ? 'token rejected' : e.status === 403 || e.status === 404 ? 'token lacks write access to this repo' : 'offline or GitHub unreachable';
    setSync(`Not synced (${why}). Saved on this device.`, true);
  } finally {
    syncing = false;
    if (again || S.dirty.progress || S.dirty.library) { again = false; if (S.dirty.progress || S.dirty.library) syncTimer = setTimeout(sync, 8000); }
  }
}
function setSync(text, warn) {
  if ($('saveBanner')) renderBanner();
  const el = $('syncDot');
  const kind = warn ? 'warn' : /^(Saving|Unsaved)/.test(text) ? 'busy' : /GitHub/.test(text) ? 'ok' : 'local';
  el.className = 'dot ' + kind; el.title = text; el.setAttribute('aria-label', text);
}

/* ---------- derived paper list ---------- */
function rebuild() {
  const lib = S.library, out = [];
  const gone = new Set(lib.removed);
  S.catalog.forEach((p, i) => {
    const e = lib.edits[p.id];
    if (e && e.hidden) return;
    out.push(Object.assign({ o: i }, p, e || {}));
  });
  lib.added.forEach((p, i) => { if (!gone.has(p.id)) out.push(Object.assign({ o: 1e6 + i, added: true }, p, lib.edits[p.id] || {})); });
  S.papers = out;
  S.byId = new Map(out.map((p) => [p.id, p]));
}
const prog = (id) => S.progress.p[id] || {};
// Field -> area -> topic. Area is optional ('' = topic sits directly under the field).
function fieldTree() {
  const tree = new Map();
  const add = (f, ar, t) => {
    if (!f) return null;
    if (!tree.has(f)) tree.set(f, new Map());
    const areas = tree.get(f);
    ar = ar || '';
    if (ar || t) { if (!areas.has(ar)) areas.set(ar, new Map()); }
    if (!t) return null;
    const topics = areas.get(ar);
    if (!topics.has(t)) topics.set(t, { n: 0, rd: 0 });
    return topics.get(t);
  };
  S.library.fields.forEach((f) => add(f));
  (S.library.areas || []).forEach((x) => { const [f, ar] = x.split('::'); add(f, ar); });
  S.library.topics.forEach((x) => { const parts = x.split('::'); if (parts.length === 3) add(parts[0], parts[1], parts[2]); else add(parts[0], '', parts[1]); });
  for (const p of S.papers) { const c = add(p.f, p.ar, p.tp); c.n++; if (prog(p.id).rd) c.rd++; }
  return tree;
}
const sumCounts = (topics) => { let n = 0, rd = 0; topics.forEach((x) => { n += x.n; rd += x.rd; }); return { n, rd }; };

/* ---------- filtering ---------- */
function inScope(p) {
  const q = $('search').value.trim().toLowerCase();
  if (q) {
    const hay = `${p.t} ${p.a} ${p.y} ${p.v} ${p.n} ${p.notes || ''}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  } else {
    if (S.view.field && p.f !== S.view.field) return false;
    if (S.view.area != null && (p.ar || '') !== S.view.area) return false;
    if (S.view.topic && p.tp !== S.view.topic) return false;
  }
  return true;
}
function passFilters(p) {
  const st = S.view.status, g = prog(p.id);
  const n = STATUSES.reduce((k, [s]) => k + (g[s] ? 1 : 0), 0);
  if (st === 'untouched' && n) return false;
  if (st === 'progress' && (n === 0 || n === 4)) return false;
  if (st === 'complete' && n !== 4) return false;
  if (st[0] === '-' && g[st.slice(1)]) return false;
  if (st[0] === '+' && !g[st.slice(1)]) return false;
  if (S.view.stars !== '0' && (p.s || 0) !== +S.view.stars) return false;  // exact star level
  return true;
}
function sorted(list) {
  const by = S.view.sort;
  const yr = (p) => parseInt(p.y, 10) || 0;
  if (by === 'new') return list.sort((a, b) => yr(b) - yr(a) || a.o - b.o);
  if (by === 'old') return list.sort((a, b) => yr(a) - yr(b) || a.o - b.o);
  if (by === 'author') return list.sort((a, b) => (a.a || '').localeCompare(b.a || '') || a.o - b.o);
  if (by === 'recent') return list.sort((a, b) => (prog(b.id).u || 0) - (prog(a.id).u || 0) || a.o - b.o);
  return list.sort((a, b) => a.o - b.o);
}

/* ---------- rendering ---------- */
const FIELD_COLORS = { Economics: '#5b4cf0', Econophysics: '#f0592b', Statistics: '#0e9f8b', Mathematics: '#d6336c' };
const SPARE = ['#2b7de9', '#d98a00', '#8a3ffc', '#1f9d55', '#e0437a', '#0891b2'];
function fieldColor(f) {
  if (!f) return '#4a4470';
  if (FIELD_COLORS[f]) return FIELD_COLORS[f];
  let h = 0; for (const c of f) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}
const ICONS = {
  pr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  rd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
  nt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  rs: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>';

function render() {
  renderNav();
  const next = S.view.mode === 'next' && !$('search').value.trim();
  $('nextView').hidden = !next; $('listView').hidden = next;
  if (next) renderNext(); else renderMain();
  renderLists(); renderBanner();
}
function renderBanner() {
  const pending = (S.dirty.progress || 0) + (S.dirty.library || 0);
  const show = !canWrite();
  $('saveBanner').hidden = !show;
  if (show) $('saveBannerText').textContent = pending
    ? `${pending} change${pending === 1 ? ' is' : 's are'} saved only in this browser. Add your GitHub token so everything saves to your repo and shows on every device.`
    : 'Changes are saved only in this browser until you add your GitHub token. Then everything saves to your repo automatically.';
}
const isDone = (id) => STATUSES.every(([s]) => prog(id)[s]);

function renderNav() {
  const tree = fieldTree();
  const searching = !!$('search').value.trim();
  const V = S.view;
  const cur = (f, ar, t) => (!searching && V.mode === 'list' && V.field === f && (V.area ?? null) === ar && V.topic === t ? ' aria-current="true"' : '');
  const data = (f, ar, t) => `data-f="${esc(f || '')}" data-a="${ar == null ? '' : esc(ar)}" data-hasa="${ar == null ? 0 : 1}" data-t="${esc(t || '')}"`;
  const count = (c) => `${c.rd}/${c.n.toLocaleString()}`;
  const all = { n: S.papers.length, rd: S.papers.filter((p) => prog(p.id).rd).length };
  const nx = nextInfo();
  let h = `<button class="nav nextnav" style="--c:#0e9f6e" data-next="1"${S.view.mode === 'next' && !searching ? ' aria-current="true"' : ''}><span class="sw"></span><span class="nm">Next up</span><span class="ct">${nx.total ? `${nx.doneCount}/${nx.total}` : ''}</span></button>`;
  h += `<button class="nav" style="--c:#4a4470" ${data(null, null, null)}${S.view.mode === 'list' ? cur(null, null, null) : ''}><span class="sw"></span><span class="nm">All papers</span><span class="ct">${count(all)}</span></button>`;
  h += '<div class="navlabel">Fields</div>';
  const fields = [...tree.keys()].sort((a, b) => (a === 'Economics' ? -1 : b === 'Economics' ? 1 : a.localeCompare(b)));
  const topicBtns = (f, ar, topics) => [...topics].map(([t, c]) =>
    `<button class="tnav" ${data(f, ar, t)}${cur(f, ar, t)}><span class="nm">${esc(t)}</span><span class="ct">${count(c)}</span></button>`).join('');
  for (const f of fields) {
    const areas = tree.get(f), c = fieldColor(f);
    const fc = { n: 0, rd: 0 }; areas.forEach((tp) => { const x = sumCounts(tp); fc.n += x.n; fc.rd += x.rd; });
    h += `<button class="nav" style="--c:${c}" ${data(f, null, null)}${cur(f, null, null)}><span class="sw"></span><span class="nm">${esc(f)}</span><span class="ct">${fc.n ? count(fc) : 'empty'}</span></button>`;
    if (V.field !== f || searching) continue;
    h += `<div class="tree" style="--c:${c}">`;
    for (const [ar, topics] of areas) {
      if (!ar) continue;
      const open = V.area === ar;
      h += `<button class="anav" ${data(f, ar, null)}${cur(f, ar, null)} aria-expanded="${open}"><span class="car" aria-hidden="true"></span><span class="nm">${esc(ar)}</span><span class="ct">${count(sumCounts(topics))}</span></button>`;
      if (open) h += `<div class="topics">${topicBtns(f, ar, topics)}<button class="navadd" data-newtopic="${esc(f)}" data-newtopicarea="${esc(ar)}">+ New topic</button></div>`;
    }
    if (areas.has('')) h += `<div class="topics loose">${topicBtns(f, '', areas.get(''))}</div>`;
    h += `<div class="addrow"><button class="navadd" data-newarea="${esc(f)}">+ New area</button><button class="navadd" data-newtopic="${esc(f)}" data-newtopicarea="">+ New topic</button></div></div>`;
  }
  h += '<button class="navadd" data-newfield="1">+ New field</button>';
  $('sidebar').innerHTML = h;
}

function progressHtml(list) {
  const n = list.length || 1;
  const done = list.filter((p) => isDone(p.id)).length;
  const stats = STATUSES.map(([s, label]) => `<span><i class="k" style="background:var(--${s})"></i><b>${list.filter((p) => prog(p.id)[s]).length}</b> ${label.toLowerCase()}</span>`).join('');
  return `<div class="pbar" title="${done} of ${list.length} fully done"><i style="width:${(100 * done) / n}%"></i></div>
    <div class="pstats"><span><b>${done}</b>&nbsp;of ${list.length.toLocaleString()} done</span>${stats}</div>`;
}

function linkLabel(u) {
  try { const h = new URL(u).hostname.replace(/^www\./, ''); return h === 'doi.org' ? 'Open paper' : h; } catch { return 'Open paper'; }
}
const LEARN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 9 12 4 2 9l10 5 10-5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v6"/></svg>';
function learnBtn(p) {
  const g = S.guides[p.id];
  if (g) return `<a class="learn has" href="${esc(g.file)}" target="_blank" rel="noopener" title="Open the interactive guide: ${esc(g.title)}">${LEARN_ICON}<span>Learn</span></a>`;
  return `<button type="button" class="learn" data-learn="1" title="No interactive guide yet">${LEARN_ICON}<span>Learn</span></button>`;
}
const SUM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/></svg>';
function sumBtn(p) {
  if (!S.summaries[p.id]) return '';
  return `<button type="button" class="learn sum has" data-sum="1" title="Summary, pages to read and what to write down">${SUM_ICON}<span>Summary</span></button>`;
}
function pagesStr(read) {
  const parts = read.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  const n = read.reduce((t, [a, b]) => t + b - a + 1, 0);
  return `PDF ${n === 1 ? 'p.' : 'pp.'} ${parts.join(', ')} (${n} page${n === 1 ? '' : 's'})`;
}
function openSummary(id) {
  const p = S.byId.get(id), s = S.summaries[id]; if (!p || !s) return;
  $('sumTitle').textContent = p.t;
  $('sumMeta').textContent = [p.a, p.y].filter(Boolean).join(' · ');
  $('sumRead').innerHTML = `<b>Read ${pagesStr(s.read)}.</b> ${esc(s.why)}`;
  $('sumText').textContent = s.sum;
  $('sumTerms').innerHTML = (s.terms || []).map(([a, b]) => `<li><b>${esc(a)}</b>: ${esc(b)}</li>`).join('');
  $('sumTerms').hidden = !(s.terms || []).length;
  $('sumWrite').innerHTML = s.write.map((w) => `<li>${esc(w)}</li>`).join('');
  const notes = [s.conf && s.conf !== 'high' ? `Confidence: ${s.conf}` : '', (s.flags || []).length ? `Flags: ${s.flags.join(', ')}` : ''].filter(Boolean);
  $('sumFoot').textContent = [...notes, `Written ${s.added || ''} from the PDF's text${s.model ? ' by ' + s.model[0].toUpperCase() + s.model.slice(1) : ''}`].join(' · ');
  $('sumMsg').hidden = true;
  $('sumDlg').dataset.id = id;
  $('sumDlg').showModal();
}
function copySummaryLines() {
  const s = S.summaries[$('sumDlg').dataset.id]; if (!s) return;
  const m = $('sumMsg');
  const ok = () => { m.hidden = false; m.className = 'formerr ok'; m.textContent = 'Copied the four lines.'; };
  try { navigator.clipboard.writeText(s.write.join('\n')).then(ok, () => {}); } catch { /* clipboard unavailable */ }
}
function learnPrompt(p) {
  const cite = `${p.a || ''} (${p.y || 'n.d.'}). "${p.t}." ${(p.v || '').replace(/\*/g, '')}`.trim();
  return `Make an interactive learning page for this paper, in the same style as Dupuit's Bridge (learn/mp0001.html in the brendynbeasley/paper-archive repo):

${cite}${p.link ? `\nLink: ${p.link}` : ''}

Build it as a single self-contained HTML file with:
- the question the paper asks and why it mattered at the time
- its argument broken into short parts, each with an interactive simulator or diagram
- the key equations, with every term explained
- flashcards, a quiz and a timeline of what came after
- page references to the original wherever possible; mark anything you're unsure of

Save it as learn/${p.id}.html, add it to data/learn.json under "${p.id}", then commit and push.`;
}
function paperRow(p, showWhere) {
  const g = prog(p.id);
  const link = p.link || `https://scholar.google.com/scholar?q=${encodeURIComponent(`${p.t} ${(p.a || '').split(',')[0]}`)}`;
  const firstAuthor = (p.a || '').split(/,|&/)[0].trim();
  const others = (p.a || '').includes('&') ? ' et al.' : '';
  const meta = [firstAuthor ? firstAuthor + others : '', p.y].filter(Boolean).map(esc).join(' · ');
  const btns = STATUSES.map(([s, label]) => {
    const on = g[s];
    const { next } = stepState(p.id);
    const idx = STATUSES.findIndex(([k]) => k === s);
    const locked = !on && idx !== next;
    const tip = on ? `${label} on ${on}` : locked ? `${STATUSES[next][1]} comes first` : `Mark as ${label.toLowerCase()}`;
    return `<button type="button" class="st ${s}${locked ? ' locked' : ''}" data-st="${s}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${label}" title="${tip}">${ICONS[s]}</button>`;
  }).join('');
  return `<article class="paper${isDone(p.id) ? ' done' : ''}" data-id="${esc(p.id)}">
    <div class="pmain"><a class="ptitle" href="${esc(link)}" target="_blank" rel="noopener" title="${p.link ? 'Open paper' : 'Search Google Scholar'}">${esc(p.t)}</a>
    <div class="pmeta">${meta}${p.s ? `<span class="s" title="${p.s === 2 ? 'Must-read' : 'Influential'}">${'★'.repeat(p.s)}</span>` : ''}${showWhere ? ` · <span class="where">${esc(p.tp)}</span>` : ''}
      <a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? linkLabel(p.link) : 'Search Scholar'} ↗</a></div></div>
    <div class="btns">${btns}${sumBtn(p)}${learnBtn(p)}</div>
    <button type="button" class="more-btn" data-edit="1" aria-label="Details and edit" title="Details and edit">${MORE_ICON}</button></article>`;
}

function renderMain() {
  const searching = $('search').value.trim();
  const scope = S.papers.filter(inScope);
  const list = sorted(scope.filter(passFilters));
  const color = searching ? '#4a4470' : fieldColor(S.view.field);
  document.documentElement.style.setProperty('--fc', color);
  const V = S.view;
  $('scopeTitle').textContent = searching ? `“${searching}”` : V.topic || V.area || V.field || 'All papers';
  const crumbs = [];
  if (!searching && V.field && (V.area || V.topic)) crumbs.push(`<button type="button" data-cf="${esc(V.field)}">${esc(V.field)}</button>`);
  if (!searching && V.area && V.topic) crumbs.push(`<button type="button" data-cf="${esc(V.field)}" data-ca="${esc(V.area)}">${esc(V.area)}</button>`);
  $('crumb').innerHTML = searching ? 'Search results across every field' : crumbs.length ? crumbs.join(' <span aria-hidden="true">›</span> ') : V.field ? 'Field' : 'Your whole archive';
  const dl = !searching && V.topic && S.downloads[V.topic];
  $('progress').innerHTML = progressHtml(scope) + (dl ? `<a class="dllink" href="${esc(dl)}" target="_blank" rel="noopener">Download checklist ↗</a>` : '');
  document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === S.view.status)));
  $('mustRead').setAttribute('aria-pressed', String(S.view.stars === '2'));
  $('influential').setAttribute('aria-pressed', String(S.view.stars === '1'));
  $('legend').innerHTML = `<span class="key"><b class="s">★★</b> must-read</span><span class="key"><b class="s">★</b> influential</span><span class="gap"></span>`
    + STATUSES.map(([s, l]) => `<span><i style="background:var(--${s})"></i>${l}</span>`).join('') + `<span>${list.length.toLocaleString()} papers</span>`;
  if (!list.length) {
    const empty = !scope.length && !searching && S.view.field;
    $('list').innerHTML = `<div class="empty">${empty ? `<p>Nothing here yet.</p><button class="pill primary" type="button" data-addhere="1">Add papers</button>` : '<p>No papers match.</p>'}</div>`;
    $('moreBtn').hidden = true;
    return;
  }
  const page = list.slice(0, S.shown);
  const group = S.view.sort === 'order' && !searching;
  const counts = new Map();
  const gkey = (p) => (V.topic ? p.st || '' : V.area != null || !p.ar ? p.tp : `${p.ar} › ${p.tp}`);
  if (group) for (const p of list) { const k = gkey(p); counts.set(k, (counts.get(k) || 0) + 1); }
  let h = '', last = null;
  for (const p of page) {
    if (group) {
      const k = gkey(p);
      if (k !== last) { if (k) h += `<div class="group">${esc(k)}<small>${counts.get(k)}</small></div>`; last = k; }
    }
    h += paperRow(p, !!searching);
  }
  $('list').innerHTML = h;
  const left = list.length - S.shown;
  $('moreBtn').hidden = left <= 0;
  $('moreBtn').textContent = `Show more (${left.toLocaleString()} left)`;
}

function renderLists() {
  const tree = fieldTree();
  const f = $('pField').value || S.view.field;
  const ar = $('pArea').value;
  const opts = (xs) => [...xs].filter(Boolean).map((x) => `<option value="${esc(x)}">`).join('');
  $('fieldList').innerHTML = opts(tree.keys());
  const areas = f && tree.has(f) ? tree.get(f) : new Map();
  $('areaList').innerHTML = opts(areas.keys());
  $('topicList').innerHTML = opts(areas.has(ar) ? areas.get(ar).keys() : []);
  const t = $('pTopic').value;
  $('subList').innerHTML = opts(new Set(S.papers.filter((p) => p.f === f && (p.ar || '') === ar && p.tp === t).map((p) => p.st)));
}

/* ---------- Next up: one paper at a time, in order ---------- */
const STEP_HELP = {
  pr: 'Print it out.',
  rd: null, // filled from the paper's depth
  nt: 'Write your notes: the question, the method, the main finding, why it mattered, and which paper it links to.',
  rs: 'Research it with an AI assistant (the Learn button has a ready-made prompt), push the work to a repo, and paste the link below.',
};
function pathOrder() {
  if (S.view.path === 'plan' && S.plan) return S.plan.order.filter((o) => S.byId.has(o.id));
  const yr = (p) => parseInt(p.y, 10) || 9999;
  return [...S.papers].sort((a, b) => yr(a) - yr(b) || a.o - b.o).map((p) => ({ id: p.id, ph: null, d: null }));
}
function nextInfo() {
  const order = S.byId.size ? pathOrder() : [];
  const i = order.findIndex((o) => !isDone(o.id));
  return { order, i, total: order.length, doneCount: order.filter((o) => isDone(o.id)).length };
}
function renderNext() {
  const { order, i, total, doneCount } = nextInfo();
  const planOn = S.view.path === 'plan' && S.plan;
  const pathBar = `<div class="pathbar" role="group" aria-label="Which order to follow">
      <span>Order</span>
      <button type="button" class="chip" data-path="plan" aria-pressed="${S.view.path === 'plan'}">Reading plan · ${S.plan ? S.plan.order.length : 0} must-reads</button>
      <button type="button" class="chip" data-path="year" aria-pressed="${S.view.path === 'year'}">Oldest first · all ${S.papers.length.toLocaleString()}</button>
    </div>`;
  document.documentElement.style.setProperty('--fc', '#0e9f6e');
  if (i < 0) {
    $('nextView').innerHTML = `<section class="hero"><div class="crumb">Next up</div><h1>All done</h1><div class="progress"><div class="pstats"><span>Every paper on this path has all four steps ticked.</span></div></div></section>${pathBar}`;
    return;
  }
  const cur = order[i], p = S.byId.get(cur.id);
  const phase = planOn && cur.ph != null ? S.plan.phases[cur.ph] : null;
  const { g, next } = stepState(p.id);
  const depth = planOn && cur.d ? S.plan.depth[cur.d] : null;
  const help = Object.assign({}, STEP_HELP, { rd: depth ? `Read it. ${depth}.` : 'Read it.' });
  const link = p.link || `https://scholar.google.com/scholar?q=${encodeURIComponent(`${p.t} ${(p.a || '').split(',')[0]}`)}`;
  const phaseEnd = planOn && (i === order.length - 1 || order[i + 1].ph !== cur.ph);
  const steps = STATUSES.map(([k, label], n) => {
    const on = g[k], isNext = n === next;
    return `<li class="step ${k}${on ? ' done' : ''}${isNext ? ' now' : ''}">
      <span class="dotn">${on ? '✓' : n + 1}</span>
      <span class="sl"><b>${label}</b><small>${on ? on : isNext ? 'Next' : ''}</small></span></li>`;
  }).join('');
  const nk = STATUSES[next];
  const doIt = nk ? `<div class="doit">
      <p>${esc(help[nk[0]])}</p>
      ${nk[0] === 'rs' ? `<label class="rsin">Research link<input id="rsLink" type="url" placeholder="https://github.com/…" value="${esc(p.research || '')}"></label>` : ''}
      <div class="doit-btns">
        <button type="button" class="pill go ${nk[0]}" data-step="${nk[0]}">${ICONS[nk[0]]} Mark as ${nk[1].toLowerCase()}</button>
        ${next > 0 ? `<button type="button" class="linkbtn" data-undo="1">Undo ${STATUSES[next - 1][1].toLowerCase()}</button>` : ''}
      </div></div>` : '';
  const upcoming = order.slice(i + 1, i + 9).map((o, n) => {
    const q = S.byId.get(o.id);
    const newPhase = planOn && o.ph !== (n === 0 ? cur.ph : order[i + n].ph);
    return `${newPhase ? `<li class="phasemark">Phase ${o.ph}: ${esc(S.plan.phases[o.ph].title)}</li>` : ''}
      <li class="up"><span class="upn">${i + n + 2}</span><span class="upt"><b>${esc(q.t)}</b><small>${esc(((q.a || '').split(/,|&/)[0] || '').trim())}${q.y ? ' · ' + esc(q.y) : ''}${o.d ? ' · ' + { deep: 'Deep', std: 'Standard', skim: 'Skim' }[o.d] : ''}</small></span>
      <span class="upd">${STATUSES.map(([k]) => `<i class="${prog(q.id)[k] ? 'on ' + k : ''}"></i>`).join('')}</span></li>`;
  }).join('');
  const recent = order.slice(0, i).filter((o) => isDone(o.id)).slice(-3).reverse().map((o) => {
    const q = S.byId.get(o.id);
    return `<li class="up donep"><span class="upn">✓</span><span class="upt"><b>${esc(q.t)}</b><small>${esc(((q.a || '').split(/,|&/)[0] || '').trim())}${q.y ? ' · ' + esc(q.y) : ''}</small></span></li>`;
  }).join('');
  $('nextView').innerHTML = `
    <section class="hero">
      <div class="crumb">Next up · ${planOn ? 'Reading plan' : 'Oldest first'}</div>
      <h1>${phase ? `Phase ${cur.ph}: ${esc(phase.title)}` : 'Oldest papers first'}</h1>
      <div class="progress">
        <div class="pbar"><i style="width:${(100 * doneCount) / (total || 1)}%"></i></div>
        <div class="pstats"><span>Paper <b>${i + 1}</b>&nbsp;of ${total.toLocaleString()}</span><span><b>${doneCount}</b>&nbsp;finished</span>${phase ? `<span>${esc(phase.about)}</span>` : ''}</div>
      </div>
    </section>
    ${pathBar}
    <article class="now" data-id="${esc(p.id)}">
      <div class="now-top"><span class="nowtag">#${i + 1}${depth ? ' · ' + esc(depth.split(' · ')[0]) : ''}</span>${p.s ? `<span class="s">${'★'.repeat(p.s)}</span>` : ''}</div>
      <a class="nowtitle" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.t)}</a>
      <div class="nowmeta">${esc(p.a || '')}${p.y ? ' · ' + esc(p.y) : ''}${p.v ? ' · ' + md(p.v) : ''}</div>
      <div class="nowlinks"><a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? 'Open paper' : 'Search Scholar'} ↗</a>${sumBtn(p)}${learnBtn(p)}</div>
      <ol class="steps">${steps}</ol>
      ${doIt}
      ${phaseEnd && phase ? `<div class="phasetask"><b>End of phase ${cur.ph}.</b> Before moving on: ${esc(phase.task)}</div>` : ''}
    </article>
    ${upcoming ? `<h2 class="nexth">Coming up</h2><ol class="uplist">${upcoming}</ol>` : ''}
    ${recent ? `<h2 class="nexth">Recently finished</h2><ol class="uplist">${recent}</ol>` : ''}`;
}
function nextClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.path) { S.view.path = b.dataset.path; saveView(); render(); return; }
  if (b.dataset.learn) return openLearn(b.closest('.now').dataset.id);
  if (b.dataset.sum) return openSummary(b.closest('.now').dataset.id);
  const card = b.closest('.now'); if (!card) return;
  const id = card.dataset.id;
  if (b.dataset.step) {
    if (b.dataset.step === 'rs') {
      const url = cleanUrl(($('rsLink') || {}).value || '');
      const pp = S.byId.get(id);
      if (url && url !== (pp.research || '')) setResearch(pp, url);
    }
    const wasLast = b.dataset.step === 'rs';
    toggle(id, b.dataset.step);
    if (wasLast) toast('Paper finished. On to the next one.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (b.dataset.undo) {
    const { last } = stepState(id);
    if (last >= 0) toggle(id, STATUSES[last][0]);
  }
}
function setResearch(p, url) {
  const lib = S.library;
  if (p.added) { const a = lib.added.find((x) => x.id === p.id); a.research = url; a.u = Date.now(); }
  else lib.edits[p.id] = Object.assign({}, lib.edits[p.id], { research: url, u: Date.now() });
  S.dirty.library++; S.messages.push(`Research link: ${p.t.slice(0, 80)}`);
}

/* ---------- actions ---------- */
// Steps go in order: Printed -> Read -> Notes -> Researched.
// You can tick only the next step, and undo only the latest one.
function stepState(id) {
  const g = prog(id);
  let next = STATUSES.findIndex(([k]) => !g[k]);
  if (next < 0) next = STATUSES.length;
  let last = -1; STATUSES.forEach(([k], i) => { if (g[k]) last = i; });
  return { g, next, last };
}
function toggle(id, s) {
  const p = S.byId.get(id); if (!p) return;
  const { next, last } = stepState(id);
  const i = STATUSES.findIndex(([k]) => k === s);
  const g = Object.assign({}, prog(id));
  const label = STATUSES[i][1];
  if (!g[s] && i !== next) return toast(`${STATUSES[next][1]} comes first. Steps go in order.`);
  if (g[s] && i !== last) return toast(`Undo ${STATUSES[last][1].toLowerCase()} first. Steps go in order.`);
  if (g[s]) delete g[s]; else g[s] = today();
  g.u = Date.now();
  S.progress.p[id] = g;
  changed('progress', `${g[s] ? label : 'Undo ' + label.toLowerCase()}: ${p.t.slice(0, 80)}`);
}

let editing = null, addTab = 'one';
function openPaper(id) {
  editing = id || null;
  const p = id ? S.byId.get(id) : null;
  $('paperDlgTitle').textContent = p ? 'Edit paper' : 'Add papers';
  $('addTabs').hidden = !!p;
  setTab(p ? 'one' : addTab);
  document.querySelector('[data-pane="edit"]').hidden = !p;
  $('pTitle').value = p ? p.t : ''; $('pAuthors').value = p ? p.a || '' : ''; $('pYear').value = p ? p.y || '' : '';
  $('pVenue').value = p ? (p.v || '').replace(/\*/g, '') : ''; $('pLink').value = p ? p.link || '' : '';
  $('pField').value = p ? p.f : S.view.field || ''; $('pArea').value = p ? p.ar || '' : S.view.area || ''; $('pTopic').value = p ? p.tp : S.view.topic || '';
  $('pSub').value = p ? p.st || '' : ''; $('pResearch').value = p ? p.research || '' : ''; $('pNotes').value = p ? p.notes || '' : '';
  $('pBulk').value = '';
  $('pAbout').innerHTML = p ? [p.n ? `<i>${md(p.n)}</i>` : '', p.vf ? 'The bibliography marks this citation as uncertain. Check it before relying on it.' : '', p.link ? '' : 'No link yet. The title opens a Google Scholar search.'].filter(Boolean).join('<br>') : '';
  document.querySelectorAll('#paperDlg details').forEach((d) => { d.open = false; });
  $('pDelete').hidden = !p;
  $('pDelete').textContent = p && p.added ? 'Delete paper' : 'Remove from archive';
  $('paperErr').hidden = true;
  renderLists();
  $('paperDlg').showModal();
}
function setTab(tab) {
  if (!editing) addTab = tab;
  document.querySelectorAll('#addTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-pane="one"]').forEach((el) => { el.hidden = tab !== 'one'; });
  document.querySelector('[data-pane="bulk"]').hidden = tab !== 'bulk';
  $('pTitle').required = tab === 'one';
}
const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanUrl = (u) => { u = (u || '').trim(); return /^https?:\/\//i.test(u) ? u : u ? 'https://' + u : ''; };

function savePaper() {
  const f = $('pField').value.trim(), ar = $('pArea').value.trim(), tp = $('pTopic').value.trim(), st = $('pSub').value.trim();
  if (!f || !tp) return err('Pick a field and a topic.');
  const lib = S.library;
  if (editing) {
    const p = S.byId.get(editing);
    const fields = { t: $('pTitle').value.trim() || p.t, a: $('pAuthors').value.trim(), y: $('pYear').value.trim(), v: $('pVenue').value.trim(), link: cleanUrl($('pLink').value), f, ar, tp, st, research: cleanUrl($('pResearch').value), notes: $('pNotes').value.trim(), u: Date.now() };
    if (p.added) {
      const i = lib.added.findIndex((x) => x.id === editing);
      lib.added[i] = Object.assign({}, lib.added[i], fields);
    } else {
      const base = S.catalog.find((x) => x.id === editing);
      const diff = { u: fields.u };
      for (const k of Object.keys(fields)) {
        if (k === 'u') continue;
        const was = String(base[k] ?? '').replace(k === 'v' ? /\*/g : /$^/, '');
        if ((fields[k] || '') !== was) diff[k] = fields[k];
      }
      lib.edits[editing] = diff;
    }
    changed('library', `Edit: ${fields.t.slice(0, 80)}`);
    return true;
  }
  let rows = [];
  if (addTab === 'bulk') {
    rows = $('pBulk').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [t, a, y, link] = l.split('|').map((x) => (x || '').trim());
      return { t, a, y, link: cleanUrl(link), v: '' };
    }).filter((r) => r.t);
    if (!rows.length) return err('Paste at least one line with a title.');
  } else {
    const t = $('pTitle').value.trim();
    if (!t) return err('A title is required.');
    rows = [{ t, a: $('pAuthors').value.trim(), y: $('pYear').value.trim(), v: $('pVenue').value.trim(), link: cleanUrl($('pLink').value) }];
  }
  const now = Date.now();
  rows.forEach((r, i) => lib.added.push(Object.assign(r, { id: newId() + i, f, ar, tp, st, s: 0, u: now })));
  changed('library', rows.length === 1 ? `Add: ${rows[0].t.slice(0, 80)}` : `Add ${rows.length} papers to ${f} › ${tp}`);
  toast(rows.length === 1 ? 'Paper added' : `${rows.length} papers added`);
  S.view.field = f; S.view.area = ar; S.view.topic = tp; saveView(); render();
  return true;
}
function err(msg) { const e = $('paperErr'); e.textContent = msg; e.hidden = false; return false; }
function deletePaper() {
  const p = S.byId.get(editing); if (!p) return;
  if (p.added) { S.library.added = S.library.added.filter((x) => x.id !== p.id); S.library.removed.push(p.id); }
  else S.library.edits[p.id] = Object.assign({}, S.library.edits[p.id], { hidden: true, u: Date.now() });
  $('paperDlg').close();
  changed('library', `Remove: ${p.t.slice(0, 80)}`);
  toast('Paper removed');
}

// mode: 'field' | 'area' | 'topic'
let groupCtx = null;
function openGroup(mode, field, area) {
  groupCtx = { mode, field, area: area || '' };
  $('groupDlgTitle').textContent = mode === 'field' ? 'New field' : mode === 'area' ? `New area in ${field}` : `New topic in ${area || field}`;
  $('gFieldWrap').hidden = mode !== 'field';
  $('gAreaWrap').hidden = mode === 'topic';
  $('gField').value = field || ''; $('gArea').value = ''; $('gTopic').value = '';
  $('gArea').required = mode === 'area';
  $('gTopic').required = mode === 'topic';
  $('gTopic').placeholder = mode === 'topic' ? '' : 'optional';
  $('gArea').placeholder = mode === 'area' ? 'e.g. Monopoly & market power' : 'optional';
  $('groupDlg').showModal();
  (mode === 'field' ? $('gField') : mode === 'area' ? $('gArea') : $('gTopic')).focus();
}
function saveGroup() {
  const f = (groupCtx.mode === 'field' ? $('gField').value : groupCtx.field).trim();
  const ar = (groupCtx.mode === 'topic' ? groupCtx.area : $('gArea').value).trim();
  const t = $('gTopic').value.trim();
  if (!f) return;
  const lib = S.library;
  lib.areas = lib.areas || [];
  if (!lib.fields.includes(f)) lib.fields.push(f);
  if (ar && !lib.areas.includes(`${f}::${ar}`)) lib.areas.push(`${f}::${ar}`);
  const key = ar ? `${f}::${ar}::${t}` : `${f}::${t}`;
  if (t && !lib.topics.includes(key)) lib.topics.push(key);
  S.view.field = f; S.view.area = ar || (t ? '' : null); S.view.topic = t || null; saveView();
  changed('library', t ? `New topic: ${[f, ar, t].filter(Boolean).join(' › ')}` : ar ? `New area: ${f} › ${ar}` : `New field: ${f}`);
}

function openSettings() {
  $('sOwner').value = S.cfg.owner; $('sRepo').value = S.cfg.repo; $('sBranch').value = S.cfg.branch || 'main';
  $('sToken').value = S.cfg.token ? '••••••••' : '';
  $('setMsg').hidden = true;
  $('setStatus').textContent = !hasRepo() ? 'No repository set. Open Repository below.'
    : canWrite() ? `Connected to ${S.cfg.owner}/${S.cfg.repo}. This device saves changes to GitHub.`
    : `Viewing ${S.cfg.owner}/${S.cfg.repo}. Add a token to save changes from this device.`;
  $('setDlg').showModal();
}
function readSettings() {
  const tok = $('sToken').value.trim();
  return { owner: $('sOwner').value.trim(), repo: $('sRepo').value.trim(), branch: $('sBranch').value.trim() || 'main', token: tok === '••••••••' ? S.cfg.token : tok };
}
async function testSettings() {
  const prev = S.cfg; S.cfg = readSettings();
  const m = $('setMsg'); m.hidden = false; m.className = 'formerr'; m.textContent = 'Checking…';
  try {
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(S.cfg.owner)}/${encodeURIComponent(S.cfg.repo)}`, { headers: headers(), cache: 'no-store' });
    if (!r.ok) throw new GhError(r.status, await errText(r));
    const j = await r.json();
    const push = j.permissions && j.permissions.push;
    m.className = 'formerr ok';
    m.textContent = push ? `Connected to ${j.full_name}. This device can save changes.` : S.cfg.token ? `Found ${j.full_name}, but this token can't write to it. Give it Contents: read and write.` : `Found ${j.full_name}. Add a token to save from this device.`;
    if (!push) m.className = 'formerr';
  } catch (e) {
    m.textContent = e.status === 401 ? 'GitHub rejected this token.' : e.status === 404 ? 'Repo not found. Check the user and repo name. A private repo needs a token.' : 'Could not reach GitHub.';
  } finally { S.cfg = prev; }
}
async function applySettings() {
  const next = readSettings();
  const repoChanged = next.owner !== S.cfg.owner || next.repo !== S.cfg.repo || next.branch !== S.cfg.branch;
  S.cfg = next; store.set(CFG_KEY, S.cfg);
  if (repoChanged) { S.sha = { progress: null, library: null }; }
  await refresh(true);
  sync();
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), library: S.library, progress: S.progress }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `paper-archive-backup-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function openLearn(id) {
  const p = S.byId.get(id); if (!p) return;
  $('learnPaper').textContent = p.t;
  $('learnPrompt').value = learnPrompt(p);
  $('learnMsg').hidden = true;
  $('learnDlg').showModal();
}
function copyLearn() {
  const t = $('learnPrompt'), m = $('learnMsg');
  const done = () => { m.hidden = false; m.className = 'formerr ok'; m.textContent = 'Copied. Paste it into an AI assistant.'; };
  const fail = () => { t.focus(); t.select(); m.hidden = false; m.className = 'formerr'; m.textContent = 'Select the text above and copy it.'; };
  try { navigator.clipboard.writeText(t.value).then(done, fail); } catch { fail(); }
}
/* ---------- theme: auto (follow device) -> light -> dark ---------- */
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else { document.documentElement.removeAttribute('data-theme'); t = 'auto'; }
  const label = { auto: 'Theme: auto (follows your device)', light: 'Theme: light', dark: 'Theme: dark' }[t];
  $('themeBtn').innerHTML = THEME_ICONS[t];
  $('themeBtn').title = label + '. Click to change.';
  $('themeBtn').setAttribute('aria-label', label);
  return t;
}
function cycleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'auto';
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[cur];
  try { if (next === 'auto') localStorage.removeItem('pa-theme'); else localStorage.setItem('pa-theme', next); } catch { /* storage blocked */ }
  toast({ auto: 'Theme follows your device', light: 'Light mode', dark: 'Dark mode' }[applyTheme(next)]);
}

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }
function saveView() { store.set(VIEW_KEY, { mode: S.view.mode, path: S.view.path, field: S.view.field, area: S.view.area, topic: S.view.topic, status: S.view.status, stars: S.view.stars, sort: S.view.sort }); }

let lastPull = 0;
async function refresh(force) {
  if (!force && Date.now() - lastPull < 30000) return;
  lastPull = Date.now();
  try {
    await pull();
    saveCache(); rebuild(); render();
    if (S.dirty.progress || S.dirty.library) { if (canWrite()) sync(); else setSync('Saved on this device. Add a token in Settings to sync.'); }
    else setSync(hasRepo() ? (canWrite() ? 'Synced with GitHub' : 'Read-only. Add a token in Settings to edit.') : 'Local mode');
  } catch (e) {
    setSync(e.status === 403 ? 'GitHub rate limit hit. Showing saved copy.' : 'Offline. Showing saved copy.', true);
  }
}

/* ---------- events ---------- */
function bind() {
  $('sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.newfield) return openGroup('field');
    if (b.dataset.newarea) return openGroup('area', b.dataset.newarea);
    if (b.dataset.newtopic) return openGroup('topic', b.dataset.newtopic, b.dataset.newtopicarea);
    $('search').value = '';
    if (b.dataset.next) { S.view.mode = 'next'; saveView(); render(); window.scrollTo({ top: 0 }); closeNav(); return; }
    S.view.mode = 'list';
    S.view.field = b.dataset.f || null;
    S.view.area = b.dataset.hasa === '1' ? b.dataset.a : null;
    S.view.topic = b.dataset.t || null; S.shown = PAGE;
    saveView(); render(); window.scrollTo({ top: 0 });
    if (S.view.topic || !b.dataset.f) closeNav();
  });
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.addhere) return openPaper(null);
    if (b.dataset.learn) return openLearn(b.closest('.paper').dataset.id);
    if (b.dataset.sum) return openSummary(b.closest('.paper').dataset.id);
    const row = b.closest('.paper'); if (!row) return;
    if (b.dataset.st) toggle(row.dataset.id, b.dataset.st);
    else if (b.dataset.edit) openPaper(row.dataset.id);
  });
  let st;
  $('search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { S.shown = PAGE; render(); }, 180); });
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { S.view.status = b.dataset.filter; S.shown = PAGE; saveView(); renderMain(); }));
  const starChip = (id, lvl) => $(id).addEventListener('click', () => { S.view.stars = S.view.stars === lvl ? '0' : lvl; S.shown = PAGE; saveView(); renderMain(); });
  starChip('mustRead', '2'); starChip('influential', '1');
  $('fSort').value = S.view.sort;
  $('fSort').addEventListener('change', () => { S.view.sort = $('fSort').value; S.shown = PAGE; saveView(); renderMain(); });
  $('crumb').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cf]'); if (!b) return;
    S.view.mode = 'list';
    S.view.field = b.dataset.cf; S.view.area = b.dataset.ca ?? null; S.view.topic = null; S.shown = PAGE; saveView(); render();
  });
  $('scrim').addEventListener('click', closeNav);
  $('moreBtn').addEventListener('click', () => { S.shown += PAGE; renderMain(); });
  $('addBtn').addEventListener('click', () => openPaper(null));
  $('addTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('pField').addEventListener('input', renderLists);
  $('pTopic').addEventListener('input', renderLists);
  $('pArea').addEventListener('input', renderLists);
  $('paperForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    if (!savePaper()) e.preventDefault();
  });
  $('pDelete').addEventListener('click', deletePaper);
  $('groupForm').addEventListener('submit', (e) => { if (!e.submitter || e.submitter.value !== 'cancel') saveGroup(); });
  $('settingsBtn').addEventListener('click', openSettings);
  applyTheme(document.documentElement.getAttribute('data-theme'));
  $('themeBtn').addEventListener('click', cycleTheme);
  $('learnCopy').addEventListener('click', copyLearn);
  $('sumCopy').addEventListener('click', copySummaryLines);
  $('setForm').addEventListener('submit', (e) => { if (e.submitter && e.submitter.value === 'save') applySettings(); });
  $('sTest').addEventListener('click', testSettings);
  $('sExport').addEventListener('click', exportBackup);
  $('sForget').addEventListener('click', () => { S.cfg.token = ''; store.set(CFG_KEY, S.cfg); $('sToken').value = ''; toast('Token removed from this device'); refresh(true); });
  $('navToggle').addEventListener('click', () => {
    const open = !$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open', open); $('navToggle').setAttribute('aria-expanded', String(open)); $('scrim').hidden = !open;
  });
  // Save straight away when you switch tabs, lock the phone or close the page.
  const flush = () => { if (canWrite() && (S.dirty.progress || S.dirty.library)) { clearTimeout(syncTimer); sync(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); else flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', (e) => { if (syncing || (canWrite() && (S.dirty.progress || S.dirty.library))) { flush(); e.preventDefault(); e.returnValue = ''; } });
  $('nextView').addEventListener('click', nextClick);
  $('saveBannerBtn').addEventListener('click', openSettings);
  window.addEventListener('online', () => refresh(true));
}
function closeNav() { $('sidebar').classList.remove('open'); $('navToggle').setAttribute('aria-expanded', 'false'); $('scrim').hidden = true; }

/* ---------- start ---------- */
async function start() {
  bind();
  loadCache();
  const cat = await fetchStatic('data/catalog.json', { papers: [] }, false);
  S.catalog = cat.papers || [];
  S.guides = (await fetchStatic('data/learn.json', { guides: {} })).guides || {};
  S.plan = await fetchStatic('data/plan.json', null);
  S.summaries = (await fetchStatic('data/summaries.json', { s: {} })).s || {};
  S.downloads = (await fetchStatic('data/downloads.json', { lists: {} })).lists || {};
  rebuild();
  // Views saved before areas existed: work out the area from the topic.
  if (S.view.topic && S.view.area == null) {
    const hit = S.papers.find((p) => p.f === S.view.field && p.tp === S.view.topic);
    S.view.area = hit ? hit.ar || '' : null;
  }
  render();
  await refresh(true);
}
start();
})();
