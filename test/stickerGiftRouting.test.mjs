import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorBotUpdateHandler} from '../src/telegram/creatorBot.mjs';

function router({stickerHandler,stickerSalesHandler}){
 return createCreatorBotUpdateHandler({
   api:async()=>true,
   sessionStore:{read:async()=>null,write:async()=>null,setScreen:async()=>null},
   listingStore:{listByOwner:async()=>[],getOwned:async()=>null},
   screenTransport:{show:async()=>({messageId:1})},
   stickerHandler,stickerSalesHandler
 });
}
function update(text){
 return {update_id:99,message:{message_id:5,text,chat:{id:80,type:'private'},from:{id:80}}};
}
test('one-time gift deep-link reaches sales before dormant sticker media wizard',async()=>{
 const calls=[];
 const handle=router({
   stickerHandler:async()=>{calls.push('sticker');return {handled:true,screen:'sticker_input'};},
   stickerSalesHandler:async()=>{calls.push('gift');return {handled:true,screen:'gift_redeem'};}
 });
 const r=await handle(update('/start gift_'+'R'.repeat(32)));
 assert.equal(r.screen,'gift_redeem');
 assert.deepEqual(calls,['gift']);
});
test('existing pinned sticker deep-link stays owned by original sticker wizard',async()=>{
 const calls=[];
 const handle=router({
   stickerHandler:async()=>{calls.push('sticker');return {handled:true,screen:'sticker_choose'};},
   stickerSalesHandler:async()=>{calls.push('sale');return {handled:true};}
 });
 const r=await handle(update('/start sticker'));
 assert.equal(r.screen,'sticker_choose');
 assert.deepEqual(calls,['sticker']);
});
