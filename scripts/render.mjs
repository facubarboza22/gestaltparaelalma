/**
 * Render a draft's slides (or its Reel) from drafts/<post>/slides.json.
 *
 *   node scripts/render.mjs drafts/2026-10-14-bola-de-nieve
 *   node scripts/render.mjs drafts/*            every draft
 *
 * slides.json: { publishAt, note?, caption, slides: [...] } for a carousel, or
 * { publishAt, note?, caption, reel: { duration, scenes: [...], cover: {...} } }.
 * Optional top-level "theme" (salvia, arcilla, bosque): the week's colour scheme;
 * "textSize": "large" for the short 5-slide carousels.
 * Layouts and the look live in scripts/render/slide.html.
 *
 * Writes NN.jpg (1080×1350) or reel.mp4 + cover.jpg (1080×1920) next to it,
 * made to Instagram's specs (scripts/lib/instagram.mjs): the reel is checked
 * with ffprobe after encoding and the render fails if Instagram would refuse it.
 * caption.txt and post.json are written only the first time: after that they
 * belong to the review page, where Sofía edits them.
 *
 * A reel can carry music: "music": { file, start?, gainDb? }, file relative to
 * the repo (keep tracks in drafts/_assets/music: licensed downloads, not ours
 * to redistribute; only the mixed reel.mp4 gets published).
 *
 * Rosario's portrait for the last slide is drafts/_assets/rosario.jpg (local
 * only); without it the slide goes out without the photo.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { REEL, reelEncodeArgs, reelFileProblems } from './lib/instagram.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = pathToFileURL(join(ROOT, 'scripts', 'render', 'slide.html')).href;
const PORTRAIT = join(ROOT, 'drafts', '_assets', 'rosario.jpg');
const FPS = REEL.fps;

const dirs = process.argv.slice(2).filter((d) => existsSync(join(d, 'slides.json')));
if (!dirs.length) {
  console.error('Usage: node scripts/render.mjs drafts/<post> [more…]   (each folder needs a slides.json)');
  process.exit(2);
}

const browser = await chromium.launch();
try {
  for (const dir of dirs) await renderPost(resolve(dir));
} finally {
  await browser.close();
}

async function renderPost(dir) {
  const spec = JSON.parse(readFileSync(join(dir, 'slides.json'), 'utf8'));
  if (!existsSync(join(dir, 'caption.txt'))) writeFileSync(join(dir, 'caption.txt'), spec.caption.trim() + '\n');
  if (!existsSync(join(dir, 'post.json'))) writeFileSync(join(dir, 'post.json'), JSON.stringify({ publishAt: spec.publishAt, ...(spec.note ? { note: spec.note } : {}) }, null, 2) + '\n');
  for (const f of readdirSync(dir)) if (/^\d{2}\.jpg$|^reel\.mp4$|^cover\.jpg$/.test(f)) rmSync(join(dir, f));

  if (spec.reel) await renderReel(dir, { theme: spec.theme, ...spec.reel });
  else await renderSlides(dir, spec.slides, spec.theme, spec.textSize);
}

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  return page;
}

async function renderSlides(dir, slides, theme, textSize) {
  const page = await newPage(1080, 1350);
  const ctx = { theme, textSize, total: slides.length, portrait: existsSync(PORTRAIT) ? pathToFileURL(PORTRAIT).href : null };
  for (const [i, slide] of slides.entries()) {
    await page.evaluate(([s, c]) => window.paint(s, c), [{ ...slide, n: i + 1 }, ctx]);
    await page.screenshot({ path: join(dir, `${String(i + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.close();
  console.log(`✓ ${dir.replace(ROOT, '')}: ${slides.length} slides`);
}

async function renderReel(dir, reel) {
  const page = await newPage(1080, 1920);
  if (reel.cover) {
    await page.evaluate((s) => window.reel({ theme: s.theme, bg: s.bg, scenes: [{ ...s, from: -10, to: 10, last: true, handAt: -10 }] }), { theme: reel.theme, ...reel.cover });
    await page.evaluate(() => window.seek(5));
    await page.screenshot({ path: join(dir, 'cover.jpg'), type: 'jpeg', quality: 92 });
  }
  await page.evaluate((r) => window.reel(r), reel);

  // Frames go straight into ffmpeg. Without music a silent track is included:
  // some players treat a video without audio as broken.
  const out = join(dir, 'reel.mp4');
  const m = reel.music;
  const audioIn = m
    ? ['-ss', String(m.start ?? 0), '-i', join(ROOT, m.file)]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const fadeOut = (reel.duration - 3).toFixed(2);
  const audioFilter = m ? ['-af', `volume=${m.gainDb ?? 0}dB,afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=3,aresample=48000`] : [];
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...audioIn,
    '-map', '0:v', '-map', '1:a', ...audioFilter, '-t', String(reel.duration),
    // Screenshots are full-range JPEG; phones expect standard-range video.
    '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
    ...reelEncodeArgs(reel.duration), out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))));

  const frames = Math.round(reel.duration * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out], { encoding: 'utf8' }));
  const problems = reelFileProblems(probe);
  if (problems.length) throw new Error(`reel.mp4 no sirve para Instagram: ${problems.join('; ')}`);
  const mb = (Number(probe.format.size) / 1024 / 1024).toFixed(1);
  console.log(`✓ ${dir.replace(ROOT, '')}: reel ${reel.duration}s, ${mb} MB`);
}
