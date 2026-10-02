/**
 * Local review page for Sofía: http://localhost:5178 (only this Mac can open it).
 *
 *   node scripts/review.mjs            start and open the browser
 *   node scripts/review.mjs --no-open  start without opening it
 *
 * Or double-click "Revisar posts.command" in the repo folder.
 *
 *   drafts/<post>  ──Aprobar──▶  queue/<post>  (commit + push: the publisher picks it up)
 *        │    ◀──Volver a borradores── (only while not published)
 *        └──Rechazar──▶ drafts/_rechazados/<post> + rechazo.json (never leaves the Mac)
 *
 * Only approved posts are committed: the repo is public. Every action that
 * touches git runs one at a time and pulls first, because the publisher
 * workflow pushes published.json / error.json into queue/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDrafts, loadPost, loadQueue, problems, state } from './lib/queue.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DRAFTS = join(ROOT, 'drafts');
const QUEUE = join(ROOT, 'queue');
const REJECTED = join(DRAFTS, '_rechazados');
const PORT = 5178;
const ORIGIN = `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = new Set([ORIGIN, `http://127.0.0.1:${PORT}`]);
const ZONE = '-03:00'; // Uruguay and Argentina, no daylight saving
const PAGE = join(ROOT, 'scripts', 'review', 'index.html');

class UserError extends Error {}
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

function unpushed() {
  try {
    return Number(git('rev-list', '--count', '@{u}..HEAD'));
  } catch {
    return 0;
  }
}

/** Bring in what the publisher pushed. Nothing has changed yet if this fails. */
function pull() {
  try {
    git('pull', '-q', '--rebase', '--autostash');
  } catch (e) {
    console.error(e.message);
    throw new UserError('No se pudo conectar con GitHub (¿hay internet?). No cambió nada: probá de nuevo en un rato.');
  }
}

function push() {
  try {
    git('push', '-q', 'origin', 'main');
  } catch (e) {
    console.error(e.message);
    throw new UserError('Quedó guardado en esta Mac pero no se pudo subir a GitHub. Tocá "Subir" en un rato.');
  }
}

// One git action at a time: two quick clicks must not interleave pulls and commits.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
};

function folder(base, name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) throw new UserError('Nombre de post inválido.');
  const dir = join(base, name);
  if (!existsSync(dir)) throw new UserError('Ese post ya no está. Recargá la página.');
  return dir;
}

function view(post, now, draft) {
  return {
    name: post.name,
    where: draft ? 'drafts' : 'queue',
    publishAt: post.publishAtRaw,
    caption: post.caption,
    note: post.note,
    images: post.images,
    state: draft ? 'draft' : state(post, now),
    problems: draft ? problems(post, { draft: true }) : state(post, now) === 'published' ? [] : problems(post),
    permalink: post.published?.permalink ?? '',
    publishedAt: post.published?.publishedAt ?? '',
    error: post.error?.error ?? '',
  };
}

function snapshot() {
  const now = Date.now();
  return {
    drafts: loadDrafts(ROOT).map((p) => view(p, now, true)),
    queue: loadQueue(ROOT).map((p) => view(p, now, false)),
    unpushed: unpushed(),
  };
}

/** "2026-10-06T10:00" from the date picker → "2026-10-06T10:00:00-03:00". */
function toPublishAt(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local ?? '')) throw new UserError('Fecha u hora inválida.');
  return `${local}:00${ZONE}`;
}

