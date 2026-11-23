import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupDuplicateVideoOffers} from '../src/operations/cleanupDuplicateVideoOffers.mjs';

const now=Date.parse('2026-11-24T05:00:00Z');
function fixture(overrides={}){
 const base={topic_id:'4672',title:'Original video',seller_user_id:'42',
 price_stars:300,paid_video_file_id:'the_same_video',status:'sent',
 updated_at:new Date(now-3600_000)};
 const rows=[
 {...base,delivery_key:'listing1:1',paid_message_id:50,free_message_ids:[51,52]},
 {...base,delivery_key:'listing1:2',paid_message_id:60,free_message_ids:[61,62]},
 {...base,delivery_key:'listing1:3',paid_message_id:70,free_message_ids:[71,72]}
 ];
 const logs=[],calls=[],audit=[];
 const pool={async query(sql){
 if(sql.includes('FROM videobot_post_receipts r JOIN'))return {rows:overrides.rows??rows};
 if(sql.includes('SELECT DISTINCT delivery_key'))return {rows:overrides.paid??[{delivery_key:'listing1:1'}]};
 if(sql.includes('videobot_video_invoice_orders'))return {rows:[{n:overrides.invoicePaid??0}]};
 if(sql.includes('COUNT(*)::int AS n FROM videobot_stars_ledger'))return {rows:[{n:1}]};
 throw Error('unexpected query');
 }};
 const api=async(method,params={})=>{
 calls.push({method,params});
 if(method==='getMe')return {is_bot:true,id:99,username:'CreateVdobot'};
 if(method==='getChat')return {id:-1002373696859,is_forum:true};
 if(method==='getChatMember')return {status:'administrator',can_delete_messages:true};
 if(method==='deleteMessage')return true;
 throw Error('unexpected API method');
 };
 return {pool,api,calls,logs,audit,rows,options:{...overrides,pool,api,now,
   auditFile:'/var/lib/videobot/media-work/test.jsonl',
   auditWrite:(path,line)=>audit.push(JSON.parse(line))}};
}
test('removes only unpurchased same-video duplicates and preserves native paid receipt',async()=>{
 const d=fixture(),r=await cleanupDuplicateVideoOffers(d.options);
 assert.deepEqual(r,{deleted:6,kept:3,duplicates:2});
 assert.deepEqual(d.calls.filter(x=>x.method==='deleteMessage').map(x=>x.params.message_id),[60,61,62,70,71,72]);
 assert.equal(d.calls.some(x=>x.params.message_id===50||x.params.message_id===51||x.params.message_id===52),false);
 assert.equal(d.audit.filter(x=>x.action==='delete_intent').length,6);
 assert.equal(d.audit.filter(x=>x.action==='delete_ack').length,6);
});
test('never deletes paid duplicate or differently sourced product',async()=>{
 const d=fixture({paid:[{delivery_key:'listing1:1'},{delivery_key:'listing1:2'}]});
 await assert.rejects(()=>cleanupDuplicateVideoOffers(d.options),/PURCHASED_RECONCILE/);
 assert.equal(d.calls.length,0);
});
test('never touches out-of-age duplicates',async()=>{
 const d=fixture();
 d.rows[1].updated_at=new Date(now-48*3600_000);
 await assert.rejects(()=>cleanupDuplicateVideoOffers(d.options),/AGE_UNSAFE/);
 assert.equal(d.calls.length,0);
});
test('refuses duplicate purchase ID collisions',async()=>{
 const d=fixture();
 d.rows[1].free_message_ids=[51,62];
 await assert.rejects(()=>cleanupDuplicateVideoOffers(d.options),/IDS_UNSAFE/);
 assert.equal(d.calls.length,0);
});
test('rejects existing invoice purchaser',async()=>{
 const d=fixture({invoicePaid:1});
 await assert.rejects(()=>cleanupDuplicateVideoOffers(d.options),/PURCHASED_RECONCILE/);
 assert.equal(d.calls.length,0);
});
test('one failed Telegram delete is recorded without faking success',async()=>{
 const d=fixture(),real=d.options.api;
 d.options.api=async(method,params)=>method==='deleteMessage'?false:real(method,params);
 await assert.rejects(()=>cleanupDuplicateVideoOffers(d.options),/ACK_UNKNOWN/);
 assert.equal(d.audit.length,1);
 assert.equal(d.audit[0].action,'delete_intent');
});

test('shared free album IDs among unpaid receipts are deleted once, not twice',async()=>{
 const d=fixture();
 d.rows[2].free_message_ids=[61,62];
 const result=await cleanupDuplicateVideoOffers(d.options);
 assert.deepEqual(result,{deleted:4,kept:3,duplicates:2});
 assert.deepEqual(d.calls.filter(x=>x.method==='deleteMessage').map(x=>x.params.message_id),[60,61,62,70]);
 assert.equal(d.audit.filter(x=>x.action==='delete_ack').length,4);
});
