import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBotEvent,postGserverEvent} from '../src/integrations/gserverEvents.mjs';
const event={bot:'create-videobot',event_id:'evt_0000001',event:'bot.request.completed',level:'info'};
const token='not-a-real-token-but-long-enough';
test('only operational event fields are transmitted',()=>{
 assert.deepEqual(normalizeBotEvent({...event,chat_id:123,user_id:456,text:'private',bot_token:'secret'}),event);
});
test('unknown event and user data as bot identity are denied',()=>{
 assert.throws(()=>normalizeBotEvent({...event,event:'transaction.paid'}));
 assert.throws(()=>normalizeBotEvent({...event,bot:'unknown'}));
});
test('accepted locally is not claimed as Telegram delivery',async()=>{
 let received;
 const result=await postGserverEvent({event,baseUrl:'http://127.0.0.1:18765/',token,fetchImpl:async (url,options)=>{received={url,options};return {status:202}}});
 assert.equal(received.url,'http://127.0.0.1:18765/bot/events');
 assert.equal(received.options.headers.Authorization,'Bearer '+token);
 assert.deepEqual(result,{acceptedLocally:true,remoteDelivered:false});
 assert.deepEqual(JSON.parse(received.options.body),event);
});
test('auth or unavailable is not accepted',async()=>{
 for(const status of [401,403,409,422,503]) {
   const r=await postGserverEvent({event,baseUrl:'http://127.0.0.1:18765/',token,fetchImpl:async()=>({status})});
   assert.deepEqual(r,{acceptedLocally:false,remoteDelivered:false,status});
 }
});
test('rejected payload and missing token never trigger network',async()=>{
 let called=false;const fetchImpl=async()=>{called=true;return {status:202}};
 await assert.rejects(()=>postGserverEvent({event:{...event,text:'hi',event:'arbitrary'},baseUrl:'http://127.0.0.1:18765/',token,fetchImpl}));
 await assert.rejects(()=>postGserverEvent({event,baseUrl:'http://127.0.0.1:18765/',token:'x',fetchImpl}));
 assert.equal(called,false);
});
test('transport error does not leak token',async()=>{
 await assert.rejects(()=>postGserverEvent({event,baseUrl:'http://127.0.0.1:18765/',token,fetchImpl:async()=>({status:500})}),/Gserver transport failed/);
});
