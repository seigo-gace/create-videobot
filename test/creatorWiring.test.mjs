import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoBotSourceModule} from '../src/telegram/creatorWiring.mjs';

const secret='a'.repeat(28);
function deps(){
  const calls=[];
  const moduleConfig={
    pool:{async query(sql,args){calls.push({type:'sql',sql,args});throw new Error('DB query not expected in blocked test');}},
    telegramApi:async(method)=>{calls.push({type:'telegram',method});throw new Error('network not expected');},
    screenTransport:{show:async()=>{calls.push({type:'screen'});return {messageId:50};}},
    gateOwner:{
      async getVerifiedVideoTopic(){calls.push({type:'topic'});return {
        id:9,purpose:'video_sale',board:'video_chat',chatId:-100123,threadId:11,
        title:'Verified sale topic',enabled:true,verified:true
      };},
      async verifyMembership(){calls.push({type:'membership'});return false;},
      async verifyReview(){calls.push({type:'review'});return true;},
      async verifyRelease(){calls.push({type:'release'});return true;}
    },
    mediaPorts:{fetchSource:async()=>{throw Error('no media reads');},
      saveGenerated:async()=>{throw Error('no media saves');}},
    webhookSecret:secret
  };
  return {moduleConfig,calls};
}
function listing() {
  return {id:'video001',sellerId:'44',revision:1,title:'Example',priceStars:300,
    thumbnail:{fileId:'photo001'},sample:{fileId:'sample001',durationSeconds:30},
    paidVideo:{fileId:'main001'},rightsVerified:true,adultConsentVerified:true,
    feeTermsAccepted:true,managementFeeBps:3000,ownerConfirmedPublish:true};
}
test('Source composition refuses missing verified GATE and screen providers',()=>{
 const x=deps();
 for(const key of ['verifyReview','verifyRelease','getVerifiedVideoTopic','verifyMembership']){
  const previous=x.moduleConfig.gateOwner[key];
  delete x.moduleConfig.gateOwner[key];
  assert.throws(()=>createVideoBotSourceModule(x.moduleConfig),/verified GATE owner provider missing/);
  x.moduleConfig.gateOwner[key]=previous;
 }
 assert.throws(()=>createVideoBotSourceModule({...x.moduleConfig,screenTransport:null}),/owned dependencies/);
 assert.throws(()=>createVideoBotSourceModule({...x.moduleConfig,mediaPorts:null}),/owned dependencies/);
});
test('verified GATE membership deny is applied from composed creator publisher before any SQL or send',async()=>{
 const x=deps();
 const bot=createVideoBotSourceModule(x.moduleConfig);
 assert.ok(typeof bot.handleTelegramWebhook==='function');
 assert.ok(typeof bot.handleCreatorUpdate==='function');
 await assert.rejects(()=>bot.publishListing(listing()),/GATE membership not verified/);
 assert.deepEqual(x.calls.map(c=>c.type),['topic','membership']);
});
test('fee agreement denial precedes all GATE, DB and Telegram side effects',async()=>{
 const x=deps();const bot=createVideoBotSourceModule(x.moduleConfig);
 const l=listing();l.feeTermsAccepted=false;
 await assert.rejects(()=>bot.publishListing(l),/fee agreement required/);
 assert.equal(x.calls.length,0);
});
test('invalid webhook token is rejected before decoding payload or querying database',async()=>{
 const x=deps();const bot=createVideoBotSourceModule(x.moduleConfig);
 await assert.rejects(()=>bot.handleTelegramWebhook({
   secretHeader:'wrong'+'x'.repeat(25),body:Buffer.from('not json')
 }),/webhook authorization failed/);
 assert.deepEqual(x.calls,[]);
});
