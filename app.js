/* Paper Archive — a static GitHub Pages app.
 *
 * Papers come from two read-only catalogs in this repo:
 *   data/catalog.json    the monopoly and market power bibliography (6,185 papers)
 *   data/economics.json  the rest of economics and econophysics, built by tools/economics/
 * Your own data lives in two more files, which the app reads through the GitHub API (so changes
 * show up on every device straight away) and writes back as commits, using a token stored only
 * in this browser:
 *   data/library.json    papers you add, edits to any paper, extra fields/areas/topics
 *   data/progress.json   printed / read / notes / researched dates per paper
 */
(() => {
'use strict';

const STATUSES = [['pr', 'Printed'], ['rd', 'Read'], ['nt', 'Notes'], ['rs', 'Researched']];
const FILES = { progress: 'data/progress.json', library: 'data/library.json' };
const CFG_KEY = 'pa-config-v1';
const CACHE_KEY = 'pa-cache-v1';
const VIEW_KEY = 'pa-view-v1';
const SEEN_KEY = 'pa-seen-v2';
const SEEN_LM_KEY = 'pa-seen-v3';   // the note about the landmark books and classics
const SEEN_SCI_KEY = 'pa-seen-v4';  // the note about mathematics, statistics and econophysics
const PAGE = 120;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>');
const localDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localDate(new Date());   // your calendar date, not the UTC one
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

/* ---------- state ---------- */
const emptyLibrary = () => ({ v: 1, fields: [], areas: [], topics: [], added: [], edits: {}, removed: [] });
const emptyProgress = () => ({ v: 1, p: {} });
const S = {
  catalog: [],                           // every catalog paper, in list order
  xrefs: [],                             // extra listings of a paper in a second topic: { id, f, ar, tp, o }
  meta: { groups: [], areas: [] },       // how areas are grouped and described (from data/economics.json)
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
  view: Object.assign({ mode: 'next', path: 'plan', field: null, area: null, topic: null, status: 'any', stars: '0', sort: 'order', pdf: false, book: false, nscope: '' }, store.get(VIEW_KEY) || {}),
  shown: PAGE,
  papers: [], rows: [], byId: new Map(), hay: new Map(),
  ready: false, added: 0,
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
// The second catalog stores each topic once and its papers as short rows; unpack it into the
// same shape as catalog.json. A bare id in a topic is an extra listing of an existing paper.
// A row may end with a one-line note and a kind ("book", "report" or "talk"): the landmarks.
function unpackCatalog(extra, start) {
  const papers = [], xrefs = [];
  let o = start;
  for (const t of extra.topics || []) {
    for (const e of t.p) {
      o++;
      if (typeof e === 'string') { xrefs.push({ id: e, f: t.f, ar: t.ar || '', tp: t.tp, o }); continue; }
      const [id, title, a, y, v, link, c, s, pdf, n, k] = e;
      const p = { id, t: title, a, y, v, n: n || '', s: s || 0, vf: false, f: t.f, ar: t.ar || '', tp: t.tp, st: '', c: c || 0, o };
      if (link) p.link = /^https?:/i.test(link) ? link : `https://doi.org/${link}`;
      if (pdf) p.pdf = pdf;
      if (k) p.k = k;
      papers.push(p);
    }
  }
  return { papers, xrefs };
}

/* ---------- saving ---------- */
let syncTimer = null, syncing = false, again = false;
function changed(kind, message) {
  S.dirty[kind]++;
  if (message) S.messages.push(message);
  if (kind === 'library') S.hay.clear();
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
        S.hay.clear(); rebuild(); render();
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
  const kind = warn ? 'warn' : /^(Saving|Unsaved)/.test(text) ? 'busy' : /GitHub/.test(text) ? 'ok' : 'local';
  $('syncDot').className = 'dot ' + kind;
  $('syncText').textContent = text.replace(/\. Add a token in Settings to (sync|edit)\.$/, '').replace(/^Saved on this device$/, 'Saved on this device only');
  $('sync').title = text;
}

/* ---------- derived paper list ---------- */
// S.papers: every paper once, with your edits applied. S.rows: every place a paper is listed
// (its own topic, plus any extra listing), which is what the topic and area views show.
function rebuild() {
  const lib = S.library, out = [];
  const gone = new Set(lib.removed);
  for (const p of S.catalog) {
    const e = lib.edits[p.id];
    if (e && e.hidden) continue;
    out.push(e ? Object.assign({}, p, e) : p);
  }
  lib.added.forEach((p, i) => { if (!gone.has(p.id)) out.push(Object.assign({ o: 1e6 + i, added: true }, p, lib.edits[p.id] || {})); });
  S.papers = out;
  S.byId = new Map(out.map((p) => [p.id, p]));
  const rows = out.map((p) => ({ p, f: p.f, ar: p.ar || '', tp: p.tp, st: p.st || '', o: p.o, main: true }));
  for (const x of S.xrefs) { const p = S.byId.get(x.id); if (p) rows.push({ p, f: x.f, ar: x.ar, tp: x.tp, st: '', o: x.o, main: false }); }
  S.rows = rows;
  S.tree = null;
}
const prog = (id) => S.progress.p[id] || {};
const isDone = (id) => { const g = S.progress.p[id]; return !!g && !!(g.pr && g.rd && g.nt && g.rs); };
const metaArea = (f, ar) => S.meta.areas.find((a) => a.f === f && a.name === ar);

// Field -> area -> topic, with counts. Area '' holds topics that sit directly under the field.
function fieldTree() {
  if (S.tree) return S.tree;
  const tree = new Map();
  const field = (f) => { if (!tree.has(f)) tree.set(f, { areas: new Map(), n: 0, rd: 0, dn: 0 }); return tree.get(f); };
  const add = (f, ar, t) => {
    if (!f) return null;
    const F = field(f);
    ar = ar || '';
    if (ar || t) { if (!F.areas.has(ar)) F.areas.set(ar, { topics: new Map(), n: 0, rd: 0, dn: 0, s2: 0, dec: new Array(13).fill(0) }); }
    if (!t) return null;
    const A = F.areas.get(ar);
    if (!A.topics.has(t)) A.topics.set(t, { n: 0, rd: 0, dn: 0, s2: 0 });
    return [F, A, A.topics.get(t)];
  };
  S.library.fields.forEach((f) => add(f));
  S.meta.areas.forEach((a) => add(a.f, a.name));
  (S.library.areas || []).forEach((x) => { const [f, ar] = x.split('::'); add(f, ar); });
  S.library.topics.forEach((x) => { const parts = x.split('::'); if (parts.length === 3) add(parts[0], parts[1], parts[2]); else add(parts[0], '', parts[1]); });
  for (const r of S.rows) {
    const hit = add(r.f, r.ar, r.tp); if (!hit) continue;
    const g = S.progress.p[r.p.id], rd = g && g.rd ? 1 : 0, dn = isDone(r.p.id) ? 1 : 0;
    const [F, A, Tp] = hit;
    Tp.n++; Tp.rd += rd; Tp.dn += dn; A.n++; A.rd += rd; A.dn += dn;
    if (r.p.s === 2) { Tp.s2++; A.s2++; }
    const y = parseInt(r.p.y, 10); if (y) A.dec[Math.max(0, Math.min(12, Math.floor((y - 1900) / 10)))]++;
    if (r.main || r.p.f !== r.f) { F.n++; F.rd += rd; F.dn += dn; }   // a paper counts once per field
  }
  S.tree = tree;
  return tree;
}
const fieldOrder = (tree) => [...tree.keys()].sort((a, b) => (a === 'Economics' ? -1 : b === 'Economics' ? 1 : a.localeCompare(b)));

/* ---------- colours ---------- */
const FIELD_COLORS = { Economics: '#4a47a8', Econophysics: '#d9582a', Statistics: '#0e9a86', Mathematics: '#cf3a6b' };
const GROUP_COLORS = {
  'Theory & methods': '#5a55c8', 'Macroeconomics & international': '#0f8a80', Finance: '#2b77c9',
  'Firms, markets & innovation': '#9a4bb0', 'Labor, people & public policy': '#c9621e',
  'Development, space & environment': '#3f8f3a', 'Institutions, history & ideas': '#b24a52',
  'Financial markets & models': '#d9582a', 'Agents, wealth & networks': '#a35d1e', 'Complexity & society': '#c2417a',
  'Foundations & history': '#7a5ac8', 'Algebra & number theory': '#cf3a6b', 'Geometry & topology': '#2f7fb8',
  Analysis: '#1f8f74', 'Probability & mathematical physics': '#a2559e', 'Discrete mathematics & computing': '#c26a1e',
  'Applied & computational mathematics': '#4f8a2e',
  'Inference & foundations': '#0e9a86', 'Models & methods': '#3a6fc4', 'Design, data & causality': '#8a56b8',
  'Computing & learning': '#c25b2a', 'Applied statistics': '#b8476b',
};
const SPARE = ['#2b7de9', '#b07a00', '#8a3ffc', '#1f9d55', '#d6457a', '#0891b2'];
function fieldColor(f) {
  if (!f) return '#4a47a8';
  if (FIELD_COLORS[f]) return FIELD_COLORS[f];
  let h = 0; for (const c of f) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}
function areaColor(f, ar) {
  const m = ar ? metaArea(f, ar) : null;
  return (m && GROUP_COLORS[m.group]) || fieldColor(f);
}

/* ---------- where you are: view state and the address bar ---------- */
const enc = encodeURIComponent;
const query = () => $('search').value.trim();
function viewHash(v) {
  if (v.mode === 'home') return '#/';
  if (v.mode === 'next') return '#/next';
  if (!v.field) return '#/all';
  let h = `#/f/${enc(v.field)}`;
  if (v.area) h += `/a/${enc(v.area)}`;
  if (v.topic) h += `/t/${enc(v.topic)}`;
  return h;
}
function readHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (location.hash.length < 2) return null;
  if (parts[0] === '') return { mode: 'home' };
  if (parts[0] === 'next') return { mode: 'next' };
  if (parts[0] === 'all') return { mode: 'list', field: null, area: null, topic: null };
  if (parts[0] === 'q') return { q: parts.slice(1).join('/') };
  if (parts[0] === 'f' && parts[1]) {
    const v = { mode: 'list', field: parts[1], area: null, topic: null };
    for (let i = 2; i < parts.length - 1; i += 2) { if (parts[i] === 'a') v.area = parts[i + 1]; if (parts[i] === 't') v.topic = parts[i + 1]; }
    if (v.topic && v.area == null) v.area = '';
    return v;
  }
  return null;
}
function saveView() {
  const v = S.view;
  store.set(VIEW_KEY, { mode: v.mode, path: v.path, field: v.field, area: v.area, topic: v.topic, status: v.status, stars: v.stars, sort: v.sort, pdf: v.pdf, book: v.book, nscope: v.nscope });
}
// Go somewhere: update the view, the address bar (so Back works) and the page.
function go(patch, replace) {
  if ($('search').value) $('search').value = '';
  Object.assign(S.view, patch);
  S.shown = PAGE;
  saveView();
  const h = viewHash(S.view);
  if (location.hash !== h) history[replace ? 'replaceState' : 'pushState'](null, '', h);
  render();
  window.scrollTo({ top: 0 });
}
function onHash() {
  const v = readHash();
  if (!v) return;
  if ('q' in v) { $('search').value = v.q; S.shown = PAGE; render(); return; }
  $('search').value = '';
  Object.assign(S.view, v); S.shown = PAGE; saveView(); render();
}

/* ---------- filtering ---------- */
function hay(p) {
  let h = S.hay.get(p.id);
  if (h === undefined) { h = fold(`${p.t} ${p.a} ${p.y} ${p.v} ${p.n || ''} ${p.notes || ''} ${p.tp} ${p.ar || ''}`); S.hay.set(p.id, h); }
  return h;
}
// The rows in the current scope, before the status and star filters.
function scopeRows() {
  const q = query(), V = S.view;
  if (q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return S.rows.filter((r) => r.main && words.every((w) => hay(r.p).includes(w)));
  }
  if (V.topic) return S.rows.filter((r) => r.f === V.field && r.ar === (V.area || '') && r.tp === V.topic);
  if (V.area) return S.rows.filter((r) => r.f === V.field && r.ar === V.area);
  if (V.field) return S.rows.filter((r) => r.f === V.field && (r.main || r.p.f !== V.field));   // once per paper
  return S.rows.filter((r) => r.main);
}
function passFilters(r) {
  const st = S.view.status, g = prog(r.p.id);
  const n = STATUSES.reduce((k, [s]) => k + (g[s] ? 1 : 0), 0);
  if (st === 'untouched' && n) return false;
  if (st === 'progress' && (n === 0 || n === 4)) return false;
  if (st === 'complete' && n !== 4) return false;
  if (st[0] === '-' && g[st.slice(1)]) return false;
  if (st[0] === '+' && !g[st.slice(1)]) return false;
  if (S.view.stars !== '0' && (r.p.s || 0) !== +S.view.stars) return false;  // exact star level
  if (S.view.pdf && !r.p.pdf) return false;
  if (S.view.book && r.p.k !== 'book') return false;
  return true;
}
function sorted(list) {
  const by = S.view.sort;
  const yr = (r) => parseInt(r.p.y, 10) || 0;
  const q = query();
  if (q && by === 'order') {
    // Best match: every word in the title or the author list, then starred, then most cited.
    const words = fold(q).split(/\s+/).filter(Boolean);
    const rank = (r) => { const h = fold(`${r.p.t} ${r.p.a}`); return words.every((w) => h.includes(w)) ? 0 : 1; };
    const key = new Map(list.map((r) => [r, rank(r)]));
    return list.sort((a, b) => key.get(a) - key.get(b) || (b.p.s || 0) - (a.p.s || 0) || (b.p.c || 0) - (a.p.c || 0) || a.o - b.o);
  }
  if (by === 'cited') return list.sort((a, b) => (b.p.c || 0) - (a.p.c || 0) || a.o - b.o);
  if (by === 'new') return list.sort((a, b) => yr(b) - yr(a) || a.o - b.o);
  if (by === 'old') return list.sort((a, b) => (yr(a) || 9999) - (yr(b) || 9999) || a.o - b.o);
  if (by === 'author') return list.sort((a, b) => fold(a.p.a || '￿').localeCompare(fold(b.p.a || '￿')) || a.o - b.o);
  if (by === 'recent') return list.sort((a, b) => (prog(b.p.id).u || 0) - (prog(a.p.id).u || 0) || a.o - b.o);
  return list.sort((a, b) => a.o - b.o);
}

/* ---------- small pieces shared by the views ---------- */
const ICONS = {
  pr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  rd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
  nt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  rs: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/></svg>',
  all: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};
const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
const LEARN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 9 12 4 2 9l10 5 10-5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/><path d="M22 9v6"/></svg>';
const SUM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/></svg>';

const scholar = (p) => `https://scholar.google.com/scholar?q=${enc(`${p.t} ${(p.a || '').split(',')[0]}`)}`;
// "Open paper", or for a book the publisher's page for it.
const openWord = (p) => (p.k === 'book' ? 'Publisher’s page' : p.k ? 'Open' : 'Open paper');
function linkLabel(u, p) {
  try { const h = new URL(u).hostname.replace(/^www\./, ''); return h === 'doi.org' ? openWord(p || {}) : h; } catch { return openWord(p || {}); }
}
function shortAuthors(a) {
  if (!a) return '';
  const first = a.split(/,|&/)[0].trim();
  const n = a.split(/\.,|&/).filter((x) => x.trim()).length;
  return first + (/et al/.test(a) || n > 2 ? ' et al.' : n === 2 ? ' & ' + a.split('&').pop().split(',')[0].trim() : '');
}
const KINDS = { book: 'Book', report: 'Report', talk: 'Speech' };
const journal = (v) => { const m = /\*([^*]+)\*/.exec(v || ''); return m ? m[1] : ''; };
function learnBtn(p, bare) {
  const g = S.guides[p.id];
  if (g) return `<a class="learn has" href="${esc(g.file)}" target="_blank" rel="noopener" title="Open the interactive guide: ${esc(g.title)}">${LEARN_ICON}<span>Learn</span></a>`;
  return `<button type="button" class="learn${bare ? ' bare' : ''}" data-learn="1" title="No interactive guide yet: get a prompt to make one" aria-label="Learn">${LEARN_ICON}<span>Learn</span></button>`;
}
function sumBtn(p) {
  if (!S.summaries[p.id]) return '';
  return `<button type="button" class="learn sum has" data-sum="1" title="Summary, pages to read and what to write down">${SUM_ICON}<span>Summary</span></button>`;
}
function mark(text, words) {
  let h = esc(text);
  if (!words || !words.length) return h;
  const re = new RegExp('(' + words.filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return words.some((w) => w.length > 1) ? h.replace(re, '<mark>$1</mark>') : h;
}
// Segmented progress bar: how many papers have reached each step.
function segHtml(counts, total) {
  const n = total || 1;
  const [pr, rd, nt, rs] = counts;
  const parts = [[rs, 'rs'], [nt - rs, 'nt'], [rd - nt, 'rd'], [pr - rd, 'pr']];
  return `<div class="seg" role="img" aria-label="${rs} of ${total} fully done">${parts.map(([k, c]) => (k > 0 ? `<i style="width:${(100 * k) / n}%;background:var(--${c})"></i>` : '')).join('')}</div>`;
}
function stepCounts(rows) {
  const c = [0, 0, 0, 0];
  for (const r of rows) { const g = S.progress.p[r.p.id]; if (g) STATUSES.forEach(([s], i) => { if (g[s]) c[i]++; }); }
  return c;
}
function statline(rows) {
  const c = stepCounts(rows), total = rows.length;
  const stats = STATUSES.map(([s, label], i) => `<span><i class="k" style="background:var(--${s})"></i><b>${fmt(c[i])}</b> ${label.toLowerCase()}</span>`).join('');
  return `${segHtml(c, total)}<div class="statline"><span><b>${fmt(c[3])}</b> of ${fmt(total)} done</span>${stats}</div>`;
}

function paperRow(r, opt) {
  const p = r.p, g = prog(p.id);
  const link = p.link || scholar(p);
  const { next } = stepState(p.id);
  const btns = STATUSES.map(([s, label], idx) => {
    const on = g[s];
    const locked = !on && idx !== next;
    const tip = on ? `${label} on ${on}` : locked ? `${STATUSES[next][1]} comes first` : `Mark as ${label.toLowerCase()}`;
    return `<button type="button" class="st ${s}${locked ? ' locked' : ''}" data-st="${s}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${label}" title="${tip}">${ICONS[s]}</button>`;
  }).join('');
  const j = journal(p.v);
  const meta = [
    p.a ? `<span class="au">${mark(shortAuthors(p.a), opt.words)}</span>` : '',
    p.y ? `<span>${esc(p.y)}</span>` : '',
    j ? `<span><i>${mark(j, opt.words)}</i></span>` : p.k ? `<span class="kind">${KINDS[p.k] || 'Report'}</span>` : '',
    p.s ? `<span class="s" title="${p.s === 2 ? 'Must-read' : 'Influential'}">${'★'.repeat(p.s)}</span>` : '',
  ].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');
  const where = opt.where ? `<button type="button" class="where" data-gof="${esc(r.f)}" data-goa="${esc(r.ar)}" data-got="${esc(r.tp)}">${esc(r.ar ? `${r.ar} › ${r.tp}` : r.tp)}</button>` : '';
  const links = `<a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? linkLabel(p.link, p) : 'Search Scholar'} ↗</a>`
    + (p.pdf ? `<a class="plink pdf" href="${esc(p.pdf)}" target="_blank" rel="noopener" title="A free-to-read copy found by OpenAlex: an author’s page, a repository or an open-access journal">Free copy ↗</a>` : '')
    + (p.research ? `<a class="plink res" href="${esc(p.research)}" target="_blank" rel="noopener" title="Your research on this paper">Research ↗</a>` : '')
    + (p.c ? `<span class="cites" title="Citations counted by OpenAlex">cited ${fmt(p.c)}×</span>` : '');
  const notes = (p.n ? `<div class="pnote" title="${esc(p.n.replace(/\*/g, ''))}">${md(p.n)}</div>` : '')
    + (p.notes ? `<div class="pnote mine" title="${esc(p.notes)}"><b>Your notes:</b> ${esc(p.notes)}</div>` : '');
  return `<article class="paper${isDone(p.id) ? ' done' : ''}" data-id="${esc(p.id)}">
    <div class="pmain"><a class="ptitle" href="${esc(link)}" target="_blank" rel="noopener" title="${p.link ? openWord(p) : 'Search Google Scholar'}">${mark(p.t, opt.words)}</a>
    <div class="pmeta">${meta}</div>${notes}<div class="pmeta">${where}${links}</div></div>
    <div class="btns">${btns}${sumBtn(p)}${learnBtn(p, true)}</div>
    <button type="button" class="more-btn" data-edit="1" aria-label="Details and edit" title="Details and edit">${MORE_ICON}</button></article>`;
}

/* ---------- sidebar ---------- */
function renderNav() {
  const tree = fieldTree();
  const searching = !!query();
  const V = S.view;
  const find = fold($('navFind').value.trim());
  const cur = (f, ar, t) => (!searching && V.mode === 'list' && V.field === f && (V.area || null) === (ar || null) && (V.topic || null) === (t || null) ? ' aria-current="true"' : '');
  const data = (f, ar, t) => `data-f="${esc(f || '')}" data-a="${esc(ar || '')}" data-t="${esc(t || '')}"`;
  const count = (c) => `${c.rd ? fmt(c.rd) + '/' : ''}${fmt(c.n)}`;
  const nx = nextInfo();
  let h = '';
  if (find) {
    const hits = [];
    for (const f of fieldOrder(tree)) for (const [ar, A] of tree.get(f).areas) {
      if (ar && fold(ar).includes(find)) hits.push([f, ar, null, A]);
      for (const [t, c] of A.topics) if (fold(t).includes(find)) hits.push([f, ar, t, c]);
    }
    h = hits.slice(0, 60).map(([f, ar, t, c]) => `<button class="tnav" style="--c:${areaColor(f, ar)}" ${data(f, ar, t)}><span class="nm">${t ? `${esc(ar || f)} › <b>${esc(t)}</b>` : `<b>${esc(ar)}</b> · ${esc(f)}`}</span><span class="ct">${fmt(c.n)}</span></button>`).join('')
      || '<div class="navempty">No area or topic with that name.</div>';
    $('navTree').innerHTML = h;
    return;
  }
  h += `<button class="nav" style="--c:var(--ink)" data-home="1"${V.mode === 'home' && !searching ? ' aria-current="true"' : ''}><span class="ic">${ICONS.home}</span><span class="nm">Overview</span><span class="ct"></span></button>`;
  h += `<button class="nav" style="--c:var(--rs)" data-next="1"${V.mode === 'next' && !searching ? ' aria-current="true"' : ''}><span class="ic">${ICONS.next}</span><span class="nm">Next up</span><span class="ct">${nx.total ? `${fmt(nx.doneCount)}/${fmt(nx.total)}` : ''}</span></button>`;
  h += `<button class="nav" style="--c:var(--ink)" ${data(null, null, null)}${cur(null, null, null)}><span class="ic">${ICONS.all}</span><span class="nm">All papers</span><span class="ct">${fmt(S.papers.length)}</span></button>`;
  h += '<div class="navlabel">Fields</div>';
  const topicBtns = (f, ar, A) => [...A.topics].map(([t, c]) =>
    `<button class="tnav" ${data(f, ar, t)}${cur(f, ar, t)}><span class="nm">${esc(t)}</span><span class="ct">${count(c)}</span></button>`).join('');
  for (const f of fieldOrder(tree)) {
    const F = tree.get(f), fc = fieldColor(f);
    h += `<button class="nav" style="--c:${fc}" ${data(f, null, null)}${cur(f, null, null)} aria-expanded="${V.field === f}"><span class="sw"></span><span class="nm">${esc(f)}</span><span class="ct">${F.n ? count(F) : 'empty'}</span></button>`;
    if (V.field !== f || V.mode !== 'list' || searching) continue;
    h += '<div class="fieldtree">';
    let lastGroup = null;
    const areaBtn = (ar, A) => {
      const c = areaColor(f, ar), open = V.area === ar;
      let s = `<button class="anav" style="--c:${c}" ${data(f, ar, null)}${cur(f, ar, null)} aria-expanded="${open}"><span class="nm">${esc(ar)}</span><span class="ct">${count(A)}</span></button>`;
      if (open) s += `<div class="topics" style="--c:${c}">${topicBtns(f, ar, A)}<button class="navadd" data-newtopic="${esc(f)}" data-newtopicarea="${esc(ar)}">+ New topic</button></div>`;
      return s;
    };
    const grouped = [], loose = [];
    for (const [ar, A] of F.areas) { if (!ar) continue; (metaArea(f, ar) ? grouped : loose).push([ar, A]); }
    for (const [ar, A] of grouped) {
      const grp = metaArea(f, ar).group;
      if (grp !== lastGroup) { h += `<div class="gl" style="--c:${GROUP_COLORS[grp] || fc}">${esc(grp)}</div>`; lastGroup = grp; }
      h += areaBtn(ar, A);
    }
    if (loose.length && grouped.length) h += `<div class="gl" style="--c:${fc}">Your areas</div>`;
    for (const [ar, A] of loose) h += areaBtn(ar, A);
    if (F.areas.has('') && F.areas.get('').topics.size) h += `<div class="topics" style="--c:${fc}">${topicBtns(f, '', F.areas.get(''))}</div>`;
    h += `<div class="addrow"><button class="navadd" data-newarea="${esc(f)}">+ New area</button><button class="navadd" data-newtopic="${esc(f)}" data-newtopicarea="">+ New topic</button></div></div>`;
  }
  h += '<button class="navadd" data-newfield="1">+ New field</button>';
  $('navTree').innerHTML = h;
}

/* ---------- rendering ---------- */
function render() {
  if (!S.ready) return;
  S.nx = null;
  const a = document.activeElement;
  let refocus = null;
  if (a && $('view').contains(a)) {
    const row = a.closest('[data-id]');
    if (a.dataset.st && row) refocus = `[data-id="${CSS.escape(row.dataset.id)}"] [data-st="${a.dataset.st}"]`;
    else if (a.dataset.filter) refocus = `[data-filter="${a.dataset.filter}"]`;
    else if (a.id) refocus = '#' + CSS.escape(a.id);
  }
  renderNav();
  const q = query();
  if (q) renderList(); else if (S.view.mode === 'home') renderHome(); else if (S.view.mode === 'next') renderNext(); else renderList();
  renderLists(); renderBanner();
  document.title = q ? `“${q}” · Paper Archive` : S.view.mode === 'list' ? `${S.view.topic || S.view.area || S.view.field || 'All papers'} · Paper Archive` : S.view.mode === 'next' ? 'Next up · Paper Archive' : 'Paper Archive';
  if (refocus) { const el = $('view').querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}
function renderBanner() {
  const pending = (S.dirty.progress || 0) + (S.dirty.library || 0);
  const show = !canWrite();
  $('saveBanner').hidden = !show;
  if (show) $('saveBannerText').textContent = pending
    ? `${pending} change${pending === 1 ? ' is' : 's are'} saved only in this browser. Add your GitHub token so everything saves to your repo and shows on every device.`
    : 'Changes are saved only in this browser until you add your GitHub token. Then everything saves to your repo automatically.';
}
const setAccent = (c) => document.documentElement.style.setProperty('--fc', c);

function spark(dec) {
  const max = Math.max(1, ...dec);
  return `<div class="spark" title="Papers by decade, 1900s to 2020s" aria-hidden="true">${dec.map((n) => `<i style="height:${Math.round((24 * n) / max) + 2}px"></i>`).join('')}</div>`;
}
function areaCard(f, ar, A) {
  const m = metaArea(f, ar);
  return `<button type="button" class="card" style="--c:${areaColor(f, ar)}" data-f="${esc(f)}" data-a="${esc(ar)}" data-t="" aria-label="${esc(ar)}: ${fmt(A.n)} papers in ${A.topics.size} topics">
    <h3>${esc(ar)}</h3>${m && m.blurb ? `<p>${esc(m.blurb)}</p>` : ''}
    <div class="cardfoot"><div class="cardnum"><b>${fmt(A.n)}</b><span>paper${A.n === 1 ? '' : 's'} · ${A.topics.size} topic${A.topics.size === 1 ? '' : 's'}${A.rd ? ` · ${fmt(A.rd)} read` : ''}</span></div>${A.n ? spark(A.dec) : ''}</div>
    <div class="cardbar"><i style="width:${A.n ? (100 * A.rd) / A.n : 0}%"></i></div></button>`;
}
function topicCard(f, ar, t, c) {
  return `<button type="button" class="tcard" data-f="${esc(f)}" data-a="${esc(ar)}" data-t="${esc(t)}" aria-label="${esc(t)}: ${fmt(c.n)} papers">
    <b>${esc(t)}</b><span class="tn">${c.rd ? fmt(c.rd) + ' / ' : ''}${fmt(c.n)}${c.s2 ? ` · ${c.s2} ★★` : ''}</span>
    <div class="cardbar"><i style="width:${c.n ? (100 * c.rd) / c.n : 0}%"></i></div></button>`;
}
// A field's areas as cards, under their group headings.
function fieldSections(f) {
  const F = fieldTree().get(f); if (!F) return '';
  const groups = new Map(), loose = [];
  for (const [ar, A] of F.areas) {
    if (!ar) continue;
    const m = metaArea(f, ar);
    if (m && m.group) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push([ar, A]); } else loose.push([ar, A]);
  }
  let h = '';
  for (const [g, list] of groups) {
    const gm = S.meta.groups.find((x) => x.name === g);
    h += `<section class="sec" style="--c:${GROUP_COLORS[g] || fieldColor(f)}"><div class="sechead"><h2>${esc(g)}</h2><p>${esc(gm ? gm.blurb : '')}</p></div>
      <div class="cards">${list.map(([ar, A]) => areaCard(f, ar, A)).join('')}</div></section>`;
  }
  if (loose.length) h += `<section class="sec" style="--c:${fieldColor(f)}">${groups.size ? '<div class="sechead"><h2>Your areas</h2></div>' : ''}<div class="cards">${loose.map(([ar, A]) => areaCard(f, ar, A)).join('')}</div></section>`;
  const top = F.areas.get('');
  if (top && top.topics.size) h += `<section class="sec"><div class="tgrid" style="--fc:${fieldColor(f)}">${[...top.topics].map(([t, c]) => topicCard(f, '', t, c)).join('')}</div></section>`;
  return h;
}

/* ---------- overview ---------- */
function activity() {
  const days = new Map();
  for (const g of Object.values(S.progress.p)) for (const [s] of STATUSES) if (g[s]) days.set(g[s], (days.get(g[s]) || 0) + 1);
  return days;
}
function heatmap(days) {
  const now = new Date(), cells = [];
  const start = new Date(now); start.setDate(now.getDate() - now.getDay() - 25 * 7);
  let max = 1;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const key = localDate(d);
    const n = days.get(key) || 0; max = Math.max(max, n); cells.push([key, n]);
  }
  const week = cells.slice(-7).reduce((t, [, n]) => t + n, 0), todayN = cells[cells.length - 1][1];
  let streak = 0; for (let i = cells.length - 1; i >= 0 && (cells[i][1] || i === cells.length - 1); i--) if (cells[i][1]) streak++;
  return `<div class="heat" role="img" aria-label="Steps ticked per day over the last 26 weeks">${cells.map(([k, n]) => `<i data-l="${n ? Math.max(1, Math.ceil((4 * n) / max)) : 0}" title="${k}: ${n} step${n === 1 ? '' : 's'}"></i>`).join('')}</div>
    <div class="heatnote"><b>${fmt(todayN)}</b> step${todayN === 1 ? '' : 's'} today · <b>${fmt(week)}</b> in the last 7 days${streak > 1 ? ` · <b>${streak}</b>-day streak` : ''}</div>`;
}
function renderHome() {
  setAccent('#4a47a8');
  const tree = fieldTree(), all = S.rows.filter((r) => r.main);
  let areas = 0, topics = 0;
  for (const F of tree.values()) for (const [ar, A] of F.areas) { if (ar && A.n) areas++; topics += [...A.topics.values()].filter((c) => c.n).length; }
  const c = stepCounts(all), days = activity();
  const { order, i, total, doneCount } = nextInfo();
  const news = !store.get(SEEN_SCI_KEY) && S.sciAdded
    ? `<div class="news"><span><b>New:</b> Mathematics, Statistics and Econophysics now have their own areas and topics: ${fmt(S.sciAdded)} papers and books, including ${fmt(S.sciLandmarks)} classic books and papers going back centuries. Your ticks are untouched.</span><button type="button" class="pill dark" data-seen="1">Got it</button></div>`
    : !store.get(SEEN_KEY)
    ? `<div class="news"><span><b>New:</b> the archive now covers all of economics. ${fmt(S.added)} papers and books were added in ${Math.max(0, S.meta.areas.length - 1)} new areas, and your earlier papers and ticks are untouched.</span><button type="button" class="pill dark" data-seen="1">Got it</button></div>`
    : !store.get(SEEN_LM_KEY) && S.landmarks
      ? `<div class="news"><span><b>New:</b> ${fmt(S.landmarks)} landmark books and classic papers were added, each with a line on what it contributed. In any list, the <b>Books</b> filter shows just the books.</span><button type="button" class="pill dark" data-seen="1">Got it</button></div>`
      : '';
  let cont = '<p class="blurb">Every paper on this path has all four steps ticked.</p>';
  if (i >= 0) {
    const p = S.byId.get(order[i].id), { next } = stepState(p.id), nk = STATUSES[next];
    cont = `<div class="cont" data-id="${esc(p.id)}"><h3><a href="${esc(p.link || scholar(p))}" target="_blank" rel="noopener">${esc(p.t)}</a></h3>
      <div class="meta">${esc(shortAuthors(p.a))}${p.y ? ' · ' + esc(p.y) : ''} · paper ${fmt(i + 1)} of ${fmt(total)}, ${fmt(doneCount)} finished</div>
      <div class="row">${nk ? `<button type="button" class="pill go ${nk[0]}" data-step="${nk[0]}">${ICONS[nk[0]]} Mark as ${nk[1].toLowerCase()}</button>` : ''}<button type="button" class="linkbtn" data-next="1">Open Next up</button></div></div>`;
  }
  const how = `<ul class="howto">${STATUSES.map(([s, label], n) => `<li><span class="st ${s}" aria-pressed="true">${ICONS[s]}</span><span><b>${label}.</b> ${['Print the paper.', 'Read it, as deeply as it deserves.', 'Write your notes by hand.', 'Research it and link your write-up.'][n]}</span></li>`).join('')}</ul>`;
  let h = `${news}<section class="welcome"><div class="eyebrow">Your reading archive</div>
    <h1>${fmt(S.papers.length)} papers across <em>${areas} areas</em> and ${fmt(topics)} topics</h1>
    ${segHtml(c, all.length)}
    <div class="statgrid">${STATUSES.map(([s, label], n) => `<div class="stat"><b>${fmt(c[n])}</b><span><i class="k" style="background:var(--${s})"></i>${label}</span></div>`).join('')}<div class="stat"><b>${fmt(c[3])}</b><span>Finished, of ${fmt(all.length)}</span></div></div></section>
    <div class="duo"><div class="panel"><div class="eyebrow">Next up</div>${cont}</div>
    <div class="panel"><div class="eyebrow">${days.size ? 'Your last 26 weeks' : 'Four steps per paper, in order'}</div>${days.size ? heatmap(days) : how}</div></div>`;
  for (const f of fieldOrder(tree)) {
    const F = tree.get(f);
    h += `<section class="sec" style="--c:${fieldColor(f)}"><div class="sechead plain"><h2 style="font-size:30px">${esc(f)}</h2><p>${F.n ? `${fmt(F.n)} paper${F.n === 1 ? '' : 's'}` : 'Nothing here yet'}</p><span class="grow"></span><button type="button" class="pill" data-f="${esc(f)}" data-a="" data-t="">${F.n ? 'Browse all' : 'Open'}</button></div></section>`;
    h += F.n ? fieldSections(f) : `<button type="button" class="card empty-card" style="--c:${fieldColor(f)}" data-f="${esc(f)}" data-a="" data-t=""><h3>Start this shelf</h3><p>Add a paper, or paste a list, and it will appear here.</p></button>`;
  }
  $('view').innerHTML = h;
}

/* ---------- lists: all papers, a field, an area, a topic, or search results ---------- */
function renderList() {
  const q = query(), V = S.view, tree = fieldTree();
  const scope = scopeRows();
  const list = sorted(scope.filter(passFilters));
  const f = q ? null : V.field, ar = q ? null : V.area, tp = q ? null : V.topic;
  setAccent(q || !f ? '#4a47a8' : ar ? areaColor(f, ar) : fieldColor(f));
  const F = f ? tree.get(f) : null, A = F && ar ? F.areas.get(ar) : null;
  const m = ar ? metaArea(f, ar) : null;
  let crumb, title, blurb = '';
  if (q) { crumb = 'Search across every field'; title = `“${esc(q)}”`; }
  else if (!f) { crumb = 'Your whole archive'; title = 'All papers'; }
  else if (tp) { crumb = `<button type="button" data-f="${esc(f)}" data-a="" data-t="">${esc(f)}</button>${ar ? `<span aria-hidden="true">›</span><button type="button" data-f="${esc(f)}" data-a="${esc(ar)}" data-t="">${esc(ar)}</button>` : ''}`; title = esc(tp); }
  else if (ar) { crumb = `<button type="button" data-f="${esc(f)}" data-a="" data-t="">${esc(f)}</button>${m && m.group ? `<span aria-hidden="true">›</span><span class="tag">${esc(m.group)}</span>` : ''}`; title = esc(ar); blurb = m ? m.blurb : ''; }
  else { crumb = 'Field'; title = esc(f); }
  const dl = tp && S.downloads[tp];
  let h = `<section class="head"><div class="crumb">${crumb}</div><h1>${title}</h1>${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
    ${statline(scope)}${dl ? `<div class="headtools"><a class="dllink" href="${esc(dl)}" target="_blank" rel="noopener">Download checklist ↗</a></div>` : ''}</section>`;
  if (!q && f && !ar && !tp) h += fieldSections(f) + (scope.length ? `<div class="sechead plain sec"><h2>All papers in ${esc(f)}</h2></div>` : '');
  if (!q && A && !tp && A.topics.size) h += `<div class="tgrid">${[...A.topics].map(([t, c]) => topicCard(f, ar, t, c)).join('')}</div><div class="sechead plain sec"><h2>Papers</h2></div>`;
  const chip = (val, label) => `<button type="button" class="chip" data-filter="${val}" aria-pressed="${V.status === val}">${label}</button>`;
  const hasPdf = scope.some((r) => r.p.pdf), hasBook = scope.some((r) => r.p.k === 'book');
  const opt = (val, label) => `<option value="${val}"${V.sort === val ? ' selected' : ''}>${label}</option>`;
  if (scope.length) h += `<div class="chips" role="group" aria-label="Filter papers">
      ${chip('any', 'All')}${chip('untouched', 'Not started')}${chip('progress', 'In progress')}${chip('complete', 'Done')}
      <span class="chipsep" aria-hidden="true"></span>
      <button type="button" class="chip star" data-stars="2" aria-pressed="${V.stars === '2'}">★★ Must-reads</button>
      <button type="button" class="chip star" data-stars="1" aria-pressed="${V.stars === '1'}">★ Influential</button>
      ${hasBook || V.book ? `<button type="button" class="chip" data-bookchip="1" aria-pressed="${!!V.book}">Books</button>` : ''}
      ${hasPdf || V.pdf ? `<button type="button" class="chip" data-pdfchip="1" aria-pressed="${!!V.pdf}">Free copy</button>` : ''}
      <label class="sortwrap">Sort <select id="fSort" aria-label="Sort papers">${opt('order', q ? 'Best match' : 'List order')}${opt('cited', 'Most cited')}${opt('new', 'Newest')}${opt('old', 'Oldest')}${opt('author', 'Author')}${opt('recent', 'Recently ticked')}</select></label>
    </div>
    <div class="legend" aria-hidden="true"><span><b class="s">★★</b> must-read</span><span><b class="s">★</b> influential</span><span class="gap"></span>${STATUSES.map(([s, l]) => `<span><i style="background:var(--${s})"></i>${l}</span>`).join('')}<span><b>${fmt(list.length)}</b>&nbsp;paper${list.length === 1 ? '' : 's'}</span></div>`;
  if (!list.length) {
    const empty = !scope.length && !q && f;
    h += `<div class="empty">${empty ? '<p>Nothing here yet.</p><button class="pill primary" type="button" data-addhere="1">Add papers</button>' : q ? '<p>No paper matches that search. Try an author’s surname or a word from the title.</p>' : '<p>No papers match these filters.</p>'}</div>`;
    $('view').innerHTML = h;
    return;
  }
  const page = list.slice(0, S.shown);
  const grouping = V.sort === 'order' && !q;
  const gkey = (r) => (tp ? r.st : ar ? r.tp : f ? (r.ar ? `${r.ar} › ${r.tp}` : r.tp) : `${r.f} › ${r.ar ? r.ar + ' › ' : ''}${r.tp}`);
  const counts = new Map();
  if (grouping) for (const r of list) { const k = gkey(r); counts.set(k, (counts.get(k) || 0) + 1); }
  const words = q ? fold(q).split(/\s+/).filter(Boolean) : null;
  const rowOpt = { words, where: !!q || (!tp && !grouping) };
  let rowsHtml = '', last = null;
  for (const r of page) {
    if (grouping) {
      const k = gkey(r);
      if (k !== last) {
        if (k) rowsHtml += `<div class="group">${tp ? esc(k) : `<button type="button" data-f="${esc(r.f)}" data-a="${esc(r.ar)}" data-t="${esc(r.tp)}">${esc(k)}</button>`}<small>${fmt(counts.get(k))}</small></div>`;
        last = k;
      }
    }
    rowsHtml += paperRow(r, rowOpt);
  }
  const left = list.length - S.shown;
  h += `<div class="list">${rowsHtml}</div>${left > 0 ? `<div class="more"><button class="pill" type="button" data-more="1">Show more (${fmt(left)} left)</button></div>` : ''}`;
  $('view').innerHTML = h;
}

function renderLists() {
  if (!$('paperDlg').open && !$('groupDlg').open) return;
  const tree = fieldTree();
  const f = $('pField').value || $('gField').value || S.view.field;
  const ar = $('pArea').value;
  const opts = (xs) => [...xs].filter(Boolean).map((x) => `<option value="${esc(x)}">`).join('');
  $('fieldList').innerHTML = opts(tree.keys());
  const areas = f && tree.has(f) ? tree.get(f).areas : new Map();
  $('areaList').innerHTML = opts(areas.keys());
  $('topicList').innerHTML = opts(areas.has(ar) ? areas.get(ar).topics.keys() : []);
  const t = $('pTopic').value;
  $('subList').innerHTML = t ? opts(new Set(S.rows.filter((r) => r.f === f && r.ar === ar && r.tp === t && r.st).map((r) => r.st))) : '';
}

/* ---------- Next up: one paper at a time, in order ---------- */
const STEP_HELP = {
  pr: 'Print it out.',
  rd: null, // filled from the paper's depth
  nt: 'Write your notes: the question, the method, the main finding, why it mattered, and which paper it links to.',
  rs: 'Research it with an AI assistant (the Learn button has a ready-made prompt), push the work to a repo, and paste the link below.',
};
function scopeParts() {
  const [f, ar, tp] = (S.view.nscope || '').split('::');
  return { f: f || '', ar: ar || '', tp: tp || '' };
}
function defaultScope() {
  const V = S.view, tree = fieldTree();
  if (V.field && (V.area || V.topic)) return `${V.field}::${V.area || ''}::${V.topic || ''}`;
  for (const f of fieldOrder(tree)) for (const [ar, A] of tree.get(f).areas) if (A.n) return `${f}::${ar}::`;
  return '';
}
// Three paths: the market-power reading plan, any area or topic (must-reads first), or everything by year.
function pathOrder() {
  if (S.view.path === 'plan' && S.plan) return S.plan.order.filter((o) => S.byId.has(o.id));
  if (S.view.path === 'scope') {
    const { f, ar, tp } = scopeParts();
    return S.rows.filter((r) => r.f === f && r.ar === ar && (!tp || r.tp === tp))
      .sort((a, b) => (b.p.s || 0) - (a.p.s || 0) || a.o - b.o).map((r) => ({ id: r.p.id, ph: null, d: null }));
  }
  const yr = (p) => parseInt(p.y, 10) || 9999;
  return [...S.papers].sort((a, b) => yr(a) - yr(b) || a.o - b.o).map((p) => ({ id: p.id, ph: null, d: null }));
}
function nextInfo() {
  if (S.nx) return S.nx;
  const order = S.byId.size ? pathOrder() : [];
  let doneCount = 0, i = -1;
  order.forEach((o, k) => { if (isDone(o.id)) doneCount++; else if (i < 0) i = k; });
  S.nx = { order, i, total: order.length, doneCount };
  return S.nx;
}
function renderNext() {
  const { order, i, total, doneCount } = nextInfo();
  const V = S.view, planOn = V.path === 'plan' && S.plan, scopeOn = V.path === 'scope';
  const sc = scopeParts(), tree = fieldTree();
  setAccent(scopeOn && sc.f ? areaColor(sc.f, sc.ar) : '#0b8f63');
  let pickers = '';
  if (scopeOn) {
    let areaOpts = '';
    for (const f of fieldOrder(tree)) {
      const opts = [...tree.get(f).areas].filter(([, A]) => A.n).map(([ar]) => `<option value="${esc(`${f}::${ar}`)}"${sc.f === f && sc.ar === ar ? ' selected' : ''}>${esc(ar || `${f}: topics`)}</option>`).join('');
      if (opts) areaOpts += `<optgroup label="${esc(f)}">${opts}</optgroup>`;
    }
    const A = tree.get(sc.f) && tree.get(sc.f).areas.get(sc.ar);
    const topicOpts = A ? [...A.topics].filter(([, c]) => c.n).map(([t]) => `<option value="${esc(t)}"${sc.tp === t ? ' selected' : ''}>${esc(t)}</option>`).join('') : '';
    pickers = `<select id="nxArea" aria-label="Area to follow">${areaOpts}</select><select id="nxTopic" aria-label="Topic to follow"><option value="">Every topic in it</option>${topicOpts}</select>`;
  }
  const pathBar = `<div class="pathbar" role="group" aria-label="Which order to follow">
      <span>Follow</span>
      <button type="button" class="chip" data-path="plan" aria-pressed="${V.path === 'plan'}">Market power reading plan · ${S.plan ? S.plan.order.length : 0}</button>
      <button type="button" class="chip" data-path="scope" aria-pressed="${scopeOn}">An area or topic, must-reads first</button>
      <button type="button" class="chip" data-path="year" aria-pressed="${V.path === 'year'}">Everything, oldest first · ${fmt(S.papers.length)}</button>
      ${pickers}
    </div>`;
  const pathName = planOn ? 'Reading plan' : scopeOn ? esc(sc.tp || sc.ar || sc.f) : 'Oldest first';
  if (i < 0) {
    $('view').innerHTML = `<section class="head"><div class="crumb">Next up · ${pathName}</div><h1>${total ? 'All done' : 'Nothing on this path'}</h1><p class="blurb">${total ? 'Every paper on this path has all four steps ticked.' : 'Pick another path below.'}</p></section>${pathBar}`;
    return;
  }
  const cur = order[i], p = S.byId.get(cur.id);
  const phase = planOn && cur.ph != null ? S.plan.phases[cur.ph] : null;
  const { g, next } = stepState(p.id);
  const depth = planOn && cur.d ? S.plan.depth[cur.d] : null;
  const help = Object.assign({}, STEP_HELP, { rd: depth ? `Read it. ${depth}.` : 'Read it.' });
  const link = p.link || scholar(p);
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
  const who = (q) => `${esc(((q.a || '').split(/,|&/)[0] || '').trim())}${q.y ? ' · ' + esc(q.y) : ''}`;
  const upcoming = order.slice(i + 1, i + 9).map((o, n) => {
    const q = S.byId.get(o.id);
    const newPhase = planOn && o.ph !== (n === 0 ? cur.ph : order[i + n].ph);
    return `${newPhase ? `<li class="phasemark">Phase ${o.ph}: ${esc(S.plan.phases[o.ph].title)}</li>` : ''}
      <li class="up"><span class="upn">${i + n + 2}</span><span class="upt"><b>${esc(q.t)}</b><small>${who(q)}${o.d ? ' · ' + { deep: 'Deep', std: 'Standard', skim: 'Skim' }[o.d] : ''}${q.s ? ' · ' + '★'.repeat(q.s) : ''}</small></span>
      <span class="upd">${STATUSES.map(([k]) => `<i class="${prog(q.id)[k] ? 'on ' + k : ''}"></i>`).join('')}</span></li>`;
  }).join('');
  const recent = order.slice(0, i).filter((o) => isDone(o.id)).slice(-3).reverse().map((o) => {
    const q = S.byId.get(o.id);
    return `<li class="up donep"><span class="upn">✓</span><span class="upt"><b>${esc(q.t)}</b><small>${who(q)}</small></span></li>`;
  }).join('');
  $('view').innerHTML = `
    <section class="head">
      <div class="crumb">Next up · ${pathName}</div>
      <h1>${phase ? `Phase ${cur.ph}: ${esc(phase.title)}` : scopeOn ? esc(sc.tp || sc.ar || sc.f) : 'Oldest papers first'}</h1>
      ${phase ? `<p class="blurb">${esc(phase.about)}</p>` : ''}
      <div class="seg"><i style="width:${(100 * doneCount) / (total || 1)}%;background:var(--rs)"></i></div>
      <div class="statline"><span>Paper <b>${fmt(i + 1)}</b> of ${fmt(total)}</span><span><b>${fmt(doneCount)}</b> finished</span></div>
    </section>
    ${pathBar}
    <article class="now" data-id="${esc(p.id)}">
      <div class="now-top"><span class="nowtag">#${i + 1}${depth ? ' · ' + esc(depth.split(' · ')[0]) : ''}${scopeOn || !planOn ? ` · ${esc(p.tp)}` : ''}</span>${p.s ? `<span class="s">${'★'.repeat(p.s)}</span>` : ''}</div>
      <a class="nowtitle" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.t)}</a>
      <div class="nowmeta">${esc(p.a || '')}${p.y ? ' · ' + esc(p.y) : ''}${p.v ? ' · ' + md(p.v) : ''}</div>
      <div class="nowlinks"><a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? openWord(p) : 'Search Scholar'} ↗</a>${p.pdf ? `<a class="plink pdf" href="${esc(p.pdf)}" target="_blank" rel="noopener">Free copy ↗</a>` : ''}${sumBtn(p)}${learnBtn(p)}</div>
      <ol class="steps">${steps}</ol>
      ${doIt}
      ${phaseEnd && phase ? `<div class="phasetask"><b>End of phase ${cur.ph}.</b> Before moving on: ${esc(phase.task)}</div>` : ''}
    </article>
    ${upcoming ? `<h2 class="nexth">Coming up</h2><ol class="uplist">${upcoming}</ol>` : ''}
    ${recent ? `<h2 class="nexth">Recently finished</h2><ol class="uplist">${recent}</ol>` : ''}`;
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
  const also = p ? S.rows.filter((r) => r.p.id === p.id && !r.main).map((r) => `${r.ar} › ${r.tp}`) : [];
  $('pAbout').innerHTML = p ? [p.n ? `<i>${md(p.n)}</i>` : '', also.length ? `Also listed under ${esc(also.join('; '))}.` : '', p.c ? `Cited ${fmt(p.c)} times, as counted by OpenAlex.` : '', p.vf ? 'The bibliography marks this citation as uncertain. Check it before relying on it.' : '', p.link ? '' : 'No link yet. The title opens a Google Scholar search.'].filter(Boolean).join('<br>') : '';
  document.querySelectorAll('#paperDlg details').forEach((d) => { d.open = false; });
  $('pDelete').hidden = !p;
  $('pDelete').textContent = p && p.added ? 'Delete paper' : 'Remove from archive';
  $('paperErr').hidden = true;
  $('paperDlg').showModal();
  renderLists();
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
  Object.assign(S.view, { mode: 'list', field: f, area: ar, topic: tp }); saveView();
  history.pushState(null, '', viewHash(S.view));
  changed('library', rows.length === 1 ? `Add: ${rows[0].t.slice(0, 80)}` : `Add ${rows.length} papers to ${f} › ${tp}`);
  toast(rows.length === 1 ? 'Paper added' : `${rows.length} papers added`);
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
  $('gField').required = mode === 'field';
  $('gArea').required = mode === 'area';
  $('gTopic').required = mode === 'topic';
  $('gTopic').placeholder = mode === 'topic' ? '' : 'optional';
  $('gArea').placeholder = mode === 'area' ? 'e.g. Monopoly & market power' : 'optional';
  $('groupDlg').showModal();
  renderLists();
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
  Object.assign(S.view, { mode: 'list', field: f, area: ar || (t ? '' : null), topic: t || null }); saveView();
  history.pushState(null, '', viewHash(S.view));
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

/* ---------- summaries and learning guides ---------- */
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

let lastPull = 0;
async function refresh(force) {
  if (!force && Date.now() - lastPull < 30000) return;
  lastPull = Date.now();
  try {
    await pull();
    saveCache(); S.hay.clear(); rebuild(); render();
    if (S.dirty.progress || S.dirty.library) { if (canWrite()) sync(); else setSync('Saved on this device. Add a token in Settings to sync.'); }
    else setSync(hasRepo() ? (canWrite() ? 'Synced with GitHub' : 'Read-only. Add a token in Settings to edit.') : 'Local mode');
  } catch (e) {
    setSync(e.status === 403 ? 'GitHub rate limit hit. Showing saved copy.' : 'Offline. Showing saved copy.', true);
  }
}

/* ---------- events ---------- */
function closeNav() { $('sidebar').classList.remove('open'); $('navToggle').setAttribute('aria-expanded', 'false'); $('scrim').hidden = true; }
const scopeOf = (d) => ({ mode: 'list', field: d.f || null, area: d.a || (d.t ? '' : null), topic: d.t || null });
function refilter() { S.shown = PAGE; saveView(); render(); }
function viewClick(e) {
  const el = e.target.closest('button');
  if (!el || !$('view').contains(el)) return;
  const d = el.dataset, row = el.closest('[data-id]');
  if (d.seen) { store.set(SEEN_KEY, 1); store.set(SEEN_LM_KEY, 1); store.set(SEEN_SCI_KEY, 1); render(); return; }
  if (d.home) return go({ mode: 'home' });
  if (d.next) return go({ mode: 'next' });
  if (d.more) { S.shown += PAGE; render(); return; }
  if (d.addhere) return openPaper(null);
  if (d.filter) { S.view.status = d.filter; return refilter(); }
  if (d.stars) { S.view.stars = S.view.stars === d.stars ? '0' : d.stars; return refilter(); }
  if (d.pdfchip) { S.view.pdf = !S.view.pdf; return refilter(); }
  if (d.bookchip) { S.view.book = !S.view.book; return refilter(); }
  if (d.path) {
    S.view.path = d.path;
    if (d.path === 'scope' && !scopeParts().f) S.view.nscope = defaultScope();
    saveView(); render(); return;
  }
  if (d.gof !== undefined) return go(scopeOf({ f: d.gof, a: d.goa, t: d.got }));
  if (row) {
    const id = row.dataset.id;
    if (d.learn) return openLearn(id);
    if (d.sum) return openSummary(id);
    if (d.st) return toggle(id, d.st);
    if (d.edit) return openPaper(id);
    if (d.step) {
      if (d.step === 'rs') {
        const url = cleanUrl(($('rsLink') || {}).value || '');
        const pp = S.byId.get(id);
        if (url && url !== (pp.research || '')) setResearch(pp, url);
      }
      toggle(id, d.step);
      if (d.step === 'rs') toast('Paper finished. On to the next one.');
      if (S.view.mode === 'next') window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (d.undo) { const { last } = stepState(id); if (last >= 0) toggle(id, STATUSES[last][0]); return; }
  }
  if (d.f !== undefined) return go(scopeOf(d));
}
function bind() {
  $('navTree').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.newfield) return openGroup('field');
    if (d.newarea) return openGroup('area', d.newarea);
    if (d.newtopic) return openGroup('topic', d.newtopic, d.newtopicarea);
    $('navFind').value = '';
    if (d.home || d.next) { go({ mode: d.home ? 'home' : 'next' }); closeNav(); return; }
    const v = scopeOf(d);
    go(v);
    if (v.topic || !v.field) closeNav();
  });
  $('navFind').addEventListener('input', renderNav);
  $('view').addEventListener('click', viewClick);
  $('view').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'fSort') { S.view.sort = t.value; refilter(); }
    else if (t.id === 'nxArea') { S.view.nscope = `${t.value}::`; saveView(); render(); }
    else if (t.id === 'nxTopic') { const sc = scopeParts(); S.view.nscope = `${sc.f}::${sc.ar}::${t.value}`; saveView(); render(); }
  });
  let st;
  $('search').addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const q = query();
      S.shown = PAGE;
      history.replaceState(null, '', q ? `#/q/${enc(q)}` : viewHash(S.view));
      render();
      if (q) window.scrollTo({ top: 0 });
    }, 160);
  });
  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !document.querySelector('dialog[open]')) {
      e.preventDefault(); $('search').focus(); $('search').select();
    } else if (e.key === 'Escape' && a === $('search') && $('search').value) {
      $('search').value = ''; $('search').dispatchEvent(new Event('input'));
    }
  });
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  $('brand').addEventListener('click', (e) => { e.preventDefault(); go({ mode: 'home' }); });
  $('scrim').addEventListener('click', closeNav);
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
  $('saveBannerBtn').addEventListener('click', openSettings);
  window.addEventListener('online', () => refresh(true));
}

