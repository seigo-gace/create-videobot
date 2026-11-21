import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';

/**
 * Upload a generated preview file to an ALREADY APPROVED private Telegram
 * media storage chat; returns Telegram's resulting reusable file ID.
 * This is not the public product-posting destination.
 *
 * The product never infers/creates a storage group, requires a verified
 * owner-supplied storage contract, and never logs the Bot Token or URL.
 */
export function createTelegramPrivateMediaUploader({
  token,fetchImpl=globalThis.fetch,verifyStorage,maxBytes=20_000_000
}={}) {
  if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token) ||
     typeof fetchImpl!=='function'||typeof verifyStorage!=='function')
    throw new Error('private media upload service unavailable');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>20_000_000)
    throw new Error('invalid upload limit');
  return async function saveGenerated({path,type}) {
    if(typeof path!=='string'||!path.startsWith('/')||
      !['photo','video'].includes(type))throw new Error('invalid media upload request');
    const storage=await verifyStorage();
    if(storage?.kind!=='private_video_media_store'||storage.verified!==true ||
       storage.private!==true||!Number.isSafeInteger(storage.chatId)||
       storage.chatId>=0)throw new Error('approved private media store not verified');
    const file=await lstat(path);
    if(!file.isFile()||file.isSymbolicLink()||file.size===0||file.size>maxBytes)
      throw new Error('generated media not safe to upload');
    const bytes=await readFile(path);
    if(bytes.length>maxBytes)throw new Error('generated media exceeds upload limit');
    const form=new FormData();
    form.set('chat_id',String(storage.chatId));
    form.set('disable_notification','true');
    form.set('protect_content','true');
    form.set('has_spoiler','true');
    form.set(type,new Blob([bytes],{type:type==='photo'?'image/jpeg':'video/mp4'}),type==='photo'?'preview.jpg':'sample.mp4');
    const method=type==='photo'?'sendPhoto':'sendVideo';
    const res=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(60000)
    });
    if(!res || res.ok!==true)throw new Error('private media upload failed');
    const json=await res.json();
    if(json?.ok!==true)throw new Error('private media upload rejected');
    const result=json.result;
    const fileId=type==='photo' ? result?.photo?.at(-1)?.file_id : result?.video?.file_id;
    if(typeof fileId!=='string'||!fileId.trim()||
       !Number.isSafeInteger(result?.message_id)||result.message_id<=0)
      throw new Error('private media upload acknowledgment invalid');
    return {fileId,messageId:result.message_id};
  };
}

/**
 * Upload auto-generated creator preview assets to the creator's own existing
 * private Bot DM. No new storage chat, group, provider, Bot or session is made.
 * The temporary upload messages are removed after obtaining reusable Telegram
 * file IDs. The final three-item DM album is sent by the existing wizard.
 */
