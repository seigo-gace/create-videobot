import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePaidMediaPurchase,applyVerifiedCharge,reconcilePaidMediaPurchase} from '../src/sales/telegramPurchase.mjs';
import {verifyTelegramWebhookHeader,validateTelegramUpdateSize} from '../src/telegram/webhookAdmission.mjs';
const update={update_id:42,purchased_paid_media:{from:{id:12345},paid_media_payload:'listing-ref'}};
test('purchase notification is not automatically counted as settled revenue',()=>{
 const r=parsePaidMediaPurchase(update,p=>p==='listing-ref'?{id:'listing-01',priceStars:80}:null);
 assert.equal(r.confirmedPayment,false);
 assert.equal(r.expectedStars,80);
});
test('unknown paid-media payload is rejected',()=>assert.throws(()=>parsePaidMediaPurchase(update,()=>null)));
test('only verified charge events enter ledger',()=>{
 const state={events:[],entries:[]};
 assert.throws(()=>applyVerifiedCharge(state,{eventId:'event_0001',kind:'paid',listingId:'listing1',chargeId:'charge_0001',stars:80}));
 const result=applyVerifiedCharge(state,{verifiedByTelegram:true,eventId:'event_0001',kind:'paid',listingId:'listing1',chargeId:'charge_0001',stars:80});
 assert.equal(result.state.entries[0].stars,80);
});
test('webhook secret checked before parsing',()=>{
 assert.equal(verifyTelegramWebhookHeader('a'.repeat(25),'a'.repeat(25)),true);
 assert.throws(()=>verifyTelegramWebhookHeader('b'.repeat(25),'a'.repeat(25)));
 assert.throws(()=>verifyTelegramWebhookHeader('a','a'.repeat(25)));
});
test('malformed or excessive update body rejected',()=>{
 assert.equal(validateTelegramUpdateSize(Buffer.from(JSON.stringify(update))).update_id,42);
 assert.throws(()=>validateTelegramUpdateSize(Buffer.from('nonsense')));
 assert.throws(()=>validateTelegramUpdateSize(Buffer.alloc(262145)));
});

const purchaseIntent=()=>parsePaidMediaPurchase(update,()=>{
 return {id:'listing-01',priceStars:80};
});
function paidTransaction(overrides={}) {
 return {id:'official-transaction-0001',amount:80,
  source:{type:'user',transaction_type:'paid_media_payment',
   user:{id:12345},paid_media_payload:'listing-ref'},...overrides};
}
test('versioned paid-media notification preserves buyer/payload but is not charge evidence',()=>{
 const intent=purchaseIntent();
 assert.equal(intent.payload,'listing-ref');
 assert.equal(intent.buyerId,12345);
 assert.equal(intent.confirmedPayment,false);
 assert.throws(()=>parsePaidMediaPurchase({...update,purchased_paid_media:{paid_media_payload:'listing-ref'}},()=>({id:'a',priceStars:80})),/buyer missing/);
});
test('real Telegram transaction response is needed to credit the existing ledger',async()=>{
 const request=[];
 const api=async(method,params)=>{
  request.push({method,params});
  return {transactions:[paidTransaction()]};
 };
 const verified=await reconcilePaidMediaPurchase({purchase:purchaseIntent(),telegramApi:api});
 assert.deepEqual(request,[{method:'getStarTransactions',params:{offset:0,limit:100}}]);
 assert.equal(verified.verifiedByTelegram,true);
 assert.equal(verified.kind,'paid');
 assert.equal(verified.stars,80);
 assert.equal(verified.listingId,'listing-01');
 assert.ok(verified.eventId.startsWith('paid_'));
 assert.ok(verified.chargeId.startsWith('charge_'));
 const {state,applied}=applyVerifiedCharge({events:[],entries:[]},verified);
 assert.equal(applied,true);
 assert.equal(state.entries[0].stars,80);
 assert.equal(applyVerifiedCharge(state,verified).applied,false);
});
test('wrong price/user/payload, unknown and ambiguous charge cannot be credited',async()=>{
 for(const tx of [
  paidTransaction({amount:70}),
  paidTransaction({source:{...paidTransaction().source,user:{id:99999}}}),
  paidTransaction({source:{...paidTransaction().source,paid_media_payload:'another'}}),
 ]) {
  await assert.rejects(()=>reconcilePaidMediaPurchase({
   purchase:purchaseIntent(),telegramApi:async()=>({transactions:[tx]})
  }),/mismatch|unverified/);
 }
 await assert.rejects(()=>reconcilePaidMediaPurchase({
  purchase:purchaseIntent(),telegramApi:async()=>({transactions:[]})
 }),/unverified/);
 await assert.rejects(()=>reconcilePaidMediaPurchase({
  purchase:purchaseIntent(),telegramApi:async()=>({transactions:[paidTransaction(),paidTransaction({id:'another-transaction-id'})]})
 }),/ambiguous/);
});
test('refund and wrong Telegram response shape fail closed',async()=>{
 await assert.rejects(()=>reconcilePaidMediaPurchase({
  purchase:purchaseIntent(),telegramApi:async()=>({transactions:[
   paidTransaction(),{id:'official-transaction-0001',amount:-80,receiver:{type:'user',user:{id:12345}}}
  ]})
 }),/refund/);
 await assert.rejects(()=>reconcilePaidMediaPurchase({
  purchase:purchaseIntent(),telegramApi:async()=>({})
 }),/unavailable/);
});
