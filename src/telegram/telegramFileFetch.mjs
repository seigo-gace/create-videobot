import {open,lstat,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Official Telegram getFile + bounded download into a private worker dir.
 * Does not accept arbitrary origins or trust file_path as a local filesystem
 * path. Token and file URL must never be logged or saved to Source/CI output.
 * Default Bot API has a 20 MB download limit; larger files require a
 * separately approved Local Bot API Server, not an accidental fallback.
 */
export function createTelegramVideoFetcher({
  telegramApi,token,fetchImpl=globalThis.fetch,maxBytes=20_000_000,openFile=open
}={}) {
  if(typeof telegramApi!=='function' || typeof token!=='string' ||
     !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token))
    throw new Error('Telegram fetcher credentials unavailable');
  if(typeof fetchImpl!=='function'||typeof openFile!=='function'||!Number.isSafeInteger(maxBytes)||
     maxBytes<1||maxBytes>20_000_000)throw new Error('invalid download boundary');
  return async function fetchSource(fileId,dir) {
    if(typeof fileId!=='string'||!/^[A-Za-z0-9_-]{3,256}$/.test(fileId))throw new Error('invalid Telegram file ID');
    if(typeof dir!=='string'||!dir.startsWith('/'))throw new Error('private media work directory required');
    const root=resolve(dir),info=await lstat(root);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe media work directory');
    const result=await telegramApi('getFile',{file_id:fileId});
    const path=result?.file_path;
    if(typeof path!=='string' || !/^[A-Za-z0-9_.\/-]+$/.test(path)||
       path.startsWith('/')||path.split('/').some(segment=>segment===''||segment==='.'||segment==='..'))
      throw new Error('Telegram file path invalid');
    if(Number.isFinite(result.file_size)&&result.file_size>maxBytes)throw new Error('file exceeds Bot API download limit');
    const target=join(root,'download-'+randomUUID()+'.mp4');
    const url='https://api.telegram.org/file/bot'+token+'/'+path;
    let created=false,fd;
    try {
      const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
      if(response?.ok!==true||!response.body)throw new Error('Telegram file download failed');
      fd=await openFile(target,'wx',0o600);created=true;
      let size=0;
      for await(const chunk of response.body) {
        const bytes=Buffer.from(chunk);
        size+=bytes.length;
        if(size>maxBytes)throw new Error('download exceeds configured limit');
        // FileHandle.write may complete only part of a chunk. A short write
        // must never result in a silently truncated paid-video preview.
        let offset=0;
        while(offset<bytes.length){
          const result=await fd.write(bytes,offset,bytes.length-offset);
          const written=result?.bytesWritten;
          if(!Number.isSafeInteger(written)||written<=0||written>bytes.length-offset)
            throw new Error('incomplete Telegram media write');
          offset+=written;
        }
      }
      if(size===0)throw new Error('downloaded media empty');
      await fd.sync();await fd.close();fd=null;
      return {path:target,cleanup:async()=>{await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});}};
    } catch(error){
      if(fd)await fd.close().catch(()=>{});
      if(created)await unlink(target).catch(()=>{});
      throw error;
    }
  };
}
