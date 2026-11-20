import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWizard } from '../src/telegram/creatorWizard.mjs';

function setup({listingStoreOverride={},publishListing,salesProvider,mediaProcessorOverride={}}={}){
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
  const handler=createCreatorWizard({api,sessionStore,screenTransport,listingStore:{...store,...listingStoreOverride},mediaProcessor:{...mediaProcessor,...mediaProcessorOverride},publishListing,salesProvider,termsUrl:'https://example.test/createvdobot-terms.html'});
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
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
  assert.equal(x.states.get(33).draft.title,'夏の思い出動画');
  await x.callback('edit:sample|r3');
  await x.send({video:{file_id:'upload001',duration:75}},212);
  assert.equal(x.states.get(33).draft.sample.durationSeconds,30);
  await x.callback('edit:price|r5');
  await x.callback('edit:price:300|r6');
  await x.callback('edit:title|r7');
  await x.send({text:'夏の思い出'},213);
  assert.equal(x.states.get(33).draft.priceStars,300);
  assert.equal(x.states.get(33).draft.title,'夏の思い出');
  await x.callback('edit:preview|r9');
  const draft=x.states.get(33).draft;
  assert.equal(draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(draft.sample.fileId,'prepared_sample_001');
  assert.ok(x.screens.at(-1).panel.text.includes('投稿前の規約・約款確認'));
  assert.ok(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===213));
  assert.ok(x.screens.some(s=>s.panel.replyToMessageId===210 && s.oldId===null),
    'registration details reply to the visible original when album creation is unconfirmed');
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
  await x.send({text:'250'},215);
  assert.equal(x.states.get(33).waiting,null);
  assert.equal(x.states.get(33).draft.title,'');
  assert.equal(x.states.get(33).draft.priceStars,250);
});
test('my videos uses owner-filtered existing listing store; edit uses original',async()=>{
  const x=setup();
  await x.callback('menu:manage');
  assert.ok(x.screens.at(-1).panel.text.includes('［編集］🆕自分の動画'));
  await x.callback('video:edit:my1|r1');
  assert.equal(x.states.get(33).draft.mode,'edit');
  assert.equal(x.states.get(33).draft.title,'自分の動画');
  await assert.rejects(()=>x.callback('video:edit:other|r2'),/VIDEO_SCREEN_STALE|LISTING_NOT_OWNED/);
});
test('VIDEO existing edit preview keeps change buttons, never enables new paid publish',async()=>{
 let publications=0,updates=0;
 const x=setup({
   listingStoreOverride:{
     async updateDraft(owner,id,rev,draft){
       updates++;
       assert.equal(id,'my1');
       assert.equal(rev,7);
       return {...draft,id,revision:8,sellerId:String(owner)};
     }
   },
   publishListing:async()=>{publications++;throw new Error('existing editing must not publish');}
 });
 await x.callback('menu:manage');
 await x.callback('video:edit:my1|r1');
 assert.equal(x.states.get(33).draft.mode,'edit');
 await x.callback('edit:preview|r2');
 assert.equal(x.states.get(33).screen,'editor');
 assert.match(x.screens.at(-1).panel.text,/変更したい項目の［編集］/);
 assert.doesNotMatch(x.screens.at(-1).panel.text,/📋 投稿前の規約・約款確認/);
 assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[0].map(b=>b.text),
   ['✅ 変更','❌ キャンセル','🗑 削除']);
 assert.equal(publications,0);
 await x.callback('edit:save|r3');
 assert.equal(updates,1);
 assert.equal(publications,0);
 assert.equal(x.states.get(33).screen,'my_videos');
});

