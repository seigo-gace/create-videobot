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
 assert.equal(calls[0].m,'sendMessage');
 assert.ok(calls[0].p.reply_markup.inline_keyboard[0][0].text.includes('動画を投稿'));
 await handler({callback_query:{id:'cq1',from:{id:33},
   data:'menu:listing',message:{chat:{id:33,type:'private'},message_id:11}}});
 assert.equal(states.get(33).draft.mode,'create');
 assert.equal(states.get(33).screenMessageId,11);
 const ignored=await handler({message:{from:{id:33},chat:{id:-99,type:'supergroup'},text:'/start',message_id:9}});
 assert.deepEqual(ignored,{handled:false});
});
