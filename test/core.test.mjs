import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantProviderStatus, resolveAssistantProvider } from '../src/assistant/config.mjs';
import { applySalesEvent, starsNetForListing } from '../src/sales/ledger.mjs';
import { validatePaidVideoDraft } from '../src/sales/listing.mjs';
test('Assistant AI keys are separated from VideoBot and do not leak in status',()=>{
 const env={ASSISTANT_AI_GROQ_API_KEY:'very-private-value'};
 assert.deepEqual(assistantProviderStatus(env),{groq:{configured:true},gemini:{configured:false},openrouter:{configured:false}});
 assert.equal(resolveAssistantProvider('groq',env).provider,'groq');
 assert.ok(!JSON.stringify(assistantProviderStatus(env)).includes('very-private-value'));
 assert.throws(()=>resolveAssistantProvider('openrouter',env));
});
test('reject unverified media',()=>assert.throws(()=>validatePaidVideoDraft({sellerId:'seller',priceStars:50,telegramMedia:[{fileId:'file'}]})));
test('valid verified media stays pending',()=>{
 const d=validatePaidVideoDraft({sellerId:'seller',adultConsentVerified:true,rightsVerified:true,priceStars:50,telegramMedia:[{fileId:'file'}]});
 assert.equal(d.review,'pending');
});
test('sale, dedupe and refund reconcile without 100x currency scaling',()=>{
 let state={events:[],entries:[]};
 let result=applySalesEvent(state,{id:'event_0001',kind:'paid',listingId:'video1',chargeId:'charge_0001',stars:40});
 state=result.state;assert.equal(starsNetForListing(state,'video1'),40);
 result=applySalesEvent(state,{id:'event_0001',kind:'paid',listingId:'video1',chargeId:'charge_0001',stars:40});
 assert.equal(result.applied,false);
 state=applySalesEvent(state,{id:'event_0002',kind:'refunded',listingId:'video1',chargeId:'charge_0001',stars:40}).state;
 assert.equal(starsNetForListing(state,'video1'),0);
 assert.throws(()=>applySalesEvent(state,{id:'event_0003',kind:'refunded',listingId:'video1',chargeId:'charge_0001',stars:40}));
});
test('reject unsupported events and negative amounts',()=>{
 assert.throws(()=>applySalesEvent({events:[],entries:[]},{id:'event_0001',kind:'withdraw',listingId:'v',stars:2}));
 assert.throws(()=>applySalesEvent({events:[],entries:[]},{id:'event_0001',kind:'paid',listingId:'v',chargeId:'charge_0001',stars:-2}));
});
