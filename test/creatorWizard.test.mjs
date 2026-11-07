import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWizard } from '../src/telegram/creatorWizard.mjs';

function setup(){
  const states=new Map(),calls=[],screens=[];
  const sessionStore={
    async read(id){return states.get(id)??null;},
    async write(id,expected,next){
      const v=states.get(id);
      if((v?.revision??0)!==expected)throw new Error('SESSION_REVISION_STALE');
      states.set(id,{...next});
    },
    async setScreen(id,rev,messageId){
      const v=states.get(id);
      if(!v||v.revision!==rev)throw new Error('SESSION_SCREEN_STALE');
      states.set(id,{...v,screenMessageId:messageId});
    }
  };
  const store={
    async listByOwner(ownerId){return [
      {id:'my1',sellerId:String(ownerId),title:'自分の動画',priceStars:100},
      {id:'other',sellerId:'999',title:'他人の動画',priceStars:500}
    ];},
    async getOwned(ownerId,id){return id==='my1'?{id:'my1',sellerId:String(ownerId),revision:7,title:'自分の動画',priceStars:100,paidVideo:{fileId:'main777'}}:null;}
  };
  const screenTransport={
    async show(userId,oldId,panel){
      screens.push({userId,oldId,panel});
      return {messageId:oldId||101,replaced:!!oldId};
    }
  };
  const api=async(method,params)=>{
    calls.push({method,params});
    return true;
  };
  const mediaProcessor={
    async prepareUserSample(video){
      assert.equal(video.file_id,'upload001');
      return {fileId:'prepared_sample_001',durationSeconds:30};
    },
    async prepareMissingPreviews(){
      return {thumbnail:{fileId:'photo_auto_1'},sample:{fileId:'sample_auto_1',durationSeconds:30}};
    }
  };
  const handler=createCreatorWizard({api,sessionStore,screenTransport,listingStore:store,mediaProcessor});
  const callback=(action,id=101,from=33)=>handler.handle({
    callback_query:{id:'cq_'+action,from:{id:from},data:action,
      message:{chat:{id:33,type:'private'},message_id:id}}
  });
  const send=(payload,message_id=211)=>handler.handle({
    message:{chat:{id:33,type:'private'},from:{id:33},message_id,...payload}
  });
  return {handler,states,calls,screens,callback,send};
}
test('creator DM callback/standard input/price flow uses one existing screen and revision',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  assert.equal(x.states.get(33).revision,1);
  await x.callback('edit:paidVideo|r1');
  await x.send({video:{file_id:'main001',duration:90}},210);
  assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
  await x.callback('edit:sample|r3');
  await x.send({video:{file_id:'upload001',duration:75}},212);
  assert.equal(x.states.get(33).draft.sample.durationSeconds,30);
  await x.callback('edit:price:300|r5');
  await x.callback('edit:title|r6');
  await x.send({text:'夏の思い出'},213);
  assert.equal(x.states.get(33).draft.priceStars,300);
  assert.equal(x.states.get(33).draft.title,'夏の思い出');
  await x.callback('edit:preview|r8');
  const draft=x.states.get(33).draft;
  assert.equal(draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(draft.sample.fileId,'prepared_sample_001');
  assert.ok(x.screens.at(-1).panel.text.includes('プレビュー確認'));
  assert.ok(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===213));
  assert.equal(x.screens.every(s=>s.oldId===101),true);
});
test('old callback revision or different owner cannot change draft',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:price:500|r1');
  await assert.rejects(()=>x.callback('edit:price:100|r1'),/STALE_CREATOR_BUTTON/);
  await assert.rejects(()=>x.callback('edit:title|r2',101,44),/PRIVATE_OWNER_REQUIRED/);
  assert.equal(x.states.get(33).draft.priceStars,500);
});
test('invalid input stays on same screen with preserved previously selected price',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:price:100|r1');
  await x.callback('edit:price:custom|r2');
  await x.send({text:'wrong title line only'},214);
  assert.equal(x.states.get(33).draft.priceStars,100);
  assert.equal(x.states.get(33).waiting,'title');
  assert.match(x.screens.at(-1).panel.text,/⚠️/);
  await x.send({text:'Title\n250'},215);
  assert.equal(x.states.get(33).waiting,null);
  assert.equal(x.states.get(33).draft.title,'Title');
  assert.equal(x.states.get(33).draft.priceStars,250);
});
test('my videos uses owner-filtered existing listing store; edit uses original',async()=>{
  const x=setup();
  await x.callback('menu:manage');
  assert.ok(x.screens.at(-1).panel.text.includes('1〜1 / 1件'));
  await x.callback('video:edit:my1');
  assert.equal(x.states.get(33).draft.mode,'edit');
  assert.equal(x.states.get(33).draft.title,'自分の動画');
  await assert.rejects(()=>x.callback('video:edit:other'),/LISTING_NOT_OWNED/);
});
test('cannot silently publish on preview or create an external Stars payout',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:preview|r1');
  assert.match(x.screens.at(-1).panel.text,/未登録/);
  assert.equal(x.calls.filter(c=>c.method==='sendPaidMedia').length,0);
  await assert.rejects(()=>x.callback('edit:publish|r2'),/UNKNOWN_CREATOR_ACTION/);
});
