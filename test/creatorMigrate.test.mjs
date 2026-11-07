import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCreatorSchema} from '../src/runtime/creatorMigrate.mjs';

function pool({failAt}={}){
 const calls=[],released=[];
 return {calls,released,async connect(){return {
  async query(sql){
   calls.push(sql);
   if(failAt&&sql.includes(failAt))throw Error('migration blocked by history');
   return {rows:[],rowCount:0};
  },
  release(){released.push(true);}
 };}};
}
test('all six VideoBot migrations run in one locked transaction with no GATE mutations',async()=>{
 const db=pool(),loaded=[];
 const result=await applyCreatorSchema({pool:db,loadSql:async name=>{
  loaded.push(name);return 'CREATE TABLE IF NOT EXISTS test_'+loaded.length+' (id int)';
 }});
 assert.deepEqual(result,{applied:true,migrations:6});
 assert.equal(loaded.length,6);
 assert.match(loaded[0],/^001_video_post_receipts/);
 assert.match(loaded.at(-1),/^006_webhook_updates/);
 assert.equal(db.calls[0],'BEGIN');
 assert.match(db.calls[1],/pg_advisory_xact_lock/);
 assert.equal(db.calls.at(-1),'COMMIT');
 assert.equal(db.released.length,1);
});
test('historical management-fee conflict rolls back all pending schema changes',async()=>{
 const db=pool({failAt:'test_5'});
 await assert.rejects(()=>applyCreatorSchema({pool:db,loadSql:async name=>{
  const n=Number(name.slice(0,3));
  return 'CREATE TABLE IF NOT EXISTS test_'+n+' (id int)';
 }}),/blocked by history/);
 assert.equal(db.calls.at(-1),'ROLLBACK');
 assert.equal(db.released.length,1);
 assert.equal(db.calls.includes('COMMIT'),false);
});
test('refuse missing files or unowned transaction pool without touching database',async()=>{
 const db=pool();
 await assert.rejects(()=>applyCreatorSchema({pool:db,loadSql:async()=>''}),/migration unavailable/);
 assert.equal(db.calls.length,0);
 await assert.rejects(()=>applyCreatorSchema(),/VideoBot migration pool required/);
});