/* ---------- start ---------- */
const DATA_V = '4';      // bump when data/economics.json is rebuilt, so browsers fetch the new copy
const SCI_V = '1';       // the same for data/sciences.json
async function start() {
  if (!$('view') || !$('navTree')) {
    // This script arrived before the page that goes with it (an old copy of index.html is cached).
    let tried = false;
    try { tried = !!sessionStorage.getItem('pa-reloaded'); sessionStorage.setItem('pa-reloaded', '1'); } catch { /* ignore */ }
    if (!tried) location.reload();
    return;
  }
  bind();
  loadCache();
  const [cat, eco, sci, learn, plan, sums, dls, cites] = await Promise.all([
    fetchStatic('data/catalog.json', { papers: [] }, false),
    fetchStatic(`data/economics.json?v=${DATA_V}`, { topics: [] }, false),
    fetchStatic(`data/sciences.json?v=${SCI_V}`, { topics: [] }, false),
    fetchStatic('data/learn.json', { guides: {} }),
    fetchStatic('data/plan.json', null),
    fetchStatic('data/summaries.json', { s: {} }),
    fetchStatic('data/downloads.json', { lists: {} }),
    fetchStatic('data/citations.json', { c: {} }, false),
  ]);
  const base = cat.papers || [];
  const counts = cites.c || {};
  // One-line notes for landmarks whose paper is listed in another file (catalog.json, or economics for a science landmark).
  const notes = Object.assign({}, eco.notes || {}, sci.notes || {});
  base.forEach((p, i) => { p.o = i; if (counts[p.id]) p.c = counts[p.id]; });
  const known = new Set(base.map((p) => p.id));
  const extra = unpackCatalog(eco, 1e5), more = unpackCatalog(sci, 5e5);
  const ecoPapers = extra.papers.filter((p) => !known.has(p.id));
  ecoPapers.forEach((p) => known.add(p.id));
  const sciPapers = more.papers.filter((p) => !known.has(p.id));
  S.catalog = base.concat(ecoPapers, sciPapers);
  S.catalog.forEach((p) => { if (!p.n && notes[p.id]) p.n = notes[p.id]; });
  S.added = S.catalog.length - base.length;
  S.landmarks = ecoPapers.filter((p) => p.n).length + Object.keys(eco.notes || {}).length;
  S.sciAdded = sciPapers.length;
  S.sciLandmarks = sciPapers.filter((p) => p.n).length + Object.keys(sci.notes || {}).length;
  S.xrefs = extra.xrefs.concat(more.xrefs);
  S.meta = { groups: (eco.groups || []).concat(sci.groups || []), areas: (eco.areas || []).concat(sci.areas || []) };
  S.guides = learn.guides || {};
  S.plan = plan;
  S.summaries = sums.s || {};
  S.downloads = dls.lists || {};
  rebuild();
  const V = S.view, fromHash = readHash();
  if (fromHash && 'q' in fromHash) $('search').value = fromHash.q;
  else if (fromHash) Object.assign(V, fromHash);
  else if (!store.get(SEEN_SCI_KEY) || !store.get(SEEN_KEY)) V.mode = 'home';   // show the overview once after an expansion
  if (!['home', 'next', 'list'].includes(V.mode)) V.mode = 'home';
  if (V.field && !fieldTree().has(V.field)) Object.assign(V, { field: null, area: null, topic: null });
  // Views saved before areas existed: work out the area from the topic.
  if (V.topic && V.area == null) {
    const hit = S.rows.find((r) => r.f === V.field && r.tp === V.topic);
    V.area = hit ? hit.ar : null;
  }
  S.ready = true;
  if (!query()) history.replaceState(null, '', viewHash(V));
  render();
  await refresh(true);
}
start();
})();
