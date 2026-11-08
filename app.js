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
const emptyLibrary = () => ({ v: 1, fields: [], topics: [], added: [], edits: {}, removed: [] });
const emptyProgress = () => ({ v: 1, p: {} });
const S = {
  catalog: [],
  library: emptyLibrary(),
  progress: emptyProgress(),
  sha: { progress: null, library: null },
  dirty: { progress: 0, library: 0 },  // change counters not yet pushed
  messages: [],                         // commit message fragments
  cfg: Object.assign({ owner: '', repo: '', branch: 'main', token: '' }, store.get(CFG_KEY) || {}),
  view: Object.assign({ field: null, topic: null, status: 'any', stars: '0', sort: 'order' }, store.get(VIEW_KEY) || {}),
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
  const r = await fetch(apiUrl(path), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  return `Update ${m.length} papers\n\n${m.slice(0, 40).map((x) => '- ' + x).join('\n')}`;
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
function setSync(text, warn) { const el = $('syncState'); el.textContent = text; el.classList.toggle('warn', !!warn); el.title = text; }

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
function fieldTree() {
  const tree = new Map();
  const add = (f, t) => {
    if (!f) return null;
    if (!tree.has(f)) tree.set(f, new Map());
    if (t && !tree.get(f).has(t)) tree.get(f).set(t, { n: 0, rd: 0 });
    return t ? tree.get(f).get(t) : null;
  };
  S.library.fields.forEach((f) => add(f));
  S.library.topics.forEach((ft) => { const [f, t] = ft.split('::'); add(f, t); });
  for (const p of S.papers) { const c = add(p.f, p.tp); c.n++; if (prog(p.id).rd) c.rd++; }
  return tree;
}

/* ---------- filtering ---------- */
function inScope(p) {
  const q = $('search').value.trim().toLowerCase();
  if (q) {
    const hay = `${p.t} ${p.a} ${p.y} ${p.v} ${p.n} ${p.notes || ''}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  } else {
    if (S.view.field && p.f !== S.view.field) return false;
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
  if ((p.s || 0) < +S.view.stars) return false;
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
function render() { renderNav(); renderMain(); renderLists(); }

function renderNav() {
  const tree = fieldTree();
  const total = S.papers.length, read = S.papers.filter((p) => prog(p.id).rd).length;
  const searching = !!$('search').value.trim();
  const cur = (f, t) => !searching && S.view.field === f && S.view.topic === t ? ' aria-current="true"' : '';
  let h = `<button class="navitem" data-f="" data-t=""${cur(null, null)}><span class="nm">All papers</span><span class="ct">${read}/${total}</span></button>`;
  const fields = [...tree.keys()].sort((a, b) => (a === 'Economics' ? -1 : b === 'Economics' ? 1 : a.localeCompare(b)));
  for (const f of fields) {
    const topics = tree.get(f);
    let n = 0, rd = 0; topics.forEach((c) => { n += c.n; rd += c.rd; });
    h += `<div class="navfield"><button class="navitem" data-f="${esc(f)}" data-t=""${cur(f, null)}><span class="nm">${esc(f)}</span><span class="ct">${rd}/${n}</span></button><div class="navtopics">`;
    for (const t of [...topics.keys()]) {
      const c = topics.get(t);
      h += `<button class="navitem" data-f="${esc(f)}" data-t="${esc(t)}"${cur(f, t)}><span class="nm" title="${esc(t)}">${esc(t)}</span><span class="ct">${c.rd}/${c.n}</span></button>`;
    }
    h += `<button class="navadd" data-newtopic="${esc(f)}">+ New topic</button></div></div>`;
  }
  h += `<div class="navsep"></div><button class="navadd" data-newfield="1">+ New field</button>`;
  $('sidebar').innerHTML = h;
}

function counters(list) {
  return STATUSES.map(([s, label]) => {
    const n = list.filter((p) => prog(p.id)[s]).length;
    return `<div class="counter ${s}"><b>${n.toLocaleString()}</b><span>${label} · ${list.length ? Math.round((100 * n) / list.length) : 0}%</span></div>`;
  }).join('');
}

function paperRow(p, showWhere) {
  const g = prog(p.id);
  const link = p.link || '';
  const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(`${p.t} ${(p.a || '').split(',')[0]}`)}`;
  const title = link
    ? `<a class="ptitle" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.t)}</a>`
    : `<span class="ptitle">${esc(p.t)}</span>`;
  const meta = [p.a, p.y].filter(Boolean).map(esc).join(' · ') + (p.v ? ` · ${md(p.v)}` : '');
  const tags = [];
  if (p.s) tags.push(`<span class="stars" title="${p.s === 2 ? 'Must-read' : 'Influential'}">${'★'.repeat(p.s)}</span>`);
  if (!link) tags.push(`<a href="${scholar}" target="_blank" rel="noopener">Find on Google Scholar</a>`);
  if (p.research) tags.push(`<a href="${esc(p.research)}" target="_blank" rel="noopener">Research</a>`);
  if (p.notes) tags.push(`<span class="tag" title="${esc(p.notes)}">has notes</span>`);
  if (p.vf) tags.push(`<span class="tag" title="The bibliography flags this citation as uncertain">check citation</span>`);
  if (showWhere) tags.push(`<span class="where">${esc(p.f)} › ${esc(p.tp)}</span>`);
  const btns = STATUSES.map(([s, label]) => {
    const on = g[s];
    const d = on ? new Date(on + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: on.slice(0, 4) === today().slice(0, 4) ? undefined : '2-digit' }) : '';
    return `<button type="button" class="st ${s}" data-st="${s}" aria-pressed="${on ? 'true' : 'false'}" title="${on ? `${label} on ${on}. Click to undo.` : `Mark as ${label.toLowerCase()}`}">${label}<small>${d}</small></button>`;
  }).join('');
  return `<article class="paper" data-id="${esc(p.id)}"><div class="pmain">${title}<div class="pmeta">${meta}</div>${p.n ? `<div class="pnote">${md(p.n)}</div>` : ''}${tags.length ? `<div class="ptags">${tags.join('')}</div>` : ''}</div><div class="pbtns">${btns}<button type="button" class="edit" data-edit="1">Edit</button></div></article>`;
}

function renderMain() {
  const searching = $('search').value.trim();
  const scope = S.papers.filter(inScope);
  const list = sorted(scope.filter(passFilters));
  $('scopeTitle').textContent = searching ? `Search: “${searching}”` : S.view.topic || S.view.field || 'All papers';
  $('crumb').textContent = searching ? 'Across every field' : S.view.topic ? S.view.field : S.view.field ? 'Field' : 'Everything in the archive';
  $('counters').innerHTML = counters(scope);
  $('resultCount').textContent = `${list.length.toLocaleString()} of ${scope.length.toLocaleString()} papers`;
  if (!list.length) {
    const empty = !scope.length && S.view.topic && !searching;
    $('list').innerHTML = `<div class="empty">${empty ? `<p>No papers in this topic yet.</p><p><button class="btn primary" type="button" data-addhere="1">Add papers here</button></p>` : '<p>No papers match these filters.</p>'}</div>`;
    $('moreBtn').hidden = true;
    return;
  }
  const page = list.slice(0, S.shown);
  const group = S.view.sort === 'order' && !searching;
  let h = '', lastGroup = null;
  for (const p of page) {
    if (group) {
      const gk = S.view.topic ? p.st || '' : S.view.field ? p.tp : `${p.f} › ${p.tp}`;
      if (gk !== lastGroup) { if (gk) h += `<div class="subhead">${esc(gk)}</div>`; lastGroup = gk; }
    }
    h += paperRow(p, !!searching || (!group && !S.view.topic));
  }
  $('list').innerHTML = h;
  $('moreBtn').hidden = list.length <= S.shown;
  $('moreBtn').textContent = `Show ${Math.min(PAGE, list.length - S.shown)} more (${(list.length - S.shown).toLocaleString()} left)`;
}

function renderLists() {
  const tree = fieldTree();
  const f = $('pField').value || S.view.field;
  $('fieldList').innerHTML = [...tree.keys()].map((x) => `<option value="${esc(x)}">`).join('');
  $('topicList').innerHTML = f && tree.has(f) ? [...tree.get(f).keys()].map((x) => `<option value="${esc(x)}">`).join('') : '';
  const t = $('pTopic').value;
  const subs = new Set(S.papers.filter((p) => p.f === f && p.tp === t && p.st).map((p) => p.st));
  $('subList').innerHTML = [...subs].map((x) => `<option value="${esc(x)}">`).join('');
}

/* ---------- actions ---------- */
function toggle(id, s) {
  const p = S.byId.get(id); if (!p) return;
  const g = Object.assign({}, prog(id));
  const label = STATUSES.find((x) => x[0] === s)[1];
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
  $('pField').value = p ? p.f : S.view.field || ''; $('pTopic').value = p ? p.tp : S.view.topic || '';
  $('pSub').value = p ? p.st || '' : ''; $('pResearch').value = p ? p.research || '' : ''; $('pNotes').value = p ? p.notes || '' : '';
  $('pBulk').value = '';
  $('pDelete').hidden = !p;
  $('pDelete').textContent = p && p.added ? 'Delete' : 'Remove from archive';
  $('paperErr').hidden = true;
  renderLists();
  $('paperDlg').showModal();
}
function setTab(tab) {
  if (!editing) addTab = tab;
  document.querySelectorAll('#addTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelector('[data-pane="one"]').hidden = tab !== 'one';
  document.querySelector('[data-pane="bulk"]').hidden = tab !== 'bulk';
  $('pTitle').required = tab === 'one';
}
const newId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanUrl = (u) => { u = (u || '').trim(); return /^https?:\/\//i.test(u) ? u : u ? 'https://' + u : ''; };

function savePaper() {
  const f = $('pField').value.trim(), tp = $('pTopic').value.trim(), st = $('pSub').value.trim();
  if (!f || !tp) return err('Pick a field and a topic.');
  const lib = S.library;
  if (editing) {
    const p = S.byId.get(editing);
    const fields = { t: $('pTitle').value.trim() || p.t, a: $('pAuthors').value.trim(), y: $('pYear').value.trim(), v: $('pVenue').value.trim(), link: cleanUrl($('pLink').value), f, tp, st, research: cleanUrl($('pResearch').value), notes: $('pNotes').value.trim(), u: Date.now() };
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
  rows.forEach((r, i) => lib.added.push(Object.assign(r, { id: newId() + i, f, tp, st, s: 0, u: now })));
  changed('library', rows.length === 1 ? `Add: ${rows[0].t.slice(0, 80)}` : `Add ${rows.length} papers to ${f} › ${tp}`);
  toast(rows.length === 1 ? 'Paper added' : `${rows.length} papers added`);
  S.view.field = f; S.view.topic = tp; saveView(); render();
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

function openGroup(field) {
  $('groupDlgTitle').textContent = field ? `New topic in ${field}` : 'New field';
  $('gFieldWrap').hidden = !!field;
  $('gField').value = field || ''; $('gTopic').value = '';
  $('gTopic').required = !!field;
  $('gTopicWrap').querySelector('input').placeholder = field ? '' : 'optional first topic';
  renderLists();
  $('groupDlg').showModal();
  (field ? $('gTopic') : $('gField')).focus();
}
function saveGroup() {
  const f = $('gField').value.trim(), t = $('gTopic').value.trim();
  if (!f) return;
  const lib = S.library;
  if (!lib.fields.includes(f)) lib.fields.push(f);
  if (t && !lib.topics.includes(`${f}::${t}`)) lib.topics.push(`${f}::${t}`);
  S.view.field = f; S.view.topic = t || null; saveView();
  changed('library', t ? `New topic: ${f} › ${t}` : `New field: ${f}`);
}

function openSettings() {
  $('sOwner').value = S.cfg.owner; $('sRepo').value = S.cfg.repo; $('sBranch').value = S.cfg.branch || 'main';
  $('sToken').value = S.cfg.token ? '••••••••' : '';
  $('setMsg').hidden = true;
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

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }
function saveView() { store.set(VIEW_KEY, { field: S.view.field, topic: S.view.topic, status: S.view.status, stars: S.view.stars, sort: S.view.sort }); }

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
    if (b.dataset.newfield) return openGroup(null);
    if (b.dataset.newtopic) return openGroup(b.dataset.newtopic);
    $('search').value = '';
    S.view.field = b.dataset.f || null; S.view.topic = b.dataset.t || null; S.shown = PAGE;
    saveView(); render(); window.scrollTo({ top: 0 });
    closeNav();
  });
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.addhere) return openPaper(null);
    const row = b.closest('.paper'); if (!row) return;
    if (b.dataset.st) toggle(row.dataset.id, b.dataset.st);
    else if (b.dataset.edit) openPaper(row.dataset.id);
  });
  let st;
  $('search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { S.shown = PAGE; render(); }, 180); });
  [['fStatus', 'status'], ['fStars', 'stars'], ['fSort', 'sort']].forEach(([id, k]) => {
    $(id).value = S.view[k];
    $(id).addEventListener('change', () => { S.view[k] = $(id).value; S.shown = PAGE; saveView(); renderMain(); });
  });
  $('moreBtn').addEventListener('click', () => { S.shown += PAGE; renderMain(); });
  $('addBtn').addEventListener('click', () => openPaper(null));
  $('addTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('pField').addEventListener('input', renderLists);
  $('pTopic').addEventListener('input', renderLists);
  $('paperForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    if (!savePaper()) e.preventDefault();
  });
  $('pDelete').addEventListener('click', deletePaper);
  $('groupForm').addEventListener('submit', (e) => { if (!e.submitter || e.submitter.value !== 'cancel') saveGroup(); });
  $('settingsBtn').addEventListener('click', openSettings);
  $('setForm').addEventListener('submit', (e) => { if (e.submitter && e.submitter.value === 'save') applySettings(); });
  $('sTest').addEventListener('click', testSettings);
  $('sExport').addEventListener('click', exportBackup);
  $('sForget').addEventListener('click', () => { S.cfg.token = ''; store.set(CFG_KEY, S.cfg); $('sToken').value = ''; toast('Token removed from this device'); refresh(true); });
  $('navToggle').addEventListener('click', () => {
    const open = !$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open', open); $('navToggle').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); });
  window.addEventListener('online', () => refresh(true));
}
function closeNav() { $('sidebar').classList.remove('open'); $('navToggle').setAttribute('aria-expanded', 'false'); }

/* ---------- start ---------- */
async function start() {
  bind();
  loadCache();
  const cat = await fetchStatic('data/catalog.json', { papers: [] }, false);
  S.catalog = cat.papers || [];
  rebuild(); render();
  await refresh(true);
}
start();
})();
