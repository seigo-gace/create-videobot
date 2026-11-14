import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramBotApi} from '../src/telegram/botApi.mjs';
const token='123456789:'+'A'.repeat(35);
test('getMe uses HTTPS Telegram endpoint and returns result without logging',async()=>{
 let called;const api=createTelegramBotApi({token,fetchImpl:async(url,options)=>{called={url,options};return {status:200,json:async()=>({ok:true,result:{id:777}})}}});
 const r=await api('getMe'); assert.equal(r.id,777);
 assert.equal(called.url,'https://api.telegram.org/bot'+token+'/getMe');
 assert.equal(called.options.redirect,'error');
});
test('arbitrary Telegram methods cannot execute',async()=>{
 let called=false;const api=createTelegramBotApi({token,fetchImpl:async()=>{called=true}});
 await assert.rejects(()=>api('deleteWebhook'));
 assert.equal(called,false);
});
test('Telegram API failure does not print URL or token',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({status:401})});
 await assert.rejects(()=>api('getMe'),err=>!err.message.includes(token)&&err.message==='Telegram API request failed');
});
test('Telegram API reports denied result without dumping body',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({status:200,json:async()=>({ok:false,description:'secret'})})});
 await assert.rejects(()=>api('getMe'),err=>!err.message.includes('secret'));
});

test('Telegram DM edit maps only known not-editable failures for safe screen replacement',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: message to edit not found'})
 })});
 await assert.rejects(()=>api('editMessageText',{chat_id:1,message_id:2,text:'new'}),/message cannot be edited/);
 const unchanged=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: message is not modified'})
 })});
 await assert.rejects(()=>unchanged('editMessageText',{chat_id:1,message_id:2,text:'old'}),/message is not modified/);
});
test('sticker DM can replace an old photo screen after definitive Telegram non-text denial',async()=>{
 for(const description of [
   'Bad Request: there is no text in the message to edit',
   'Bad Request: message is not a text message'
 ]){
  const api=createTelegramBotApi({token,fetchImpl:async()=>({
    status:400,json:async()=>({ok:false,description})
  })});
  await assert.rejects(()=>api('editMessageText',{chat_id:42,message_id:301,text:'🎨 ステッカー'}),
    /message cannot be edited/);
 }
});
test('definitive unknown HTTP 400 edit can replace screen without leaking the response',async()=>{
 const untrusted='private text '+token;
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: '+untrusted})
 })});
 await assert.rejects(()=>api('editMessageText',{chat_id:1,message_id:2,text:'new'}),
   error=>error.message==='message cannot be edited'&&!error.message.includes(untrusted));
 await assert.rejects(()=>api('sendMessage',{chat_id:1,text:'x'}),
   /Telegram API request failed/);
});

test('definitive Telegram 400 for sticker mutation is classified without leaking description',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'private content '+token})
 })});
 await assert.rejects(
   ()=>api('createNewStickerSet',{user_id:42,name:'set_by_CreateVdobot',title:'X',stickers:[]}),
   error=>error.definitiveTelegramRejection===true &&
     error.message==='STICKER_TELEGRAM_REGISTRATION_REJECTED' &&
     !error.message.includes(token));
});
test('Telegram server failure is not a confirmed sticker rejection',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({status:503})});
 await assert.rejects(
   ()=>api('addStickerToSet',{user_id:42,name:'set_by_CreateVdobot',sticker:{}}),
   error=>error.definitiveTelegramRejection!==true);
});

test('native sticker photo edit treats exact Telegram no-op as a confirmed current state',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: message is not modified'})
 })});
 for(const [method,args] of [
  ['editMessageCaption',{chat_id:-1002373696859,message_id:4663,caption:'🎨 ちびキャラ'}],
  ['editMessageReplyMarkup',{chat_id:-1002373696859,message_id:4663}]
 ]){
  const result=await api(method,args);
  assert.deepEqual(result,{alreadyCurrent:true});
 }
});
test('paid photo edit rejects any non-idempotent 400 without leaking Telegram descriptions',async()=>{
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: private content '+token})
 })});
 for(const method of ['editMessageCaption','editMessageReplyMarkup'])
  await assert.rejects(()=>api(method,{chat_id:-1002373696859,message_id:4663}),
   error=>error.message==='Telegram API request failed'&&!error.message.includes(token));
});

test('HTTP 400 edit denial replaces the DM screen once; HTTP 503 never does',async()=>{
 const {createVideoBotScreenTransport}=await import('../src/telegram/creatorScreenTransport.mjs');
 const panel={text:'通常メニュー',reply_markup:{inline_keyboard:[
  [{text:'🎨 ステッカー・絵文字',callback_data:'menu:stickers'}]]}};
 const calls=[];
 const api=createTelegramBotApi({token,fetchImpl:async(url)=>{
  const method=url.split('/').pop();calls.push(method);
  if(method==='editMessageText')return {status:400,json:async()=>({ok:false,description:'Bad Request: unspecified edit rejection'})};
  if(method==='sendMessage')return {status:200,json:async()=>({ok:true,result:{message_id:9}})};
  return {status:200,json:async()=>({ok:true,result:true})};
 }});
 const transport=createVideoBotScreenTransport(api);
 assert.deepEqual(await transport.show(33,8,panel),{messageId:9,replaced:false});
 assert.deepEqual(calls,['editMessageText','sendMessage','deleteMessage']);
 const unavailable=createTelegramBotApi({token,fetchImpl:async()=>({status:503})});
 const safe=createVideoBotScreenTransport(unavailable);
 await assert.rejects(()=>safe.show(33,8,panel),/WIZARD_EDIT_RESULT_UNKNOWN/);
});
