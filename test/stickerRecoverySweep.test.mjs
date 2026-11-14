import test from 'node:test';
import assert from 'node:assert/strict';
import {sweepStickerRegistrations} from '../src/runtime/creatorPollingMain.mjs';

test('recovery scans owners in bounded pages and wraps at the end',async()=>{
 const owners=[8,14,42],calls=[];
 const source={
  sessionStore:{async listPendingStickerRegistrations({afterOwnerId,limit}){
   assert.equal(limit,2);
   return owners.filter(x=>x>afterOwnerId).slice(0,limit)
     .map(ownerId=>({ownerId}));
  }},
  stickerWizard:{async recoverPending(ownerId){
   calls.push(ownerId);
   return {status:ownerId===14?'retry_readback':'registered'};
  }}
 };
 let cursor=0;
 const a=await sweepStickerRegistrations({source,afterOwnerId:cursor,limit:2});
 assert.deepEqual([a.afterOwnerId,a.processed,a.recovered],[14,2,1]);
 cursor=a.afterOwnerId;
 const b=await sweepStickerRegistrations({source,afterOwnerId:cursor,limit:2});
 assert.deepEqual([b.afterOwnerId,b.processed,b.recovered],[42,1,1]);
 const end=await sweepStickerRegistrations({source,afterOwnerId:b.afterOwnerId,limit:2});
 assert.deepEqual([end.afterOwnerId,end.processed],[0,0]);
 await sweepStickerRegistrations({source,afterOwnerId:end.afterOwnerId,limit:2});
 assert.deepEqual(calls,[8,14,42,8,14]);
});

test('recovery isolates per-owner failures without interrupting the poller',async()=>{
 const source={
  sessionStore:{listPendingStickerRegistrations:async()=>[
   {ownerId:1},{ownerId:2},{ownerId:3}]},
  stickerWizard:{recoverPending:async id=>{
   if(id===2)throw Error('transient connection');
   return {status:'registered'};
  }}
 };
 const result=await sweepStickerRegistrations({source});
 assert.equal(result.processed,3);
 assert.equal(result.recovered,2);
 assert.equal(result.afterOwnerId,3);
});

test('incompatible old source does not spawn worker or stop poller',async()=>{
 assert.deepEqual(await sweepStickerRegistrations({source:{}}),
  {afterOwnerId:0,processed:0,unavailable:true});
});
