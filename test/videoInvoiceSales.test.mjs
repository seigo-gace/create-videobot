import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoInvoiceSalesFlow} from '../src/telegram/videoInvoiceSales.mjs';
function deps(overrides={}){
 const calls=[],state={status:'prepared',orderId:'vi_'+'a'.repeat(24),priceStars:300,
  title:'動画本編',listingId:'listing1',buyerId:42};
 const store={
  async reserve({buyerId,listingId,revision}){
   assert.equal(buyerId,42);assert.equal(listingId,'listing1');assert.equal(revision,1);
   return {...state};},
  async markSending(){if(state.status!=='prepared')return null;
   state.status='sending';return {...state};},
  async markInvoiceSent(){state.status='sent';},
  async markInvoiceUnknown(){state.status='invoice_unknown';},
  async verifyCheckout({orderId,buyerId,amount}){
   return orderId===state.orderId&&buyerId===42&&amount===300;},
  async capturePayment({orderId,buyerId,payment}){
   assert.equal(orderId,state.orderId);assert.equal(buyerId,42);
   assert.equal(payment.currency,'XTR');state.status='paid';
   return {duplicate:false};},
  async claimDelivery(){if(state.status!=='paid')return null;
   state.status='delivering';return {fileId:'video_existing_file_id',title:'動画本編'};},
  async markDelivered(){state.status='delivered';},
  async markDeliveryUnknown(){state.status='delivery_unknown';}
 };
 const api=async(method,params)=>{
  calls.push({method,params});
  if(method==='sendInvoice')return {message_id:321};
  if(method==='sendVideo')return {message_id:322,chat:{id:42}};
  return true;
 };
 return {calls,state,store,...overrides,api:overrides.api??api};
}
test('sample inline callback produces Telegram XTR invoice bound to buyer',async()=>{
 const d=deps(),flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 const r=await flow.handle({callback_query:{id:'cb01',from:{id:42},data:'vid:buy:listing1:1',message:{chat:{id:-1001}}}});
 assert.equal(r.invoiceSent,true);
 assert.deepEqual(d.calls.map(x=>x.method),['answerCallbackQuery','sendInvoice']);
 assert.equal(d.calls[1].params.currency,'XTR');
 assert.equal(d.calls[1].params.chat_id,42);
 assert.equal(d.calls[1].params.prices[0].amount,300);
 assert.equal(d.calls[1].params.payload,'vid:vi_'+'a'.repeat(24));
});
test('precheckout is approved only for matching authenticated order',async()=>{
 const d=deps(),flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 const good=await flow.handle({pre_checkout_query:{id:'pq1',from:{id:42},
  currency:'XTR',total_amount:300,invoice_payload:'vid:vi_'+'a'.repeat(24)}});
 assert.equal(good.preCheckoutApproved,true);
 const bad=await flow.handle({pre_checkout_query:{id:'pq2',from:{id:42},
  currency:'XTR',total_amount:301,invoice_payload:'vid:vi_'+'a'.repeat(24)}});
 assert.equal(bad.preCheckoutApproved,false);
 assert.deepEqual(d.calls.map(x=>x.params.ok),[true,false]);
});
test('successful payment triggers one protected private video send only after capture',async()=>{
 const d=deps(),flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 const r=await flow.handle({update_id:100,message:{chat:{type:'private',id:42},from:{id:42},
   successful_payment:{invoice_payload:'vid:vi_'+'a'.repeat(24),
     currency:'XTR',total_amount:300,telegram_payment_charge_id:'charge1'}}});
 assert.equal(r.paymentRecorded,true);assert.equal(r.delivered,true);
 assert.equal(d.calls.length,1);assert.equal(d.calls[0].method,'sendVideo');
 assert.equal(d.calls[0].params.video,'video_existing_file_id');
 assert.equal(d.calls[0].params.protect_content,false);
 assert.equal(d.state.status,'delivered');
 const duplicate=await flow.deliver(d.state.orderId,42);
 assert.equal(duplicate.deliveryPending,true);
 assert.equal(d.calls.length,1);
});
test('incomplete/foreign payment identity is rejected without video transfer',async()=>{
 const d=deps(),flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 await assert.rejects(()=>flow.handle({update_id:5,message:{chat:{type:'private',id:99},from:{id:42},
   successful_payment:{invoice_payload:'vid:vi_'+'a'.repeat(24)}}}),/IDENTITY/);
 assert.equal(d.calls.length,0);
});
test('delivery error stays unknown and is not silently resent',async()=>{
 const d=deps({api:async(method)=>{throw Error('timeout: '+method);}}),
  flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 const r=await flow.handle({update_id:101,message:{chat:{type:'private',id:42},from:{id:42},
  successful_payment:{invoice_payload:'vid:vi_'+'a'.repeat(24),
   currency:'XTR',total_amount:300,telegram_payment_charge_id:'charge2'}}});
 assert.equal(r.deliveryUnknown,true);assert.equal(d.state.status,'delivery_unknown');
 assert.equal((await flow.deliver(d.state.orderId,42)).deliveryPending,true);
});
test('unrelated sticker and paid media updates remain separate',async()=>{
 const d=deps(),flow=createVideoInvoiceSalesFlow({api:d.api,store:d.store});
 assert.equal((await flow.handle({pre_checkout_query:{invoice_payload:'stk:so_abc'}})).handled,false);
 assert.equal((await flow.handle({purchased_paid_media:{paid_media_payload:'listing1:1'}})).handled,false);
 assert.equal(d.calls.length,0);
});

test('previous native Stars buyer receives downloaded full video with NO new invoice',async()=>{
 const d=deps(),calls=[];
 d.store.claimLegacyDelivery=async()=>({
   legacy:true,claimed:true,deliveryKey:'reissue241124:1',
   fileId:'old_paid_full_file_id',title:'Purchased full video'
 });
 d.store.markLegacyDelivered=async args=>calls.push({kind:'saved',args});
 d.store.markLegacyUnknown=async()=>{throw Error('unexpected unknown delivery');};
 const flow=createVideoInvoiceSalesFlow({store:d.store,api:async(method,params)=>{
   calls.push({kind:method,params});
   if(method==='sendVideo')return {message_id:8765,chat:{id:42}};
   throw Error('no invoice or other outbound method expected');
 }});
 const r=await flow.purchase(42,'reissue241124',1);
 assert.equal(r.alreadyPurchased,true);
 assert.equal(r.delivered,true);
 assert.deepEqual(calls.map(c=>c.kind),['sendVideo','saved']);
 assert.equal(calls[0].params.protect_content,false);
 assert.equal(calls[0].params.video,'old_paid_full_file_id');
});
test('previously bought video with uncertain delivery never charges again',async()=>{
 const d=deps(),calls=[];
 d.store.claimLegacyDelivery=async()=>({
   legacy:true,claimed:false,deliveryKey:'reissue241124:1'
 });
 const flow=createVideoInvoiceSalesFlow({store:d.store,api:async(method)=>calls.push(method)});
 const r=await flow.purchase(42,'reissue241124',1);
 assert.equal(r.alreadyPurchased,true);
 assert.equal(r.deliveryState,'previous_delivery_recorded');
 assert.equal(calls.length,0);
});
test('new buyer with no legacy purchase still receives an XTR invoice',async()=>{
 const d=deps();
 d.store.claimLegacyDelivery=async()=>({legacy:false});
 const flow=createVideoInvoiceSalesFlow({store:d.store,api:d.api});
 const r=await flow.purchase(42,'listing1',1);
 assert.equal(r.invoiceSent,true);
 assert.deepEqual(d.calls.map(c=>c.method),['sendInvoice']);
});
