import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
/**
 * A photo preview generated from a registered STICKER (static or WebM).
 * This photo is only Telegram's native Stars purchase surface; the sale is
 * for the immutable sticker/emoji product and delivery is handled separately.
 */
export function createStickerPaidCover({fetchSource}={}){
 if(typeof fetchSource!=='function')throw Error('STICKER_COVER_FETCHER_MISSING');
 return async function paidCover(product){
  const fileId=product?.items?.[0]?.file_id;
  if(typeof fileId!=='string'||!/^[A-Za-z0-9_-]{3,256}$/.test(fileId))
    throw Error('STICKER_COVER_SOURCE_INVALID');
  const dir=await mkdtemp(join(tmpdir(),'sticker-paid-cover-'));
  let downloaded;
  try{
   downloaded=await fetchSource(fileId,dir);
   if(!downloaded?.path)throw Error('STICKER_COVER_SOURCE_MISSING');
   const output=join(dir,'sticker-cover.jpg');
   await exec('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
     '-i',downloaded.path,'-frames:v','1','-vf',
     'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:white',
     '-q:v','3',output],{timeout:90000,maxBuffer:65536});
   const info=await stat(output);
   if(!info.isFile()||info.size<1||info.size>10_000_000)
     throw Error('STICKER_COVER_SIZE_INVALID');
   return new Uint8Array(await readFile(output));
  }catch{throw Error('STICKER_COVER_CONVERSION_FAILED');}
  finally{
   await downloaded?.cleanup?.().catch(()=>{});
   await rm(dir,{recursive:true,force:true});
  }
 };
}
