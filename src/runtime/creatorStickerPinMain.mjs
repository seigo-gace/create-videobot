import {request} from 'node:https';
import {pathToFileURL} from 'node:url';
import {readPrivateToken} from './config.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {createCreatorStickerTopicEntryPin} from '../stickers/creatorTopicEntryPin.mjs';
import {openFileStickerEntryPin} from '../stickers/fileStickerEntryPin.mjs';

// STK-04 production one-shot for the existing CreateVdobot.
// The chat/thread are copied from Telegram-verified Gserver topic registration;
// an unrelated or moved Topic must fail closed during its send readback.
export const registeredTopic=Object.freeze({
 board:'video_chat',purpose:'sticker',enabled:true,verified:true,
 chatId:-1002373696859,threadId:4291,
 groupTitle:'ビデオChatの掲示板',title:'ステッカーの公開と販売'
});
function ipv4Fetch(url,options={}){
 return new Promise((resolve,reject)=>{
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='api.telegram.org')
    return reject(Error('CREATOR_PIN_API_HOST_INVALID'));
  const data=options.body;
  if(typeof data!=='string')return reject(Error('CREATOR_PIN_JSON_ONLY'));
  const req=request({hostname:u.hostname,port:443,path:u.pathname,
   family:4,method:'POST',headers:{
     'content-type':'application/json','content-length':Buffer.byteLength(data)
   },timeout:12000,signal:options.signal},resp=>{
    const chunks=[];let bytes=0;
    resp.on('data',chunk=>{
      bytes+=chunk.byteLength;
      if(bytes<=131072)chunks.push(chunk);
      else req.destroy(Error('CREATOR_PIN_RESPONSE_TOO_LARGE'));
    });
    resp.on('end',()=>resolve(new Response(Buffer.concat(chunks),{
      status:resp.statusCode,headers:{'content-type':'application/json'}
    })));
  });
  req.on('timeout',()=>req.destroy(Error('CREATOR_PIN_API_TIMEOUT')));
  req.on('error',reject);
  req.end(data);
 });
}
export async function runCreatorStickerPinOnce(env=process.env){
 if(env.VIDEOBOT_STICKER_PIN_ONCE!=='YES')
   throw Error('CREATOR_STICKER_PIN_NOT_ENABLED');
 const token=readPrivateToken(env.VIDEOBOT_TELEGRAM_TOKEN_FILE);
 const store=await openFileStickerEntryPin(env.VIDEOBOT_STICKER_PIN_RECEIPT_DIR);
 try{
  const api=createTelegramBotApi({token,fetchImpl:ipv4Fetch,timeoutMs:20000});
  const ensure=createCreatorStickerTopicEntryPin({
    telegramApi:api,
    getVerifiedStickerEntryTopic:async()=>({...registeredTopic}),
    receiptStore:store
  });
  const r=await ensure();
  if(r.acknowledged!==true)throw Error('CREATOR_STICKER_PIN_UNACKNOWLEDGED');
  process.stdout.write('CREATOR_STICKER_PIN_API_ACK=PASS\\n');
  process.stdout.write('CREATOR_STICKER_PIN_MESSAGE_ID='+r.messageId+'\\n');
  process.stdout.write('CREATOR_STICKER_PIN_PREEXISTING='+(r.alreadyPinned?'YES':'NO')+'\\n');
  return r;
 }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await runCreatorStickerPinOnce();}
 catch(e){
  const name=typeof e?.message==='string'?e.message:'UNCLASSIFIED';
  const safe=name.startsWith('CREATOR_')?name:'CREATOR_STICKER_PIN_OPERATION_FAILED';
  process.stderr.write(safe+'\\n');
  process.exitCode=1;
 }
}
