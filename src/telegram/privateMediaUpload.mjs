import {readFile,lstat} from 'node:fs/promises';

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
