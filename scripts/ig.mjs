/**
 * Instagram publisher for @gestaltparaelalma (Instagram API with Instagram
 * Login, graph.instagram.com). Posts come from queue/ (see queue/README.md).
 *
 *   node scripts/ig.mjs whoami              which account the token belongs to (read-only)
 *   node scripts/ig.mjs check               validate every post in queue/ and show its state (no token needed)
 *   node scripts/ig.mjs publish --dry-run   what a run would do right now (read-only)
 *   node scripts/ig.mjs publish             publish the oldest due post (the GitHub Action runs this)
 *   node scripts/ig.mjs refresh             new 60-day token into .env + GitHub (Mac only)
 *
 * The token is IG_ACCESS_TOKEN: from .env on the Mac, from the repo secret in
 * GitHub Actions. Never print it. IG_TOKEN_EXPIRES_AT (a repo variable, and a
 * line in .env) lets a run warn before the token dies.
 *
 * One post per run: the workflow runs every two hours, so a backlog after a
 * missed day goes out spaced, not all at once. Results are written into the
 * post's folder (published.json / error.json) and committed by the workflow.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ATTEMPTS, RAW_BASE, REPO, loadQueue, problems, state } from './lib/queue.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://graph.instagram.com/v25.0';
const WARN_DAYS = 10;

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // No .env in GitHub Actions: the workflow passes the secret as env.
}

function token() {
  const t = process.env.IG_ACCESS_TOKEN;
  if (!t) throw new Error('IG_ACCESS_TOKEN is not set (.env on the Mac, repo secret in GitHub).');
  return t;
}

async function call(path, { method = 'GET', params = {} } = {}) {
  const url = new URL(API + path);
  const init = { method, headers: { Authorization: `Bearer ${token()}` } };
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    throw new Error(`Instagram ${method} ${path}: ${e.message ?? res.status}${e.error_user_msg ? ` (${e.error_user_msg})` : ''}`);
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function waitFinished(id) {
  for (let i = 0; i < 60; i++) {
    const s = await call(`/${id}`, { params: { fields: 'status_code,status' } });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`container ${id}: ${s.status_code} ${s.status ?? ''}`);
    await sleep(3000);
  }
  throw new Error(`container ${id} still processing after 3 minutes`);
}

function tokenWarning(now) {
  const exp = Date.parse(process.env.IG_TOKEN_EXPIRES_AT ?? '');
  if (Number.isNaN(exp)) return process.env.GITHUB_ACTIONS ? 'IG_TOKEN_EXPIRES_AT is not set: add it as a repo variable.' : null;
  const days = Math.floor((exp - now) / 864e5);
  if (days >= WARN_DAYS) return null;
  return `The Instagram token ${days < 0 ? 'EXPIRED' : `expires in ${days} days`} (${day(exp)}). On the Mac run: node scripts/ig.mjs refresh`;
}

async function publishPost(post) {
  const igId = (await call('/me', { params: { fields: 'user_id' } })).user_id;

  // A run that published but died before committing published.json would post
  // the same thing again next run. Look at the account first.
  const recent = await call(`/${igId}/media`, { params: { fields: 'id,caption,permalink,timestamp', limit: '10' } });
  const same = recent.data?.find((m) => (m.caption ?? '').replace(/\r\n/g, '\n').trim() === post.caption);
  if (same) return { mediaId: same.id, permalink: same.permalink, publishedAt: same.timestamp, recovered: true };

  const urls = post.images.map((f) => `${RAW_BASE}/${post.path}/${f}`);
  let creationId;
  if (urls.length === 1) {
    creationId = (await call(`/${igId}/media`, { method: 'POST', params: { image_url: urls[0], caption: post.caption } })).id;
  } else {
    const children = [];
    for (const u of urls) children.push((await call(`/${igId}/media`, { method: 'POST', params: { image_url: u, is_carousel_item: 'true' } })).id);
    for (const c of children) await waitFinished(c);
    creationId = (await call(`/${igId}/media`, { method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption } })).id;
  }
  await waitFinished(creationId);
  const { id } = await call(`/${igId}/media_publish`, { method: 'POST', params: { creation_id: creationId } });
  const { permalink } = await call(`/${id}`, { params: { fields: 'permalink' } }).catch(() => ({}));
  return { mediaId: id, permalink: permalink ?? '', publishedAt: new Date().toISOString() };
}

function recordError(post, message, attempts) {
  writeJson(join(post.dir, 'error.json'), { attempts, error: message, lastTryAt: new Date().toISOString() });
  console.error(`✗ ${post.name}: ${message} (attempt ${attempts}/${MAX_ATTEMPTS})`);
}

async function publish(dryRun) {
  const now = Date.now();
  let exitCode = 0;
  if (existsSync(join(ROOT, 'PAUSED'))) {
    console.log('PAUSED file in the repo: not publishing. Delete it to resume.');
    return 0;
  }

  const due = loadQueue(ROOT).filter((p) => state(p, now) === 'due');
  if (!due.length) console.log('Nothing due.');
  for (const post of due) {
    const bad = problems(post);
    if (bad.length) {
      // Retrying can't fix a broken post: fail it now and move on to the next one.
      if (dryRun) console.log(`would fail ${post.name}: ${bad.join('; ')}`);
      else recordError(post, bad.join('; '), MAX_ATTEMPTS);
      exitCode = 1;
      continue;
    }
    if (dryRun) {
      console.log(`would publish ${post.name} (${post.images.length} image${post.images.length > 1 ? 's' : ''}), due ${post.publishAtRaw}`);
      break;
    }
    try {
      const result = await publishPost(post);
      writeJson(join(post.dir, 'published.json'), result);
      rmSync(join(post.dir, 'error.json'), { force: true });
      console.log(`✓ ${post.name}: ${result.recovered ? 'already on Instagram, recorded' : 'published'} ${result.permalink}`);
    } catch (e) {
      recordError(post, e.message, (post.error?.attempts ?? 0) + 1);
      exitCode = 1;
    }
    break;
  }
  if (due.length > 1) console.log(`${due.length} posts were due: one per run, the rest go out in the next runs.`);

  const warning = tokenWarning(now);
  if (warning) {
    console.error(`! ${warning}`);
    exitCode = 1; // a red run is what makes GitHub send the email
  }
  return exitCode;
}

function check() {
  const now = Date.now();
  const posts = loadQueue(ROOT);
  let bad = 0;
  if (!posts.length) console.log('queue/ is empty.');
  for (const p of posts) {
    const s = state(p, now);
    const list = s === 'published' ? [] : problems(p);
    const extra = s === 'published' ? ` ${p.published.permalink}` : s === 'failed' ? ` ${p.error.error}` : '';
    console.log(`${list.length ? '✗' : '✓'} ${p.name}  ${s}, ${p.publishAtRaw || 'no date'}${extra}`);
    for (const x of list) console.log(`    - ${x}`);
    bad += list.length ? 1 : 0;
  }
  const warning = tokenWarning(now);
  if (warning) console.log(`! ${warning}`);
  return bad ? 1 : 0;
}

async function whoami() {
  const me = await call('/me', { params: { fields: 'user_id,username,account_type,media_count' } });
  const limit = await call(`/${me.user_id}/content_publishing_limit`, { params: { fields: 'quota_usage,config' } });
  const q = limit.data?.[0];
  console.log(`@${me.username} (${me.account_type}), user id ${me.user_id}, ${me.media_count} posts`);
  if (q) console.log(`API posts in the last 24 h: ${q.quota_usage}/${q.config?.quota_total}`);
  const exp = process.env.IG_TOKEN_EXPIRES_AT;
  if (exp) console.log(`Token expires ${day(Date.parse(exp))}`);
  return 0;
}

function gh(args, input) {
  const r = spawnSync('gh', [...args, '--repo', REPO], { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed`);
}

/** A token can be refreshed once it is a day old; each refresh gives 60 more days. */
async function refresh() {
  if (process.env.GITHUB_ACTIONS) throw new Error('refresh runs on the Mac: it rewrites .env');
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token())}`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new Error(`refresh failed: ${body.error?.message ?? res.status}`);
  const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();

  gh(['secret', 'set', 'IG_ACCESS_TOKEN'], body.access_token);
  gh(['variable', 'set', 'IG_TOKEN_EXPIRES_AT', '--body', expiresAt]);
  const envPath = join(ROOT, '.env');
  const keep = readFileSync(envPath, 'utf8').split('\n').filter((l) => l && !/^IG_(ACCESS_TOKEN|TOKEN_EXPIRES_AT)=/.test(l));
  writeFileSync(envPath, [...keep, `IG_ACCESS_TOKEN=${body.access_token}`, `IG_TOKEN_EXPIRES_AT=${expiresAt}`].join('\n') + '\n', { mode: 0o600 });
  console.log(`Token refreshed: valid until ${day(Date.parse(expiresAt))}. Saved in .env and GitHub.`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { whoami, check, refresh, publish: () => publish(rest.includes('--dry-run')) };
if (!commands[cmd]) {
  console.error('Usage: node scripts/ig.mjs whoami | check | publish [--dry-run] | refresh');
  process.exit(2);
}
try {
  process.exitCode = await commands[cmd]();
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
