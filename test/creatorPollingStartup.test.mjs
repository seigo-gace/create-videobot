import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorPollingRuntime} from '../src/runtime/creatorPollingMain.mjs';
import {CREATOR_SCHEMA_MIGRATION_COUNT} from '../src/runtime/creatorMigrate.mjs';
// Isolated startup integration: no network, credentials, live DB or Bot.
function setup(schema){
 let closed=0,started=0;
 class FakePool{async query(){throw Error('unexpected database call');}async end(){closed++;}}
 const env={NODE_ENV:'production',VIDEOBOT_RUN_MODE:'telegram_poll',VIDEOBOT_PRIVATE_INGRESS_ONLY:'true',VIDEOBOT_TELEGRAM_TOKEN_FILE:'/run/secrets/test',VIDEOBOT_DATABASE_URL_FILE:'/run/secrets/test-db',VIDEOBOT_SCHEMA_MIGRATE:'YES'};
 const options={env,poolCtor:FakePool,readSecret:path=>path===env.VIDEOBOT_TELEGRAM_TOKEN_FILE?'123:'+('x'.repeat(35)):'postgresql://localhost/unused',applySchema:async()=>schema,fetchImpl:async url=>{const method=url.split('/').at(-1);const result=method==='getMe'?{is_bot:true,username:'CreateVdobot'}:method==='getWebhookInfo'?{url:''}:method==='getMyCommands'?[]:method==='getChatMenuButton'?{type:'default'}:method==='deleteMyCommands'||method==='setChatMenuButton'?true:null;assert.ok(result,'unexpected Telegram API');return {ok:true,status:200,json:async()=>({ok:true,result})};},createSource:()=>{started++;return {handleTelegramWebhook:async()=>({accepted:true})};}};
 return {options,counts:()=>({closed,started})};
}
test('polling runtime accepts complete migration set and reaches source initialization',async()=>{
 const x=setup({applied:true,migrations:CREATOR_SCHEMA_MIGRATION_COUNT});
 const runtime=await createCreatorPollingRuntime(x.options);
 assert.equal(typeof runtime.poller.pollBatch,'function');
 assert.equal(x.counts().started,1);
 await runtime.close();assert.equal(x.counts().closed,1);
});
test('polling runtime refuses incomplete schema before starting source',async()=>{
 const x=setup({applied:true,migrations:CREATOR_SCHEMA_MIGRATION_COUNT-1});
 await assert.rejects(()=>createCreatorPollingRuntime(x.options),/CREATOR_POLL_SCHEMA_INCOMPLETE/);
 assert.deepEqual(x.counts(),{closed:1,started:0});
});
