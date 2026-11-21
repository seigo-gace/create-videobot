import test from 'node:test';
import assert from 'node:assert/strict';
import {editStickerPack,replaceStickerItem,verifyStickerPackEditSnapshot} from '../src/stickers/stickerPackManagement.mjs';
const name='s42_1234abcd_by_CreateVdobot';
const record={ownerId:42,name,kind:'regular'};
const start=()=>({name,title:'My pack',sticker_type:'regular',
 stickers:[{file_id:'a1',file_unique_id:'u1',emoji:'🙂'},
           {file_id:'a2',file_unique_id:'u2',emoji:'😀'}]});
function client(){
 let set=start();const mutations=[];
 const api=async(method,p)=>{
  if(method==='getStickerSet')return structuredClone(set);
  mutations.push(method);
  if(method==='setStickerSetTitle')set.title=p.title;
  else if(method==='deleteStickerFromSet')set.stickers=set.stickers.filter(x=>x.file_id!==p.sticker);
  else if(method==='setStickerPositionInSet'){
    const index=set.stickers.findIndex(x=>x.file_id===p.sticker);
    const [item]=set.stickers.splice(index,1);set.stickers.splice(p.position,0,item);
  }else if(method==='setStickerEmojiList'){
    set.stickers.find(x=>x.file_id===p.sticker).emoji=p.emoji_list[0];
  }else throw new Error('unexpected method');
  return true;
 };
 return {api,mutations,set:()=>set};
}
test('pack rename, reorder, emoji and deletion require Telegram readback',async()=>{
 const c=client();
 const base={telegramApi:c.api,owner:42,botUsername:'CreateVdobot',record};
 for(const [action,params] of [
  ['title',{title:'New pack'}],
  ['move_item',{stickerUniqueId:'u2',position:0}],
  ['emoji',{stickerUniqueId:'u2',emoji:'👋'}],
  ['delete_item',{stickerUniqueId:'u1'}]
 ]) {
   const r=await editStickerPack({...base,action,...params});
   assert.equal(r.verified,true);
 }
 assert.deepEqual(c.mutations,[
  'setStickerSetTitle','setStickerPositionInSet','setStickerEmojiList','deleteStickerFromSet'
 ]);
 assert.deepEqual(c.set().stickers.map(x=>x.file_unique_id),['u2']);
 assert.equal(c.set().title,'New pack');
});
test('another owner or unrelated bot cannot edit even with a valid set name',async()=>{
 const c=client();
 await assert.rejects(editStickerPack({telegramApi:c.api,owner:21,
   botUsername:'CreateVdobot',record,action:'title',title:'Bad'}),/OWNER_NOT_VERIFIED/);
 await assert.rejects(editStickerPack({telegramApi:c.api,owner:42,
   botUsername:'DifferentBot',record,action:'title',title:'Bad'}),/NOT_OWNED_BY_BOT/);
 assert.equal(c.mutations.length,0);
});
test('not-owned item is refused without Telegram mutation',async()=>{
 const c=client();
 await assert.rejects(editStickerPack({telegramApi:c.api,owner:42,
   botUsername:'CreateVdobot',record,action:'delete_item',
   stickerUniqueId:'another-pack-item'}),/NOT_IN_PACK/);
 assert.equal(c.mutations.length,0);
});
test('unknown write result preserves ambiguity rather than retrying',async()=>{
 const c=client();let writes=0;
 const api=async(method,p)=>{
  if(method==='getStickerSet')return c.api(method,p);
  writes++;throw new Error('timeout');
 };
 await assert.rejects(editStickerPack({telegramApi:api,owner:42,
   botUsername:'CreateVdobot',record,action:'title',title:'New pack'}),
   /RESULT_UNKNOWN/);
 assert.equal(writes,1);
});

test('replaceStickerInSet uploads first, stores phase receipt, and verifies new content',async()=>{
 let set=start(),phase='start',mutationCount=0;
 const api=async(method,p)=>{
   if(method==='getStickerSet')return structuredClone(set);
   if(method==='uploadStickerFile'){
     assert.equal(phase,'start');
     return {file_id:'file_new',file_unique_id:'unique_new'};
   }
   if(method==='replaceStickerInSet'){
     assert.equal(phase,'submitted');
     mutationCount++;
     assert.equal(p.old_sticker,'a1');
     set.stickers[0]={file_id:'file_new',file_unique_id:'unique_new',emoji:'🙂'};
     return true;
   }
   throw Error('unexpected method');
 };
 const result=await replaceStickerItem({telegramApi:api,owner:42,
   botUsername:'CreateVdobot',record,
   stickerUniqueId:'u1',bytes:new Uint8Array([1,2,3]),format:'static',
   onUploaded:async receipt=>{assert.equal(receipt.fileUniqueId,'unique_new');phase='uploaded';},
   onBeforeMutation:async receipt=>{assert.equal(phase,'uploaded');phase='submitted';}
 });
 assert.equal(result.verified,true);
 assert.equal(mutationCount,1);
 assert.equal(verifyStickerPackEditSnapshot({set,name,kind:'regular',
   action:'replace_item',stickerUniqueId:'u1',newUniqueId:'unique_new'}),true);
});
test('unknown replacement never blindly writes twice',async()=>{
 let mutations=0;
 const api=async method=>{
   if(method==='getStickerSet')return start();
   if(method==='uploadStickerFile')
     return {file_id:'file_new',file_unique_id:'unique_new'};
   if(method==='replaceStickerInSet'){mutations++;throw Error('connection reset');}
   throw Error('unexpected method');
 };
 await assert.rejects(replaceStickerItem({telegramApi:api,owner:42,
   botUsername:'CreateVdobot',record,stickerUniqueId:'u1',
   bytes:new Uint8Array([1]),format:'static',
   onUploaded:async()=>{},onBeforeMutation:async()=>{}
 }),/STICKER_REPLACE_RESULT_UNKNOWN/);
 assert.equal(mutations,1);
});
