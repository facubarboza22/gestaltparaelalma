// Run: node --test scripts/
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasLink, jpegSize, loadPost, loadQueue, looksLikePhone, problems, state } from './lib/queue.mjs';

/** Smallest buffer jpegSize accepts: SOI, an APP0 segment to skip, then SOF0. */
function fakeJpeg(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0]);
}

function makePost(root, name, { meta = { approved: true, publishAt: '2026-10-06T10:00:00-03:00' }, caption = 'Hola.\n\nEscribime por mensaje directo.', images = { '01.jpg': [1080, 1350] }, extra = {} } = {}) {
  const dir = join(root, 'queue', name);
  mkdirSync(dir, { recursive: true });
  if (meta) writeFileSync(join(dir, 'post.json'), JSON.stringify(meta));
  if (caption !== null) writeFileSync(join(dir, 'caption.txt'), caption);
  for (const [f, [w, h]] of Object.entries(images)) writeFileSync(join(dir, f), fakeJpeg(w, h));
  for (const [f, data] of Object.entries(extra)) writeFileSync(join(dir, f), JSON.stringify(data));
  return loadPost(join(root, 'queue'), name);
}

const tmp = () => mkdtempSync(join(tmpdir(), 'gestalt-queue-'));

test('jpegSize reads width and height, rejects non-JPEGs', () => {
  assert.deepEqual(jpegSize(fakeJpeg(1080, 1350)), { width: 1080, height: 1350 });
  assert.equal(jpegSize(Buffer.from('\x89PNG\r\n')), null);
});

test('phone numbers are caught, dates and short numbers are not', () => {
  assert.ok(looksLikePhone('Llamame al 099 123 456'));
  assert.ok(looksLikePhone('+598 99 123 456'));
  assert.ok(looksLikePhone('11-4567-8901'));
  assert.ok(!looksLikePhone('Nos vemos el 2026-10-06'));
  assert.ok(!looksLikePhone('Hace 25 años que acompaño procesos, 3 de cada 10'));
  assert.ok(!looksLikePhone('Si estás en Uruguay, Línea Vida: 0800 0767 o *0767 (gratis, 24 h).'));
  assert.ok(looksLikePhone('Línea Vida 0800 0767, o a mi número 099 123 456'));
});

test('links are caught', () => {
  assert.ok(hasLink('Reservá en https://example.com'));
  assert.ok(hasLink('wa.me/59899123456'));
  assert.ok(hasLink('Visitá misitio.com.uy'));
  assert.ok(!hasLink('Escribime por mensaje directo. #gestalt @gestaltparaelalma'));
});

test('a well-formed single image and carousel have no problems', () => {
  const root = tmp();
  assert.deepEqual(problems(makePost(root, '2026-10-06-que-es-gestalt')), []);
  assert.deepEqual(problems(makePost(root, '2026-10-07-carrusel', { images: { '01.jpg': [1080, 1350], '02.jpg': [1080, 1350] } })), []);
});

test('broken posts list every problem', () => {
  const root = tmp();
  const post = makePost(root, 'Mi Post', {
    meta: { publishAt: '2026-10-06 10:00' },
    caption: 'Llamame al 099 123 456 o entrá a www.ejemplo.com',
    images: { '01.jpg': [1080, 1080], '03.jpg': [1080, 1350] },
  });
  const p = problems(post).join('\n');
  for (const want of ['nombre de la carpeta', '"approved": true', 'zona horaria', 'link', 'teléfono', 'sin saltos', 'misma proporción']) {
    assert.match(p, new RegExp(want.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')));
  }
  assert.match(problems(makePost(root, '2026-10-08-sin-texto', { caption: null, images: {} })).join('\n'), /falta el texto[\s\S]*no hay imágenes/);
  assert.match(problems(makePost(root, '2026-10-09-apaisada', { images: { '01.jpg': [2000, 1000] } })).join('\n'), /tiene que ser 1080×1350/);
});

test('a draft is not required to be approved yet', () => {
  const root = tmp();
  const post = makePost(root, '2026-10-06-borrador', { meta: { publishAt: '2026-10-06T10:00:00-03:00' } });
  assert.deepEqual(problems(post, { draft: true }), []);
  assert.match(problems(post).join('\n'), /"approved": true/);
});

test('state: scheduled, due, published, failed', () => {
  const root = tmp();
  const at = Date.parse('2026-10-06T10:00:00-03:00');
  const post = makePost(root, '2026-10-06-a');
  assert.equal(state(post, at - 1), 'scheduled');
  assert.equal(state(post, at), 'due');
  assert.equal(state(makePost(root, '2026-10-06-b', { extra: { 'published.json': { mediaId: '1' } } }), at), 'published');
  assert.equal(state(makePost(root, '2026-10-06-c', { extra: { 'error.json': { attempts: 2 } } }), at), 'due');
  assert.equal(state(makePost(root, '2026-10-06-d', { extra: { 'error.json': { attempts: 3 } } }), at), 'failed');
});

test('loadQueue sorts by publish time and ignores loose files', () => {
  const root = tmp();
  makePost(root, '2026-10-08-later', { meta: { approved: true, publishAt: '2026-10-08T10:00:00-03:00' } });
  makePost(root, '2026-10-06-sooner');
  writeFileSync(join(root, 'queue', 'README.md'), '# queue');
  assert.deepEqual(loadQueue(root).map((p) => p.name), ['2026-10-06-sooner', '2026-10-08-later']);
});

test('a reel folder: reel.mp4 (+ cover.jpg), no slides, under 20 MB', () => {
  const root = tmp();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16)]);
  const ok = makePost(root, '2026-10-19-pausa', { images: { 'cover.jpg': [1080, 1920] } });
  writeFileSync(join(ok.dir, 'reel.mp4'), mp4);
  rmSync(join(ok.dir, '01.jpg'), { force: true });
  const reel = loadPost(join(root, 'queue'), '2026-10-19-pausa');
  assert.equal(reel.video, 'reel.mp4');
  assert.equal(reel.cover, 'cover.jpg');
  assert.deepEqual(reel.images, []);
  assert.deepEqual(problems(reel), []);

  const mixed = makePost(root, '2026-10-19-mezcla');
  writeFileSync(join(mixed.dir, 'reel.mp4'), mp4);
  assert.match(problems(loadPost(join(root, 'queue'), '2026-10-19-mezcla')).join(), /solo con reel\.mp4/);

  const fake = makePost(root, '2026-10-19-falso', { images: {} });
  writeFileSync(join(fake.dir, 'reel.mp4'), 'not a video');
  assert.match(problems(loadPost(join(root, 'queue'), '2026-10-19-falso')).join(), /no es un video/);
});
