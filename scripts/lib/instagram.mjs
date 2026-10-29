/**
 * What we hand Instagram, in one place. Everything is watched on a phone and
 * published only to Instagram, so files are made to its specs and no bigger:
 *
 * - Reels: 1080×1920 (9:16), H.264 High, yuv420p, 30 fps constant, a keyframe
 *   every 2 s, AAC 128 kbps 48 kHz stereo, moov atom first ("faststart"),
 *   3–90 s (Instagram takes up to 15 min by API, but past 90 s a Reel stops
 *   being recommended to non-followers).
 * - Under 20 MB: the video reaches Instagram through jsDelivr, which serves
 *   GitHub files only up to that size (queue.mjs). We aim at 18 MB.
 * - Carousel slides 1080×1350 (4:5) and covers 1080×1920, JPEG under 8 MB.
 *
 * Instagram re-encodes everything it gets; a clean upload around 3–8 Mbps
 * is all it can use.
 */
export const REEL = { width: 1080, height: 1920, fps: 30, minSeconds: 3, maxSeconds: 90 };
export const AUDIO_KBPS = 128;
export const MAX_VIDEO_KBPS = 8000;
export const TARGET_BYTES = 18 * 1024 * 1024;
export const MAX_REEL_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Video bitrate cap so the whole file lands under TARGET_BYTES (3% kept for the container). */
export function videoKbps(seconds) {
  const budget = Math.floor(((TARGET_BYTES * 8) / 1000 / seconds) * 0.97) - AUDIO_KBPS;
  return Math.min(MAX_VIDEO_KBPS, budget);
}

/** ffmpeg output options for a Reel of this length. */
export function reelEncodeArgs(seconds) {
  const kbps = videoKbps(seconds);
  return [
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-preset', 'slow',
    '-crf', '18', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-r', String(REEL.fps), '-g', String(REEL.fps * 2), '-keyint_min', String(REEL.fps * 2), '-flags', '+cgop',
    '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
  ];
}

/** Problems with a finished reel.mp4, from `ffprobe -print_format json -show_streams -show_format`. */
export function reelFileProblems(probe) {
  const out = [];
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const seconds = Number(probe.format.duration);
  const bytes = Number(probe.format.size);
  if (!v) return ['reel.mp4 no tiene video'];
  if (v.codec_name !== 'h264') out.push(`el video es ${v.codec_name}: tiene que ser H.264`);
  if (v.width !== REEL.width || v.height !== REEL.height) out.push(`el video mide ${v.width}×${v.height}: tiene que ser ${REEL.width}×${REEL.height}`);
  if (v.pix_fmt !== 'yuv420p') out.push(`el video es ${v.pix_fmt}: tiene que ser yuv420p`);
  if (v.r_frame_rate !== `${REEL.fps}/1`) out.push(`el video va a ${v.r_frame_rate} cuadros por segundo: tiene que ser ${REEL.fps}`);
  if (!a) out.push('reel.mp4 no tiene audio');
  else if (a.codec_name !== 'aac' || Number(a.sample_rate) !== 48000) out.push(`el audio es ${a.codec_name} ${a.sample_rate} Hz: tiene que ser AAC 48000 Hz`);
  if (seconds < REEL.minSeconds || seconds > REEL.maxSeconds) out.push(`dura ${seconds.toFixed(1)} s: un reel va de ${REEL.minSeconds} a ${REEL.maxSeconds} s`);
  if (bytes > MAX_REEL_BYTES) out.push(`pesa ${(bytes / 1024 / 1024).toFixed(1)} MB: tiene que pesar menos de 20 MB`);
  return out;
}

/** Top-level MP4 boxes in order: 'ftyp', 'moov', 'mdat'… */
export function mp4Boxes(buf) {
  const out = [];
  let o = 0;
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o);
    out.push(buf.toString('latin1', o + 4, o + 8));
    if (size === 1 && o + 16 <= buf.length) size = Number(buf.readBigUInt64BE(o + 8));
    if (size < 8) break;
    o += size;
  }
  return out;
}
