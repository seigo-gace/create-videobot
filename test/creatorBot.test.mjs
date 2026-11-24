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
 assert.equal(calls[0].p.reply_markup.inline_keyboard[0][0].callback_data,'menu:video');
 assert.equal(calls[0].p.reply_markup.inline_keyboard[0][1].callback_data,'menu:stickers');
 assert.equal(states.get(33).screenMessageId,11);
 await handler({message:{from:{id:33},chat:{id:33,type:'private'},message_id:6,text:'/start'}});
 assert.equal(calls.filter(c=>c.m==='screen').length,2,
  'repeated /start edits the existing Bot DM screen, not sendMessage');
 await handler({callback_query:{id:'cq_video',from:{id:33},
   data:'menu:listing',message:{chat:{id:33,type:'private'},message_id:11}}});
 assert.match(calls.at(-1).p.text,/タイトル/);
 assert.equal(calls.filter(c=>c.m==='sendMessage').length,0);
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

test('GayBBS handoff uses existing video and sticker owner without a duplicate menu',async()=>{
 const calls=[],states=new Map();
 const api=async(method,payload)=>{calls.push({method,payload});return {message_id:27}};
 const sessionStore={
  async read(id){return states.get(id)||null;},
  async write(id,revision,next){assert.equal(states.get(id)?.revision??0,revision);states.set(id,next);},
  async setScreen(id,revision,messageId){states.set(id,{...states.get(id),screenMessageId:messageId})}
 };
 const handler=createCreatorBotUpdateHandler({
  api,sessionStore,
  screenTransport:{show:async(_,oldId,panel)=>{calls.push({method:'screen',payload:panel});return {messageId:oldId||27}}},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
  stickerHandler:async(update)=>update.message?.text==='/start sticker'?
    {handled:true,owner:'sticker'}:{handled:false}
 });
 const sticker=await handler({message:{chat:{id:39,type:'private'},from:{id:39},text:'/start sticker',message_id:1}});
 assert.deepEqual(sticker,{handled:true,owner:'sticker'});
 assert.equal(calls.length,0,'sticker must not open the unrelated video menu');
 await handler({message:{chat:{id:39,type:'private'},from:{id:39},text:'/start video',message_id:2}});
 assert.equal(calls.filter(c=>c.method==='screen').length,1);
 assert.match(calls.at(-1).payload.text,/動画/);
});


test('creator home opens sticker/emoji editor through existing sticker handler instead of video wizard',async()=>{
 const states=new Map(),events=[];
 const sessionStore={
  async read(id){return states.get(id)??null;},
  async write(id,revision,next){assert.equal(states.get(id)?.revision??0,revision);states.set(id,next);},
  async setScreen(id,revision,messageId){states.set(id,{...states.get(id),screenMessageId:messageId})}
 };
 const bot=createCreatorBotUpdateHandler({
  api:async(method,params)=>{events.push({method,params});return true;},
  sessionStore,
  screenTransport:{show:async(_,oldId,panel)=>{events.push({method:'screen',panel});return {messageId:oldId||27}}},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
  stickerHandler:async update=>{
   if(update.callback_query?.data==='menu:stickers'){
    events.push({method:'existingStickerEditor',owner:update.callback_query.from.id});
    return {handled:true,screen:'sticker_choose'};
   }
   return {handled:false};
  }
 });
 await bot({message:{chat:{id:33,type:'private'},from:{id:33},message_id:1,text:'/start creator'}});
 assert.equal(events.find(x=>x.method==='screen').panel.reply_markup.inline_keyboard[0][1].callback_data,'menu:stickers');
 const selected=await bot({callback_query:{id:'stk',from:{id:33},data:'menu:stickers',message:{chat:{id:33,type:'private'},message_id:27}}});
 assert.deepEqual(selected,{handled:true,screen:'sticker_choose'});
 assert.equal(events.filter(x=>x.method==='existingStickerEditor').length,1);
 assert.equal(events.filter(x=>x.method==='screen').length,1,'video wizard must not replace sticker screen');
});

