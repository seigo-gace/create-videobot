import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

/** Generate a low-resolution animated GIF PREVIEW, not paid original assets.
 * All source downloads are private, bounded, and destroyed after conversion.
 */
export function createStickerShopPreview({fetchSource}={}){
 if(typeof fetchSource!=='function')throw Error('STICKER_SHOP_PREVIEW_SOURCE_MISSING');
 const cache=new Map(),pending=new Map();
 return async function preview({productId,index,item}={}){
  if(typeof productId!=='string'||!/^sp_[a-f0-9]{24}$/.test(productId)||
     !Number.isSafeInteger(index)||index<0||index>=200||
     typeof item?.file_id!=='string'||!/^[A-Za-z0-9_-]{3,256}$/.test(item.file_id))
   throw Error('STICKER_SHOP_PREVIEW_ITEM_INVALID');
  const key=productId+':'+index+':'+item.file_id;
  if(cache.has(key))return cache.get(key);
  if(pending.has(key))return pending.get(key);
  if(pending.size>=6)throw Error('STICKER_SHOP_PREVIEW_BUSY');
  const task=(async()=>{
   const dir=await mkdtemp(join(tmpdir(),'cv-sticker-shop-'));
   let dl;
   try{
    dl=await fetchSource(item.file_id,dir);
    if(typeof dl?.path!=='string')throw Error('STICKER_SHOP_PREVIEW_FETCH_FAILED');
    const file=join(dir,'preview.gif');
    // Keep content identifiable yet never supply a full-size paid sticker.
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',dl.path,'-t','3','-vf',
      'fps=8,scale=128:128:force_original_aspect_ratio=decrease,pad=128:128:(ow-iw)/2:(oh-ih)/2:color=white@0',
      '-loop','0',file],{timeout:25000,maxBuffer:16384});
    const info=await stat(file);
    if(!info.isFile()||info.size<1||info.size>1_500_000)
      throw Error('STICKER_SHOP_PREVIEW_BOUNDARY');
    const bytes=await readFile(file);
    if(cache.size>=64)cache.delete(cache.keys().next().value);
    cache.set(key,bytes);
    return bytes;
   }finally{
    await dl?.cleanup?.().catch(()=>{});
    await rm(dir,{recursive:true,force:true});
   }
  })();
  pending.set(key,task);
  try{return await task;}finally{pending.delete(key);}
 };
}
