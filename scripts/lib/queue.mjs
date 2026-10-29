/**
 * The post queue: one folder per approved post under queue/ (format in
 * queue/README.md). Pure helpers, no network: the CLI and the tests use them.
 *
 * A folder holds NN.jpg slides (single image or carousel) or reel.mp4 (+ an
 * optional cover.jpg) for a Reel.
 *
 *   approved ──(publishAt passed)──▶ due ──▶ published   (published.json)
 *                                      └──▶ failed       (error.json, after 3 tries)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MAX_IMAGE_BYTES, MAX_REEL_BYTES, REEL, mp4Boxes } from './instagram.mjs';

export const REPO = 'facubarboza22/gestaltparaelalma';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
/**
 * Videos go through jsDelivr, pinned to a commit: raw.githubusercontent.com
 * serves .mp4 as application/octet-stream, jsDelivr as video/mp4. jsDelivr
 * only serves GitHub files up to 20 MB.
 */
export const cdnBase = (sha) => `https://cdn.jsdelivr.net/gh/${REPO}@${sha}`;
export const MAX_VIDEO_BYTES = MAX_REEL_BYTES;
export const MAX_ATTEMPTS = 3;

const FOLDER = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;
// Instagram crops feed images outside 4:5 (portrait) to 1.91:1 (landscape).
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export const loadQueue = (root) => loadFolders(join(root, 'queue'));

/** Drafts waiting for Sofía (drafts/ is gitignored). Folders starting with _ are archives. */
export const loadDrafts = (root) => loadFolders(join(root, 'drafts'));

function loadFolders(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => loadPost(base, d.name))
    .sort((a, b) => (a.publishAt || 0) - (b.publishAt || 0) || a.name.localeCompare(b.name));
}

