import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWizard } from '../src/telegram/creatorWizard.mjs';

function setup({listingStoreOverride={},publishListing,salesProvider}={}){
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
  const handler=createCreatorWizard({api,sessionStore,screenTransport,listingStore:{...store,...listingStoreOverride},mediaProcessor,publishListing,salesProvider});
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
  await x.send({video:{file_id:'main001',duration:90},caption:'夏の思い出動画'},210);
  assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
  assert.equal(x.states.get(33).draft.title,'夏の思い出動画');
  await x.callback('edit:sample|r2');
  await x.send({video:{file_id:'upload001',duration:75}},212);
  assert.equal(x.states.get(33).draft.sample.durationSeconds,30);
  await x.callback('edit:price|r4');
  await x.callback('edit:price:300|r5');
  await x.callback('edit:title|r6');
  await x.send({text:'夏の思い出'},213);
  assert.equal(x.states.get(33).draft.priceStars,300);
  assert.equal(x.states.get(33).draft.title,'夏の思い出');
  await x.callback('edit:preview|r8');
  const draft=x.states.get(33).draft;
  assert.equal(draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(draft.sample.fileId,'prepared_sample_001');
  assert.ok(x.screens.at(-1).panel.text.includes('動画販売プレビュー'));
  assert.ok(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===213));
  assert.equal(x.screens.every(s=>s.oldId===101),true);
});
test('old callback revision or different owner cannot change draft',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:price|r1');
  await x.callback('edit:price:500|r2');
  await assert.rejects(()=>x.callback('edit:price:100|r2'),/STALE_CREATOR_BUTTON/);
  await assert.rejects(()=>x.callback('edit:title|r3',101,44),/PRIVATE_OWNER_REQUIRED/);
  assert.equal(x.states.get(33).draft.priceStars,500);
});
test('invalid input stays on same screen with preserved previously selected price',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:price|r1');
  await x.callback('edit:price:100|r2');
  await x.callback('edit:price|r3');
  await x.callback('edit:price:custom|r4');
  await x.send({text:'wrong title line only'},214);
  assert.equal(x.states.get(33).draft.priceStars,100);
  assert.equal(x.states.get(33).waiting,'customPrice');
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
  await x.callback('video:edit:my1|r1');
  assert.equal(x.states.get(33).draft.mode,'edit');
  assert.equal(x.states.get(33).draft.title,'自分の動画');
  await assert.rejects(()=>x.callback('video:edit:other|r2'),/VIDEO_SCREEN_STALE|LISTING_NOT_OWNED/);
});
test('cannot silently publish on preview or create an external Stars payout',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.callback('edit:preview|r1');
  assert.match(x.screens.at(-1).panel.text,/未登録/);
  assert.equal(x.calls.filter(c=>c.method==='sendPaidMedia').length,0);
  await assert.rejects(()=>x.callback('edit:publish|r2'),/UNKNOWN_CREATOR_ACTION/);
});

test('creator confirms rights and explicitly publishes only after verified store/receipt response',async()=>{
 const published=[],saved=[],calls=[];
 const x=setup({
   listingStoreOverride:{
     async createDraft(owner,id,draft){
       saved.push({owner,id,draft});
       return {id,revision:1,sellerId:String(owner),...draft};
     },
     async updateDraft(){throw new Error('update not expected');},
     async markPublished(owner,id,rev,proof){
       calls.push({owner,id,rev,proof});
       return {status:'published'};
     }
   },
   publishListing:async data=>{
     published.push(data);
     return {posted:true,freeMessageIds:[101,102],paidMessageId:103};
   }
 });
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'},caption:'動画タイトル'},301);
 await x.callback('edit:price|r2');
 await x.callback('edit:price:300|r3');
 await x.callback('edit:preview|r4');
 assert.equal(x.states.get(33).screen,'review');
 assert.match(x.screens.at(-1).panel.text,/出演者全員の成人/);
 await x.callback('review:publish|r5');
 assert.equal(published.length,0);
 assert.match(x.screens.at(-1).panel.text,/未登録項目と権利/);
 await x.callback('review:rights|r6');
 assert.equal(x.states.get(33).draft.rightsVerified,true);
 await x.callback('review:publish|r7');
 assert.equal(saved.length,1);
 assert.equal(published.length,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].proof.paidMessageId,103);
 assert.equal(saved[0].owner,33);
 assert.equal(x.states.get(33).draft,null);
 assert.match(x.screens.at(-1).panel.text,/投稿を確認しました/);
 await assert.rejects(()=>x.callback('review:publish|r7'),/CREATOR_SCREEN_STALE|CREATOR_NOT_IN_REVIEW/);
 assert.equal(published.length,1);
});
test('unknown paid-media send result locks creator flow for explicit reconciliation',async()=>{
 let attempts=0;
 const x=setup({
   listingStoreOverride:{
     async createDraft(owner,id,draft){return {id,revision:1,sellerId:String(owner),...draft};},
     async updateDraft(){throw Error('unexpected');},
     async markPublished(){throw Error('unexpected');}
   },
   publishListing:async()=>{attempts++;throw new Error('network result unknown');}
 });
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'},caption:'動画タイトル'},301);
 await x.callback('edit:price|r2');
 await x.callback('edit:price:300|r3');
 await x.callback('edit:preview|r4');
 await x.callback('review:rights|r5');
 await x.callback('review:publish|r6');
 const revision=x.states.get(33).revision;
 assert.equal(x.states.get(33).publishing,'needs_reconcile');
 assert.equal(attempts,1);
 await assert.rejects(()=>x.callback('review:publish|r'+revision),/PUBLISH_NEEDS_RECONCILE/);
 assert.equal(attempts,1);
 await x.callback('menu:home');
 assert.equal(x.states.get(33).publishing,'needs_reconcile',
  'returning to home must never clear an ambiguous paid-video send');
 await x.callback('menu:listing');
 assert.equal(x.states.get(33).publishing,'needs_reconcile',
  'reopening the creator editor must preserve reconciliation lock');
 const reopened=x.states.get(33);
 await x.callback('edit:preview|r'+reopened.revision);
 const afterPreview=x.states.get(33);
 await assert.rejects(()=>x.callback('review:publish|r'+afterPreview.revision),
  /PUBLISH_NEEDS_RECONCILE/);
 assert.equal(attempts,1,'menu navigation cannot cause duplicate paid media sends');
});