export function createCreatorDmPreviewUploader({
 token,fetchImpl=globalThis.fetch,telegramApi,maxBytes=20_000_000,
 baseUrl='https://api.telegram.org',localMediaRoot=null
}={}){
 if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)||
    typeof fetchImpl!=='function'||typeof telegramApi!=='function')
   throw new Error('creator preview upload provider missing');
 return async function saveGenerated({path,type,ownerId}={}){
   if(!Number.isSafeInteger(ownerId)||ownerId<=0||
      typeof path!=='string'||!path.startsWith('/')||
      !['photo','video'].includes(type))throw new Error('invalid creator DM media owner');
   if(!['https://api.telegram.org','http://telegram-bot-api:8081'].includes(baseUrl))
     throw Error('unverified Bot API upload endpoint');
   if(!Number.isSafeInteger(maxBytes)||maxBytes<1||
      maxBytes>(baseUrl==='http://telegram-bot-api:8081'?2_000_000_000:20_000_000))
     throw Error('creator preview upload size boundary invalid');
   const stat=await lstat(path);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>maxBytes)
     throw new Error('generated creator preview upload size invalid');
   // --local mode can send a file by absolute path when the same verified
   // directory is mounted into the official Bot API server.
   // User-supplied paths and FFmpeg temp files never get this privilege.
   if(localMediaRoot!==null){
     if(baseUrl!=='http://telegram-bot-api:8081' ||
        typeof localMediaRoot!=='string' || !localMediaRoot.startsWith('/') ||
        resolve(localMediaRoot)==='/' || localMediaRoot.split(sep).includes('..'))
       throw Error('unverified local media root');
     const base=await realpath(localMediaRoot);
     const absolute=await realpath(path);
     if(absolute.startsWith(base+sep) && absolute!==base){
       const result=await telegramApi(type==='photo'?'sendPhoto':'sendVideo',{
         chat_id:ownerId,[type]:pathToFileURL(absolute).href,disable_notification:true,protect_content:true
       });
       const fileId=type==='photo'?result?.photo?.at(-1)?.file_id:result?.video?.file_id;
       if(typeof fileId!=='string'||!fileId.trim()||
          !Number.isSafeInteger(result?.message_id)||result.message_id<=0)
         throw Error('creator local media handoff result unknown');
       await telegramApi('deleteMessage',{chat_id:ownerId,message_id:result.message_id}).catch(()=>{});
       return {fileId};
     }
   }
   const method=type==='photo'?'sendPhoto':'sendVideo';
   const mime=type==='photo'?'image/jpeg':'video/mp4';
   const filename=type==='photo'?'creator-preview.jpg':'creator-sample.mp4';
   let request;
   if(stat.size>20_000_000){
     if(baseUrl!=='http://telegram-bot-api:8081')
       throw Error('large creator media requires verified Local Bot API');
     // Stream one multipart upload rather than Buffer-ing a one-hour movie
     // into Node memory. An unknown Telegram result is never retried here.
     const boundary='gace'+randomBytes(20).toString('hex');
     const chunks=[
       ['chat_id',String(ownerId)],
       ['disable_notification','true'],
       ['protect_content','true']
     ].map(([name,value])=>Buffer.from(
       '--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n'));
     const fileHead=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+type+'"; filename="'+filename+'"\r\nContent-Type: '+mime+'\r\n\r\n');
     const ending=Buffer.from('\r\n--'+boundary+'--\r\n');
     const contentLength=chunks.reduce((n,v)=>n+v.length,0)+fileHead.length+stat.size+ending.length;
     const source=createReadStream(path,{highWaterMark:256*1024});
     const upload=Readable.from((async function*(){
       for(const item of chunks)yield item;
       yield fileHead;
       for await(const chunk of source)yield chunk;
       yield ending;
     })());
     request={
       method:'POST',
       body:upload,
       duplex:'half',
       headers:{'content-type':'multipart/form-data; boundary='+boundary,
         'content-length':String(contentLength)},
       redirect:'error',signal:AbortSignal.timeout(900000)
     };
   } else {
     const bytes=await readFile(path);
     const form=new FormData();
     form.set('chat_id',String(ownerId));
     form.set('disable_notification','true');
     form.set('protect_content','true');
     form.set(type,new Blob([bytes],{type:mime}),filename);
     request={method:'POST',body:form,redirect:'error',
       signal:AbortSignal.timeout(60000)};
   }
   const response=await fetchImpl(baseUrl+'/bot'+token+'/'+method,request);
   if(response?.ok!==true)throw new Error('creator preview Telegram upload failed');
   const json=await response.json();
   if(json?.ok!==true)throw new Error('creator preview Telegram upload rejected');
   const receipt=json.result;
   const fileId=type==='photo'?receipt?.photo?.at(-1)?.file_id:receipt?.video?.file_id;
   if(typeof fileId!=='string'||!fileId.trim()||
      !Number.isSafeInteger(receipt?.message_id)||receipt.message_id<1)
      throw new Error('creator preview upload result unknown');
   // Deletion is best-effort; do not send a duplicate upload if it fails.
   await telegramApi('deleteMessage',{chat_id:ownerId,message_id:receipt.message_id}).catch(()=>{});
   return {fileId};
 };
}
