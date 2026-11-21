import test from 'node:test';
import assert from 'node:assert/strict';
import {menuPage,parseMenuCallback,handleMenuUpdate} from '../src/telegram/menuPanel.mjs';
test('shared creator home selects existing video and sticker/emoji menus',()=>{
 const p=menuPage();
 assert.equal(p.reply_markup.inline_keyboard.length,2);
 assert.deepEqual(p.reply_markup.inline_keyboard[0],[
  {text:'🎬 動画',callback_data:'menu:video'},
  {text:'🎨 ステッカー／絵文字',callback_data:'menu:stickers'}
 ]);
 assert.ok(!p.text.includes('/start'));
 assert.match(p.text,/Telegram Stars/);
 assert.equal(p.text.includes('30%'),false,'fee explanation belongs to terms');
 assert.deepEqual(p.reply_markup.inline_keyboard[1],[
  {text:'🔙 戻る',url:'https://t.me/c/2373696859/1613'},
  {text:'⭐ 売上・引き出し',callback_data:'menu:sales'},
  {text:'⭐ 購入',callback_data:'menu:purchase'}
 ]);
 assert.match(p.text,/売上・履歴/);
 assert.match(p.text,/購入先（Telegram／Fragment）/);
 const purchase=menuPage('purchase');
 assert.deepEqual(purchase.reply_markup.inline_keyboard,[
  [{text:'🔗 Telegramで購入',url:'https://t.me/PremiumBot'},
   {text:'🔗 Fragmentで購入',url:'https://fragment.com/stars'}],
  [{text:'🔙 戻る',callback_data:'menu:home'}]
 ]);
 assert.match(purchase.text,/各サービスの画面/);
 const video=menuPage('video');
 assert.deepEqual(video.reply_markup.inline_keyboard[0][0],{text:'🎬 動画を投稿',callback_data:'menu:listing'});
});
test('private start opens menu but public group start is ignored',async()=>{
 const calls=[];const api=async(method,body)=>{calls.push({method,body});return {message_id:4}};
 await handleMenuUpdate({api,update:{message:{chat:{id:33,type:'private'},text:'/start'}}});
 assert.equal(calls[0].method,'sendMessage');
 const r=await handleMenuUpdate({api,update:{message:{chat:{id:-33,type:'supergroup'},text:'/start'}}});
 assert.deepEqual(r,{handled:false});assert.equal(calls.length,1);
});
test('owner callback is acknowledged and edits existing panel',async()=>{
 const calls=[];const api=async(method,body)=>{calls.push({method,body});return true};
 await handleMenuUpdate({api,update:{callback_query:{id:'q1',from:{id:33},data:'menu:sales',message:{chat:{id:33,type:'private'},message_id:8}}}});
 assert.deepEqual(calls.map(x=>x.method),['answerCallbackQuery','editMessageText']);
 assert.equal(calls[1].body.message_id,8);
});
test('other-user callback cannot mutate panel',async()=>{
 let called=false;
 await assert.rejects(()=>handleMenuUpdate({api:async()=>{called=true},update:{callback_query:{id:'q1',from:{id:90},data:'menu:manage',message:{chat:{id:33,type:'private'},message_id:8}}}}));
 assert.equal(called,false);
});
test('action ids and menu pages have fixed allowlist',()=>{
 assert.equal(parseMenuCallback('menu:home'),'home');
 assert.equal(parseMenuCallback('menu:purchase'),'purchase');
 assert.throws(()=>parseMenuCallback('admin:erase'));
 assert.throws(()=>menuPage('missing'));
});