test('older VIDEO edit review cannot be submitted through new paid publication',async()=>{
 let publications=0;
 const x=setup({publishListing:async()=>{publications++;throw Error('must not publish');}});
 await x.callback('menu:manage');
 await x.callback('video:edit:my1|r1');
 const current=x.states.get(33);
 x.states.set(33,{...current,screen:'review'});
 await x.callback('review:publish|r2');
 assert.equal(publications,0);
 assert.equal(x.states.get(33).screen,'editor');
 assert.equal(x.states.get(33).draft.mode,'edit');
 assert.match(x.screens.at(-1).panel.text,/新規投稿は行っていません/);
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
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r3');
 await x.callback('edit:price:300|r4');
 await x.callback('edit:preview|r5');
 assert.equal(x.states.get(33).screen,'review');
 assert.match(x.screens.at(-1).panel.text,/出演者の年齢と必要な同意/);
 await x.callback('review:publish|r6');
 assert.equal(published.length,0);
 assert.match(x.screens.at(-1).panel.text,/未登録項目と権利/);
 await x.callback('review:rights|r7');
 assert.equal(x.states.get(33).draft.rightsVerified,true);
 await x.callback('review:publish|r8');
 assert.equal(saved.length,1);
 assert.equal(published.length,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].proof.paidMessageId,103);
 assert.equal(saved[0].owner,33);
 assert.equal(x.states.get(33).draft,null);
 assert.match(x.screens.at(-1).panel.text,/新規動画を登録しました/);
 await x.callback('review:publish|r8');
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.equal(published.length,1);
});
test('definitive pre-send GATE refusal retains one draft and permits safe retry',async()=>{
 let creates=0,updates=0,attempts=0,published=0;
 const x=setup({
   listingStoreOverride:{
     async createDraft(owner,id,draft){creates++;return {...draft,id,revision:1,sellerId:String(owner)};},
     async updateDraft(owner,id,revision,draft){
       updates++;assert.equal(revision,1);
       return {...draft,id,revision:2,sellerId:String(owner)};
     },
     async markPublished(){published++;}
   },
   publishListing:async()=>{
     attempts++;
     if(attempts===1){
       const error=new Error('VIDEO_TOPIC_NOT_CONNECTED');
       error.code='VIDEO_PUBLICATION_PRE_SEND_REJECTED';
       throw error;
     }
     return {posted:true,freeMessageIds:[301,302],paidMessageId:303};
   }
 });
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'},caption:'動画タイトル'},301);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r3');
 await x.callback('edit:price:300|r4');
 await x.callback('edit:preview|r5');
 await x.callback('review:rights|r6');
 await x.callback('review:publish|r7');
 const stopped=x.states.get(33);
 assert.equal(stopped.publishing,null);
 assert.equal(stopped.pendingVideoDraft.revision,1);
 assert.match(x.screens.at(-1).panel.text,/Telegramへ投稿していません/);
 assert.deepEqual([creates,updates,published],[1,0,0]);
 await x.callback('review:publish|r'+stopped.revision);
 assert.deepEqual([creates,updates,published],[1,1,1]);
 assert.equal(x.states.get(33).pendingVideoDraft,null);
 assert.equal(x.states.get(33).publishing,null);
 assert.equal(x.states.get(33).screen,'my_videos');
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
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r3');
 await x.callback('edit:price:300|r4');
 await x.callback('edit:preview|r5');
 await x.callback('review:rights|r6');
 await x.callback('review:publish|r7');
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
 assert.match(x.screens.at(-1).panel.text,/公式決済取消：−100 Stars/);
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
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
 assert.equal(x.states.get(33).draft.title,'動画とタイトル');
 assert.ok(x.calls.every(c=>!(c.method==='deleteMessage'&&c.params.message_id===401)),
    'the original upload must remain visible when its title is missing');
});

test('my videos new-listing shortcut returns to existing editor',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('menu:listing|r1');
 assert.equal(x.states.get(33).screen,'await_video');
 assert.equal(x.states.get(33).waiting,'paidVideo');
});

test('changing paid main refreshes the private album while preserving price and description',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'first001'},caption:'一作目'},451);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 assert.equal(x.states.get(33).screen,'editor');
 assert.equal(x.states.get(33).draft.sample.durationSeconds,30);
 await x.callback('edit:description|r3');
 await x.send({text:'追加説明'},452);
 await x.callback('edit:price|r5');
 await x.callback('edit:price:500|r6');
 await x.callback('edit:paidVideo|r7');
 await x.send({video:{file_id:'second002'},caption:'二作目'},453);
 const draft=x.states.get(33).draft;
 assert.equal(draft.title,'二作目');
 assert.equal(draft.paidVideo.fileId,'second002');
 assert.equal(draft.priceStars,500);
 assert.equal(draft.description,'追加説明');
 assert.equal(draft.thumbnail.fileId,'photo_auto_1');
 assert.equal(draft.sample.fileId,'sample_auto_1');
 assert.equal(x.calls.filter(c=>c.method==='sendMediaGroup').length,2);
});

