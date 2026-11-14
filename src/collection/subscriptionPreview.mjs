import {execFile as execCb} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';

const execFile=promisify(execCb);

/**
 * Produce a Telegram-streamable preview from a collected full video.
 * The caller supplies the verified local video path and an owned output root.
 * Never opens a Telegram session, publishes a video or touches Stars ledger.
 */
export function createSubscriptionPreviewGenerator({
  resolveStoredVideo,outputRoot,run=execFile,seconds=60
}={}) {
  if(typeof resolveStoredVideo!=='function' || typeof outputRoot!=='string' ||
     !outputRoot.startsWith('/') || typeof run!=='function')
    throw Error('PREVIEW_MEDIA_PORT_UNAVAILABLE');
  if(!Number.isInteger(seconds) || seconds<1 || seconds>60)
    throw Error('PREVIEW_DURATION_INVALID');
  return {
    async generate({storageKey,channelId,messageId,startSeconds=0}={}) {
      if(typeof storageKey!=='string' || !storageKey.trim() ||
         !Number.isSafeInteger(channelId) || channelId<=0 ||
         !Number.isSafeInteger(messageId) || messageId<=0 ||
         !Number.isFinite(startSeconds) || startSeconds<0)
        throw Error('PREVIEW_SOURCE_INVALID');
      const inputPath=await resolveStoredVideo(storageKey);
      if(typeof inputPath!=='string' || !inputPath.startsWith('/'))
        throw Error('PREVIEW_SOURCE_NOT_FOUND');
      const probe=await run('ffprobe',[
        '-v','error','-show_entries','format=duration',
        '-of','default=noprint_wrappers=1:nokey=1',inputPath
      ]);
      const duration=Number(String(probe.stdout).trim());
      if(!Number.isFinite(duration)||duration<=0||startSeconds>=duration)
        throw Error('PREVIEW_SOURCE_DURATION_INVALID');
      const actualSeconds=Math.min(seconds,duration-startSeconds);
      const dir=join(outputRoot,String(channelId),String(messageId));
      await mkdir(dir,{recursive:true});
      const output=join(dir,'sample-60s.mp4');
      await run('ffmpeg',[
        '-nostdin','-hide_banner','-loglevel','error','-y',
        '-ss',String(startSeconds),'-i',inputPath,'-t',String(actualSeconds),
        '-map','0:v:0','-map','0:a:0?','-vf','scale=w=trunc(min(iw\,1280)/2)*2:h=-2',
        '-c:v','libx264','-pix_fmt','yuv420p','-preset','veryfast','-crf','24',
        '-c:a','aac','-b:a','128k','-movflags','+faststart',output
      ]);
      const result=await stat(output);
      if(result.size<1)throw Error('PREVIEW_EMPTY_OUTPUT');
      return {storagePath:output,durationSeconds:actualSeconds,streamingReady:true};
    }
  };
}