test('native field callback works for current owner/revision; stale old links cannot change it',async()=>{
 const states=new Map(),calls=[];
 const api=async(method,params)=>{calls.push({method,params});return {message_id:41};};
 const store={
  async read(id){return states.get(id)??null;},
  async write(id,prev,next){assert.equal(states.get(id)?.revision??0,prev);states.set(id,next);},
  async setScreen(id,rev,msg){states.set(id,{...states.get(id),screenMessageId:msg});}
 };
 const handler=createCreatorBotUpdateHandler({
  api,sessionStore:store,
  screenTransport:{show:async(_,old,panel)=>{calls.push({method:'screen',panel});return {messageId:old||41};}},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null}
 });
 const priv=(id,text,extra={})=>({message:{chat:{id,type:'private'},from:{id},
  message_id:calls.length+101,text,...extra}});
 await handler(priv(33,'/start creator'));
 await handler({callback_query:{id:'select',from:{id:33},data:'menu:listing',
  message:{chat:{id:33,type:'private'},message_id:41}}});
 assert.equal(states.get(33).revision,2);
 const initial=calls.filter(x=>x.method==='screen').at(-1).panel;
 assert.equal(initial.entities,undefined);
 await handler({message:{chat:{id:33,type:'private'},from:{id:33},
  message_id:150,video:{file_id:'video_001'},caption:'作品タイトル'}});
 assert.equal(states.get(33).revision,3);
 assert.equal(states.get(33).screen,'description');
 assert.match(calls.filter(x=>x.method==='screen').at(-1).panel.text,/説明は省略できます/);
 await handler({callback_query:{id:'skip',from:{id:33},data:'entry:skip|r3',
  message:{chat:{id:33,type:'private'},message_id:41}}});
 assert.equal(states.get(33).revision,4);
 const screen=calls.filter(x=>x.method==='screen').at(-1).panel;
 assert.equal(states.get(33).screen,'editor');
 assert.equal(screen.entities,undefined);
 const buttons=screen.reply_markup.inline_keyboard.flat();
 assert.ok(buttons.some(b=>b.callback_data==='edit:description|r4'));
 assert.equal(buttons.filter(b=>/^edit:(title|description|price|thumbnail|sample|paidVideo)\|r/.test(b.callback_data)).length,6);
 assert.ok(buttons.every(b=>!b.url));
 const title=buttons.find(b=>b.callback_data==='edit:title|r4');
 const result=await handler({callback_query:{id:'field',from:{id:33},data:title.callback_data,
  message:{chat:{id:33,type:'private'},message_id:41}}});
 assert.equal(result.handled,true);
 assert.equal(states.get(33).waiting,'title');
 assert.equal(states.get(33).revision,5);
 const stale=await handler(priv(33,'/start ved_price_r4'));
 assert.ok(!stale?.revision || stale?.revision!==6);
 await handler({message:{chat:{id:33,type:'private'},from:{id:33},
  message_id:151,text:'変更後タイトル'}});
 assert.equal(states.get(33).draft.title,'変更後タイトル');
 assert.equal(states.get(33).revision,6);
});

test('invoice offer button enters purchase before sticker start handler, without typed buyer commands',async()=>{
 let stickerCalls=0,invoiceCalls=0;
 const handler=createCreatorBotUpdateHandler({
  api:async()=>true,
  sessionStore:{read:async()=>null,write:async()=>null,setScreen:async()=>null},
  screenTransport:{show:async()=>({messageId:3})},
  listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
  stickerHandler:async()=>{stickerCalls++;return {handled:true,source:'sticker-start'};},
  videoInvoiceHandler:async(update)=>{
   invoiceCalls++;
   assert.equal(update.message.from.id,42);
   return {handled:true,source:'video-invoice'};
  }
 });
 const r=await handler({message:{chat:{id:42,type:'private'},from:{id:42},
   text:'/start vid_sale001_r1',message_id:42}});
 assert.deepEqual(r,{handled:true,source:'video-invoice'});
 assert.equal(invoiceCalls,1);
 assert.equal(stickerCalls,0);
});
