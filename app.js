/* Paper Archive — a static GitHub Pages app.
 *
 * Papers come from three read-only catalogs in this repo:
 *   data/catalog.json    the monopoly and market power bibliography (6,185 papers)
 *   data/economics.json  the rest of economics, built by tools/economics/
 *   data/sciences.json   econophysics, mathematics and statistics, built by tools/sciences/
 * Your own data lives in two more files, read from and written back to the repo as commits:
 *   data/library.json    papers you add, edits to any paper (notes, links, flashcards), weekly goals,
 *                        and extra fields, areas and topics
 *   data/progress.json   the date of each of the five steps, per paper
 * Saving goes through a small relay (SYNC_URL below, code in sync/worker.js) that holds the repo
 * token, so anyone on any device can save without signing in. Without the relay, a GitHub token
 * entered in Settings does the same for that one device; with neither, changes stay in the browser.
 */
(() => {
'use strict';

// The save relay's address (a Cloudflare Worker running sync/worker.js). Empty until it is set up.
const SYNC_URL = '';

const STATUSES = [['pr', 'Printed'], ['rd', 'Read'], ['nt', 'Notes'], ['rs', 'Researched'], ['fl', 'Flashcards']];
const NSTEP = STATUSES.length;
const VERB = { pr: 'Print', rd: 'Read', nt: 'Write notes', rs: 'Research', fl: 'Flashcards' };
const FILES = { progress: 'data/progress.json', library: 'data/library.json' };
const CFG_KEY = 'pa-config-v1';
const CACHE_KEY = 'pa-cache-v1';
const VIEW_KEY = 'pa-view-v1';
const SEEN_KEY = 'pa-seen-v2';
const SEEN_LM_KEY = 'pa-seen-v3';   // the note about the landmark books and classics
const SEEN_SCI_KEY = 'pa-seen-v4';  // the note about mathematics, statistics and econophysics
const SEEN_V5_KEY = 'pa-seen-v5';   // the note about five steps, weekly goals and saving everywhere
const PAGE = 120;
const DEFAULT_GOALS = { pr: 5, rd: 5, nt: 5, rs: 5, fl: 5, ws: 1 };   // papers per week per step; weeks start Monday
const MODES = ['home', 'week', 'next', 'progress', 'cards', 'list'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>');
const localDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localDate(new Date());   // your calendar date, not the UTC one
const parseDay = (s) => new Date(`${s}T12:00:00`);
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return localDate(d); };
const dayLabel = (s, o) => parseDay(s).toLocaleDateString('en-US', o || { month: 'short', day: 'numeric' });
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
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
  meta: { groups: [], areas: [] },       // how areas are grouped and described (from the catalogs)
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
  view: Object.assign({ mode: 'home', path: 'plan', field: null, area: null, topic: null, status: 'any', stars: '0', sort: 'order', pdf: false, book: false, nscope: '' }, store.get(VIEW_KEY) || {}),
  shown: PAGE,
  wk: 0,                                 // the week the planner shows: 0 this week, -1 last week, 1 next week
  study: { scope: 'all', order: null, key: '', i: 0, flip: false },
  editCards: [],                         // flashcards being edited in the paper dialog
  papers: [], rows: [], byId: new Map(), hay: new Map(),
  ready: false, added: 0, ncards: 0,
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
// Shared saving: on the live site (or with ?shared=1 while testing), every visitor saves through the relay.
const SHARED = !!SYNC_URL && (/\.github\.io$/i.test(location.hostname) || /[?&]shared=1\b/.test(location.search));
const hasRepo = () => !!(S.cfg.owner && S.cfg.repo);
const online = () => SHARED || hasRepo();
const canWrite = () => SHARED || (hasRepo() && !!S.cfg.token);

/* ---------- reading and writing the two data files ---------- */
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
const relayUrl = (path) => `${SYNC_URL.replace(/\/+$/, '')}/${path}`;
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
  const r = SHARED
    ? await fetch(`${relayUrl(path)}?t=${Date.now()}`, { cache: 'no-store' })
    : await fetch(`${apiUrl(path)}?ref=${encodeURIComponent(S.cfg.branch || 'main')}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new GhError(r.status, await errText(r));
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function ghPut(path, obj, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(obj, null, 1) + '\n'), branch: S.cfg.branch || 'main' };
  if (sha) body.sha = sha;
  const json = JSON.stringify(body);
  const h = SHARED ? { 'Content-Type': 'application/json' } : { ...headers(), 'Content-Type': 'application/json' };
  // keepalive lets the save finish even if the tab is closing (browsers cap it at 64 KB)
  const r = await fetch(SHARED ? relayUrl(path) : apiUrl(path), { method: 'PUT', headers: h, body: json, keepalive: json.length < 60000 });
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
  const out = Object.assign({}, remote, local, emptyLibrary());   // keep any key a newer version adds
  out.fields = [...new Set([...remote.fields, ...local.fields])];
  out.topics = [...new Set([...remote.topics, ...local.topics])];
  out.areas = [...new Set([...(remote.areas || []), ...(local.areas || [])])];
  out.removed = [...new Set([...remote.removed, ...local.removed])];
  const gone = new Set(out.removed);
  const added = new Map();
  for (const p of [...remote.added, ...local.added]) if (!gone.has(p.id)) added.set(p.id, newer(added.get(p.id), p));
  out.added = [...added.values()];
  for (const id of new Set([...Object.keys(remote.edits), ...Object.keys(local.edits)])) out.edits[id] = newer(remote.edits[id], local.edits[id]);
  const goals = newer(remote.goals, local.goals);
  if (goals) out.goals = goals; else delete out.goals;
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
  if (!online()) {
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
// The second and third catalogs store each topic once and its papers as short rows; unpack them
// into the same shape as catalog.json. A bare id in a topic is an extra listing of an existing paper.
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
  setSync(canWrite() ? 'busy' : 'local', canWrite() ? 'Saving…' : 'Saved in this browser');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1500);
}
function commitMessage() {
  const m = S.messages;
  if (m.length === 1) return m[0];
  if (!m.length) return 'Update archive';
  return `Update archive (${m.length} changes)\n\n${m.slice(0, 40).map((x) => '- ' + x).join('\n')}`;
}
function failReason(e) {
  if (SHARED) return e.status === 422 ? 'the archive refused the change' : e.status >= 500 ? 'the save relay is not working' : 'offline, or the archive could not be reached';
  return e.status === 401 ? 'token rejected' : e.status === 403 || e.status === 404 ? 'token lacks write access to this repo' : 'offline or GitHub unreachable';
}
async function sync() {
  if (!canWrite() || !(S.dirty.progress || S.dirty.library)) return;
  if (syncing) { again = true; return; }
  syncing = true;
  setSync('busy', 'Saving…');
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
    setSync('ok', `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · on every device`);
  } catch (e) {
    saveCache();
    setSync('warn', `Not saved yet (${failReason(e)}). Kept in this browser; it will retry.`);
  } finally {
    syncing = false;
    if (again || S.dirty.progress || S.dirty.library) { again = false; if (S.dirty.progress || S.dirty.library) syncTimer = setTimeout(sync, 8000); }
  }
}
function setSync(kind, text) {
  if ($('saveBanner')) renderBanner();
  $('syncDot').className = 'dot ' + kind;
  $('syncText').textContent = text;
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
  S.tree = null; S.ev = null; S.nx = null;
  S.ncards = 0;
  for (const p of out) if (p.cards) S.ncards += cardsOf(p).length;
}
const prog = (id) => S.progress.p[id] || {};
const stepsDone = (g) => STATUSES.reduce((k, [s]) => k + (g && g[s] ? 1 : 0), 0);
const isDone = (id) => stepsDone(S.progress.p[id]) === NSTEP;
const metaArea = (f, ar) => S.meta.areas.find((a) => a.f === f && a.name === ar);
const cardsOf = (p) => (Array.isArray(p && p.cards) ? p.cards.filter((c) => c && (c.q || c.a)) : []);

// Field -> area -> topic, with counts. Area '' holds topics that sit directly under the field.
// Each node: n papers, s2 must-reads, st started, dn finished, rd read, c[i] papers that reached
// step i, m[i] the same for must-reads, last (latest step date), next (first unfinished must-read).
function fieldTree() {
  if (S.tree) return S.tree;
  const tree = new Map();
  const blank = () => ({ n: 0, s2: 0, st: 0, dn: 0, rd: 0, c: new Array(NSTEP).fill(0), m: new Array(NSTEP).fill(0), last: '', next: null });
  const field = (f) => { if (!tree.has(f)) tree.set(f, Object.assign(blank(), { areas: new Map() })); return tree.get(f); };
  const add = (f, ar, t) => {
    if (!f) return null;
    const F = field(f);
    ar = ar || '';
    if (ar || t) { if (!F.areas.has(ar)) F.areas.set(ar, Object.assign(blank(), { topics: new Map() })); }
    if (!t) return null;
    const A = F.areas.get(ar);
    if (!A.topics.has(t)) A.topics.set(t, blank());
    return [F, A, A.topics.get(t)];
  };
  S.library.fields.forEach((f) => add(f));
  S.meta.areas.forEach((a) => add(a.f, a.name));
  (S.library.areas || []).forEach((x) => { const [f, ar] = x.split('::'); add(f, ar); });
  S.library.topics.forEach((x) => { const parts = x.split('::'); if (parts.length === 3) add(parts[0], parts[1], parts[2]); else add(parts[0], '', parts[1]); });
  for (const r of S.rows) {
    const hit = add(r.f, r.ar, r.tp); if (!hit) continue;
    const [F, A, Tp] = hit;
    const g = S.progress.p[r.p.id], k = stepsDone(g), must = r.p.s === 2;
    let last = '';
    if (k) for (const [s] of STATUSES) if (g[s] && g[s] > last) last = g[s];
    const nodes = r.main || r.p.f !== r.f ? [F, A, Tp] : [A, Tp];   // a paper counts once per field
    for (const X of nodes) {
      X.n++;
      if (must) X.s2++;
      if (k) {
        X.st++;
        if (g.rd) X.rd++;
        if (k === NSTEP) X.dn++;
        STATUSES.forEach(([s], i) => { if (g[s]) { X.c[i]++; if (must) X.m[i]++; } });
        if (last > X.last) X.last = last;
      }
      if (must && k < NSTEP && (!X.next || r.o < X.next.o)) X.next = r;
    }
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
  if (['week', 'next', 'progress', 'cards'].includes(v.mode)) return `#/${v.mode}`;
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
  if (['week', 'next', 'progress', 'cards'].includes(parts[0])) return { mode: parts[0] };
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
  const n = stepsDone(g);
  if (st === 'untouched' && n) return false;
  if (st === 'progress' && (n === 0 || n === NSTEP)) return false;
  if (st === 'complete' && n !== NSTEP) return false;
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
  fl: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="14" height="13" rx="2"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h11A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5H16.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  week: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14.5l2 2 4-4"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/></svg>',
  prog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="14" height="13" rx="2"/><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h11A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5H16.5"/></svg>',
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
// Segmented progress bar: counts[i] = how many papers have reached step i, out of total.
function segHtml(counts, total, cls) {
  const n = total || 1, parts = [];
  for (let i = NSTEP - 1; i >= 0; i--) {
    const v = (counts[i] || 0) - (i + 1 < NSTEP ? counts[i + 1] || 0 : 0);
    if (v > 0) parts.push(`<i style="width:max(3px, ${(100 * v) / n}%);background:var(--${STATUSES[i][0]})"></i>`);
  }
  return `<div class="seg${cls ? ' ' + cls : ''}" role="img" aria-label="${counts[NSTEP - 1] || 0} of ${total} finished">${parts.join('')}</div>`;
}
function stepCounts(rows) {
  const c = new Array(NSTEP).fill(0);
  for (const r of rows) { const g = S.progress.p[r.p.id]; if (g) STATUSES.forEach(([s], i) => { if (g[s]) c[i]++; }); }
  return c;
}
function statline(rows) {
  const c = stepCounts(rows), total = rows.length;
  const stats = STATUSES.map(([s, label], i) => `<span><i class="k" style="background:var(--${s})"></i><b>${fmt(c[i])}</b> ${label.toLowerCase()}</span>`).join('');
  return `${segHtml(c, total)}<div class="statline"><span><b>${fmt(c[NSTEP - 1])}</b> of ${fmt(total)} finished</span>${stats}</div>`;
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
  const nc = cardsOf(p).length;
  const links = `<a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? linkLabel(p.link, p) : 'Search Scholar'} ↗</a>`
    + (p.pdf ? `<a class="plink pdf" href="${esc(p.pdf)}" target="_blank" rel="noopener" title="A free-to-read copy found by OpenAlex: an author’s page, a repository or an open-access journal">Free copy ↗</a>` : '')
    + (p.research ? `<a class="plink res" href="${esc(p.research)}" target="_blank" rel="noopener" title="Your research on this paper">Research ↗</a>` : '')
    + (nc || p.deck ? `<button type="button" class="plink fc" data-cards="1" title="Flashcards for this paper">${nc ? plural(nc, 'card') : 'Deck'}</button>` : '')
    + (p.c ? `<span class="cites" title="Citations counted by OpenAlex">cited ${fmt(p.c)}×</span>` : '');
  const notes = (p.n ? `<div class="pnote" title="${esc(p.n.replace(/\*/g, ''))}">${md(p.n)}</div>` : '')
    + (p.notes ? `<div class="pnote mine" title="${esc(p.notes)}"><b>Your notes:</b> ${esc(p.notes)}</div>` : '');
  return `<article class="paper${isDone(p.id) ? ' done' : ''}" data-id="${esc(p.id)}">
    <div class="pmain"><a class="ptitle" href="${esc(link)}" target="_blank" rel="noopener" title="${p.link ? openWord(p) : 'Search Google Scholar'}">${mark(p.t, opt.words)}</a>
    <div class="pmeta">${meta}</div>${notes}<div class="pmeta">${where}${links}</div></div>
    <div class="btns">${btns}${sumBtn(p)}${learnBtn(p, true)}</div>
    <button type="button" class="more-btn" data-edit="1" aria-label="Details and edit" title="Details and edit">${MORE_ICON}</button></article>`;
}

/* ---------- weeks, goals and the plan ---------- */
const goals = () => Object.assign({}, DEFAULT_GOALS, S.library.goals || {});
const goalTotal = (G) => STATUSES.reduce((t, [s]) => t + (+G[s] || 0), 0);
function weekStart(day) {
  const ws = goals().ws === 0 ? 0 : 1, d = parseDay(day);
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7));
  return localDate(d);
}
function rangeLabel(a, b) {
  const A = parseDay(a), B = parseDay(b);
  const left = dayLabel(a);
  const right = A.getMonth() === B.getMonth() ? String(B.getDate()) : dayLabel(b);
  return `${left} – ${right}${A.getFullYear() !== new Date().getFullYear() ? `, ${A.getFullYear()}` : ''}`;
}
// Every step ever ticked, newest first: { id, s, d }.
function events() {
  if (S.ev) return S.ev;
  const list = [];
  for (const [id, g] of Object.entries(S.progress.p)) for (const [s] of STATUSES) if (g[s]) list.push({ id, s, d: g[s], u: g.u || 0, k: STATUSES.findIndex(([x]) => x === s) });
  list.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.u - a.u || b.k - a.k));
  S.ev = list;
  return list;
}
function countIn(from, to) {
  const c = {};
  STATUSES.forEach(([s]) => { c[s] = 0; });
  for (const e of events()) if (e.d >= from && e.d <= to && S.byId.has(e.id)) c[e.s]++;
  return c;
}
// Papers with some steps done but not all: the most recently touched first, or the earliest started.
function inProgress(oldestFirst) {
  const out = [];
  for (const [id, g] of Object.entries(S.progress.p)) {
    const k = stepsDone(g);
    if (k > 0 && k < NSTEP && S.byId.has(id)) out.push([id, oldestFirst ? g.pr || '' : g.u || 0]);
  }
  out.sort((a, b) => (oldestFirst ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : b[1] - a[1]));
  return out.map((x) => x[0]);
}
const finished = () => Object.keys(S.progress.p).filter((id) => isDone(id) && S.byId.has(id));
// What to do in each of the next few weeks to meet the goals: papers already started come first,
// then the path you follow in Next up. Steps run in order, so a paper printed early in a week can
// be read later that week. This week only plans what is still left after what's done.
function weekPlan(weeks) {
  const G = goals(), ws = weekStart(today());
  const done = countIn(ws, addDays(ws, 6));
  const order = inProgress(true), seen = new Set(order);
  const nx = nextInfo(), want = goalTotal(G) * weeks + 5;
  let fresh = 0;
  for (let k = Math.max(0, nx.i); k < nx.order.length && fresh < want; k++) {
    const id = nx.order[k].id;
    if (!seen.has(id) && stepsDone(prog(id)) === 0) { order.push(id); seen.add(id); fresh++; }
  }
  const nextOf = new Map(order.map((id) => [id, stepState(id).next]));
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const plan = {};
    STATUSES.forEach(([s], i) => {
      plan[s] = [];
      let quota = (+G[s] || 0) - (w === 0 ? done[s] : 0);
      for (const id of order) {
        if (quota <= 0) break;
        if (nextOf.get(id) === i) { plan[s].push(id); nextOf.set(id, i + 1); quota--; }
      }
    });
    out.push(plan);
  }
  return out;
}
function setGoals(next) {
  const G = goals(), clean = {};
  for (const [s] of STATUSES) clean[s] = Math.max(0, Math.min(200, parseInt(next[s], 10) || 0));
  clean.ws = +next.ws === 0 ? 0 : 1;
  if (STATUSES.every(([s]) => clean[s] === G[s]) && clean.ws === G.ws) return;
  S.library.goals = Object.assign(clean, { u: Date.now() });
  changed('library', `Weekly goals: ${STATUSES.map(([s]) => `${clean[s]} ${VERB[s].toLowerCase()}`).join(', ')}`);
}

