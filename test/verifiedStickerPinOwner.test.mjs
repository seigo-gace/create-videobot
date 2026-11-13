import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPinnedStickerReceipt} from '../owner/gateOwner.mjs';
const base={status:'pinned_ack',bot_id:901,chat_id:-1002373696859,
 thread_id:4640,message_id:5012,link:'https://t.me/CreateVdobot?start=sticker'};
const me={id:901,username:'CreateVdobot',is_bot:true};
test('adopt existing, exact CreateVdobot 4640 pinned ACK without recreating Topic',()=>{
 const route=verifyPinnedStickerReceipt(base,me);
 assert.deepEqual({chatId:route.chatId,threadId:route.threadId,
  purpose:route.purpose,verified:route.verified},
  {chatId:-1002373696859,threadId:4640,purpose:'sticker',verified:true});
});
test('reject altered Topic, Bot, link, unknown status and missing message receipt',()=>{
 for(const different of [
  {...base,status:'sending'},
  {...base,chat_id:-1002373696860},
  {...base,thread_id:4291},
  {...base,bot_id:902},
  {...base,message_id:null},
  {...base,link:'https://t.me/CreateVdobot?start=other'}
 ])assert.throws(()=>verifyPinnedStickerReceipt(different,me),/VERIFIED_PIN_RECEIPT_REQUIRED/);
 assert.throws(()=>verifyPinnedStickerReceipt(base,{...me,id:902}),/VERIFIED_PIN_RECEIPT_REQUIRED/);
});
