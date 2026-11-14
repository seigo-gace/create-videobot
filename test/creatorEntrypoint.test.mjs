import test from 'node:test';
import assert from 'node:assert/strict';
import {startCreatorFromPrivateMounts} from '../src/runtime/creatorEntrypoint.mjs';

const config={
 NODE_ENV:'production',VIDEOBOT_RUN_MODE:'telegram',
 VIDEOBOT_PRIVATE_INGRESS_ONLY:'true',
 VIDEOBOT_PRIVATE_BIND:'127.0.0.1',VIDEOBOT_PRIVATE_PORT:'8766',
 VIDEOBOT_GATE_OWNER_ADAPTER:'/opt/videobot/owner/gateOwner.mjs',
 VIDEOBOT_TELEGRAM_TOKEN_FILE:'/run/secrets/tg_token',
 VIDEOBOT_WEBHOOK_SECRET_FILE:'/run/secrets/wh_secret',
 VIDEOBOT_DATABASE_URL_FILE:'/run/secrets/db_url'
};
const storage={kind:'private_video_media_store',verified:true,private:true,chatId:-100333};
const gateOwner={
 getVerifiedVideoTopic:async()=>null,verifyMembership:async()=>false,
 verifyReview:async()=>false,verifyRelease:async()=>false
};
function fixture(overrides={}){
 const events=[];
 class Pool {
  constructor(options){events.push({kind:'pool',options});}
  async end(){events.push({kind:'db_closed'});}
 }
 const mock={
  env:{...config},
  pgPoolCtor:Pool,
  readSecret:(_env,key)=>{
   events.push({kind:'secret',key});
   return {
    VIDEOBOT_TELEGRAM_TOKEN_FILE:'1234:'+('x'.repeat(36)),
    VIDEOBOT_WEBHOOK_SECRET_FILE:'S'.repeat(32),
    VIDEOBOT_DATABASE_URL_FILE:'postgresql://private-only/placeholder'
   }[key];
  },
  importOwner:async spec=>{
   events.push({kind:'gate_import',spec});
   return {createGateOwner:async()=>gateOwner,
     verifyPrivateMediaStore:async()=>storage};
  },
  createService:opts=>{
   events.push({kind:'service',opts});
   return {
     async start(){events.push({kind:'start'});return {host:'127.0.0.1',port:8766};},
     async close(){events.push({kind:'service_closed'});}
   };
  },
  ...overrides
 };
 return {mock,events};
}
test('real Creator startup uses exactly three private secret files and GATE owner module',async()=>{
 const x=fixture();
 const runtime=await startCreatorFromPrivateMounts(x.mock);
 assert.equal(runtime.listener.port,8766);
 const eventKinds=x.events.map(e=>e.kind);
 assert.deepEqual(eventKinds,[
  'secret','secret','secret','pool','gate_import','service','start'
 ]);
 assert.equal(x.events.find(e=>e.kind==='gate_import').spec,
  'file:///opt/videobot/owner/gateOwner.mjs');
 const svc=x.events.find(e=>e.kind==='service').opts;
 assert.equal(svc.storageApproved,true);
 assert.deepEqual(svc.gateOwner,gateOwner);
 assert.equal(svc.host,'127.0.0.1');
 assert.equal(svc.webhookSecret,'S'.repeat(32));
 await runtime.close();
 assert.deepEqual(x.events.slice(-2).map(e=>e.kind),[
  'service_closed','db_closed'
 ]);
});
test('unverified private media storage prevents startup and closes owned SQL pool',async()=>{
 const x=fixture({importOwner:async()=>({
  createGateOwner:async()=>gateOwner,
  verifyPrivateMediaStore:async()=>({...storage,verified:false})
 })});
 await assert.rejects(()=>startCreatorFromPrivateMounts(x.mock),/storage not verified/);
 assert.equal(x.events.at(-1).kind,'db_closed');
 assert.ok(!x.events.some(e=>e.kind==='start'));
});
test('missing GATE adapter is not replaced with a fake verified membership provider',async()=>{
 const x=fixture({importOwner:async()=>({})});
 await assert.rejects(()=>startCreatorFromPrivateMounts(x.mock),/trusted existing GATE owner/);
 assert.equal(x.events.at(-1).kind,'db_closed');
});
test('entrypoint rejects public ingress, wrong run mode and unmanaged secrets before pool creation',async()=>{
 for(const envPatch of [
  {VIDEOBOT_PRIVATE_INGRESS_ONLY:'false'},
  {VIDEOBOT_RUN_MODE:'bootstrap'},
  {VIDEOBOT_GATE_OWNER_ADAPTER:'/tmp/other.mjs'}
 ]){
  const x=fixture({env:{...config,...envPatch}});
  await assert.rejects(()=>startCreatorFromPrivateMounts(x.mock));
  assert.ok(!x.events.some(e=>e.kind==='pool'));
 }
});
