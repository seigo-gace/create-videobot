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

test('photo-backed prior DM cannot be edited as text: send replacement sticker menu',async()=>{
 for(const rejection of ['Bad Request: there is no text in the message to edit','Bad Request: message is not a text message']){
  const calls=[];
  const transport=createVideoBotScreenTransport(async(method,args)=>{
   calls.push({method,args});
   if(method==='editMessageText')throw Error(rejection);
   if(method==='sendMessage')return {message_id:303};
   if(method==='deleteMessage')return true;
  });
  assert.deepEqual(await transport.show(33,101,panel),{messageId:303,replaced:false});
  assert.deepEqual(calls.map(call=>call.method),['editMessageText','sendMessage','deleteMessage']);
 }
});

test('registered-field [編集] text links pass through Telegram entities on the existing DM message',async()=>{
 const calls=[];
 const show=createVideoBotScreenTransport(async(method,args)=>{calls.push({method,args});return true;});
 const body='［編集］ 📝 タイトル：登録済み';
 const withLink={text:body,
  entities:[{type:'text_link',offset:0,length:4,url:'https://t.me/CreateVdobot?start=ved_title_r3'}],
  reply_markup:{inline_keyboard:[[{text:'👁 プレビュー',callback_data:'edit:preview|r3'}]]}};
 await show.show(33,101,withLink);
 assert.deepEqual(calls[0].args.entities,withLink.entities);
 assert.equal(calls[0].args.text.slice(0,4),'［編集］');
 assert.equal(calls[0].args.reply_markup.inline_keyboard[0][0].text,'👁 プレビュー');
 await assert.rejects(()=>show.show(33,101,{...withLink,
  entities:[{type:'text_link',offset:0,length:4,url:'https://evil.example/start'}]}),/invalid creator text links/);
});

test('attach editable title/description/keyboard to last video of private album',async()=>{
 const calls=[],transport=createVideoBotScreenTransport(async(method,args)=>{
   calls.push({method,args});return true;
 });
 const editor={...panel,albumMessageId:311,
   entities:[{type:'text_link',offset:0,length:2,
     url:'https://t.me/CreateVdobot?start=ved_title_r2'}]};
 const result=await transport.show(33,101,editor);
 assert.deepEqual(result,{messageId:311,replaced:false,album:true});
 assert.deepEqual(calls.map(c=>c.method),['editMessageCaption','deleteMessage']);
 assert.equal(calls[0].args.message_id,311);
 assert.equal(calls[0].args.caption,panel.text);
 assert.deepEqual(calls[0].args.caption_entities,editor.entities);
 assert.equal(calls[0].args.reply_markup,editor.reply_markup);
});
test('definitive album-caption refusal falls back to one normal text editor',async()=>{
 const calls=[],transport=createVideoBotScreenTransport(async(method,args)=>{
   calls.push(method);
   if(method==='editMessageCaption'||method==='editMessageText')throw Error('message cannot be edited');
   if(method==='sendMessage')return {message_id:403};
   return true;
 });
 const result=await transport.show(33,101,{...panel,albumMessageId:311});
 assert.equal(result.messageId,403);
 assert.deepEqual(calls,['editMessageCaption','editMessageText','sendMessage','deleteMessage']);
});
test('ambiguous Telegram caption response never sends a second editor',async()=>{
 const calls=[],transport=createVideoBotScreenTransport(async(method)=>{
   calls.push(method);throw Error('network timeout');
 });
 await assert.rejects(()=>transport.show(33,101,{...panel,albumMessageId:311}),
   /WIZARD_ALBUM_EDIT_RESULT_UNKNOWN/);
 assert.deepEqual(calls,['editMessageCaption']);
});

test('single media field uses actual registered photo and never edits or removes owning album',async()=>{
 const calls=[];
 const api=async(method,params)=>{
   calls.push({method,params});
   if(method==='sendPhoto')return {message_id:220};
   return true;
 };
 const transport=createVideoBotScreenTransport(api);
 const panel={text:'🖼 サムネ：登録済み\n──────────\n画像を変更する場合は送信してください。',
   mediaPreview:{type:'photo',fileId:'thumb_existing'},
   reply_markup:{inline_keyboard:[[{text:'🔙 戻る',callback_data:'edit:back|r2'}]]}};
 const result=await transport.show(33,null,panel);
 assert.equal(result.messageId,220);
 assert.equal(calls[0].method,'sendPhoto');
 assert.equal(calls[0].params.photo,'thumb_existing');
 assert.equal(calls.some(x=>x.method==='deleteMessage'),false);
 assert.equal(calls.some(x=>x.method==='editMessageCaption'),false);
});

test('not-modified album caption is confirmed without resending or deleting the album',async()=>{
 for(const previous of [311,101,null]){
  const calls=[];
  const transport=createVideoBotScreenTransport(async(method,args)=>{
   calls.push({method,args});
   if(method==='editMessageCaption')throw Error('Bad Request: message is not modified');
   return true;
  });
  assert.deepEqual(await transport.show(33,previous,{...panel,albumMessageId:311}),
    {messageId:311,replaced:previous===311,album:true});
  assert.deepEqual(calls.map(c=>c.method),previous===101?
    ['editMessageCaption','deleteMessage']:['editMessageCaption']);
  if(previous===101)assert.equal(calls[1].args.message_id,101);
 }
});