/** One post folder; `base` is the queue/ or drafts/ directory that holds it. */
export function loadPost(base, name) {
  const dir = join(base, name);
  const meta = readJson(join(dir, 'post.json')) ?? {};
  const captionFile = join(dir, 'caption.txt');
  return {
    name,
    dir,
    path: `${basename(base)}/${name}`,
    approved: meta.approved === true,
    note: meta.note ?? '',
    publishAtRaw: meta.publishAt ?? '',
    publishAt: Date.parse(meta.publishAt ?? ''),
    caption: existsSync(captionFile) ? readFileSync(captionFile, 'utf8').replace(/\r\n/g, '\n').trim() : '',
    images: readdirSync(dir).filter((f) => /^\d{2}\.jpg$/.test(f)).sort(),
    video: existsSync(join(dir, 'reel.mp4')) ? 'reel.mp4' : null,
    cover: existsSync(join(dir, 'cover.jpg')) ? 'cover.jpg' : null,
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

/**
 * Public crisis lines that may appear in a caption (verified on gub.uy,
 * 2026-10-01). Add a line here only after checking it on an official source.
 */
export const CRISIS_LINES = ['0800 0767', '*0767', '0800 1920', '911'];

/** Long digit runs that aren't a date: the therapist's number must never go public. */
export function looksLikePhone(text) {
  const rest = CRISIS_LINES.reduce((t, line) => t.split(line).join(' '), text);
  return (rest.match(/\+?\d[\d\s.()-]{6,}\d/g) ?? []).some((m) => !/^\d{4}-\d{2}-\d{2}$/.test(m) && m.replace(/\D/g, '').length >= 8);
}

export const hasLink = (text) => /(https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(com|net|org|uy|ar|me|ly|link)\b)/i.test(text);

/**
 * Everything that would make Instagram reject the post, or break the content
 * rules. A draft isn't approved yet by definition, so that check is skipped.
 */
export function problems(post, { draft = false } = {}) {
  const out = [];
  if (!FOLDER.test(post.name)) out.push('el nombre de la carpeta tiene que ser como 2026-10-06-titulo-corto (minúsculas, sin espacios ni tildes)');
  if (!draft && !post.approved) out.push('post.json necesita "approved": true (en queue/ solo van posts aprobados por Sofía)');
  if (!WITH_ZONE.test(post.publishAtRaw) || Number.isNaN(post.publishAt)) {
    out.push('falta la fecha y hora de publicación, con zona horaria (ej. "2026-10-06T10:00:00-03:00")');
  }

  const c = post.caption;
  if (!c) out.push('falta el texto (caption.txt)');
  if (c.length > 2200) out.push(`el texto tiene ${c.length} caracteres (Instagram permite 2200)`);
  if ((c.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) out.push('el texto tiene más de 30 hashtags');
  if ((c.match(/@[\w.]+/g) ?? []).length > 20) out.push('el texto tiene más de 20 @menciones');
  if (hasLink(c)) out.push('el texto tiene un link: la única invitación es a escribir por mensaje directo');
  if (looksLikePhone(c)) out.push('el texto tiene algo que parece un número de teléfono');

  if (post.video) return [...out, ...reelProblems(post)];

  const n = post.images.length;
  if (n === 0) out.push('no hay imágenes: falta 01.jpg (y 02.jpg… para un carrusel), o reel.mp4 para un reel');
  if (n > 10) out.push(`hay ${n} imágenes: un carrusel admite hasta 10`);
  post.images.forEach((f, i) => {
    if (f !== `${String(i + 1).padStart(2, '0')}.jpg`) out.push(`las imágenes van numeradas 01.jpg, 02.jpg… sin saltos (encontré ${f})`);
  });
  const ratios = new Set();
  for (const f of post.images) {
    if (statSync(join(post.dir, f)).size > MAX_IMAGE_BYTES) out.push(`${f} pesa más de 8 MB`);
    const size = jpegSize(readFileSync(join(post.dir, f)));
    if (!size) {
      out.push(`${f} no es un JPEG`);
      continue;
    }
    const r = size.width / size.height;
    if (r < MIN_RATIO - 0.01 || r > MAX_RATIO + 0.01) out.push(`${f} mide ${size.width}×${size.height}: tiene que ser 1080×1350 (4:5)`);
    ratios.add(r.toFixed(2));
  }
  if (ratios.size > 1) out.push('todas las imágenes del carrusel tienen que tener la misma proporción');
  return out;
}

function reelProblems(post) {
  const out = [];
  if (post.images.length) out.push('un reel va solo con reel.mp4 (y cover.jpg): sacá las imágenes 01.jpg…');
  const file = join(post.dir, post.video);
  const boxes = mp4Boxes(readFileSync(file));
  if (boxes[0] !== 'ftyp') out.push('reel.mp4 no es un video MP4');
  // Instagram reads the index (moov) before the frames (mdat): ffmpeg -movflags +faststart.
  else if (!boxes.includes('moov') || (boxes.includes('mdat') && boxes.indexOf('moov') > boxes.indexOf('mdat'))) out.push('reel.mp4 no está preparado para streaming: el índice (moov) tiene que ir antes que el video (render con -movflags +faststart)');
  const mb = statSync(file).size / 1024 / 1024;
  if (mb > MAX_VIDEO_BYTES / 1024 / 1024) out.push(`reel.mp4 pesa ${mb.toFixed(1)} MB: tiene que pesar menos de 20 MB`);
  if (post.cover) {
    const size = jpegSize(readFileSync(join(post.dir, post.cover)));
    if (!size) out.push('cover.jpg no es un JPEG');
    else if (size.width !== REEL.width || size.height !== REEL.height) out.push(`cover.jpg mide ${size.width}×${size.height}: tiene que ser ${REEL.width}×${REEL.height}`);
    if (statSync(join(post.dir, post.cover)).size > MAX_IMAGE_BYTES) out.push('cover.jpg pesa más de 8 MB');
  }
  return out;
}