/* ---------- sidebar and tab bar ---------- */
function renderNav() {
  const tree = fieldTree();
  const searching = !!query();
  const V = S.view;
  const find = fold($('navFind').value.trim());
  const cur = (f, ar, t) => (!searching && V.mode === 'list' && V.field === f && (V.area || null) === (ar || null) && (V.topic || null) === (t || null) ? ' aria-current="true"' : '');
  const data = (f, ar, t) => `data-f="${esc(f || '')}" data-a="${esc(ar || '')}" data-t="${esc(t || '')}"`;
  const count = (c) => `${c.rd ? fmt(c.rd) + '/' : ''}${fmt(c.n)}`;
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
  const nx = nextInfo(), G = goals(), ws = weekStart(today()), wdone = countIn(ws, addDays(ws, 6));
  const wsum = STATUSES.reduce((t, [s]) => t + Math.min(wdone[s], +G[s] || 0), 0);
  const nprog = inProgress().length + finished().length;
  const item = (mode, icon, label, ct, color) => `<button class="nav" style="--c:${color}" data-mode="${mode}"${V.mode === mode && !searching ? ' aria-current="true"' : ''}><span class="ic">${icon}</span><span class="nm">${label}</span><span class="ct">${ct}</span></button>`;
  h += item('home', ICONS.home, 'Overview', '', 'var(--ink)');
  h += item('week', ICONS.week, 'This week', goalTotal(G) ? `${wsum}/${goalTotal(G)}` : '', 'var(--rs)');
  h += item('next', ICONS.next, 'Next up', nx.total ? `${fmt(nx.doneCount)}/${fmt(nx.total)}` : '', 'var(--rd)');
  h += item('progress', ICONS.prog, 'Progress', nprog ? fmt(nprog) : '', 'var(--pr)');
  h += item('cards', ICONS.cards, 'Flashcards', S.ncards ? fmt(S.ncards) : '', 'var(--fl)');
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
function renderTabbar() {
  const m = query() ? '' : S.view.mode;
  $('tabbar').innerHTML = [['home', 'home', 'Overview'], ['week', 'week', 'Week'], ['next', 'next', 'Next up'], ['progress', 'prog', 'Progress'], ['cards', 'cards', 'Cards']]
    .map(([k, ic, l]) => `<button type="button" data-mode="${k}"${m === k ? ' aria-current="page"' : ''}>${ICONS[ic]}<span>${l}</span></button>`).join('');
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
  renderNav(); renderTabbar();
  const q = query(), m = S.view.mode;
  if (q || m === 'list') renderList();
  else if (m === 'home') renderHome();
  else if (m === 'week') renderWeek();
  else if (m === 'next') renderNext();
  else if (m === 'progress') renderProgress();
  else if (m === 'cards') renderCards();
  else renderList();
  renderLists(); renderBanner();
  const names = { home: 'Paper Archive', week: 'This week · Paper Archive', next: 'Next up · Paper Archive', progress: 'Progress · Paper Archive', cards: 'Flashcards · Paper Archive' };
  document.title = q ? `“${q}” · Paper Archive` : m === 'list' ? `${S.view.topic || S.view.area || S.view.field || 'All papers'} · Paper Archive` : names[m] || 'Paper Archive';
  if (refocus) { const el = $('view').querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}
function renderBanner() {
  const pending = (S.dirty.progress || 0) + (S.dirty.library || 0);
  const show = !canWrite();
  $('saveBanner').hidden = !show;
  if (show) $('saveBannerText').textContent = (pending ? `${plural(pending, 'change')} ${pending === 1 ? 'is' : 'are'} saved in this browser only. ` : 'Changes are saved in this browser for now. ')
    + 'Saving for every device switches on once the archive’s save relay is connected.';
}
const setAccent = (c) => document.documentElement.style.setProperty('--fc', c);

// A task: one paper and the step to do on it, with a button when that step is the paper's next one.
function taskRow(id, s, opt = {}) {
  const p = S.byId.get(id); if (!p) return '';
  const i = STATUSES.findIndex(([k]) => k === s);
  const { next } = stepState(id);
  const link = p.link || scholar(p);
  const btn = i < next ? `<span class="tdone">✓ ${STATUSES[i][1]}</span>`
    : i === next ? `<button type="button" class="pill go sm ${s}" data-step="${s}">${ICONS[s]}<span>${STATUSES[i][1]}</span></button>`
      : `<span class="twait">after ${STATUSES[next][1].toLowerCase()}</span>`;
  return `<li class="task" data-id="${esc(id)}"><span class="tstep ${s}" title="${VERB[s]}">${ICONS[s]}</span>
    <div class="tmain"><a class="ttitle" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.t)}</a>
    <small>${esc(shortAuthors(p.a))}${p.y ? ' · ' + esc(p.y) : ''}${p.s ? ` · <span class="s">${'★'.repeat(p.s)}</span>` : ''}${opt.where !== false ? ` · <button type="button" class="where" data-gof="${esc(p.f)}" data-goa="${esc(p.ar || '')}" data-got="${esc(p.tp)}">${esc(p.tp)}</button>` : ''}</small></div>${btn}</li>`;
}
function eventRow(e) {
  const p = S.byId.get(e.id); if (!p) return '';
  return `<li class="ev"><span class="evd">${esc(dayLabel(e.d))}</span><span class="tstep ${e.s} mini" title="${STATUSES[e.k][1]}">${ICONS[e.s]}</span>
    <span class="evt"><b>${esc(p.t)}</b><small>${STATUSES[e.k][1]}${p.research && e.s === 'rs' ? ` · <a href="${esc(p.research)}" target="_blank" rel="noopener">research ↗</a>` : ''}</small></span></li>`;
}
function goalBar(s, d, g) {
  const pct = g ? Math.min(100, (100 * d) / g) : d ? 100 : 0;
  return `<div class="gb ${s}${g && d >= g ? ' met' : ''}"><div class="gbt"><span class="gbl">${ICONS[s]}${VERB[s]}</span><span class="gbn"><b>${d}</b>/${g}</span></div><div class="gbar"><i style="width:${pct}%"></i></div></div>`;
}
function weekPanel() {
  const G = goals(), ws = weekStart(today()), we = addDays(ws, 6), done = countIn(ws, we);
  const total = goalTotal(G), sum = STATUSES.reduce((t, [s]) => t + Math.min(done[s], +G[s] || 0), 0);
  return `<section class="panel weekpanel"><div class="wphead"><div><div class="eyebrow">This week · ${esc(rangeLabel(ws, we))}</div>
    <b class="wpsum">${sum} of ${total} goal steps done</b></div><button type="button" class="pill" data-mode="week">Plan the week →</button></div>
    <div class="goalmini">${STATUSES.map(([s]) => goalBar(s, done[s], +G[s] || 0)).join('')}</div></section>`;
}
function howto() {
  const what = ['Print it', 'Read it, as deeply as it deserves', 'Write notes on it by hand', 'Research it, link the write-up', 'Make flashcards of what matters'];
  return `<ol class="howto compact">${STATUSES.map(([s, label], n) => `<li><span class="st ${s}" aria-pressed="true">${ICONS[s]}</span><span><b>${label}</b> ${what[n]}</span></li>`).join('')}</ol>`;
}

/* ---------- cards: fields, areas, topics ---------- */
function areaCard(f, ar, A) {
  const m = metaArea(f, ar);
  const must = A.s2, base = must ? A.m : A.c, of = must || A.n;
  const nx = A.next ? A.next.p : null;
  const progTxt = A.st
    ? `<b>${fmt(A.st)}</b> started · <b>${fmt(A.dn)}</b> finished${A.last ? ` · last ${esc(dayLabel(A.last))}` : ''}`
    : 'Not started yet';
  return `<button type="button" class="card" style="--c:${areaColor(f, ar)}" data-f="${esc(f)}" data-a="${esc(ar)}" data-t="" aria-label="${esc(ar)}: ${fmt(A.n)} papers in ${A.topics.size} topics">
    <h3>${esc(ar)}</h3>${m && m.blurb ? `<p>${esc(m.blurb)}</p>` : ''}
    <div class="cardstats"><span><b>${fmt(A.n)}</b> papers</span><span><b>${A.topics.size}</b> topics</span>${must ? `<span><b>${fmt(must)}</b> must-reads</span>` : ''}</div>
    <div class="cardprog">${segHtml(base, of, 'thin')}<div class="cardprogtxt">${must ? `Must-reads <b>${fmt(A.m[NSTEP - 1])}/${fmt(must)}</b> done · ` : ''}${progTxt}</div></div>
    ${nx ? `<div class="cardnext"><span>Next must-read</span><b>${esc(nx.t)}</b></div>` : ''}</button>`;
}
function topicCard(f, ar, t, c) {
  const base = c.s2 ? c.m : c.c, of = c.s2 || c.n;
  const sub = c.st ? `${fmt(c.st)} started · ${fmt(c.dn)} finished${c.last ? ` · last ${esc(dayLabel(c.last))}` : ''}` : c.next ? `Start with: ${esc(c.next.p.t)}` : '';
  return `<button type="button" class="tcard" data-f="${esc(f)}" data-a="${esc(ar)}" data-t="${esc(t)}" aria-label="${esc(t)}: ${fmt(c.n)} papers">
    <b>${esc(t)}</b><span class="tn">${fmt(c.n)}${c.s2 ? ` · ${c.s2} ★★` : ''}</span>
    ${segHtml(base, of, 'thin')}${sub ? `<span class="tsub">${sub}</span>` : ''}</button>`;
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
// Progress over the life of the archive: a square for every day (shaded by how many steps were
// ticked), and under it, how many papers had reached each step by the end of each week. It always
// shows at least a year, and grows to the left as the archive gets older.
function progressGraph() {
  const t = today(), evs = events().filter((e) => S.byId.has(e.id));
  const days = new Map(), weekSums = new Map();
  for (const e of evs) {
    days.set(e.d, (days.get(e.d) || 0) + 1);
    const k = weekStart(e.d); weekSums.set(k, (weekSums.get(k) || 0) + 1);
  }
  const firstDay = evs.length ? evs[evs.length - 1].d : t;          // events() is newest first
  const yearAgo = weekStart(addDays(t, -7 * 51));
  const start = firstDay < yearAgo ? weekStart(firstDay) : yearAgo;
  const nweeks = Math.round((parseDay(weekStart(t)) - parseDay(start)) / 6048e5) + 1;
  const maxDay = Math.max(1, ...days.values());
  let cells = '', months = '', lastMonth = -1;
  for (let w = 0; w < nweeks; w++) {
    const wd = addDays(start, 7 * w), m = parseDay(wd).getMonth();
    months += `<span>${m !== lastMonth ? esc(parseDay(wd).toLocaleDateString('en-US', { month: 'short' })) : ''}</span>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const day = addDays(wd, d);
      if (day > t) { cells += '<i class="x"></i>'; continue; }
      const n = days.get(day) || 0;
      cells += `<i data-l="${n ? Math.max(1, Math.ceil((4 * n) / maxDay)) : 0}" title="${esc(dayLabel(day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}: ${n ? plural(n, 'step') : 'nothing'}"></i>`;
    }
  }
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) => (d % 2 === 0 && d < 6 ? parseDay(addDays(start, d)).toLocaleDateString('en-US', { weekday: 'short' }) : ''));
  // How many papers had reached each step by the end of each week.
  const cum = STATUSES.map(([s]) => {
    const dates = evs.filter((e) => e.s === s).map((e) => e.d).sort(), out = [];
    let k = 0;
    for (let w = 0; w < nweeks; w++) {
      const end = addDays(start, 7 * w + 6);
      while (k < dates.length && dates[k] <= end) k++;
      out.push(k);
    }
    return out;
  });
  const top = Math.max(1, ...cum.map((c) => c[nweeks - 1]));
  const pts = (c) => c.map((v, w) => `${(w + 0.5).toFixed(2)},${(97 - (90 * v) / top).toFixed(2)}`).join(' ');
  const svg = `<svg class="cum" viewBox="0 0 ${nweeks} 100" preserveAspectRatio="none" role="img" aria-label="Papers that have reached each step, week by week">
      ${cum.map((c, i) => `<polygon points="0.5,97 ${pts(c)} ${(nweeks - 0.5).toFixed(2)},97" style="fill:var(--${STATUSES[i][0]})"/><polyline points="${pts(c)}" style="stroke:var(--${STATUSES[i][0]})"/>`).join('')}</svg>`;
  let streak = 0;
  for (let d = days.has(t) ? t : addDays(t, -1); days.has(d); d = addDays(d, -1)) streak++;
  const best = Math.max(0, ...weekSums.values());
  const stats = [`<span><b>${fmt(evs.length)}</b> steps</span>`, `<span><b>${fmt(finished().length)}</b> papers finished</span>`, `<span><b>${fmt(days.size)}</b> active days</span>`,
    `<span><b>${fmt(best)}</b> best week</span>`, streak ? `<span><b>${streak}</b>-day streak</span>` : ''].join('');
  return `<section class="panel pgpanel"><div class="pghead"><div><div class="eyebrow">Progress over time</div>
      <b class="pgtitle">${evs.length ? `Since ${esc(dayLabel(firstDay, { month: 'long', day: 'numeric', year: 'numeric' }))}` : 'Every step you tick fills in a square'}</b></div><div class="pgstats">${stats}</div></div>
    <div class="hscroll"><div class="hinner" style="min-width:${32 + nweeks * 12}px">
      <div class="hmonths" aria-hidden="true">${months}</div>
      <div class="hdays" aria-hidden="true">${dayNames.map((n) => `<span>${n}</span>`).join('')}</div>
      <div class="hgrid" role="img" aria-label="Steps ticked each day">${cells}</div>
      <div class="hcum">${svg}</div>
    </div></div>
    <div class="pglegend"><span class="pgsteps">${STATUSES.map(([s, l], i) => `<span><i style="background:var(--${s})"></i>${l} <b>${fmt(cum[i][nweeks - 1])}</b></span>`).join('')}</span>
      <span class="pgheat">Less <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> More</span></div></section>`;
}
const scrollGraphs = () => $('view').querySelectorAll('.hscroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
function newsHtml() {
  const seen = (k) => store.get(k);
  if (!seen(SEEN_V5_KEY)) return `<div class="news"><span><b>New:</b> a fifth step, <b>Flashcards</b>; weekly goals with a <b>This week</b> planner; a <b>Progress</b> page; and ${SHARED ? 'saving that works on every device, no sign-in needed' : 'everything you tick saved in this browser until shared saving is switched on'}.</span><button type="button" class="pill dark" data-seen="1">Got it</button></div>`;
  if (!seen(SEEN_SCI_KEY) && S.sciAdded) return `<div class="news"><span><b>New:</b> Mathematics, Statistics and Econophysics now have their own areas and topics: ${fmt(S.sciAdded)} papers and books, including ${fmt(S.sciLandmarks)} classic books and papers going back centuries. Your ticks are untouched.</span><button type="button" class="pill dark" data-seen="1">Got it</button></div>`;
  return '';
}
function nextCard() {
  const { order, i, total, doneCount } = nextInfo();
  if (i < 0) return '<p class="blurb">Every paper on this path has all five steps ticked.</p>';
  const p = S.byId.get(order[i].id), { next } = stepState(p.id), nk = STATUSES[next];
  return `<div class="cont" data-id="${esc(p.id)}"><h3><a href="${esc(p.link || scholar(p))}" target="_blank" rel="noopener">${esc(p.t)}</a></h3>
    <div class="meta">${esc(shortAuthors(p.a))}${p.y ? ' · ' + esc(p.y) : ''} · paper ${fmt(i + 1)} of ${fmt(total)}, ${fmt(doneCount)} finished</div>
    <div class="row">${nk ? `<button type="button" class="pill go ${nk[0]}" data-step="${nk[0]}">${ICONS[nk[0]]} Mark as ${nk[1].toLowerCase()}</button>` : ''}<button type="button" class="linkbtn" data-mode="next">Open Next up</button></div></div>`;
}
function renderHome() {
  setAccent('#4a47a8');
  const tree = fieldTree(), all = S.rows.filter((r) => r.main);
  let areas = 0, topics = 0;
  for (const F of tree.values()) for (const [ar, A] of F.areas) { if (ar && A.n) areas++; topics += [...A.topics.values()].filter((c) => c.n).length; }
  const c = stepCounts(all);
  let h = `${newsHtml()}<section class="welcome"><div class="eyebrow">A public reading archive</div>
    <h1>${fmt(S.papers.length)} papers across <em>${areas} areas</em> and ${fmt(topics)} topics</h1>
    ${segHtml(c, all.length)}
    <div class="statgrid">${STATUSES.map(([s, label], n) => `<div class="stat"><b>${fmt(c[n])}</b><span><i class="k" style="background:var(--${s})"></i>${label}</span></div>`).join('')}<div class="stat"><b>${fmt(c[NSTEP - 1])}</b><span>Finished, of ${fmt(all.length)}</span></div></div></section>`;
  h += weekPanel();
  h += `<div class="duo"><div class="panel"><div class="eyebrow">Next up</div>${nextCard()}</div>
    <div class="panel"><div class="eyebrow">Five steps per paper, in order</div>${howto()}</div></div>`;
  h += progressGraph();
  const cont = inProgress().slice(0, 6), recent = events().filter((e) => S.byId.has(e.id)).slice(0, 8);
  if (cont.length || recent.length) {
    h += `<div class="duo"><div class="panel"><div class="eyebrow">Continue where you left off</div>${cont.length ? `<ol class="tasks">${cont.map((id) => taskRow(id, STATUSES[stepState(id).next][0])).join('')}</ol>` : '<p class="blurb small">Nothing half-done. Start the next paper from Next up.</p>'}</div>
      <div class="panel"><div class="eyebrow">Recently done</div><ol class="evlist">${recent.map(eventRow).join('')}</ol><button type="button" class="linkbtn" data-mode="progress">See all progress</button></div></div>`;
  }
  for (const f of fieldOrder(tree)) {
    const F = tree.get(f);
    const sub = F.n ? `${fmt(F.n)} papers${F.s2 ? ` · ${fmt(F.s2)} must-reads` : ''}${F.st ? ` · ${fmt(F.st)} started · ${fmt(F.dn)} finished` : ''}` : 'Nothing here yet';
    h += `<section class="sec fieldsec" style="--c:${fieldColor(f)}"><div class="sechead plain"><h2 style="font-size:30px">${esc(f)}</h2><p>${sub}</p><span class="grow"></span><button type="button" class="pill" data-f="${esc(f)}" data-a="" data-t="">${F.n ? 'Browse all' : 'Open'}</button></div></section>`;
    h += F.n ? fieldSections(f) : `<button type="button" class="card empty-card" style="--c:${fieldColor(f)}" data-f="${esc(f)}" data-a="" data-t=""><h3>Start this shelf</h3><p>Add a paper, or paste a list, and it will appear here.</p></button>`;
  }
  $('view').innerHTML = h;
  scrollGraphs();
}

/* ---------- This week: goals, the plan, and what's done ---------- */
function dayStrip(ws, evs) {
  const t = today(), days = [];
  for (let k = 0; k < 7; k++) days.push(addDays(ws, k));
  const per = days.map((d) => { const c = {}; STATUSES.forEach(([s]) => { c[s] = 0; }); for (const e of evs) if (e.d === d) c[e.s]++; return c; });
  const max = Math.max(4, ...per.map((c) => STATUSES.reduce((x, [s]) => x + c[s], 0)));
  return `<div class="days" role="img" aria-label="Steps done each day">${days.map((d, k) => {
    const c = per[k], n = STATUSES.reduce((x, [s]) => x + c[s], 0);
    const bars = STATUSES.map(([s]) => (c[s] ? `<i style="height:${(100 * c[s]) / max}%;background:var(--${s})" title="${c[s]} ${VERB[s].toLowerCase()}"></i>` : '')).join('');
    return `<div class="day${d === t ? ' today' : ''}${d > t ? ' future' : ''}"><div class="dbar">${bars}</div><b>${n || ''}</b><span>${parseDay(d).toLocaleDateString('en-US', { weekday: 'short' })} ${parseDay(d).getDate()}</span></div>`;
  }).join('')}</div>`;
}
function doneByDay(evs) {
  const groups = new Map();
  for (const e of evs) { if (!groups.has(e.d)) groups.set(e.d, []); groups.get(e.d).push(e); }
  return [...groups].map(([d, list]) => `<div class="dayhead">${esc(parseDay(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))}<small>${plural(list.length, 'step')}</small></div>
    <ol class="evlist">${list.map(eventRow).join('')}</ol>`).join('');
}
function goalCard(s, d, g, off) {
  const pct = g ? Math.min(100, (100 * d) / g) : d ? 100 : 0, left = Math.max(0, g - d);
  const note = !g ? 'No goal set' : d >= g ? 'Goal met ✓' : off < 0 ? `${left} short` : `${left} to go`;
  return `<div class="goal ${s}${g && d >= g ? ' met' : ''}"><div class="goaltop"><span class="tstep ${s}">${ICONS[s]}</span><span class="goalname">${VERB[s]}</span></div>
    <div class="goalnum"><b>${d}</b><span>/ ${g}</span></div><div class="gbar"><i style="width:${pct}%"></i></div><small>${note}</small></div>`;
}
function renderWeek() {
  setAccent('#0b8f63');
  const G = goals(), off = S.wk || 0, t = today();
  const ws = addDays(weekStart(t), 7 * off), we = addDays(ws, 6);
  const done = countIn(ws, we);
  const evs = events().filter((e) => e.d >= ws && e.d <= we && S.byId.has(e.id));
  const label = off === 0 ? 'This week' : off === -1 ? 'Last week' : off === 1 ? 'Next week' : off < 0 ? `${-off} weeks ago` : `In ${off} weeks`;
  const total = goalTotal(G), sum = STATUSES.reduce((x, [s]) => x + Math.min(done[s], +G[s] || 0), 0);
  const daysLeft = off === 0 ? Math.round((parseDay(we) - parseDay(t)) / 864e5) + 1 : 0;
  const blurb = off > 0 ? 'What the plan has lined up for this week, if this week’s goals are met.'
    : off === 0 ? `${sum} of ${total} goal steps done, ${plural(daysLeft, 'day')} left. Goals are per week, for each step.`
      : `${sum} of ${total} goal steps were done that week.`;
  let h = `<section class="head weekhead"><div class="crumb">${label}</div>
    <div class="weeknav"><button type="button" class="iconbtn wkbtn" data-wk="-1" aria-label="Previous week">‹</button><h1>${esc(rangeLabel(ws, we))}</h1><button type="button" class="iconbtn wkbtn" data-wk="1" aria-label="Next week">›</button>${off ? '<button type="button" class="pill sm" data-wk="0">Back to this week</button>' : ''}</div>
    <p class="blurb">${blurb}</p></section>
    <div class="goals">${STATUSES.map(([s]) => goalCard(s, done[s], +G[s] || 0, off)).join('')}</div>
    <div class="goaledit"><button type="button" class="linkbtn" data-goals="1">Change weekly goals</button></div>`;
  if (off <= 0) h += dayStrip(ws, evs);
  if (off >= 0 && off <= 3) {
    const plan = weekPlan(off + 1)[off];
    const any = STATUSES.some(([s]) => plan[s].length);
    h += `<h2 class="nexth">${off === 0 ? 'To do this week' : 'Planned'}</h2>`;
    h += any ? `<div class="todo">${STATUSES.filter(([s]) => plan[s].length).map(([s]) => `<section class="todogroup"><h3><span class="tstep ${s}">${ICONS[s]}</span>${VERB[s]}<small>${plan[s].length}${off === 0 ? ' left' : ''}</small></h3><ol class="tasks">${plan[s].map((id) => taskRow(id, s)).join('')}</ol></section>`).join('')}</div>`
      : `<div class="empty"><p>${off === 0 ? 'Every goal for this week is met. Nice work.' : 'Nothing planned. Set some weekly goals.'}</p></div>`;
    h += pathBar('The plan follows');
  } else if (off > 3) {
    h += '<div class="empty"><p>The plan looks three weeks ahead.</p></div>';
  }
  if (off <= 0) h += `<h2 class="nexth">${off === 0 ? 'Done this week' : 'Done that week'}</h2>${evs.length ? doneByDay(evs) : '<div class="empty"><p>Nothing ticked yet.</p></div>'}`;
  $('view').innerHTML = h;
}

/* ---------- Progress: everything done, by week, field and paper ---------- */
function renderProgress() {
  setAccent('#7c4dee');
  const all = S.rows.filter((r) => r.main), c = stepCounts(all), tree = fieldTree(), G = goals();
  const fin = finished(), open = inProgress();
  const ws = weekStart(today()), weeks = [];
  for (let k = 11; k >= 0; k--) { const a = addDays(ws, -7 * k); weeks.push([a, countIn(a, addDays(a, 6))]); }
  const tot = (x) => STATUSES.reduce((t, [s]) => t + x[s], 0);
  const goalSum = goalTotal(G), max = Math.max(goalSum, ...weeks.map(([, x]) => tot(x)), 4);
  const chart = `<div class="wchart" role="img" aria-label="Steps done each week, last 12 weeks">
    ${goalSum ? `<div class="goalline" style="bottom:${(100 * goalSum) / max}%"><span>goal ${goalSum}</span></div>` : ''}
    ${weeks.map(([a, x]) => `<div class="wcol${a === ws ? ' now' : ''}" title="Week of ${esc(dayLabel(a))}: ${tot(x)} steps"><div class="wbar">${STATUSES.map(([s]) => (x[s] ? `<i style="height:${(100 * x[s]) / max}%;background:var(--${s})"></i>` : '')).join('')}</div><b>${tot(x) || ''}</b><span>${esc(dayLabel(a))}</span></div>`).join('')}</div>`;
  const head = (cols) => `<div class="prow phead">${cols.map((x) => `<span>${x}</span>`).join('')}</div>`;
  const stepCells = (X) => STATUSES.map(([s], i) => `<span class="num"><i class="k" style="background:var(--${s})"></i>${fmt(X.c[i])}</span>`).join('');
  const fieldRows = fieldOrder(tree).filter((f) => tree.get(f).n).map((f) => {
    const F = tree.get(f);
    return `<button type="button" class="prow" data-f="${esc(f)}" data-a="" data-t=""><span class="pname"><i class="sw" style="background:${fieldColor(f)}"></i>${esc(f)}</span><span class="num">${fmt(F.n)}</span>${stepCells(F)}<span class="num"><b>${fmt(F.dn)}</b></span></button>`;
  }).join('');
  const areaList = [];
  for (const f of fieldOrder(tree)) for (const [ar, A] of tree.get(f).areas) if (ar && A.st) areaList.push([f, ar, A]);
  areaList.sort((a, b) => (a[2].last < b[2].last ? 1 : a[2].last > b[2].last ? -1 : b[2].st - a[2].st));
  const areaRows = areaList.map(([f, ar, A]) => `<button type="button" class="prow" data-f="${esc(f)}" data-a="${esc(ar)}" data-t=""><span class="pname"><i class="sw" style="background:${areaColor(f, ar)}"></i>${esc(ar)}<small>${esc(f)}${A.last ? ` · last ${esc(dayLabel(A.last))}` : ''}</small></span><span class="num">${fmt(A.n)}</span>${stepCells(A)}<span class="num"><b>${fmt(A.dn)}</b></span></button>`).join('');
  const cols = ['', 'Papers', ...STATUSES.map(([, l]) => l), 'Finished'];
  fin.sort((a, b) => (prog(b).fl || '').localeCompare(prog(a).fl || ''));
  const finRows = fin.slice(0, 200).map((id) => {
    const p = S.byId.get(id), nc = cardsOf(p).length;
    return `<li class="fin" data-id="${esc(id)}"><span class="evd">${esc(dayLabel(prog(id).fl))}</span><span class="evt"><a class="ttitle" href="${esc(p.link || scholar(p))}" target="_blank" rel="noopener">${esc(p.t)}</a><small>${esc(shortAuthors(p.a))}${p.y ? ' · ' + esc(p.y) : ''} · ${esc(p.tp)}</small></span>
      <span class="finlinks">${p.research ? `<a class="plink res" href="${esc(p.research)}" target="_blank" rel="noopener">Research ↗</a>` : ''}${nc || p.deck ? `<button type="button" class="plink fc" data-cards="1">${nc ? plural(nc, 'card') : 'Deck'}</button>` : ''}</span></li>`;
  }).join('');
  $('view').innerHTML = `<section class="head"><div class="crumb">Progress</div><h1>What’s been done</h1>
      <p class="blurb">Every step ticked in this archive, by week, by field and by paper. The archive is public: anyone with the link sees this page.</p>
      ${segHtml(c, all.length)}
      <div class="statgrid">${STATUSES.map(([s, label], n) => `<div class="stat"><b>${fmt(c[n])}</b><span><i class="k" style="background:var(--${s})"></i>${label}</span></div>`).join('')}<div class="stat"><b>${fmt(fin.length)}</b><span>Finished</span></div><div class="stat"><b>${fmt(open.length)}</b><span>In progress</span></div></div></section>
    ${progressGraph()}
    <h2 class="nexth">The last 12 weeks</h2><div class="panel">${chart}<div class="legend chartlegend">${STATUSES.map(([s, l]) => `<span><i style="background:var(--${s})"></i>${l}</span>`).join('')}</div></div>
    <h2 class="nexth">By field</h2><div class="ptable">${head(cols)}${fieldRows}</div>
    ${areaRows ? `<h2 class="nexth">Areas you’ve worked in</h2><div class="ptable">${head(cols)}${areaRows}</div>` : ''}
    <h2 class="nexth">In progress <small>${fmt(open.length)}</small></h2>${open.length ? `<div class="panel"><ol class="tasks">${open.slice(0, 100).map((id) => taskRow(id, STATUSES[stepState(id).next][0])).join('')}</ol></div>` : '<div class="empty"><p>Nothing half-done.</p></div>'}
    <h2 class="nexth">Finished papers <small>${fmt(fin.length)}</small></h2>${fin.length ? `<div class="panel"><ol class="evlist finlist">${finRows}</ol></div>` : '<div class="empty"><p>No paper has all five steps yet. The first one will show up here, with its research and flashcards.</p></div>'}`;
  scrollGraphs();
}

/* ---------- Flashcards: study the cards made for each paper ---------- */
function renderCards() {
  setAccent('#d6336c');
  const decks = S.papers.filter((p) => cardsOf(p).length || p.deck);
  const st = S.study;
  const fields = [...new Set(decks.filter((p) => cardsOf(p).length).map((p) => p.f))].sort();
  if (st.scope !== 'all' && !fields.includes(st.scope)) st.scope = 'all';
  const pool = [];
  for (const p of decks) if (st.scope === 'all' || p.f === st.scope) cardsOf(p).forEach((c, i) => pool.push({ id: p.id, i, c }));
  const key = `${st.scope}|${pool.map((x) => `${x.id}:${x.i}`).join(',')}`;
  if (st.key !== key) { st.key = key; st.order = pool.map((_, k) => k); st.i = 0; st.flip = false; }
  let study;
  if (pool.length) {
    const k = st.order[Math.min(st.i, pool.length - 1)], x = pool[k], p = S.byId.get(x.id);
    study = `<div class="flash${st.flip ? ' flipped' : ''}" data-id="${esc(x.id)}">
        <button type="button" class="flashcard" data-flip="1" aria-label="${st.flip ? 'Show the question' : 'Show the answer'}">
          <span class="fside">${st.flip ? 'Answer' : 'Question'}</span>
          <span class="ftext">${esc(st.flip ? x.c.a || '(no answer written)' : x.c.q || '(no question written)')}</span>
          <span class="fhint">${st.flip ? 'Click or press space for the question' : 'Click or press space for the answer'}</span>
        </button>
        <div class="fmeta">Card ${Math.min(st.i, pool.length - 1) + 1} of ${pool.length} · from <a href="${esc(p.link || scholar(p))}" target="_blank" rel="noopener">${esc(p.t)}</a></div>
        <div class="fbtns"><button type="button" class="pill" data-cprev="1">← Previous</button><button type="button" class="pill primary" data-flip="1">${st.flip ? 'Hide answer' : 'Show answer'}</button><button type="button" class="pill" data-cnext="1">Next →</button><button type="button" class="linkbtn" data-shuffle="1">Shuffle</button></div>
      </div>`;
  } else {
    study = `<div class="empty"><p>No flashcards yet. When a paper reaches step 5, add its cards in Next up, or from any paper’s ⋯ menu.</p></div>`;
  }
  const scope = fields.length > 1 ? `<label class="sortwrap">Study <select id="cScope"><option value="all">every field</option>${fields.map((f) => `<option value="${esc(f)}"${st.scope === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>` : '';
  const deckRows = decks.sort((a, b) => (prog(b.id).fl || '').localeCompare(prog(a.id).fl || '') || a.o - b.o).map((p) => {
    const nc = cardsOf(p).length;
    return `<li class="fin" data-id="${esc(p.id)}"><span class="evd">${nc}</span><span class="evt"><b>${esc(p.t)}</b><small>${esc(shortAuthors(p.a))}${p.y ? ' · ' + esc(p.y) : ''} · ${esc(p.tp)}</small></span>
      <span class="finlinks">${p.deck ? `<a class="plink fc" href="${esc(p.deck)}" target="_blank" rel="noopener">Deck ↗</a>` : ''}<button type="button" class="plink alt" data-cards="1">Edit cards</button></span></li>`;
  }).join('');
  $('view').innerHTML = `<section class="head"><div class="crumb">Flashcards</div><h1>${S.ncards ? `${plural(S.ncards, 'card')} from ${plural(decks.length, 'paper')}` : 'Flashcards'}</h1>
      <p class="blurb">Step 5 for every paper: the question it asks, its key result, its method and one fact worth remembering.</p></section>
    <div class="chips">${scope}</div>${study}
    ${decks.length ? `<h2 class="nexth">Decks by paper</h2><div class="panel"><ol class="evlist finlist">${deckRows}</ol></div>` : ''}`;
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
  nt: 'Write your notes on it: the question, the method, the main finding, why it mattered, and which paper it links to.',
  rs: 'Research it with an AI assistant (the Learn button has a ready-made prompt), push the work to a repo, and paste the link below.',
  fl: 'Make flashcards: the question the paper asks, its key result, its method, and one fact worth remembering. Add them here, or link a deck.',
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
function pathBar(lead) {
  const V = S.view, scopeOn = V.path === 'scope', sc = scopeParts(), tree = fieldTree();
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
  return `<div class="pathbar" role="group" aria-label="Which order to follow">
      <span>${lead || 'Follow'}</span>
      <button type="button" class="chip" data-path="plan" aria-pressed="${V.path === 'plan'}">Market power reading plan · ${S.plan ? S.plan.order.length : 0}</button>
      <button type="button" class="chip" data-path="scope" aria-pressed="${scopeOn}">An area or topic, must-reads first</button>
      <button type="button" class="chip" data-path="year" aria-pressed="${V.path === 'year'}">Everything, oldest first · ${fmt(S.papers.length)}</button>
      ${pickers}
    </div>`;
}
function cardEditor(p) {
  const cards = cardsOf(p);
  return `<div class="fcedit">
      ${cards.length ? `<ol class="cardlist">${cards.map((c, i) => `<li><div><b>${esc(c.q)}</b><span>${esc(c.a)}</span></div><button type="button" class="linkbtn danger" data-delcard="${i}">Remove</button></li>`).join('')}</ol>` : ''}
      <div class="row2"><label class="rsin">Question<textarea id="fcQ" rows="2" placeholder="What does the paper ask?"></textarea></label><label class="rsin">Answer<textarea id="fcA" rows="2"></textarea></label></div>
      <div class="doit-btns"><button type="button" class="pill" data-addcard="1">+ Add card</button><span class="hint">${cards.length ? plural(cards.length, 'card') + ' so far' : 'Add as many as you like.'}</span></div>
      <label class="rsin">Deck link <span class="hint">optional: Anki, Quizlet or any page</span><input id="flDeck" type="url" placeholder="https://…" value="${esc(p.deck || '')}"></label>
    </div>`;
}
function renderNext() {
  const { order, i, total, doneCount } = nextInfo();
  const V = S.view, planOn = V.path === 'plan' && S.plan, scopeOn = V.path === 'scope';
  const sc = scopeParts();
  setAccent(scopeOn && sc.f ? areaColor(sc.f, sc.ar) : '#1f5fd6');
  const pathName = planOn ? 'Reading plan' : scopeOn ? esc(sc.tp || sc.ar || sc.f) : 'Oldest first';
  if (i < 0) {
    $('view').innerHTML = `<section class="head"><div class="crumb">Next up · ${pathName}</div><h1>${total ? 'All done' : 'Nothing on this path'}</h1><p class="blurb">${total ? 'Every paper on this path has all five steps ticked.' : 'Pick another path below.'}</p></section>${pathBar()}`;
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
      <span class="sl"><b>${label}</b><small>${on ? esc(dayLabel(on)) : isNext ? 'Next' : ''}</small></span></li>`;
  }).join('');
  const nk = STATUSES[next];
  const doIt = nk ? `<div class="doit">
      <p>${esc(help[nk[0]])}</p>
      ${nk[0] === 'rs' ? `<label class="rsin">Research link<input id="rsLink" type="url" placeholder="https://github.com/…" value="${esc(p.research || '')}"></label>` : ''}
      ${nk[0] === 'fl' ? cardEditor(p) : ''}
      <div class="doit-btns">
        <button type="button" class="pill go ${nk[0]}" data-step="${nk[0]}">${ICONS[nk[0]]} ${nk[0] === 'fl' ? 'Flashcards done' : `Mark as ${nk[1].toLowerCase()}`}</button>
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
      <div class="seg"><i style="width:${(100 * doneCount) / (total || 1)}%;background:var(--fl)"></i></div>
      <div class="statline"><span>Paper <b>${fmt(i + 1)}</b> of ${fmt(total)}</span><span><b>${fmt(doneCount)}</b> finished</span></div>
    </section>
    ${pathBar()}
    <article class="now" data-id="${esc(p.id)}">
      <div class="now-top"><span class="nowtag">#${i + 1}${depth ? ' · ' + esc(depth.split(' · ')[0]) : ''}${scopeOn || !planOn ? ` · ${esc(p.tp)}` : ''}</span>${p.s ? `<span class="s">${'★'.repeat(p.s)}</span>` : ''}</div>
      <a class="nowtitle" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.t)}</a>
      <div class="nowmeta">${esc(p.a || '')}${p.y ? ' · ' + esc(p.y) : ''}${p.v ? ' · ' + md(p.v) : ''}</div>
      <div class="nowlinks"><a class="plink${p.link ? '' : ' alt'}" href="${esc(link)}" target="_blank" rel="noopener">${p.link ? openWord(p) : 'Search Scholar'} ↗</a>${p.pdf ? `<a class="plink pdf" href="${esc(p.pdf)}" target="_blank" rel="noopener">Free copy ↗</a>` : ''}${p.research ? `<a class="plink res" href="${esc(p.research)}" target="_blank" rel="noopener">Research ↗</a>` : ''}${sumBtn(p)}${learnBtn(p)}</div>
      <ol class="steps">${steps}</ol>
      ${doIt}
      ${phaseEnd && phase ? `<div class="phasetask"><b>End of phase ${cur.ph}.</b> Before moving on: ${esc(phase.task)}</div>` : ''}
    </article>
    ${upcoming ? `<h2 class="nexth">Coming up</h2><ol class="uplist">${upcoming}</ol>` : ''}
    ${recent ? `<h2 class="nexth">Recently finished</h2><ol class="uplist">${recent}</ol>` : ''}`;
}
// Quietly set fields on a paper (the next change saves them): in its edit, or in the added entry.
function setPaperFields(p, fields, message) {
  const lib = S.library, u = Date.now();
  if (p.added) { const a = lib.added.find((x) => x.id === p.id); if (a) Object.assign(a, fields, { u }); }
  else lib.edits[p.id] = Object.assign({}, lib.edits[p.id], fields, { u });
  S.dirty.library++;
  if (message) S.messages.push(message);
}
function setResearch(p, url) { setPaperFields(p, { research: url }, `Research link: ${p.t.slice(0, 80)}`); }

/* ---------- actions ---------- */
// Steps go in order: Printed -> Read -> Notes -> Researched -> Flashcards.
// You can tick only the next step, and undo only the latest one.
function stepState(id) {
  const g = prog(id);
  let next = STATUSES.findIndex(([k]) => !g[k]);
  if (next < 0) next = NSTEP;
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
  if (g[s] && i === NSTEP - 1) toast('Paper finished: all five steps done.');
}
function addCard(p, q, a) {
  if (!q && !a) return false;
  setPaperFields(p, { cards: [...cardsOf(p), { q, a }] }, `Flashcard: ${p.t.slice(0, 80)}`);
  S.dirty.library--;
  changed('library');
  return true;
}
function removeCard(p, i) {
  const cards = cardsOf(p); cards.splice(i, 1);
  setPaperFields(p, { cards }, `Remove flashcard: ${p.t.slice(0, 80)}`);
  S.dirty.library--;
  changed('library');
}

let editing = null, addTab = 'one';
function renderCardEditorDlg() {
  const cards = S.editCards;
  $('pCards').innerHTML = cards.map((c, i) => `<li><div><b>${esc(c.q)}</b><span>${esc(c.a)}</span></div><button type="button" class="linkbtn danger" data-delc="${i}">Remove</button></li>`).join('');
  $('pCardsCount').textContent = cards.length ? plural(cards.length, 'card') : 'none yet';
}
function openPaper(id, focus) {
  editing = id || null;
  const p = id ? S.byId.get(id) : null;
  $('paperDlgTitle').textContent = p ? 'Paper' : 'Add papers';
  $('addTabs').hidden = !!p;
  setTab(p ? 'one' : addTab);
  document.querySelector('[data-pane="edit"]').hidden = !p;
  $('pTitle').value = p ? p.t : ''; $('pAuthors').value = p ? p.a || '' : ''; $('pYear').value = p ? p.y || '' : '';
  $('pVenue').value = p ? (p.v || '').replace(/\*/g, '') : ''; $('pLink').value = p ? p.link || '' : '';
  $('pField').value = p ? p.f : S.view.field || ''; $('pArea').value = p ? p.ar || '' : S.view.area || ''; $('pTopic').value = p ? p.tp : S.view.topic || '';
  $('pSub').value = p ? p.st || '' : ''; $('pResearch').value = p ? p.research || '' : ''; $('pNotes').value = p ? p.notes || '' : '';
  $('pBulk').value = '';
  if (p) {
    const g = prog(p.id);
    $('pSteps').innerHTML = STATUSES.map(([s, l]) => `<span class="tl ${s}${g[s] ? ' on' : ''}"><i>${ICONS[s]}</i><b>${l}</b><small>${g[s] ? esc(dayLabel(g[s], { month: 'short', day: 'numeric', year: 'numeric' })) : 'not yet'}</small></span>`).join('');
    S.editCards = cardsOf(p).map((c) => ({ q: c.q || '', a: c.a || '' }));
    $('pDeck').value = p.deck || ''; $('pQ').value = ''; $('pA').value = '';
    renderCardEditorDlg();
  }
  const also = p ? S.rows.filter((r) => r.p.id === p.id && !r.main).map((r) => `${r.ar} › ${r.tp}`) : [];
  $('pAbout').innerHTML = p ? [p.n ? `<i>${md(p.n)}</i>` : '', also.length ? `Also listed under ${esc(also.join('; '))}.` : '', p.c ? `Cited ${fmt(p.c)} times, as counted by OpenAlex.` : '', p.vf ? 'The bibliography marks this citation as uncertain. Check it before relying on it.' : '', p.link ? '' : 'No link yet. The title opens a Google Scholar search.'].filter(Boolean).join('<br>') : '';
  document.querySelectorAll('#paperDlg details').forEach((d) => { d.open = false; });
  $('pDelete').hidden = !p;
  $('pDelete').textContent = p && p.added ? 'Delete paper' : 'Remove from archive';
  $('paperErr').hidden = true;
  $('paperDlg').showModal();
  renderLists();
  if (p && focus === 'cards') { $('pCardsWrap').scrollIntoView({ block: 'center' }); $('pQ').focus({ preventScroll: true }); }
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
    const pending = { q: $('pQ').value.trim(), a: $('pA').value.trim() };
    if (pending.q || pending.a) S.editCards.push(pending);   // a card typed but not added still counts
    const fields = { t: $('pTitle').value.trim() || p.t, a: $('pAuthors').value.trim(), y: $('pYear').value.trim(), v: $('pVenue').value.trim(), link: cleanUrl($('pLink').value), f, ar, tp, st, research: cleanUrl($('pResearch').value), notes: $('pNotes').value.trim(), u: Date.now() };
    const cards = S.editCards.filter((c) => c.q || c.a), deck = cleanUrl($('pDeck').value);
    if (p.added) {
      const i = lib.added.findIndex((x) => x.id === editing);
      lib.added[i] = Object.assign({}, lib.added[i], fields, { cards, deck });
    } else {
      const base = S.catalog.find((x) => x.id === editing);
      const diff = { u: fields.u };
      for (const k of Object.keys(fields)) {
        if (k === 'u') continue;
        const was = String(base[k] ?? '').replace(k === 'v' ? /\*/g : /$^/, '');
        if ((fields[k] || '') !== was) diff[k] = fields[k];
      }
      if (cards.length) diff.cards = cards;
      if (deck) diff.deck = deck;
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

const GOAL_INPUTS = { pr: 'gPr', rd: 'gRd', nt: 'gNt', rs: 'gRs', fl: 'gFl' };
function openSettings(focus) {
  $('sOwner').value = S.cfg.owner; $('sRepo').value = S.cfg.repo; $('sBranch').value = S.cfg.branch || 'main';
  $('sToken').value = S.cfg.token ? '••••••••' : '';
  $('setMsg').hidden = true;
  const G = goals();
  for (const [s, el] of Object.entries(GOAL_INPUTS)) $(el).value = G[s];
  $('gWs').value = String(G.ws === 0 ? 0 : 1);
  $('setStatus').innerHTML = SHARED
    ? '<b class="okc">Saving is on for everyone.</b> Every tick and edit is saved to the archive within a couple of seconds and shows on every device. Anyone with the link can view and edit.'
    : canWrite() ? `<b class="okc">Saving with your GitHub token on this device.</b> Changes go to ${esc(S.cfg.owner)}/${esc(S.cfg.repo)} and show on every device.`
      : '<b>Changes are saved in this browser for now.</b> Saving for every device switches on once the archive’s save relay is connected (the README explains the one-time setup). Until then, a GitHub token under Advanced saves from this device.';
  $('setDlg').showModal();
  if (focus === 'goals') { $('gPr').focus(); $('gPr').select(); }
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
  const want = { ws: $('gWs').value };
  for (const [s, el] of Object.entries(GOAL_INPUTS)) want[s] = $(el).value;
  setGoals(want);
  const next = readSettings();
  const repoChanged = next.owner !== S.cfg.owner || next.repo !== S.cfg.repo || next.branch !== S.cfg.branch;
  const tokenChanged = next.token !== S.cfg.token;
  if (!repoChanged && !tokenChanged) return;
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
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400); }

let lastPull = 0;
async function refresh(force) {
  if (!force && Date.now() - lastPull < 30000) return;
  if (syncing) return;
  lastPull = Date.now();
  try {
    await pull();
    saveCache(); S.hay.clear(); rebuild(); render();
    if (S.dirty.progress || S.dirty.library) { if (canWrite()) sync(); else setSync('local', 'Saved in this browser'); }
    else setSync(canWrite() ? 'ok' : 'local', SHARED ? 'Up to date · saves for everyone' : canWrite() ? 'Synced with GitHub' : online() ? 'Viewing · changes stay in this browser' : 'Local copy');
  } catch (e) {
    setSync('warn', e.status === 403 ? 'Rate limit hit. Showing the saved copy.' : 'Offline. Showing the saved copy.');
  }
}

/* ---------- events ---------- */
function closeNav() { $('sidebar').classList.remove('open'); $('navToggle').setAttribute('aria-expanded', 'false'); $('scrim').hidden = true; }
const scopeOf = (d) => ({ mode: 'list', field: d.f || null, area: d.a || (d.t ? '' : null), topic: d.t || null });
function refilter() { S.shown = PAGE; saveView(); render(); }
function studyMove(step) {
  const st = S.study, n = (st.order || []).length;
  if (!n) return;
  st.i = (st.i + step + n) % n; st.flip = false; render();
}
function viewClick(e) {
  const el = e.target.closest('button');
  if (!el || !$('view').contains(el)) return;
  const d = el.dataset, row = el.closest('[data-id]');
  if (d.seen) { [SEEN_KEY, SEEN_LM_KEY, SEEN_SCI_KEY, SEEN_V5_KEY].forEach((k) => store.set(k, 1)); render(); return; }
  if (d.mode) return go({ mode: d.mode });
  if (d.wk !== undefined) { S.wk = d.wk === '0' ? 0 : (S.wk || 0) + +d.wk; render(); window.scrollTo({ top: 0 }); return; }
  if (d.goals) return openSettings('goals');
  if (d.more) { S.shown += PAGE; render(); return; }
  if (d.addhere) return openPaper(null);
  if (d.filter) { S.view.status = d.filter; return refilter(); }
  if (d.stars) { S.view.stars = S.view.stars === d.stars ? '0' : d.stars; return refilter(); }
  if (d.pdfchip) { S.view.pdf = !S.view.pdf; return refilter(); }
  if (d.bookchip) { S.view.book = !S.view.book; return refilter(); }
  if (d.flip) { S.study.flip = !S.study.flip; render(); return; }
  if (d.cnext) return studyMove(1);
  if (d.cprev) return studyMove(-1);
  if (d.shuffle) {
    const o = S.study.order || [];
    for (let k = o.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [o[k], o[j]] = [o[j], o[k]]; }
    S.study.i = 0; S.study.flip = false; render(); toast('Shuffled'); return;
  }
  if (d.path) {
    S.view.path = d.path;
    if (d.path === 'scope' && !scopeParts().f) S.view.nscope = defaultScope();
    saveView(); render(); return;
  }
  if (d.gof !== undefined) return go(scopeOf({ f: d.gof, a: d.goa, t: d.got }));
  if (row) {
    const id = row.dataset.id, pp = S.byId.get(id);
    if (d.learn) return openLearn(id);
    if (d.sum) return openSummary(id);
    if (d.st) return toggle(id, d.st);
    if (d.edit) return openPaper(id);
    if (d.cards) return openPaper(id, 'cards');
    if (d.addcard) {
      const q = ($('fcQ') || {}).value || '', a = ($('fcA') || {}).value || '';
      if (!addCard(pp, q.trim(), a.trim())) return toast('Write a question or an answer first.');
      const qq = $('fcQ'); if (qq) qq.focus();
      return toast('Card added');
    }
    if (d.delcard !== undefined) return removeCard(pp, +d.delcard);
    if (d.step) {
      if (d.step === 'rs') {
        const url = cleanUrl(($('rsLink') || {}).value || '');
        if (url && url !== (pp.research || '')) setResearch(pp, url);
      }
      if (d.step === 'fl') {
        const q = (($('fcQ') || {}).value || '').trim(), a = (($('fcA') || {}).value || '').trim();
        const deck = cleanUrl(($('flDeck') || {}).value || '');
        if (q || a) setPaperFields(pp, { cards: [...cardsOf(pp), { q, a }] }, `Flashcard: ${pp.t.slice(0, 80)}`);
        if (deck && deck !== (pp.deck || '')) setPaperFields(S.byId.get(id), { deck }, `Flashcard deck: ${pp.t.slice(0, 80)}`);
      }
      toggle(id, d.step);
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
    if (d.mode) { go({ mode: d.mode }); closeNav(); return; }
    const v = scopeOf(d);
    go(v);
    if (v.topic || !v.field) closeNav();
  });
  $('tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { closeNav(); go({ mode: b.dataset.mode }); } });
  $('navFind').addEventListener('input', renderNav);
  $('view').addEventListener('click', viewClick);
  $('view').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'fSort') { S.view.sort = t.value; refilter(); }
    else if (t.id === 'nxArea') { S.view.nscope = `${t.value}::`; saveView(); render(); }
    else if (t.id === 'nxTopic') { const sc = scopeParts(); S.view.nscope = `${sc.f}::${sc.ar}::${t.value}`; saveView(); render(); }
    else if (t.id === 'cScope') { S.study.scope = t.value; render(); }
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
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || document.querySelector('dialog[open]');
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
      e.preventDefault(); $('search').focus(); $('search').select();
    } else if (e.key === 'Escape' && a === $('search') && $('search').value) {
      $('search').value = ''; $('search').dispatchEvent(new Event('input'));
    } else if (S.view.mode === 'cards' && !query() && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === ' ' || e.key === 'Enter') { if (a && (a.tagName === 'BUTTON' || a.tagName === 'A')) return; e.preventDefault(); S.study.flip = !S.study.flip; render(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); studyMove(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); studyMove(-1); }
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
  $('pAddCard').addEventListener('click', () => {
    const q = $('pQ').value.trim(), a = $('pA').value.trim();
    if (!q && !a) return;
    S.editCards.push({ q, a }); $('pQ').value = ''; $('pA').value = ''; $('pQ').focus();
    renderCardEditorDlg();
  });
  $('pCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delc]'); if (!b) return;
    S.editCards.splice(+b.dataset.delc, 1); renderCardEditorDlg();
  });
  $('paperForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    if (!savePaper()) e.preventDefault();
  });
  $('pDelete').addEventListener('click', deletePaper);
  $('groupForm').addEventListener('submit', (e) => { if (!e.submitter || e.submitter.value !== 'cancel') saveGroup(); });
  $('settingsBtn').addEventListener('click', () => openSettings());
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
  $('saveBannerBtn').addEventListener('click', () => openSettings());
  window.addEventListener('online', () => refresh(true));
  // Pick up what other devices saved, every minute while the page is open.
  setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(false); }, 60000);
}

/* ---------- start ---------- */
const DATA_V = '5';      // bump when data/economics.json is rebuilt, so browsers fetch the new copy
const SCI_V = '2';       // the same for data/sciences.json
async function start() {
  if (!$('view') || !$('navTree') || !$('tabbar')) {
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
  else V.mode = 'home';
  if (!MODES.includes(V.mode)) V.mode = 'home';
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