test('one-line title edit retains custom Stars price without demanding two-line input',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001'},caption:'旧題名'},501);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r3');
 await x.callback('edit:price:custom|r4');
 await x.send({text:'250'},502);
 assert.equal(x.states.get(33).draft.priceStars,250);
 assert.equal(x.states.get(33).draft.title,'旧題名');
 await x.callback('edit:title|r6');
 await x.send({text:'新題名'},503);
 assert.equal(x.states.get(33).draft.title,'新題名');
 assert.equal(x.states.get(33).draft.priceStars,250);
});

test('video upload -> inline edit -> explicit terms -> publish once -> personal list',async()=>{
 const saved=[],published=[],receipts=[];
 const x=setup({
   listingStoreOverride:{
     async createDraft(owner,id,draft){saved.push(draft);return {id,revision:1,sellerId:String(owner),managementFeeBps:3000,...draft};},
     async updateDraft(){throw Error('unneeded update');},
     async markPublished(owner,id,rev,proof){receipts.push(proof);return {status:'published'};}
   },
   publishListing:async listing=>{
    published.push(listing);
    return {posted:true,freeMessageIds:[901,902],paidMessageId:903};
   }
 });
 await x.callback('menu:listing');
 await x.send({video:{file_id:'original_001'},caption:'旅の動画'},1001);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 let state=x.states.get(33);
 assert.equal(state.screen,'editor');
 assert.equal(state.waiting,null);
 assert.equal(state.draft.thumbnail.fileId,'photo_auto_1');
 assert.equal(state.draft.sample.durationSeconds,30);
 assert.equal(x.calls.filter(c=>c.method==='sendMediaGroup').length,1);
 assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[0].map(b=>b.text),
   ['✅ 投稿する','❌ キャンセル']);
 assert.match(x.screens.at(-1).panel.text,/［未登録］ 説明：/);
 await x.callback('edit:description|r3');
 await x.send({text:'この動画の説明です'},1002);
 await x.callback('edit:price|r5');
 await x.callback('edit:price:300|r6');
 await x.callback('entry:register|r7');
 assert.equal(x.states.get(33).screen,'review');
 assert.equal(published.length,0,'entering review cannot publish');
 assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard.flat().some(b=>b.text==='✅ 投稿する'),false);
 await x.callback('review:agree|r8');
 assert.equal(x.states.get(33).draft.feeTermsAccepted,true);
 await x.callback('review:publish|r9');
 assert.equal(saved.length,1);
 assert.equal(saved[0].description,'この動画の説明です');
 assert.deepEqual([saved[0].rightsVerified,saved[0].adultConsentVerified,saved[0].feeTermsAccepted],[true,true,true]);
 assert.equal(published.length,1);
 assert.equal(receipts[0].paidMessageId,903);
 assert.equal(x.states.get(33).draft,null);
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.match(x.screens.at(-1).panel.text,/新規動画を登録しました/);
});

test('description remains optional and editable through inline text only',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'original_001'},caption:'タイトル'},1101);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 assert.equal(x.states.get(33).screen,'editor');
 assert.equal(x.states.get(33).draft.description,'');
 const panel=x.screens.at(-1).panel;
 assert.match(panel.text,/［未登録］ 説明：/);
 assert.ok(panel.entities.some(e=>e.url.endsWith('ved_description_r3')));
});

test('existing draft recovers missing automatic media on editor re-entry without re-upload',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'保存済み動画'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const prior=x.states.get(33);
  x.states.set(33,{...prior,
    draft:{...prior.draft,thumbnail:null,sample:null},
    previewMessageId:null});
  await x.callback('menu:listing|r3');
  const restored=x.states.get(33);
  assert.equal(restored.draft.paidVideo.fileId,'main001');
  assert.equal(restored.draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(restored.draft.sample.durationSeconds,30);
  assert.equal(restored.screen,'editor');
  assert.equal(restored.previewMessageId,null,
    'unconfirmed album response is never represented as a successful album');
});

