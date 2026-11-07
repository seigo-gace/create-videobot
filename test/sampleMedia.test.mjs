import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SAMPLE_MAX_SECONDS, probeDurationSeconds, prepareSampleVideo } from '../src/sales/sampleMedia.mjs';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'videobot-sample-'));
  try {
    const input = join(dir, 'source.mp4');
    const output = join(dir, 'sample.mp4');
    await writeFile(input, 'original remains unchanged');
    return await fn({ dir, input, output });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function fakeMediaRun({ duration, resultDuration = 30, failFfmpeg = false, calls = [] }) {
  return async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') {
      const path = args.at(-1);
      return { stdout: String(path.includes('.sample-') ? resultDuration : duration) };
    }
    if (command === 'ffmpeg') {
      if (failFfmpeg) throw new Error('simulated transcode failure');
      await writeFile(args.at(-1), 'clipped fixture');
      return { stdout: '' };
    }
    throw new Error('unexpected executor');
  };
}

test('30 seconds or shorter is used unchanged; no ffmpeg and no output', () => fixture(async ({ input, output }) => {
  const calls = [];
  const run = fakeMediaRun({ duration: 30, calls });
  const result = await prepareSampleVideo({ inputPath: input, outputPath: output, run });
  assert.equal(result.kind, 'original');
  assert.equal(result.path, input);
  assert.equal(calls.filter(x => x.command === 'ffmpeg').length, 0);
  assert.equal((await readFile(input, 'utf8')), 'original remains unchanged');
  for (const duration of [0.2, 29.99]) {
    const r = await prepareSampleVideo({ inputPath: input, run: fakeMediaRun({ duration }) });
    assert.equal(r.kind, 'original');
  }
}));

test('more than 30 seconds is cut from beginning into a distinct file', () => fixture(async ({ input, output }) => {
  const calls = [];
  const result = await prepareSampleVideo({ inputPath: input, outputPath: output, run: fakeMediaRun({ duration: 90, calls }) });
  assert.equal(result.kind, 'clipped');
  assert.equal(result.path, output);
  assert.equal(result.originalDurationSeconds, 90);
  assert.equal(result.durationSeconds, SAMPLE_MAX_SECONDS);
  const ffmpeg = calls.find(x => x.command === 'ffmpeg').args;
  assert.deepEqual(ffmpeg.slice(ffmpeg.indexOf('-t'), ffmpeg.indexOf('-t') + 2), ['-t', '30']);
  assert.equal(ffmpeg[ffmpeg.indexOf('-i') + 1], input);
  assert.equal(await readFile(input, 'utf8'), 'original remains unchanged');
  assert.equal(await readFile(output, 'utf8'), 'clipped fixture');
}));

test('no overwriting completed sample; failure does not leave temporary file', () => fixture(async ({ dir, input, output }) => {
  await writeFile(output, 'keep');
  await assert.rejects(prepareSampleVideo({ inputPath: input, outputPath: output, run: fakeMediaRun({ duration: 40 }) }), /destination already exists/);
  assert.equal(await readFile(output, 'utf8'), 'keep');
  await rm(output);
  await assert.rejects(prepareSampleVideo({ inputPath: input, outputPath: output, run: fakeMediaRun({ duration: 60, failFfmpeg: true }) }), /transcode failure/);
  assert.deepEqual((await readdir(dir)).sort(), ['source.mp4']);
}));

test('rejects bad duration, broken files and generated overlength without publishing', () => fixture(async ({ dir, input, output }) => {
  await assert.rejects(probeDurationSeconds(input, { run: async () => ({ stdout: 'NaN' }) }), /invalid video duration/);
  await assert.rejects(prepareSampleVideo({ inputPath: input, outputPath: output, run: fakeMediaRun({ duration: 60, resultDuration: 30.1 }) }), /exceeds requested length/);
  assert.deepEqual((await readdir(dir)).sort(), ['source.mp4']);
  await assert.rejects(prepareSampleVideo({ inputPath: join(dir, 'missing.mp4'), run: fakeMediaRun({ duration: 10 }) }));
}));
