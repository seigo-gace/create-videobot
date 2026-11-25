import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, stat, link, unlink, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { probeDurationSeconds, prepareAutomaticSampleVideo } from './sampleMedia.mjs';

const execute = promisify(execFile);

function outputFile(path, suffix) {
  if (typeof path !== 'string' || !path.startsWith('/') || extname(path).toLowerCase() !== suffix) throw new Error('absolute ' + suffix + ' output path required');
  return resolve(path);
}
async function ensureAbsent(path) {
  if (!(await stat(dirname(path))).isDirectory()) throw new Error('output directory required');
  try {
    await lstat(path);
    throw new Error('output already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
/**
 * Extract one preview image from the main video. No Telegram send or automatic
 * publishing occurs. Output is created only if absent; source is never touched.
 */
export async function extractPreviewThumbnail({ inputPath, outputPath, run = execute, ffprobe = 'ffprobe', ffmpeg = 'ffmpeg', fraction = 0.25 } = {}) {
  const duration = await probeDurationSeconds(inputPath, { run, ffprobe });
  const output = outputFile(outputPath, '.jpg');
  if (resolve(inputPath) === output) throw new Error('thumbnail must differ from source');
  await ensureAbsent(output);
  const temporary = resolve(dirname(output), '.thumb-' + randomUUID() + '.jpg');
  try {
    await run(ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(duration * fraction),
      '-i', inputPath, '-frames:v', '1', '-q:v', '2', '-y', temporary
    ], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const info = await lstat(temporary);
    if (!info.isFile() || info.size === 0) throw new Error('thumbnail not generated');
    await chmod(temporary, 0o600);
    await link(temporary, output);
    return { kind: 'generated', path: output };
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/**
 * For missing assets only, derive a thumbnail and a safe free sample from the
 * sale's main video. Existing manual assets are never overwritten.
 * No short paid video is ever copied in full to a free sample.
 * This is an offline preparation layer. Product preview/rights confirmation,
 * upload and publish are handled by separate bounded components.
 */
export async function prepareMissingPreviewAssets({
  sourcePath, thumbnail = null, sample = null, thumbnailOutputPath, secondThumbnailOutputPath, sampleOutputPath,
  run = execute, ffprobe = 'ffprobe', ffmpeg = 'ffmpeg'
} = {}) {
  if (thumbnail && (!secondThumbnailOutputPath || thumbnail.secondFileId) && sample) return { thumbnail: { kind: 'existing', value: thumbnail }, secondThumbnail: null, sample: { kind: 'existing', value: sample } };
  const seconds = await probeDurationSeconds(sourcePath, { run, ffprobe });
  // A short paid video still receives a *strictly shorter* free sample.
  // Do not expose the entire video as a free preview. Sub-second clips
  // need a source playable for at least a few frames at 30 FPS.
  if(!sample && seconds < 0.3)throw Error('video shorter than playable preview minimum');
  const generatedThumbnails = [];
  try {
    const thumbnailResult = thumbnail
      ? { kind: 'existing', value: thumbnail }
      : await extractPreviewThumbnail({ inputPath: sourcePath, outputPath: thumbnailOutputPath, run, ffprobe, ffmpeg });
    if (!thumbnail) generatedThumbnails.push(thumbnailResult.path);
    const secondThumbnail = secondThumbnailOutputPath && !thumbnail?.secondFileId
      ? await extractPreviewThumbnail({inputPath:sourcePath,outputPath:secondThumbnailOutputPath,run,ffprobe,ffmpeg,fraction:0.75}) : null;
    if(secondThumbnail) generatedThumbnails.push(secondThumbnail.path);
    const sampleResult = sample
      ? { kind: 'existing', value: sample }
      : await prepareAutomaticSampleVideo({inputPath:sourcePath,outputPath:sampleOutputPath,run,ffprobe,ffmpeg});
    if (!sample && sampleResult.kind !== 'clipped') throw new Error('paid main must not be copied fully as free sample');
    return { thumbnail: thumbnailResult, secondThumbnail, sample: sampleResult };
  } catch (error) {
    for (const path of generatedThumbnails) await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
    throw error;
  }
}