test('Stars settings back regenerates missing media for an old registered draft',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'既存作品'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const old=x.states.get(33);
  x.states.set(33,{...old,draft:{...old.draft,thumbnail:null,sample:null}});
  await x.callback('edit:price|r3');
  await x.callback('edit:back|r4');
  const restored=x.states.get(33);
  assert.equal(restored.screen,'editor');
  assert.equal(restored.draft.paidVideo.fileId,'main001');
  assert.equal(restored.draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(restored.draft.sample.durationSeconds,30);
  assert.ok(x.screens.at(-1).panel.entities.some(
    b=>b.url.includes('ved_paidVideo_')));
});

test('obsolete pre-deploy Stars button redraws owner current draft and recovers My Videos',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'旧画面作品'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const current=x.states.get(33);
  x.states.set(33,{...current,
    draft:{...current.draft,thumbnail:null,sample:null},
    screenMessageId:999,previewMessageId:null});
  const result=await x.callback('edit:price|r2',101);
  const state=x.states.get(33);
  assert.equal(result.handled,true);
  assert.equal(state.screen,'editor');
  assert.equal(state.draft.title,'旧画面作品');
  assert.equal(state.draft.thumbnail.fileId,'photo_auto_1');
  assert.equal(state.draft.sample.durationSeconds,30);
  assert.ok(x.screens.at(-1).panel.entities.some(
    b=>b.url.includes('ved_paidVideo_')));
});

test('stale review buttons refresh current draft without publishing or canceling',async()=>{
  const published=[];
  const x=setup({publishListing:async x=>{published.push(x);return {posted:true,paidMessageId:99};}});
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'守る作品'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const original=x.states.get(33);
  x.states.set(33,{...original,screen:'editor',screenMessageId:999});
  for(const action of ['review:publish|r2','review:edit|r2','review:cancel|r2']){
    await x.callback(action,101);
    assert.equal(x.states.get(33).draft.title,'守る作品');
    assert.equal(x.states.get(33).screen,'review');
    assert.match(x.screens.at(-1).panel.text,/前の画面のボタン/);
  }
  assert.equal(published.length,0);
});

test('video preview failure keeps source video and displays 20MB download blocker',async()=>{
  const x=setup({mediaProcessorOverride:{
    async prepareMissingPreviews(){throw Error('file exceeds Bot API download limit');}
  }});
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main_large_001',duration:360},caption:'長い動画'},410);
  const session=x.states.get(33);
  assert.equal(session.draft.paidVideo.fileId,'main_large_001');
  assert.equal(session.draft.thumbnail,null);
  assert.equal(session.draft.sample,null);
  assert.match(x.screens.at(-1).panel.text,/20MB取得上限/);
  assert.equal(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===410),false,
    'failed media preparation must not delete the only visible source video');
});

test('old published review keyboard opens My Videos instead of becoming inert',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 const state=x.states.get(33);
 x.states.set(33,{...state,draft:null,screen:'home',screenMessageId:999});
 const result=await x.callback('review:publish|r1',101);
 assert.equal(result.handled,true);
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.match(x.screens.at(-1).panel.text,/登録済み動画/);
});

test('obsolete register and cancel never act on newer draft',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001',duration:90},caption:'下書き'},210);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 const current=x.states.get(33);
 x.states.set(33,{...current,screen:'editor',screenMessageId:999});
 for(const code of ['entry:register|r2','edit:cancel|r2']){
   const result=await x.callback(code,101);
   assert.equal(result.handled,true);
   assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
   assert.equal(x.states.get(33).screen,'editor');
   assert.match(x.screens.at(-1).panel.text,/前の画面のボタン/);
 }
});

test('MP4 sent as a Telegram document is normalized into a video and reaches the private editor',async()=>{
  const x=setup({mediaProcessorOverride:{
    async normalizeVideoDocument(document,ownerId){
      assert.equal(document.file_id,'document_mp4_001');
      assert.equal(document.mime_type,'video/mp4');
      assert.equal(ownerId,33);
      return {file_id:'normalized_video_001'};
    }
  }});
  await x.callback('menu:listing');
  const result=await x.send({document:{file_id:'document_mp4_001',mime_type:'video/mp4',file_name:'sample.mp4'},caption:'撮影作品'},501);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  assert.equal(result.handled,true);
  const state=x.states.get(33);
  assert.equal(state.draft.title,'撮影作品');
  assert.equal(state.draft.paidVideo.fileId,'normalized_video_001');
  assert.equal(state.screen,'editor');
  assert.ok(x.screens.at(-1).panel.text.includes('［編集］ タイトル：撮影作品'));
});

