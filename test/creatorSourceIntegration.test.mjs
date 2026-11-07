import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoBotSourceModule} from '../src/telegram/creatorWiring.mjs';

const secret='v'.repeat(32);
function offline(){
 const sessions=new Map(),updates=new Map(),calls=[];
 const pool={async query(sql,params){
   const id=params?.[0];
   if(sql.startsWith('INSERT INTO videobot_webhook_updates')){
     if(updates.has(id))return {rowCount:0,rows:[]};
     updates.set(id,{payload_sha256:params[1],status:'processing',handled:null});
     return {rowCount:1,rows:[{update_id:id}]};
   }
   if(sql.startsWith('SELECT payload_sha256')){
     const x=updates.get(id);return {rows:x?[x]:[]};
   }
   if(sql.startsWith("UPDATE videobot_webhook_updates SET status='completed'")){
     const x=updates.get(id);assert.equal(x.status,'processing');
     x.status='completed';x.handled=params[1];return {rowCount:1};
   }
   if(sql.startsWith("UPDATE videobot_webhook_updates SET status='needs_reconcile'")){
     const x=updates.get(id);x.status='needs_reconcile';return {rowCount:1};
   }
   if(sql.startsWith('SELECT revision,screen_message_id,state FROM videobot_creator_sessions')){
     const x=sessions.get(id);
     return {rows:x?[{revision:x.revision,screen_message_id:x.screenMessageId,
       state:x.payload}]:[]};
   }
   if(sql.startsWith('INSERT INTO videobot_creator_sessions')){
     if(sessions.has(id))return {rowCount:0};
     sessions.set(id,{revision:params[1],screenMessageId:params[2],payload:JSON.parse(params[3])});
     return {rowCount:1};
   }
   if(sql.startsWith('UPDATE videobot_creator_sessions SET revision=')){
     const old=sessions.get(id);
     if(!old||old.revision!==params[4])return {rowCount:0};
     sessions.set(id,{revision:params[1],screenMessageId:params[2],payload:JSON.parse(params[3])});
     return {rowCount:1};
   }
   if(sql.startsWith('UPDATE videobot_creator_sessions SET screen_message_id=')){
     const old=sessions.get(id);
     if(old?.revision!==params[1])return {rowCount:0};
     old.screenMessageId=params[2];return {rowCount:1};
   }
   throw Error('Unexpected read/write in offline creator flow: '+sql.slice(0,70));
 }};
 const telegramApi=async(method,params)=>{
  calls.push({method,params});
  if(method==='sendMessage')return {message_id:101};
  if(method==='editMessageText'||method==='deleteMessage'||method==='answerCallbackQuery')
   return true;
  throw Error('Unexpected external Telegram call: '+method);
 };
 const instance=createVideoBotSourceModule({
  pool,telegramApi,webhookSecret:secret,
  mediaPorts:{
   fetchSource:async()=>{throw Error('preview media unavailable');},
   saveGenerated:async()=>{throw Error('media storage unavailable');}
  },
  gateOwner:{
   getVerifiedVideoTopic:async()=>{throw Error('No live topic');},
   verifyMembership:async()=>false,
   verifyReview:async()=>false,
   verifyRelease:async()=>false
  }
 });
 const send=async update=>{
   const body=Buffer.from(JSON.stringify(update));
   return instance.handleTelegramWebhook({secretHeader:secret,body});
 };
 return {send,calls,updates,sessions};
}
function callback(id,data) {
 return {update_id:id,callback_query:{
  id:'cb_'+id,data,from:{id:33},
  message:{chat:{id:33,type:'private'},message_id:101}
 }};
}
test('source-composed offline Telegram webhook drives real wizard route with durable revision and no GATE bypass',async()=>{
 const x=offline();
 let r=await x.send({update_id:1,message:{message_id:1,from:{id:33},
  chat:{id:33,type:'private'},text:'/start'}});
 assert.equal(r.accepted,true);
 assert.ok(x.calls[0].params.text.includes('管理費30%'));
 r=await x.send(callback(2,'menu:listing'));
 assert.equal(r.handled,true);
 const state=()=>x.sessions.get(33);
 assert.equal(state().revision,3);
 assert.equal(state().payload.draft.mode,'create');
 assert.ok(x.calls.some(y=>y.method==='editMessageText'&&
  y.params.text.includes('残り70%')));
 await x.send(callback(3,'edit:title|r2'));
 assert.equal(state().revision,2);
 assert.equal(state().payload.waiting,'title');
 r=await x.send({update_id:4,message:{message_id:11,
  from:{id:33},chat:{id:33,type:'private'},text:'夏の思い出'}});
 assert.equal(r.handled,true);
 assert.equal(state().payload.draft.title,'夏の思い出');
 assert.ok(x.calls.some(y=>y.method==='deleteMessage'&&y.params.message_id===11));
 await x.send(callback(5,'edit:price:300|r4'));
 assert.equal(state().payload.draft.priceStars,300);
 assert.equal(state().revision,5);
 const screen=x.calls.filter(y=>y.method==='editMessageText').at(-1);
 assert.match(screen.params.text,/管理費90 Stars／投稿者分210 Stars/);
 const replay=await x.send(callback(5,'edit:price:300|r4'));
 assert.equal(replay.duplicate,true);
 assert.equal(state().revision,5);
 assert.ok(!x.calls.some(y=>y.method==='sendPaidMedia'||y.method==='sendMediaGroup'));
});
