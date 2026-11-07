import test from 'node:test';
import assert from 'node:assert/strict';
import {menuPage,parseMenuCallback,handleMenuUpdate} from '../src/telegram/menuPanel.mjs';
test('menu buttons and no slash command UI',()=>{
 const p=menuPage();
 assert.equal(p.reply_markup.inline_keyboard.length,2);
 assert.ok(!p.text.includes('/start'));
 assert.deepEqual(p.reply_markup.inline_keyboard[0][0],{text:'🎬 動画を投稿',callback_data:'menu:listing'});
 assert.deepEqual(p.reply_markup.inline_keyboard[0][1],{text:'📦 マイ動画',callback_data:'menu:manage'});
 assert.deepEqual(p.reply_markup.inline_keyboard[1][0],{text:'⭐ 売上・引き出し',callback_data:'menu:sales'});
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
 assert.throws(()=>parseMenuCallback('admin:erase'));
 assert.throws(()=>menuPage('missing'));
});
