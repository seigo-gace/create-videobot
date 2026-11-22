import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresPostingReceiptStore } from '../src/sales/pgPostingReceipts.mjs';
import { publishVideoListing } from '../src/telegram/paidListingPublisher.mjs';

function fakeDb(){
  const entries=new Map(),queries=[];
  return {
    entries,queries,
    async query(sql,params){
      queries.push({sql,params});
      const k=params[0];
      if(sql.startsWith('INSERT INTO videobot_post_receipts')){
        if(entries.has(k))return {rowCount:0,rows:[]};
        entries.set(k,{status:'sending',free_message_ids:null,paid_message_id:null});
        return {rowCount:1,rows:[{delivery_key:k}]};
      }
      if(sql.startsWith('SELECT delivery_key,status FROM videobot_post_receipts')) {
        const other=[...entries.entries()].find(([key,row])=>
          key.startsWith(params[0]+':') && key!==params[1] &&
          ['sending','sent','needs_reconcile'].includes(row.status));
        return {rowCount:other?1:0,rows:other?[{delivery_key:other[0],status:other[1].status}]:[]};
      }
      if(sql.startsWith('SELECT status,free_message_ids')){
        const row=entries.get(k);
        return {rowCount:row?1:0,rows:row?[{...row}]:[]};
      }
      const row=entries.get(k);
      if(sql.includes('SET free_message_ids=')){
        if(!row||row.status!=='sending'||row.free_message_ids)return {rowCount:0,rows:[]};
        row.free_message_ids=params[1];return {rowCount:1,rows:[{delivery_key:k}]};
      }
      if(sql.includes("SET paid_message_id=")){
        if(!row||row.status!=='sending'||!row.free_message_ids||row.paid_message_id)return {rowCount:0,rows:[]};
        row.paid_message_id=params[1];row.status='sent';return {rowCount:1,rows:[{delivery_key:k}]};
      }
      if(sql.includes("SET status='needs_reconcile'")){
        if(row?.status==='sending')row.status='needs_reconcile';
        return {rowCount:row?1:0,rows:[]};
      }
      throw new Error('unknown SQL');
    }
  };
}
test('claim/ack are atomic conditional SQL operations, cannot overwrite two messages',async()=>{
  const db=fakeDb(),store=createPostgresPostingReceiptStore(db);
  assert.deepEqual(await store.claim({key:'list1:1',listingId:'list1',revision:1,topicId:3}),{claimed:true});
  assert.deepEqual(await store.claim({key:'list1:1',listingId:'list1',revision:1,topicId:3}),{claimed:false});
  await store.recordFree('list1:1',[21,22]);
  await assert.rejects(()=>store.recordFree('list1:1',[31,32]),/STALE/);
  await store.recordPaid('list1:1',33);
  await assert.rejects(()=>store.recordPaid('list1:1',34),/STALE/);
  await store.markUnknown('list1:1');
  assert.deepEqual(await store.read('list1:1'),{status:'sent',freeMessageIds:[21,22],paidMessageId:33});
  assert.ok(db.queries.some(q=>q.sql.includes('ON CONFLICT (delivery_key) DO NOTHING')));
  assert.ok(db.queries.some(q=>q.sql.includes('status=\'sending\' AND free_message_ids IS NULL')));
});
test('PostgreSQL bigint[] text IDs are normalized without losing exact message identities',async()=>{
  const db=fakeDb(),store=createPostgresPostingReceiptStore(db);
  await store.claim({key:'list2:1',listingId:'list2',revision:1,topicId:1695});
  await store.recordFree('list2:1',[4689,4690]);
  await store.recordPaid('list2:1',4691);
  db.entries.get('list2:1').free_message_ids=['4689','4690'];
  db.entries.get('list2:1').paid_message_id='4691';
  assert.deepEqual(await store.read('list2:1'),{
    status:'sent',freeMessageIds:[4689,4690],paidMessageId:4691
  });
  db.entries.get('list2:1').free_message_ids=['9007199254740993','4690'];
  await assert.rejects(()=>store.read('list2:1'),/PERSISTED_FREE_MESSAGE_ID_INVALID/);
});
test('domain paid sale path reuses existing builders and private receipt store, not shared MPB',async()=>{
  const db=fakeDb(),store=createPostgresPostingReceiptStore(db);
  const calls=[];
  const dependencies={
    listing:{id:'list1',sellerId:'user1',revision:1,title:'Movie',priceStars:50,
      thumbnail:{fileId:'photo001'},sample:{fileId:'sample001',durationSeconds:30},paidVideo:{fileId:'main001'},
      rightsVerified:true,adultConsentVerified:true,ownerConfirmedPublish:true,feeTermsAccepted:true,managementFeeBps:3000},
    getVerifiedVideoTopic:async()=>({id:3,chatId:-100333,threadId:22,
      purpose:'video_sale',board:'video_chat',verified:true,enabled:true,title:'Sale'}),
    verifyMembership:async()=>true,verifyReview:async()=>true,verifyRelease:async()=>true,store,
    telegramApi:async(method)=>{
      calls.push(method);
      return method==='sendMediaGroup'?[{message_id:71,media_group_id:'album_db'},{message_id:72,media_group_id:'album_db'}]:{message_id:73,chat:{id:-100333},message_thread_id:22,paid_media:{star_count:50,paid_media:[{type:'preview'}]}};
    }
  };
  const first=await publishVideoListing(dependencies);
  const repeated=await publishVideoListing(dependencies);
  assert.equal(first.posted,true);
  assert.equal(repeated.alreadySent,true);
  assert.deepEqual(calls,['sendMediaGroup','sendPaidMedia']);
  assert.deepEqual((await store.read('list1:1')).freeMessageIds,[71,72]);
});
test('database adapter rejects invalid ids and refuses stale paid acknowledgment',async()=>{
  const store=createPostgresPostingReceiptStore(fakeDb());
  await assert.rejects(()=>store.claim({key:'../:1',listingId:'foo',revision:1,topicId:1}),/invalid/);
  await assert.rejects(()=>store.recordPaid('a:1',4),/STALE/);
  await assert.rejects(()=>store.recordFree('a:1',[1,1]),/distinct/);
  assert.throws(()=>createPostgresPostingReceiptStore(),/pool required/);
});

test('same product another published version is detected by the existing receipt store',async()=>{
 const db=fakeDb(),store=createPostgresPostingReceiptStore(db);
 assert.equal(await store.findOtherDelivery({listingId:'list1',key:'list1:2'}),null);
 await store.claim({key:'list1:1',listingId:'list1',revision:1,topicId:3});
 await store.recordFree('list1:1',[41,42]);
 await store.recordPaid('list1:1',43);
 assert.deepEqual(await store.findOtherDelivery({listingId:'list1',key:'list1:2'}),{key:'list1:1',status:'sent'});
 assert.equal(await store.findOtherDelivery({listingId:'list1',key:'list1:1'}),null);
 assert.ok(db.queries.some(q=>q.sql.includes('ORDER BY updated_at ASC LIMIT 1')));
});
