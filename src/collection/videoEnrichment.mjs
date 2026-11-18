import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {mkdir,stat} from 'node:fs/promises';
const execFile=promisify(execFileCallback);

/** Media processing is intentionally independent of Telegram and sales. */
export function createVideoEnrichment({translateToJapanese,resolveStoredVideo,thumbnailDirectory,run=execFile}={}) {
  if(typeof translateToJapanese!=='function'||typeof resolveStoredVideo!=='function')
    throw Error('VIDEO_ENRICHMENT_DEPENDENCY_MISSING');
  if(typeof thumbnailDirectory!=='string'||!thumbnailDirectory.startsWith('/'))
    throw Error('THUMBNAIL_DIRECTORY_REQUIRED');
  return {
    async enrich({storageKey,caption,channelId,messageId}) {
      const original=typeof caption==='string'?caption:'';
      const japanese=original.trim()?await translateToJapanese({text:original,sourceLanguage:'zh',targetLanguage:'ja'}):'';
      if(typeof japanese!=='string'||(original.trim()&&!japanese.trim()))
        throw Error('JAPANESE_TRANSLATION_FAILED');
      const videoPath=await resolveStoredVideo(storageKey);
      if(typeof videoPath!=='string'||!videoPath.startsWith('/'))
        throw Error('STORED_VIDEO_PATH_UNAVAILABLE');
      const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',videoPath]);
      const duration=Number(String(stdout).trim());
      if(!Number.isFinite(duration)||duration<=0)throw Error('INVALID_VIDEO_DURATION');
      const base=join(thumbnailDirectory,String(channelId),String(messageId));
      await mkdir(base,{recursive:true});
      const thumbnails=[];
      // Two distinct points away from the first/last frame.
      for(const [index,fraction] of [0.25,0.75].entries()){
        const time=Math.min(Math.max(duration*fraction,0),Math.max(0,duration-0.001));
        const output=join(base,'thumb'+(index+1)+'.jpg');
        await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',videoPath,'-frames:v','1','-q:v','3',output]);
        const file=await stat(output);
        if(file.size<=0)throw Error('EMPTY_VIDEO_THUMBNAIL');
        thumbnails.push(output);
      }
      return {captionJapanese:japanese,thumbnail1:thumbnails[0],thumbnail2:thumbnails[1]};
    }
  };
}