test('MP4 document without caption reports missing title instead of silently ignoring upload',async()=>{
  const x=setup({mediaProcessorOverride:{
    async normalizeVideoDocument(){throw Error('must not normalize untitled video');}
  }});
  await x.callback('menu:listing');
  const result=await x.send({document:{file_id:'document_mp4_001',mime_type:'video/mp4',file_name:'sample.mp4'}},502);
  assert.equal(result.handled,true);
  assert.equal(x.states.get(33).screen,'await_video');
  assert.equal(x.states.get(33).draft.paidVideo,null);
  assert.ok(x.screens.at(-1).panel.text.includes('⚠️'));
  assert.ok(x.calls.every(c=>!(c.method==='deleteMessage' && c.params.message_id===502)),
    'keep original upload visible while asking for caption title');
});

test('owner-only title edit shows one field and cancel restores saved video without writing',async()=>{
  let updates=0;
  const x=setup({listingStoreOverride:{
    async updateDraft(){updates++;throw Error('cancel must not save');}
  }});
  await x.callback('menu:manage');
  await x.callback('video:edit:my1|r1');
  assert.equal(x.states.get(33).draft.mode,'edit');
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[0].map(b=>b.text),
    ['🔙 戻る','✅ 変更','❌ キャンセル','🗑 削除']);
  await x.callback('edit:title|r2');
  assert.equal(x.states.get(33).screen,'field');
  assert.equal(x.screens.at(-1).panel.text.includes('［編集］価格'),false);
  assert.equal(x.screens.at(-1).panel.text.includes('管理費'),false);
  await x.send({text:'編集したタイトル'},901);
  assert.equal(x.states.get(33).draft.title,'編集したタイトル');
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[0].map(b=>b.text),
    ['✅ 変更','❌ キャンセル','🗑 削除']);
  await x.callback('edit:cancel|r4');
  assert.equal(x.states.get(33).screen,'my_videos');
  assert.equal(x.states.get(33).draft,null);
  assert.equal(updates,0);
  assert.match(x.screens.at(-1).panel.text,/自分の動画/);
});

test('initial video upload asks for optional description after private preview and accepts direct text',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main_desc_001'},caption:'動画タイトル'},1101);
  const pending=x.states.get(33);
  assert.equal(pending.screen,'description');
  assert.equal(pending.waiting,'description');
  assert.equal(pending.draft.title,'動画タイトル');
  assert.equal(pending.draft.sample.fileId,'sample_auto_1');
  assert.equal(pending.draft.thumbnail.fileId,'photo_auto_1');
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.map(row=>row[0].text),
    ['⏭ スキップ','❌ キャンセル']);
  assert.match(x.screens.at(-1).panel.text,/説明は省略できます/);
  await x.send({text:'次に表示される説明'},1102);
  assert.equal(x.states.get(33).screen,'editor');
  assert.equal(x.states.get(33).waiting,null);
  assert.equal(x.states.get(33).draft.description,'次に表示される説明');
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[0].map(b=>b.text),
    ['✅ 投稿する','❌ キャンセル']);
  assert.equal(x.calls.filter(c=>c.method==='sendPaidMedia').length,0);
});

test('skip on optional description keeps the real album and reaches the ordinary editor once',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main_skip_001'},caption:'説明なしの作品'},1105);
  assert.equal(x.states.get(33).screen,'description');
  await x.callback('entry:skip|r2');
  const state=x.states.get(33);
  assert.equal(state.screen,'editor');
  assert.equal(state.waiting,null);
  assert.equal(state.descriptionEntered,true);
  assert.equal(state.draft.description,'');
  assert.equal(state.draft.paidVideo.fileId,'main_skip_001');
  assert.equal(state.draft.sample.fileId,'sample_auto_1');
  await assert.rejects(()=>x.callback('entry:skip|r2'),/STALE_CREATOR_BUTTON/);
});