const actions = {
  /** Caption and date of a draft. Renames the folder when the day changes, so it stays sorted. */
  save({ name, caption, publishAt }) {
    const dir = folder(DRAFTS, name);
    if (typeof caption === 'string') writeFileSync(join(dir, 'caption.txt'), caption.trim() + '\n');
    if (!publishAt) return { name };
    const at = toPublishAt(publishAt);
    writeJson(join(dir, 'post.json'), { ...readJson(join(dir, 'post.json')), publishAt: at });
    const slug = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(name)?.[1] ?? name;
    const renamed = `${at.slice(0, 10)}-${slug}`;
    if (renamed === name) return { name };
    if (existsSync(join(DRAFTS, renamed))) throw new UserError('Ya hay otro borrador con ese día y título.');
    renameSync(dir, join(DRAFTS, renamed));
    return { name: renamed };
  },

  approve: ({ name }) =>
    serial(() => {
      const dir = folder(DRAFTS, name);
      const bad = problems(loadPost(DRAFTS, name), { draft: true });
      if (bad.length) throw new UserError(`Antes de aprobar hay que corregir: ${bad.join('; ')}`);
      pull();
      if (existsSync(join(QUEUE, name))) throw new UserError('Ya hay un post aprobado con ese nombre.');
      const { publishAt } = readJson(join(dir, 'post.json'));
      renameSync(dir, join(QUEUE, name));
      // Only what the publisher needs: internal notes stay on the Mac.
      writeJson(join(QUEUE, name, 'post.json'), { approved: true, publishAt, approvedAt: new Date().toISOString() });
      git('add', '--', `queue/${name}`);
      git('commit', '-q', '-m', `Aprobado: ${name}`, '--', `queue/${name}`);
      push();
      return { name };
    }),

  /** Back to drafts while it hasn't gone out. Its images stay in git history (public). */
  unapprove: ({ name }) =>
    serial(() => {
      pull();
      const dir = folder(QUEUE, name);
      if (existsSync(join(dir, 'published.json'))) throw new UserError('Ese post ya se publicó.');
      if (existsSync(join(DRAFTS, name))) throw new UserError('Ya hay un borrador con ese nombre.');
      mkdirSync(DRAFTS, { recursive: true });
      renameSync(dir, join(DRAFTS, name));
      rmSync(join(DRAFTS, name, 'error.json'), { force: true });
      const { publishAt } = readJson(join(DRAFTS, name, 'post.json'));
      writeJson(join(DRAFTS, name, 'post.json'), { publishAt });
      git('add', '-A', '--', `queue/${name}`);
      git('commit', '-q', '-m', `Vuelve a borradores: ${name}`, '--', `queue/${name}`);
      push();
      return { name };
    }),

  reject({ name, reason }) {
    const dir = folder(DRAFTS, name);
    mkdirSync(REJECTED, { recursive: true });
    let target = join(REJECTED, name);
    if (existsSync(target)) target = `${target}-${Date.now()}`;
    renameSync(dir, target);
    writeJson(join(target, 'rechazo.json'), { reason: String(reason ?? '').trim(), at: new Date().toISOString() });
    return { name };
  },

  push: () =>
    serial(() => {
      pull();
      push();
      return {};
    }),
};

const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(PAGE), TYPES['.html']);
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, snapshot());

    const media = /^\/media\/(drafts|queue)\/([^/]+)\/(\d{2}\.jpg)$/.exec(url.pathname);
    if (req.method === 'GET' && media) {
      const dir = folder(media[1] === 'drafts' ? DRAFTS : QUEUE, decodeURIComponent(media[2]));
      return send(res, 200, readFileSync(join(dir, media[3])), TYPES[extname(media[3])]);
    }

    const action = /^\/api\/(\w+)$/.exec(url.pathname)?.[1];
    if (req.method === 'POST' && actions[action]) {
      // Only this page may change things: blocks other sites posting to localhost.
      if (!ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 403, { error: 'Origen no permitido.' });
      const result = await actions[action](await readBody(req));
      return send(res, 200, { ok: true, ...result });
    }
    send(res, 404, { error: 'No encontrado.' });
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    send(res, e instanceof UserError ? 400 : 500, { error: e.message });
  }
});

const open = () => !process.argv.includes('--no-open') && spawn('open', [ORIGIN], { stdio: 'ignore', detached: true }).unref();

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`La página ya estaba abierta: ${ORIGIN}`);
  open();
});
server.listen(PORT, 'localhost', () => {
  console.log(`Página de revisión: ${ORIGIN}  (cerrá esta ventana para apagarla)`);
  open();
});
