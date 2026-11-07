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
test('Telegram API rejects unknown edit failure without propagating user data',async()=>{
 const untrusted='private text '+token;
 const api=createTelegramBotApi({token,fetchImpl:async()=>({
   status:400,json:async()=>({ok:false,description:'Bad Request: '+untrusted})
 })});
 await assert.rejects(()=>api('editMessageText',{chat_id:1,message_id:2,text:'new'}),
   error=>error.message==='Telegram API request failed'&&!error.message.includes(untrusted));
 await assert.rejects(()=>api('sendMessage',{chat_id:1,text:'x'}),
   /Telegram API request failed/);
});
