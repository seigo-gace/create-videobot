import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerPaidPhotoFlow} from '../src/telegram/stickerPaidPhotoFlow.mjs';
const productId='sp_'+'a'.repeat(24);
test('paid PHOTO purchase of stickers creates claimable rights, never an invoice',async()=>{
 const state=new Map(),calls=[];
 let hasEntitlement=false;
 const rows=[{item_index:0,status:'pending'},{item_index:1,status:'pending'}];
 const store={
  async hasTopicPublication(){return true;},
  async capturePurchase(update){
   assert.equal(update.purchased_paid_media.paid_media_payload,'stkmedia_'+productId);
   hasEntitlement=true;return {recorded:true,duplicate:false,productId,saleId:1};
  },
  async getEntitlement({buyerId,productId:id}){
   assert.equal(buyerId,81);assert.equal(id,productId);
   return hasEntitlement?{sale_id:1,product_id:id}:null;
  },
  async getSale({buyerId,saleId}){
   assert.equal(buyerId,81);assert.equal(saleId,1);
   return {sale_id:1,product_id:productId,title:'Sticker',version:1,
     items:[{file_id:'sticker_file_1'},{file_id:'sticker_file_2'}]};
  },
  async deliveryRows(){return rows.map(x=>({...x}));},
  async claimItem({buyerId,index}){
   assert.equal(buyerId,81);
   if(rows[index].status!=='pending')return null;
   rows[index].status='sending';return {file_id:'sticker_file_'+(index+1)};
  },
  async itemSent({index}){rows[index].status='sent';},
  async itemUnknown({index}){rows[index].status='unknown';},
  async redeliver(){for(const row of rows)row.status='pending';return {attempt:2};},
  async listPurchases(){return hasEntitlement?[{order_id:'paidphoto:1',paid_photo:true,title:'Sticker',version:1}]:[];}
 };
 const api=async(method,args)=>{
  calls.push({method,args});
  if(method==='sendSticker')return {message_id:700+calls.length};
  throw Error('UNEXPECTED_BILLING_OR_OTHER_METHOD');
 };
 const flow=createStickerPaidPhotoFlow({api,paidPhotoStore:store,
  sessionStore:{read:async user=>state.get(user)??{revision:1,screen:'home'}},
  show:async(user,old,patch)=>{state.set(user,{...old,...patch});return {handled:true};}});
 await flow.claim(81,productId);
 assert.equal(state.get(81).screen,'sticker_sale_paid_unpaid');
 assert.equal(calls.length,0);
 const verified=await flow.purchased({update_id:901,
  purchased_paid_media:{paid_media_payload:'stkmedia_'+productId,from:{id:81}}});
 assert.equal(verified.purchaseRecorded,true);
 await flow.claim(81,productId);
 assert.equal(state.get(81).screen,'sticker_sale_paid_delivery');
 assert.equal(calls.filter(x=>x.method==='sendSticker').length,2);
 const d=state.get(81).stickerSale;
 await flow.callback({action:'sale:paid_next',userId:81,old:state.get(81),d});
 assert.equal(calls.filter(x=>x.method==='sendSticker').length,2);
 await flow.callback({action:'sale:paid_redeliver',userId:81,old:state.get(81),d});
 assert.equal(calls.filter(x=>x.method==='sendSticker').length,4);
 assert.equal(calls.some(x=>x.method==='sendInvoice'||x.method==='sendPaidMedia'),false);
});
