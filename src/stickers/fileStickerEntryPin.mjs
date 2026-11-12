import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * A single-run Gserver adapter for an OWNED one-shot entry pin when the
 * full paid-video webhook runtime is not deployed. It implements the same
 * receipt contract as the PostgreSQL adapter, without touching GateApp data.
 * A crash leaves a lock/uncertain receipt rather than silently reposting.
 */
export async function openFileStickerEntryPin(directory){
 if(typeof directory!=='string'||!directory.startsWith('/var/lib/videobot/'))
   throw Error('CREATOR_STICKER_ENTRY_PRIVATE_STATE_REQUIRED');
 await mkdir(directory,{recursive:true,mode:0o700});
 const name=join(directory,'sticker-entry.json');
 const lockPath=join(directory,'sticker-entry.lock');
 let lock;
 try{lock=await open(lockPath,'wx',0o600);}
 catch{throw Error('CREATOR_STICKER_ENTRY_OPERATION_LOCKED');}
 let closed=false;
 async function current(){
  try{return JSON.parse(await readFile(name,'utf8'));}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
 }
 async function save(value){
  const tmp=name+'.tmp';
  await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});
  try{await rename(tmp,name);}catch(e){await unlink(tmp).catch(()=>{});throw e;}
 }
 function guard({topic,botId,messageId=null}){
  if(!topic||!Number.isSafeInteger(topic.chatId)||!Number.isSafeInteger(topic.threadId)||
     !Number.isSafeInteger(botId)||botId<=0||
     (messageId!==null&&(!Number.isSafeInteger(messageId)||messageId<=0)))
    throw Error('CREATOR_STICKER_ENTRY_FILE_RECEIPT_INVALID');
 }
 async function transition(expected,status,args){
  guard(args);
  const old=await current();
  if(!old||old.status!==expected||old.chatId!==args.topic.chatId||
     old.threadId!==args.topic.threadId||old.botId!==args.botId||
     (old.messageId!==null&&old.messageId!==args.messageId))
    throw Error('CREATOR_STICKER_ENTRY_FILE_CAS_FAILED');
  await save({...old,status,messageId:args.messageId});
 }
 return Object.freeze({
  async claim({topic,botId,botUsername}){
   guard({topic,botId});
   if(String(botUsername).toLowerCase()!=='createvdobot')
     throw Error('CREATOR_STICKER_ENTRY_FILE_USERNAME_INVALID');
   const old=await current();
   if(!old){
    await save({status:'sending',chatId:topic.chatId,threadId:topic.threadId,
      botId,botUsername,messageId:null});
    return {claimed:true};
   }
   if(old.chatId!==topic.chatId||old.threadId!==topic.threadId||
      old.botId!==botId||String(old.botUsername).toLowerCase()!=='createvdobot')
    throw Error('CREATOR_STICKER_ENTRY_FILE_OWNER_CONFLICT');
   return {claimed:false,status:old.status,messageId:old.messageId};
  },
  sent:args=>transition('sending','sent',args),
  pinRequested:args=>transition('sent','pin_requested',args),
  pinned:args=>transition('pin_requested','pinned_ack',args),
  async unknown(args){
   guard(args);
   const old=await current();
   if(old?.status==='pinned_ack')return;
   if(old&&old.chatId===args.topic.chatId&&old.threadId===args.topic.threadId&&old.botId===args.botId)
     await save({...old,status:'needs_reconcile',
       messageId:old.messageId??args.messageId??null});
  },
  async close(){
   if(closed)return;
   closed=true;await lock.close();await unlink(lockPath).catch(()=>{});
  }
 });
}
