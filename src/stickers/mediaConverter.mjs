import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stickerGeometry} from './geometry.mjs';

const exec=promisify(execFile);
const MAX_STATIC=512*1024;
const MAX_VIDEO=256*1024;
const MAX_INPUT=20_000_000;

function safePath(path) {
  if (typeof path!=='string'||!path.startsWith('/')||path.includes('\0')) throw new Error('STICKER_SOURCE_PATH_INVALID');
  return resolve(path);
}
function imageStream(metadata) {
  const streams=metadata?.streams;
  const stream=Array.isArray(streams)?streams.find(x=>x.codec_type==='video'):null;
  if(!stream||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||
    stream.width<1||stream.height<1||stream.width>16384||stream.height>16384)
    throw new Error('STICKER_DIMENSIONS_UNSUPPORTED');
  return stream;
}
async function run(binary,args) {
  try {return await exec(binary,args,{timeout:90000,maxBuffer:1024*1024,windowsHide:true});}
  catch(error){throw new Error('STICKER_MEDIA_COMMAND_FAILED:'+binary+(error?.killed?':TIMEOUT':''));}
}
function filterGeometry(g,video) {
  const scale='scale='+g.drawWidth+':'+g.drawHeight+':flags=lanczos';
  const pad=(g.canvasWidth===g.drawWidth&&g.canvasHeight===g.drawHeight)
    ?'':'pad='+g.canvasWidth+':'+g.canvasHeight+':'+g.left+':'+g.top+':color=black@0';
  return [scale,pad,video?'format=yuva420p':'format=rgba'].filter(Boolean).join(',');
}
async function verifyOutput(path,kind,isVideo) {
  const file=await stat(path);
  const limit=isVideo?MAX_VIDEO:MAX_STATIC;
  if(file.size<1||file.size>limit)throw new Error('STICKER_OUTPUT_SIZE_EXCEEDED');
  const info=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path])).stdout);
  const stream=imageStream(info);
  const g=stickerGeometry(stream.width,stream.height,kind);
  if(kind==='emoji'&&(stream.width!==100||stream.height!==100))throw new Error('EMOJI_OUTPUT_DIMENSIONS_INVALID');
  if(kind==='sticker'&&Math.max(stream.width,stream.height)!==512)throw new Error('STICKER_OUTPUT_DIMENSIONS_INVALID');
  if(isVideo){
    if(stream.codec_name!=='vp9'||info.format?.format_name?.split(',').includes('matroska')===false&&
       !String(info.format?.format_name??'').includes('webm'))throw new Error('STICKER_VIDEO_CODEC_INVALID');
    if(stream.width>512||stream.height>512)throw new Error('STICKER_VIDEO_DIMENSIONS_INVALID');
    const duration=Number(info.format?.duration??stream.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>3.05)throw new Error('STICKER_VIDEO_DURATION_INVALID');
    const [num,den]=String(stream.avg_frame_rate??'0/1').split('/').map(Number);
    if(!den||num/den>30.001)throw new Error('STICKER_VIDEO_FPS_INVALID');
    if(info.streams.some(s=>s.codec_type==='audio'))throw new Error('STICKER_VIDEO_HAS_AUDIO');
  } else if(stream.codec_name!=='png') throw new Error('STICKER_STATIC_CODEC_INVALID');
  return {bytes:file.size,codec:stream.codec_name,width:stream.width,height:stream.height,canvas:g};
}
/**
 * Convert user-supplied media into a Telegram-ready sticker or custom emoji.
 * Returns a PRIVATE temporary output. Caller must await cleanup() in finally.
 * A successful conversion is NOT proof of Telegram pack registration.
 */
export async function convertStickerMedia({sourcePath,kind='sticker',format='auto'}={}) {
  const source=safePath(sourcePath);
  if(kind!=='sticker'&&kind!=='emoji')throw new Error('STICKER_KIND_INVALID');
  if(!['auto','static','video'].includes(format))throw new Error('STICKER_FORMAT_INVALID');
  const input=await stat(source);
  if(!input.isFile()||input.size<1||input.size>MAX_INPUT)throw new Error('STICKER_INPUT_SIZE_INVALID');
  const metadata=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',source])).stdout);
  const stream=imageStream(metadata);
  const isMoving=['gif','webm','matroska','mov','mp4'].some(x=>String(metadata.format?.format_name??'').includes(x));
  const video=format==='video'||(format==='auto'&&isMoving);
  if(format==='static'&&isMoving)throw new Error('STICKER_VIDEO_TO_STATIC_NOT_IMPLICIT');
  const geometry=stickerGeometry(stream.width,stream.height,kind);
  const dir=await mkdtemp(join(tmpdir(),'cv-sticker-'));
  const output=join(dir,video?'sticker.webm':'sticker.png');
  const cleanup=async()=>{await rm(dir,{recursive:true,force:true});};
  try {
    const vf=filterGeometry(geometry,video);
    if(!video){
      await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,
        '-frames:v','1','-vf',vf,'-c:v','png','-pix_fmt','rgba',output]);
    } else {
      let success=false;
      for(const crf of [34,42,50,58,63]){
        await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
          '-i',source,'-t','3','-an','-vf',vf,'-r','30','-c:v','libvpx-vp9',
          '-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','0','-crf',String(crf),
          '-deadline','realtime','-cpu-used','5',output]);
        if((await stat(output)).size<=MAX_VIDEO){success=true;break;}
      }
      if(!success)throw new Error('STICKER_OUTPUT_SIZE_EXCEEDED');
    }
    const check=await verifyOutput(output,kind,video);
    return {path:output,format:video?'video':'static',kind,geometry,check,cleanup};
  }catch(error){await cleanup();throw error;}
}
