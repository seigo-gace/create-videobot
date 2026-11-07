import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoBotScreenTransport} from '../src/telegram/creatorScreenTransport.mjs';

const panel={text:'🎬 動画を投稿\n運営管理費は売上の30％です。',
 reply_markup:{inline_keyboard:[[{text:'↩ 戻る',callback_data:'menu:home'}]]}};
test('shared private DM contract edits one existing Bot-owned screen',async()=>{
 const calls=[],show=createVideoBotScreenTransport(async(method,args)=>{
  calls.push({method,args});return true;
 });
 assert.deepEqual(await show.show(33,101,panel),{messageId:101,replaced:true});
 assert.deepEqual(calls.map(c=>c.method),['editMessageText']);
 assert.equal(calls[0].args.message_id,101);
 assert.equal(calls[0].args.reply_markup.inline_keyboard[0][0].callback_data,'menu:home');
});
test('known edit denial creates one replacement screen and best-effort removes obsolete screen',async()=>{
 const calls=[],show=createVideoBotScreenTransport(async(method)=>{
  calls.push(method);
  if(method==='editMessageText')throw Error('message to edit not found');
  if(method==='sendMessage')return {message_id:202};
  if(method==='deleteMessage')throw Error('not authorized');
 });
 assert.deepEqual(await show.show(33,101,panel),{messageId:202,replaced:false});
 assert.deepEqual(calls,['editMessageText','sendMessage','deleteMessage']);
});
test('Telegram timeout or unknown edit response must not create duplicate DM messages',async()=>{
 const calls=[],show=createVideoBotScreenTransport(async(method)=>{
  calls.push(method);throw Error('network timeout; edit may have been accepted');
 });
 await assert.rejects(()=>show.show(33,101,panel),/WIZARD_EDIT_RESULT_UNKNOWN/);
 assert.deepEqual(calls,['editMessageText']);
});
test('not-modified edit is success and never resends screen',async()=>{
 const calls=[],show=createVideoBotScreenTransport(async(method)=>{
  calls.push(method);throw Error('Bad Request: message is not modified');
 });
 assert.deepEqual(await show.show(33,101,panel),{messageId:101,replaced:true});
 assert.deepEqual(calls,['editMessageText']);
});
test('only private chat and valid original message IDs, no silent fallbacks',async()=>{
 const show=createVideoBotScreenTransport(async()=>({message_id:99}));
 await assert.rejects(()=>show.show(-1009,null,panel),/PRIVATE_WIZARD_CHAT_REQUIRED/);
 await assert.rejects(()=>show.show(33,-1,panel),/PRIVATE_WIZARD_MESSAGE_REQUIRED/);
 await assert.rejects(()=>show.show(33,null,{text:'bad'}),/invalid shared DM screen/);
 assert.throws(()=>createVideoBotScreenTransport(),/verified Telegram/);
});
