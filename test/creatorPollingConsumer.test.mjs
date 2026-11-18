import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorPollingConsumer} from '../src/runtime/creatorPollingConsumer.mjs';

function fixture({webhook='',updates=[],failOn=null,reconcileOn=null,quarantineFail=false,initial=null}={}){
 let cursor=initial,calls=[],seen=[],quarantined=new Map();
 const api=async(name,params)=>{
  calls.push({name,params});
  if(name==='getWebhookInfo')return {url:webhook,pending_update_count:updates.length};
  if(name==='getUpdates')return updates.filter(x=>cursor===null||x.update_id>cursor);
  throw Error('INVALID_METHOD');
 };
 const pool={query:async(sql,params)=>{
  if(sql.includes('INSERT INTO videobot_poll_quarantine')){
   if(quarantineFail)throw Error('QUARANTINE_WRITE_FAILED');
   quarantined.set(params[0],{digest:params[1],payload:JSON.parse(params[2])});
   return {rowCount:1,rows:[{update_id:params[0]}]};
  }
  if(sql.startsWith('SELECT last_update_id FROM videobot_poll_cursor'))
    return {rows:cursor===null?[]:[{last_update_id:cursor}]};
  if(sql.includes('INSERT INTO videobot_poll_cursor')){
   cursor=Math.max(cursor??0,params[0]);
   return {rowCount:1,rows:[{last_update_id:cursor}]};
  }
  throw Error('UNEXPECTED_SQL');
 }};
 const consume=async({secretHeader,body})=>{
  assert.equal(secretHeader,'a'.repeat(32));
  const update=JSON.parse(body.toString());
  seen.push(update.update_id);
  if(update.update_id===failOn)throw Error('HANDLE_FAILED');
  if(update.update_id===reconcileOn)throw Error('WEBHOOK_UPDATE_NEEDS_RECONCILE');
  return {accepted:true,updateId:update.update_id,handled:true};
 };
 return {client:createCreatorPollingConsumer({
  telegramApi:api,pool,handleTelegramWebhook:consume,
  webhookSecret:'a'.repeat(32)}),get calls(){return calls},get cursor(){return cursor},seen,quarantined};
}
test('CreatorBot poller consumes pending deep link then commits durable offsets',async()=>{
 const f=fixture({updates:[{update_id:101,message:{text:'/start sticker'}},
  {update_id:102,callback_query:{id:'test'}}]});
 const r=await f.client.pollBatch({timeout:0});
 assert.equal(r.accepted,2);
 assert.equal(f.cursor,102);
 assert.deepEqual(f.seen,[101,102]);
 assert.equal(f.calls[0].name,'getWebhookInfo');
 const q=f.calls.find(x=>x.name==='getUpdates');
 assert.deepEqual(q.params.allowed_updates,['message','callback_query',
  'pre_checkout_query','purchased_paid_media']);
});
test('Existing webhook must never be deleted or competed against',async()=>{
 const f=fixture({webhook:'https://example.net/webhook'});
 await assert.rejects(f.client.pollBatch(),/EXISTING_WEBHOOK/);
 assert.equal(f.calls.filter(x=>x.name==='getUpdates').length,0);
});
test('Failure leaves unacknowledged update and all later updates untouched',async()=>{
 const f=fixture({updates:[{update_id:101},{update_id:102},{update_id:103}],failOn:102});
 await assert.rejects(f.client.pollBatch(),/HANDLE_FAILED/);
 assert.equal(f.cursor,101);
 assert.deepEqual(f.seen,[101,102]);
});
test('Replayed older update does not execute owner handler twice',async()=>{
 const f=fixture({initial:200,updates:[{update_id:199},{update_id:201}]});
 await f.client.pollBatch({timeout:0});
 assert.deepEqual(f.seen,[201]);
 assert.equal(f.cursor,201);
});

test('a durable unknown update is quarantined before continuing later callbacks',async()=>{
 const original={update_id:102,callback_query:{id:'stale',data:'review:publish|r2'}};
 const f=fixture({updates:[{update_id:101},original,{update_id:103}],reconcileOn:102});
 const r=await f.client.pollBatch({timeout:0});
 assert.deepEqual([r.accepted,r.quarantined,r.lastUpdateId],[2,1,103]);
 assert.deepEqual(f.seen,[101,102,103]);
 assert.deepEqual(f.quarantined.get(102).payload,original);
 assert.match(f.quarantined.get(102).digest,/^[a-f0-9]{64}$/);
});

test('quarantine write rejection never advances cursor or discards update',async()=>{
 const f=fixture({updates:[{update_id:101},{update_id:102},{update_id:103}],
   reconcileOn:102,quarantineFail:true});
 await assert.rejects(()=>f.client.pollBatch({timeout:0}),/QUARANTINE_WRITE_FAILED/);
 assert.equal(f.cursor,101);
 assert.deepEqual(f.seen,[101,102]);
 assert.equal(f.quarantined.size,0);
});
