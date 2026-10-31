import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePaidMediaPurchase,applyVerifiedCharge} from '../src/sales/telegramPurchase.mjs';
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
