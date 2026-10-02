/**
 * The post queue: one folder per approved post under queue/ (format in
 * queue/README.md). Pure helpers, no network: the CLI and the tests use them.
 *
 *   approved ──(publishAt passed)──▶ due ──▶ published   (published.json)
 *                                      └──▶ failed       (error.json, after 3 tries)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO = 'facubarboza22/gestaltparaelalma';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
export const MAX_ATTEMPTS = 3;

const FOLDER = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;
// Instagram crops feed images outside 4:5 (portrait) to 1.91:1 (landscape).
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export function loadQueue(root) {
  return readdirSync(join(root, 'queue'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadPost(root, d.name))
    .sort((a, b) => (a.publishAt || 0) - (b.publishAt || 0) || a.name.localeCompare(b.name));
}

export function loadPost(root, name) {
  const dir = join(root, 'queue', name);
  const meta = readJson(join(dir, 'post.json')) ?? {};
  const captionFile = join(dir, 'caption.txt');
  return {
    name,
    dir,
    path: `queue/${name}`,
    approved: meta.approved === true,
    publishAtRaw: meta.publishAt ?? '',
    publishAt: Date.parse(meta.publishAt ?? ''),
    caption: existsSync(captionFile) ? readFileSync(captionFile, 'utf8').replace(/\r\n/g, '\n').trim() : '',
    images: readdirSync(dir).filter((f) => /^\d{2}\.jpg$/.test(f)).sort(),
    published: readJson(join(dir, 'published.json')),
    error: readJson(join(dir, 'error.json')),
  };
}

/** published | failed | due | scheduled */
export function state(post, now) {
  if (post.published) return 'published';
  if ((post.error?.attempts ?? 0) >= MAX_ATTEMPTS) return 'failed';
  if (post.publishAt <= now) return 'due';
  return 'scheduled';
}

/** Width and height from a JPEG's SOF segment, or null if it isn't a JPEG. */
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Long digit runs that aren't a date: the therapist's number must never go public. */
export function looksLikePhone(text) {
  return (text.match(/\+?\d[\d\s.()-]{6,}\d/g) ?? []).some((m) => !/^\d{4}-\d{2}-\d{2}$/.test(m) && m.replace(/\D/g, '').length >= 8);
}

export const hasLink = (text) => /(https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(com|net|org|uy|ar|me|ly|link)\b)/i.test(text);

/** Everything that would make Instagram reject the post, or break the content rules. */
export function problems(post) {
  const out = [];
  if (!FOLDER.test(post.name)) out.push('folder name must look like 2026-10-06-short-title (lowercase, no spaces or accents)');
  if (!post.approved) out.push('post.json needs "approved": true (only posts Sofía approved go in queue/)');
  if (!WITH_ZONE.test(post.publishAtRaw) || Number.isNaN(post.publishAt)) {
    out.push('post.json "publishAt" must be a date with its time zone, e.g. "2026-10-06T10:00:00-03:00"');
  }

  const c = post.caption;
  if (!c) out.push('caption.txt is missing or empty');
  if (c.length > 2200) out.push(`caption is ${c.length} characters (Instagram allows 2200)`);
  if ((c.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) out.push('caption has more than 30 hashtags');
  if ((c.match(/@[\w.]+/g) ?? []).length > 20) out.push('caption has more than 20 @mentions');
  if (hasLink(c)) out.push('caption has a link: the only call to action is a DM');
  if (looksLikePhone(c)) out.push('caption has what looks like a phone number');

  const n = post.images.length;
  if (n === 0) out.push('no images: add 01.jpg (and 02.jpg… for a carousel)');
  if (n > 10) out.push(`${n} images: a carousel allows 10`);
  post.images.forEach((f, i) => {
    if (f !== `${String(i + 1).padStart(2, '0')}.jpg`) out.push(`images must be numbered 01.jpg, 02.jpg… without gaps (found ${f})`);
  });
  const ratios = new Set();
  for (const f of post.images) {
    const size = jpegSize(readFileSync(join(post.dir, f)));
    if (!size) {
      out.push(`${f} is not a JPEG`);
      continue;
    }
    const r = size.width / size.height;
    if (r < MIN_RATIO - 0.01 || r > MAX_RATIO + 0.01) out.push(`${f} is ${size.width}×${size.height}: use 1080×1350 (4:5)`);
    ratios.add(r.toFixed(2));
  }
  if (ratios.size > 1) out.push('carousel images must all have the same proportions');
  return out;
}
