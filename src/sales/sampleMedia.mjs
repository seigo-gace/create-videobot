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
      // 30s at this bounded video bitrate stays comfortably below the
      // existing 20 MB Telegram upload limit for generated media.
      '-maxrate', '2500k', '-bufsize', '5000k',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-y', temporary
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

/** Automatic preview only: four non-overlapping excerpts, never the whole paid source.
 * Keep the existing creator-supplied sample trimming contract independent.
 */
export const AUTO_SAMPLE_MAX_SECONDS = 60;
export function planAutomaticSample(duration) {
  if (!Number.isFinite(duration) || duration < 0.3) throw new Error('video shorter than playable preview minimum');
  const length = duration > 60 ? 15 : duration / 12;
  // Each excerpt is contained inside its own quarter of the source, so a
  // short source cannot cause overlap or expose the entire paid video.
  return [0,1,2,3].map(i => ({
    start: i * duration / 4 + (duration / 4 - length) / 2,
    length
  }));
}
export async function prepareAutomaticSampleVideo({inputPath,outputPath,run=exec,ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
  const input=absolutePath(inputPath), output=absolutePath(outputPath);
  if(input===output||extname(output).toLowerCase()!=='.mp4')throw new Error('distinct .mp4 destination required');
  await destinationAvailable(output);
  const duration=await probeDurationSeconds(input,{run,ffprobe});
  const clips=planAutomaticSample(duration);
  const total=clips.reduce((n,c)=>n+c.length,0);
  const {stdout:audio}=await run(ffprobe,[
    '-v','error','-select_streams','a:0','-show_entries','stream=index',
    '-of','csv=p=0',input
  ],{timeout:30000,maxBuffer:4096});
  const hasAudio=/^\d+\s*$/.test(String(audio).trim());
  const temporary=resolve(dirname(output),'.montage-'+randomUUID()+'.mp4');
  const sources=clips.flatMap(c=>['-ss',String(c.start),'-t',String(c.length),'-i',input]);
  const filters=clips.flatMap((c,i)=>[
    '['+i+':v:0]fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,setpts=PTS-STARTPTS[v'+i+']',
    ...(hasAudio?['['+i+':a:0]aresample=48000,apad,atrim=duration='+c.length+',asetpts=PTS-STARTPTS[a'+i+']']:[])
  ]);
  filters.push(clips.map((_,i)=>'[v'+i+']'+(hasAudio?'[a'+i+']':'')).join('')+
    'concat=n=4:v=1:a='+(hasAudio?'1':'0')+'[v]'+(hasAudio?'[a]':''));
  try {
    await run(ffmpeg,[
      '-nostdin','-hide_banner','-loglevel','error','-filter_complex_threads','1',...sources,
      '-filter_complex',filters.join(';'),'-map','[v]',...(hasAudio?['-map','[a]']:[]),
      '-t',String(total),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',
      '-b:v','1800k','-maxrate','2000k','-bufsize','4000k',
      ...(hasAudio?['-c:a','aac','-b:a','96k']:[]),'-movflags','+faststart','-y',temporary
    ],{timeout:240000,maxBuffer:1024*1024});
    const actual=await probeDurationSeconds(temporary,{run,ffprobe});
    if(actual>60.1||actual>=duration||Math.abs(actual-total)>0.15)
      throw new Error('generated automatic sample duration invalid');
    const info=await stat(temporary);
    if(info.size<=0||info.size>20*1024*1024)throw new Error('automatic sample upload size invalid');
    await chmod(temporary,0o600);
    await link(temporary,output);
    return {kind:'clipped',path:output,durationSeconds:actual,originalDurationSeconds:duration};
  } finally {
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
