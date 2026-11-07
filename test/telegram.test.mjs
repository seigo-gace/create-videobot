import test from 'node:test';
import assert from 'node:assert/strict';
import {beginSale,transitionSale,finalizeDraft} from '../src/telegram/salesFlow.mjs';
import {buildPaidMediaRequest,sendPaidVideo} from '../src/telegram/paidMedia.mjs';
test('stepwise paid video draft',()=>{let d=beginSale('creator_01'); d=transitionSale(d,{type:'media',fileId:'file_001'});d=transitionSale(d,{type:'price',stars:80});d=transitionSale(d,{type:'confirm_rights',rightsVerified:true,adultConsentVerified:true});assert.equal(finalizeDraft(d).priceStars,80);});
test('cannot bypass consent and price validation',()=>{const d=beginSale('creator_01');assert.throws(()=>finalizeDraft(d));assert.throws(()=>transitionSale(d,{type:'price',stars:2}));});
test('paid media uses exact Stars and sends no file content',()=>{assert.deepEqual(buildPaidMediaRequest({chatId:12345,mediaFileId:'file_001',priceStars:80}),{chat_id:12345,star_count:80,media:[{type:'video',media:'file_001'}]});});
test('paid media payload is revision-tagged and prevents zero-payload purchases',()=>{
 const p=buildPaidMediaRequest({chatId:-100123,mediaFileId:'file_001',priceStars:80,payload:'listing1:2'});
 assert.equal(p.payload,'listing1:2');
 assert.throws(()=>buildPaidMediaRequest({chatId:1,mediaFileId:'file_001',priceStars:1,payload:'unsafe\\nvalue'}),/payload/);
 assert.throws(()=>buildPaidMediaRequest({chatId:1,mediaFileId:'file_001',priceStars:1,payload:'listing1:0'}),/payload/);
});
test('deny unauthorized Telegram media send',async()=>{let called=false;const telegramApi=async()=>{called=true};await assert.rejects(()=>sendPaidVideo({telegramApi,gateVerified:false,approved:true,params:{chatId:12345,mediaFileId:'file_001',priceStars:80}}));assert.equal(called,false);});
test('authorized mock send uses selected Bot API method',async()=>{let method;const result=await sendPaidVideo({telegramApi:async(m,p)=>{method=m;return {message_id:7}},gateVerified:true,approved:true,params:{chatId:12345,mediaFileId:'file_001',priceStars:80}});assert.equal(method,'sendPaidMedia');assert.equal(result.message_id,7);});

test('paid media topic routing and exact Telegram limits',()=>{
 const p=buildPaidMediaRequest({chatId:-1001234567890,mediaFileId:'file_001',priceStars:25000,messageThreadId:123});
 assert.equal(p.message_thread_id,123);
 assert.equal(p.star_count,25000);
 assert.throws(()=>buildPaidMediaRequest({chatId:1,mediaFileId:'file_001',priceStars:25001}));
 assert.throws(()=>buildPaidMediaRequest({chatId:1,mediaFileId:'file_001',priceStars:1,messageThreadId:-1}));
});
