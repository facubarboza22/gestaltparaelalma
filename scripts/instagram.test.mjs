import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIO_KBPS, MAX_VIDEO_KBPS, TARGET_BYTES, mp4Boxes, reelEncodeArgs, reelFileProblems, videoKbps } from './lib/instagram.mjs';

test('the video bitrate keeps any reel under the target size', () => {
  for (const s of [10, 30, 47.5, 60, 90]) {
    const bytes = ((videoKbps(s) + AUDIO_KBPS) * 1000 * s) / 8;
    assert.ok(bytes <= TARGET_BYTES, `${s} s → ${bytes} bytes`);
  }
  assert.equal(videoKbps(5), MAX_VIDEO_KBPS);
  const args = reelEncodeArgs(47.5);
  assert.equal(args[args.indexOf('-maxrate') + 1], `${videoKbps(47.5)}k`);
  assert.ok(args.includes('+faststart'));
});

test('ffprobe output: what Instagram would refuse', () => {
  const probe = (v = {}, a = {}, f = {}) => ({
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1', ...v }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', ...a }],
    format: { duration: '47.5', size: String(15 * 1024 * 1024), ...f },
  });
  assert.deepEqual(reelFileProblems(probe()), []);
  assert.match(reelFileProblems(probe({ width: 1920, height: 1080 })).join(), /1920×1080/);
  assert.match(reelFileProblems(probe({}, {}, { size: String(31 * 1024 * 1024) })).join(), /31\.0 MB/);
  assert.match(reelFileProblems(probe({}, {}, { duration: '95' })).join(), /dura 95/);
  assert.match(reelFileProblems(probe({ r_frame_rate: '60/1' })).join(), /60\/1/);
});

test('mp4 top-level boxes in order', () => {
  const box = (t, n = 8) => Buffer.concat([Buffer.from([0, 0, 0, 8 + n]), Buffer.from(t), Buffer.alloc(n)]);
  assert.deepEqual(mp4Boxes(Buffer.concat([box('ftyp'), box('moov', 20), box('mdat', 3)])), ['ftyp', 'moov', 'mdat']);
});
