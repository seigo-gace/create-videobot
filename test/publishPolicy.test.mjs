import test from 'node:test';
import assert from 'node:assert/strict';
import {publishWithGate} from '../src/telegram/publishPolicy.mjs';
const args={sellerId:'seller1',listingId:'listing1',targetChatId:-1001234567890,messageThreadId:5,mediaFileId:'file_001',priceStars:250};
test('denied GATE cannot publish',async()=>{
 let called=false;
 await assert.rejects(()=>publishWithGate({...args,verifyGate:async()=>false,verifyReview:async()=>true,telegramApi:async()=>{called=true}}));
 assert.equal(called,false);
});
test('unapproved listing cannot publish',async()=>{
 let called=false;
 await assert.rejects(()=>publishWithGate({...args,verifyGate:async()=>true,verifyReview:async()=>false,telegramApi:async()=>{called=true}}));
 assert.equal(called,false);
});
test('verified approved listing posts to topic',async()=>{
 let params;
 const r=await publishWithGate({...args,verifyGate:async()=>true,verifyReview:async()=>true,telegramApi:async(method,p)=>{assert.equal(method,'sendPaidMedia');params=p;return {message_id:77}}});
 assert.equal(params.message_thread_id,5);
 assert.deepEqual(r,{posted:true,messageId:77});
});
test('caller cannot replace trusted verification dependencies with booleans',async()=>{
 await assert.rejects(()=>publishWithGate({...args,gateVerified:true,approved:true,telegramApi:async()=>({message_id:7})}));
});
