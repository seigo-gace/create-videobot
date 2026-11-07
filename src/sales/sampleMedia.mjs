import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, stat, link, unlink, chmod } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
export const SAMPLE_MAX_SECONDS = 30;

function absolutePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('absolute media path required');
  return resolve(path);
}
async function sourceFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('regular source file required');
}
async function destinationAvailable(path) {
  const parent = await stat(dirname(path));
  if (!parent.isDirectory()) throw new Error('destination directory missing');
  try {
    await lstat(path);
    throw new Error('destination already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Inspect actual file duration. A duration supplied by a Telegram message is not sufficient. */
export async function probeDurationSeconds(filePath, { run = exec, ffprobe = 'ffprobe' } = {}) {
  const file = absolutePath(filePath);
  await sourceFile(file);
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file
  ], { timeout: 30000, maxBuffer: 4096 });
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('invalid video duration');
  return seconds;
}

/**
 * Offline media worker for a user-uploaded sample.
 * Existing <=30s sample is reused; longer video is clipped from the beginning.
 * This never edits the original, never replaces an existing destination, and
 * never sends media to Telegram or publishes a listing.
 */
export async function prepareSampleVideo({ inputPath, outputPath, run = exec, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', limitSeconds = SAMPLE_MAX_SECONDS } = {}) {
  if (!Number.isFinite(limitSeconds) || limitSeconds <= 0 || limitSeconds > SAMPLE_MAX_SECONDS) throw new Error('invalid sample length');
  const input = absolutePath(inputPath);
  const duration = await probeDurationSeconds(input, { run, ffprobe });
  if (duration <= limitSeconds) {
    return { kind: 'original', path: input, durationSeconds: duration };
  }
  const output = absolutePath(outputPath);
  if (input === output || extname(output).toLowerCase() !== '.mp4') throw new Error('distinct .mp4 destination required');
  await destinationAvailable(output);
  const temporary = resolve(dirname(output), '.sample-' + randomUUID() + '.mp4');
  try {
    await run(ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', input, '-t', String(limitSeconds),
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', temporary
    ], { timeout: 180000, maxBuffer: 1024 * 1024 });
    const clippedDuration = await probeDurationSeconds(temporary, { run, ffprobe });
    if (clippedDuration > limitSeconds) throw new Error('generated sample exceeds requested length');
    await chmod(temporary, 0o600);
    // link() fails if a competing writer creates output; rename() could overwrite it.
    await link(temporary, output);
    return { kind: 'clipped', path: output, durationSeconds: clippedDuration, originalDurationSeconds: duration };
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
