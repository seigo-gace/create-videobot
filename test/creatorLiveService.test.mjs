import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreatorLiveService} from '../src/runtime/creatorLiveService.mjs';

const token='123456:'+('x'.repeat(36));
const secret='S'.repeat(30);
function dependencies({dbReady=true,identityOk=true}={}){
 const events=[],updates=new Map(),sessions=new Map();
 const pool={async query(sql,args=[]){
  if(sql.startsWith('SELECT to_regclass')){
   return {rows:[{updates:dbReady?'videobot_webhook_updates':null,
    sessions:'videobot_creator_sessions',listings:'videobot_listings',
    stars:'videobot_stars_ledger'}]};
  }
  if(sql.startsWith('INSERT INTO videobot_webhook_updates')){
   const [id,hash]=args;
   if(updates.has(id))return {rowCount:0,rows:[]};
   updates.set(id,{payload_sha256:hash,status:'processing',handled:null});
   return {rowCount:1};
  }
  if(sql.startsWith('SELECT payload_sha256')){
   const r=updates.get(args[0]);return {rows:r?[r]:[]};
  }
  if(sql.startsWith("UPDATE videobot_webhook_updates SET status='completed'")){
   const r=updates.get(args[0]);r.status='completed';r.handled=args[1];return {rowCount:1};
  }
  if(sql.startsWith("UPDATE videobot_webhook_updates SET status='needs_reconcile'")){
   const r=updates.get(args[0]);r.status='needs_reconcile';return {rowCount:1};
  }
  if(sql.startsWith('SELECT revision,screen_message_id,state FROM videobot_creator_sessions')){
   const session=sessions.get(args[0]);
   return {rows:session?[{revision:session.revision,screen_message_id:session.screenMessageId,
    state:session.state}]:[]};
  }
  if(sql.startsWith('INSERT INTO videobot_creator_sessions')){
   if(sessions.has(args[0]))return {rowCount:0};
   sessions.set(args[0],{revision:args[1],screenMessageId:args[2],state:JSON.parse(args[3])});
   return {rowCount:1};
  }
  if(sql.startsWith('UPDATE videobot_creator_sessions SET screen_message_id=')){
   const session=sessions.get(args[0]);
   if(session?.revision!==args[1])return {rowCount:0};
   session.screenMessageId=args[2];return {rowCount:1};
  }
  if(sql.startsWith('UPDATE videobot_creator_sessions SET revision=')){
   const session=sessions.get(args[0]);
   if(!session||session.revision!==args[4])return {rowCount:0};
   sessions.set(args[0],{revision:args[1],screenMessageId:args[2],state:JSON.parse(args[3])});
   return {rowCount:1};
  }
  throw Error('unexpected database access: '+sql.slice(0,45));
 }};
 const fetchImpl=async(url,options)=>{
  const method=String(url).split('/').at(-1);
  events.push({method,params:JSON.parse(options.body)});
  if(method==='getMe')return {status:200,json:async()=>({
   ok:true,result:{is_bot:true,username:identityOk?'CreateVdoBot':'another_bot'}
  })};
  if(method==='sendMessage')return {status:200,json:async()=>({
   ok:true,result:{message_id:22}
  })};
  return {status:200,json:async()=>({ok:true,result:true})};
 };
 const gateOwner={
  getVerifiedVideoTopic:async()=>{throw Error('no verified topic');},
  verifyMembership:async()=>false,
  verifyReview:async()=>false,
  verifyRelease:async()=>false
 };
 const mediaPorts={
  fetchSource:async()=>{throw Error('not connected');},
  saveGenerated:async()=>{throw Error('not connected');}
 };
 return {pool,fetchImpl,gateOwner,mediaPorts,events,updates,sessions};
}
test('actual private runtime listens only after Bot identity and SQL migrations pass',async()=>{
 const deps=dependencies();
 const svc=createCreatorLiveService({...deps,botToken:token,webhookSecret:secret,port:0});
 const addr=await svc.start();
 try{
  assert.equal(addr.host,'127.0.0.1');
  assert.equal(deps.events[0].method,'getMe');
  const u='http://127.0.0.1:'+addr.port;
  assert.equal((await fetch(u+'/readyz')).status,200);
  const update={update_id:17,message:{message_id:7,
   from:{id:33},chat:{id:33,type:'private'},text:'/start'}};
  const req=()=>fetch(u+'/telegram/creator',{
   method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
   body:JSON.stringify(update)
  });
  assert.equal((await req()).status,200);
  assert.equal((await req()).status,200);
  assert.equal(deps.events.filter(x=>x.method==='sendMessage').length,1);
  assert.equal(deps.sessions.get(33).screenMessageId,22);
  assert.equal(deps.sessions.get(33).revision,1);
  assert.equal(deps.updates.get(17).status,'completed');
 }finally{await svc.close();}
});
test('unrelated Bot identity is rejected before opening listener',async()=>{
 const deps=dependencies({identityOk:false});
 const svc=createCreatorLiveService({...deps,botToken:token,webhookSecret:secret,port:0});
 await assert.rejects(()=>svc.start(),/unexpected Telegram bot identity/);
 await svc.close();
});
test('missing migrations prevent Bot from accepting updates',async()=>{
 const deps=dependencies({dbReady:false});
 const svc=createCreatorLiveService({...deps,botToken:token,webhookSecret:secret,port:0});
 await assert.rejects(()=>svc.start(),/migrations missing/);
 await svc.close();
});
test('invalid secret, token or missing GATE contract aborts safely',()=>{
 const deps=dependencies();
 assert.throws(()=>createCreatorLiveService({...deps,botToken:token,webhookSecret:'bad'}),/private Telegram webhook/);
 assert.throws(()=>createCreatorLiveService({...deps,botToken:'wrong',webhookSecret:secret}),/invalid Bot Token/);
 assert.throws(()=>createCreatorLiveService({...deps,botToken:token,webhookSecret:secret,gateOwner:{}}),/verified GATE owner provider/);
});
