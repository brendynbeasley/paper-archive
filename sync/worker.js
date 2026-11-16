/* Paper Archive save relay: a Cloudflare Worker.
 *
 * The site is static (GitHub Pages), and writing to the repo needs a GitHub token. Rather than
 * asking for a token on every device, this relay holds one token as a secret and lets the site
 * read and write exactly two files, nothing else:
 *   data/progress.json   the dates of each paper's five steps
 *   data/library.json    papers you add, edits, notes, flashcards, weekly goals
 * Anyone who opens the site can save, from any device, with no sign-in.
 *
 * The site calls it like the GitHub contents API, minus the token:
 *   GET  <relay>/data/progress.json   ->  GitHub's JSON for the file (content in base64, sha)
 *   PUT  <relay>/data/progress.json   <-  { message, content (base64), sha }
 *
 * Setup (once): see "Saving from every device" in the README. In short: create a Worker, paste
 * this file, add a secret named GITHUB_TOKEN (a fine-grained token with Contents: read and write
 * on this repo only), deploy, and put the Worker's URL in SYNC_URL at the top of app.js.
 */
const OWNER = 'brendynbeasley';
const REPO = 'paper-archive';
const BRANCH = 'main';
const FILES = new Set(['data/progress.json', 'data/library.json']);
const ORIGINS = ['https://brendynbeasley.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX_BYTES = 4 * 1024 * 1024;   // largest file the relay will write

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(body, status, cors) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STEPS = new Set(['pr', 'rd', 'nt', 'rs', 'fl']);

// The file must still look like what the site writes, so a stray request cannot replace it with
// something the site cannot read.
export function validFile(path, data) {
  if (!isObj(data)) return false;
  if (path === 'data/progress.json') {
    if (!isObj(data.p)) return false;
    for (const [id, g] of Object.entries(data.p)) {
      if (id.length > 64 || !isObj(g)) return false;
      for (const [k, v] of Object.entries(g)) {
        if (k === 'u') { if (typeof v !== 'number') return false; }
        else if (!STEPS.has(k) || typeof v !== 'string' || !DAY.test(v)) return false;
      }
    }
    return true;
  }
  if (path === 'data/library.json') {
    return isObj(data.edits) && Array.isArray(data.added) && Array.isArray(data.fields)
      && Array.isArray(data.topics) && Array.isArray(data.removed);
  }
  return false;
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/^\/+/, '');
    if (!path) return reply({ ok: true, files: [...FILES] }, 200, cors);
    if (!FILES.has(path)) return reply({ message: 'Not found' }, 404, cors);
    if (!env.GITHUB_TOKEN) return reply({ message: 'The relay has no GITHUB_TOKEN secret yet' }, 500, cors);

    const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
    const gh = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'paper-archive-relay',
    };

    if (req.method === 'GET') {
      const r = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
      return reply(await r.text(), r.status, cors);
    }

    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_BYTES * 1.4) return reply({ message: 'File too large' }, 413, cors);
      let body;
      try { body = JSON.parse(text); } catch { return reply({ message: 'Not JSON' }, 400, cors); }
      if (!isObj(body) || typeof body.content !== 'string') return reply({ message: 'No content' }, 400, cors);
      let data;
      try { data = JSON.parse(decodeBase64Utf8(body.content)); } catch { return reply({ message: 'The file is not JSON' }, 422, cors); }
      if (!validFile(path, data)) return reply({ message: 'The file does not look like an archive file' }, 422, cors);
      const put = {
        message: String(body.message || 'Update archive').slice(0, 4000),
        content: body.content,
        branch: BRANCH,
      };
      if (typeof body.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha)) put.sha = body.sha;
      const r = await fetch(api, { method: 'PUT', headers: { ...gh, 'Content-Type': 'application/json' }, body: JSON.stringify(put) });
      return reply(await r.text(), r.status, cors);
    }

    return reply({ message: 'Method not allowed' }, 405, cors);
  },
};