test('existing sales summary and history are shown through injected owner ledger, not duplicate records',async()=>{
 const x=setup({salesProvider:{
   async getSummary(id){assert.equal(id,33);return {grossStars:850,availableStars:210,payoutReady:true};},
   async getHistory(id){assert.equal(id,33);return [{type:'sale',stars:300},{type:'refund',stars:100}];}
 }});
 await x.callback('menu:sales');
 assert.equal(x.states.get(33).screen,'sales');
 assert.match(x.screens.at(-1).panel.text,/累計売上：850 Stars/);
 await x.callback('sales:history|r1');
 assert.equal(x.states.get(33).screen,'sales_history');
 assert.match(x.screens.at(-1).panel.text,/返金：−100 Stars/);
 await x.callback('sales:back|r2');
 assert.equal(x.states.get(33).screen,'sales');
 await x.callback('sales:withdraw|r3');
 assert.equal(x.states.get(33).screen,'sales_withdrawal');
 assert.match(x.screens.at(-1).panel.text,/引き出しは利用できません/);
 assert.equal(x.states.get(33).waiting,null);
 await x.callback('menu:home|r4');
 assert.equal(x.states.get(33).screen,'home');
});

test('existing My Videos title and price buttons show seller-only detail, fee disclosure and back',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('video:open:my1|r1');
 assert.equal(x.states.get(33).screen,'video_detail');
 assert.match(x.screens.at(-1).panel.text,/自分の動画/);
 assert.match(x.screens.at(-1).panel.text,/運営管理費/);
 assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard[0][0].callback_data,'video:back:my1|r2');
 await x.callback('video:back:my1|r2');
 assert.equal(x.states.get(33).screen,'my_videos');
 await x.callback('video:price:my1|r3');
 assert.equal(x.states.get(33).screen,'video_detail');
 assert.match(x.screens.at(-1).panel.text,/管理費30 Stars／投稿者分70 Stars/);
 await assert.rejects(()=>x.callback('video:back:my1|r2'),/STALE_CREATOR_BUTTON/);
});

test('caption without title does not store video, retry accepts same captioned video',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'}},401);
 assert.equal(x.states.get(33).draft.paidVideo,null);
 assert.equal(x.states.get(33).waiting,'paidVideo');
 await x.send({video:{file_id:'main001'},caption:'動画とタイトル'},402);
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
 assert.equal(x.states.get(33).draft.title,'動画とタイトル');
 assert.ok(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===401));
});

test('my videos new-listing shortcut returns to existing editor',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('menu:listing|r1');
 assert.equal(x.states.get(33).screen,'editor');
 assert.equal(x.states.get(33).waiting,'paidVideo');
});

test('replacing a video keeps price but clears previews derived from older video',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'first001'},caption:'一作目'},451);
 await x.callback('edit:price|r2');
 await x.callback('edit:price:500|r3');
 await x.callback('edit:preview|r4');
 assert.equal(x.states.get(33).draft.thumbnail.fileId,'photo_auto_1');
 await x.callback('review:edit|r5');
 await x.callback('edit:paidVideo|r6');
 await x.send({video:{file_id:'second002'},caption:'二作目'},452);
 const draft=x.states.get(33).draft;
 assert.equal(draft.title,'二作目');
 assert.equal(draft.paidVideo.fileId,'second002');
 assert.equal(draft.priceStars,500);
 assert.equal(draft.thumbnail,null);
 assert.equal(draft.sample,null);
});

test('one-line title edit retains custom Stars price without demanding two-line input',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'},caption:'旧題名'},501);
 await x.callback('edit:price|r2');
 await x.callback('edit:price:custom|r3');
 await x.send({text:'旧題名\\n250'},502);
 assert.equal(x.states.get(33).draft.priceStars,250);
 await x.callback('edit:title|r5');
 await x.send({text:'新題名'},503);
 assert.equal(x.states.get(33).draft.title,'新題名');
 assert.equal(x.states.get(33).draft.priceStars,250);
});
