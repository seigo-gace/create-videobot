import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresWebhookUpdateStore} from '../src/sales/pgWebhookUpdates.mjs';

function db(){
 const rows=new Map();
 return {rows,async query(sql,params){
  const id=params[0],row=rows.get(id);
  if(sql.startsWith('INSERT INTO videobot_webhook_updates')){
   if(row)return {rowCount:0,rows:[]};
   rows.set(id,{payload_sha256:params[1],status:'processing',handled:null});
   return {rowCount:1,rows:[{update_id:id}]};
  }
  if(sql.startsWith('SELECT payload_sha256')){
   return {rowCount:row?1:0,rows:row?[{...row}]:[]};
  }
  if(sql.startsWith("UPDATE videobot_webhook_updates SET status='completed'")){
   if(!row||row.status!=='processing'||row.handled!==null)return {rowCount:0,rows:[]};
   row.status='completed';row.handled=params[1];
   return {rowCount:1,rows:[{update_id:id}]};
  }
  if(sql.startsWith("UPDATE videobot_webhook_updates SET status='needs_reconcile'")){
   if(!row||row.status!=='processing')return {rowCount:0,rows:[]};
   row.status='needs_reconcile';
   return {rowCount:1,rows:[{update_id:id}]};
  }
  throw Error('Unexpected SQL');
 }};
}
const fp=c=>c.repeat(64);
test('Telegram webhook update is completed exactly once and replays without running handler',async()=>{
 const pool=db(),store=createPostgresWebhookUpdateStore(pool);
 assert.deepEqual(await store.claim(42,fp('a')),{claimed:true});
 await store.complete(42,true);
 assert.deepEqual(await store.claim(42,fp('a')),{claimed:false,completed:true,handled:true});
 assert.equal(pool.rows.size,1);
 await assert.rejects(()=>store.complete(42,true),/COMPLETION_STALE/);
});
test('same update ID with different bytes is not accepted',async()=>{
 const store=createPostgresWebhookUpdateStore(db());
 await store.claim(43,fp('b'));
 await assert.rejects(()=>store.claim(43,fp('c')),/FINGERPRINT_CONFLICT/);
 await assert.rejects(()=>store.claim(43,fp('b')),/NEEDS_RECONCILE/);
});
test('failed media processing is locked for explicit reconciliation and never automatically retried',async()=>{
 const pool=db(),store=createPostgresWebhookUpdateStore(pool);
 await store.claim(44,fp('d'));await store.markUnknown(44);
 await assert.rejects(()=>store.claim(44,fp('d')),/NEEDS_RECONCILE/);
 assert.equal(pool.rows.get(44).status,'needs_reconcile');
 assert.equal(pool.rows.get(44).handled,null);
});
test('reject invalid fingerprint, ID and missing pool before persistence',async()=>{
 const store=createPostgresWebhookUpdateStore(db());
 await assert.rejects(()=>store.claim(-1,fp('a')),/invalid Telegram/);
 await assert.rejects(()=>store.claim(3,'aaa'),/fingerprint/);
 await assert.rejects(()=>store.complete(5,'true'),/invalid webhook completion/);
 assert.throws(()=>createPostgresWebhookUpdateStore(),/private webhook SQL pool/);
});
