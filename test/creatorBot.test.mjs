import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorBotUpdateHandler } from '../src/telegram/creatorBot.mjs';

test('native Telegram start opens existing main menu; callback enters reuse-based creator form',async()=>{
 const calls=[],states=new Map();
 const api=async(m,p)=>{calls.push({m,p});return {message_id:11}};
 const store={
   async read(id){return states.get(id)||null;},
   async write(id,prev,next){assert.equal(states.get(id)?.revision??0,prev);states.set(id,next);},
   async setScreen(id,rev,msg){const state=states.get(id);assert.equal(state.revision,rev);states.set(id,{...state,screenMessageId:msg});}
 };
 const handler=createCreatorBotUpdateHandler({
   api,sessionStore:store,
   screenTransport:{show:async(_,oldId,panel)=>{calls.push({m:'screen',p:panel});return {messageId:oldId||11}}},
   listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
   mediaProcessor:{prepareUserSample:async()=>({fileId:'ok',durationSeconds:15})}
 });
 await handler({message:{from:{id:33},chat:{id:33,type:'private'},message_id:5,text:'/start'}});
 assert.equal(calls[0].m,'screen');
 assert.ok(calls[0].p.reply_markup.inline_keyboard[0][0].text.includes('動画を投稿'));
 assert.equal(states.get(33).screenMessageId,11);
 await handler({message:{from:{id:33},chat:{id:33,type:'private'},message_id:6,text:'/start'}});
 assert.equal(calls.filter(c=>c.m==='screen').length,2,
  'repeated /start edits the existing Bot DM screen, not sendMessage');
 assert.equal(calls.filter(c=>c.m==='sendMessage').length,0);
 await handler({callback_query:{id:'cq1',from:{id:33},
   data:'menu:listing',message:{chat:{id:33,type:'private'},message_id:11}}});
 assert.equal(states.get(33).draft.mode,'create');
 assert.equal(states.get(33).screenMessageId,11);
 const ignored=await handler({message:{from:{id:33},chat:{id:-99,type:'supergroup'},text:'/start',message_id:9}});
 assert.deepEqual(ignored,{handled:false});
});

test('a stale creator button is acknowledged as harmless navigation, not marked as unknown payment',async()=>{
 const calls=[],states=new Map();
 const api=async(method,params)=>{calls.push({method,params});return {message_id:11};};
 const sessionStore={
  async read(id){return states.get(id)||null;},
  async write(id,revision,next){assert.equal(states.get(id)?.revision??0,revision);states.set(id,next);},
  async setScreen(id,revision,messageId){const old=states.get(id);states.set(id,{...old,screenMessageId:messageId});}
 };
 const bot=createCreatorBotUpdateHandler({
  api,sessionStore,screenTransport:{show:async()=>({messageId:11})},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null}
 });
 await bot({callback_query:{id:'cb_first',from:{id:33},data:'menu:listing',
  message:{chat:{id:33,type:'private'},message_id:11}}});
 const result=await bot({callback_query:{id:'cb_old',from:{id:33},data:'edit:title|r999',
  message:{chat:{id:33,type:'private'},message_id:11}}});
 assert.deepEqual(result,{handled:true,staleButton:true});
 assert.equal(states.get(33).revision,1);
 assert.equal(calls.filter(c=>c.method==='answerCallbackQuery').length,2);
});
test('do not mistake unauthorized callback ownership errors for harmless stale taps',async()=>{
 const bot=createCreatorBotUpdateHandler({
  api:async()=>true,
  sessionStore:{read:async()=>null,write:async()=>null,setScreen:async()=>null},
  screenTransport:{show:async()=>({messageId:3})},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null}
 });
 await assert.rejects(()=>bot({callback_query:{id:'unauthorized',from:{id:9},
  data:'menu:listing',message:{chat:{id:33,type:'private'},message_id:3}}}),/PRIVATE_OWNER_REQUIRED/);
});
