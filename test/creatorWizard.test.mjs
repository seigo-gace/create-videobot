import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorWizard } from '../src/telegram/creatorWizard.mjs';

function setup({listingStoreOverride={},publishListing,salesProvider,mediaProcessorOverride={},termsUrl='https://example.test/createvdobot-terms.html'}={}){
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
      return {thumbnail:{fileId:'photo_auto_1',secondFileId:'photo_auto_2'},sample:{fileId:'sample_auto_1',durationSeconds:30}};
    }
  };
  const handler=createCreatorWizard({api,sessionStore,screenTransport,listingStore:{...store,...listingStoreOverride},mediaProcessor:{...mediaProcessor,...mediaProcessorOverride},publishListing,salesProvider,termsUrl});
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
test('creator home purchase selector switches in place and returns without resetting draft or creating another sale',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  const before=x.states.get(33).draft;
  await x.callback('menu:purchase');
  assert.equal(x.states.get(33).screen,'purchase');
  assert.equal(x.states.get(33).draft,before);
  assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard[0][0].url,'https://t.me/PremiumBot');
  assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard[0][1].url,'https://fragment.com/stars');
  assert.equal(x.screens.at(-1).oldId,101,'must reuse existing DM screen');
  await x.callback('menu:home');
  assert.equal(x.states.get(33).screen,'home');
  assert.equal(x.states.get(33).draft,before);
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard[1].map(b=>b.text),
    ['🔙戻る','⭐ 売上・引き出し','⭐ 購入']);
  await x.callback('menu:sales');
  assert.equal(x.states.get(33).screen,'sales');
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
 assert.match(x.screens.at(-1).panel.text,/変更したい項目の［編集］をタップ/);
 assert.doesNotMatch(x.screens.at(-1).panel.text,/📋 投稿前の規約・約款確認/);
 assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),
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
 assert.equal(saved.length,1);
 assert.equal(published.length,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].proof.paidMessageId,103);
 assert.equal(saved[0].owner,33);
 assert.equal(x.states.get(33).draft,null);
 assert.match(x.screens.at(-1).panel.text,/新規動画を登録しました/);
 await x.callback('review:rights|r7');
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
 const stopped=x.states.get(33);
 assert.equal(stopped.publishing,null);
 assert.equal(stopped.pendingVideoDraft.revision,1);
 assert.match(x.screens.at(-1).panel.text,/Telegramへ投稿していません/);
 assert.deepEqual([creates,updates,published],[1,0,0]);
 await x.callback('review:agree|r'+stopped.revision);
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
 const revision=x.states.get(33).revision;
 assert.equal(x.states.get(33).publishing,'needs_reconcile');
 assert.equal(attempts,1);
 await x.callback('review:publish|r'+revision);
 assert.match(x.screens.at(-1).panel.text,/前の投稿結果を確認中/);
 assert.equal(attempts,1);
 await x.callback('menu:home');
 assert.equal(x.states.get(33).publishing,'needs_reconcile',
  'returning to home must never clear an ambiguous paid-video send');
 await x.callback('menu:listing');
 const reopened=x.states.get(33);
 assert.equal(reopened.publishing,'needs_reconcile',
  'new post must not erase an unresolved paid-video publication');
 assert.equal(reopened.screen,'review');
 assert.match(x.screens.at(-1).panel.text,/前の投稿結果が未確定/);
 await x.callback('review:publish|r'+reopened.revision);
 assert.match(x.screens.at(-1).panel.text,/前の投稿結果を確認中/);
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

test('legacy title and price detail callbacks return to video list without opening unrequested details',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('video:open:my1|r1');
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.match(x.screens.at(-1).panel.text,/自分の動画/);
 assert.doesNotMatch(x.screens.at(-1).panel.text,/管理費30 Stars／投稿者分70 Stars/);
 assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1)[1].callback_data,'menu:listing');
 await x.callback('video:price:my1|r2');
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.doesNotMatch(x.screens.at(-1).panel.text,/運営管理費/);
 await assert.rejects(()=>x.callback('video:back:my1|r2'),/VIDEO_SCREEN_STALE|STALE_CREATOR_BUTTON/);
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
 assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),
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
 const consent=x.screens.at(-1).panel.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.startsWith('review:agree'));
  assert.equal(consent.text,'✅ 同意して登録する');
  await x.callback(consent.callback_data);
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
 assert.ok(panel.entities.some(e=>e.url.endsWith('ved_description_r3')&&panel.text.slice(e.offset,e.offset+e.length)==='［未登録］'));
});

test('existing draft recovers missing automatic media on explicit edit-back, never via New Post',async()=>{
  const x=setup();
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'保存済み動画'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const prior=x.states.get(33);
  x.states.set(33,{...prior,
    draft:{...prior.draft,thumbnail:null,sample:null},
    previewMessageId:null});
  await x.callback('edit:price|r3');
  await x.callback('edit:back|r4');
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
  assert.ok(x.screens.at(-1).panel.entities.some(e=>e.url.endsWith('ved_paidVideo_r'+x.states.get(33).revision)));
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
  assert.ok(x.screens.at(-1).panel.entities.some(e=>e.url.endsWith('ved_paidVideo_r'+x.states.get(33).revision)));
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
 assert.match(x.screens.at(-1).panel.text,/動画一覧/);
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
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),
    ['🔙 戻る','✅ 変更','❌ キャンセル','🗑 削除']);
  await x.callback('edit:title|r2');
  assert.equal(x.states.get(33).screen,'field');
  assert.equal(x.screens.at(-1).panel.text.includes('［編集］価格'),false);
  assert.equal(x.screens.at(-1).panel.text.includes('管理費'),false);
  await x.send({text:'編集したタイトル'},901);
  assert.equal(x.states.get(33).draft.title,'編集したタイトル');
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),
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
  assert.deepEqual(x.screens.at(-1).panel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),
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


test('new post from an existing video editor is always an empty CREATE flow with no old album or pending listing',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('video:edit:my1|r1');
 const previous=x.states.get(33);
 x.states.set(33,{...previous,
  previewMessageId:301,albumMessageId:301,
  pendingVideoDraft:{listingId:'my1',revision:7},
  descriptionEntered:true,field:'title',detailId:'my1'});
 await x.callback('menu:listing');
 const fresh=x.states.get(33);
 assert.equal(fresh.draft.mode,'create');
 assert.equal(fresh.draft.listingId,null);
 assert.equal(fresh.draft.paidVideo,null);
 assert.equal(fresh.draft.thumbnail,null);
 assert.equal(fresh.draft.sample,null);
 assert.equal(fresh.draft.title,'');
 assert.equal(fresh.previewMessageId,null);
 assert.equal(fresh.albumMessageId,null);
 assert.equal(fresh.pendingVideoDraft,null);
 assert.equal(fresh.originalDraft,null);
 assert.equal(fresh.field,null);
 assert.equal(fresh.detailId,null);
 assert.equal(fresh.screen,'await_video');
 assert.equal(fresh.waiting,'paidVideo');
 assert.match(x.screens.at(-1).panel.text,/新規動画を投稿/);
 assert.equal(x.screens.at(-1).panel.albumMessageId,undefined);
 assert.equal(x.screens.at(-1).panel.replyToMessageId,undefined);
 await x.send({video:{file_id:'genuine_new_video_222',duration:87},caption:'新規登録する作品'},1001);
 assert.equal(x.states.get(33).draft.mode,'create');
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'genuine_new_video_222');
 assert.equal(x.states.get(33).draft.listingId,null);
});
test('repeated explicit new post always discards prior CREATE draft, never returns to its preview',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'old_video_100',duration:88},caption:'前の作品'},1101);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'old_video_100');
 const old=x.states.get(33);
 x.states.set(33,{...old,previewMessageId:401,albumMessageId:401,
   pendingVideoDraft:{listingId:'old_pending_product',revision:1}});
 await x.callback('menu:listing');
 const fresh=x.states.get(33);
 assert.equal(fresh.draft.mode,'create');
 assert.equal(fresh.screen,'await_video');
 assert.equal(fresh.draft.paidVideo,null);
 assert.equal(fresh.draft.title,'');
 assert.equal(fresh.previewMessageId,null);
 assert.equal(fresh.albumMessageId,null);
 assert.equal(fresh.pendingVideoDraft,null);
 assert.equal(x.screens.at(-1).panel.albumMessageId,undefined);
 assert.equal(x.screens.at(-1).panel.replyToMessageId,undefined);
});
test('new registration after editing never updates the previous listing',async()=>{
 let updated=0,created=0;
 const x=setup({listingStoreOverride:{
  async updateDraft(){updated++;throw Error('old listing must never be updated');},
  async createDraft(owner,id,draft){
   created++;
   assert.equal(owner,33);
   assert.notEqual(id,'my1');
   assert.equal(draft.mode,'create');
   assert.equal(draft.listingId,null);
   assert.equal(draft.paidVideo.fileId,'brand_new_unique_video');
   return {id,revision:1,sellerId:String(owner),...draft};
  },
  async markPublished(){return {status:'published'}}
 },publishListing:async()=>({posted:true,freeMessageIds:[501,502],paidMessageId:503})});
 await x.callback('menu:manage');
 await x.callback('video:edit:my1|r1');
 await x.callback('menu:listing');
 await x.send({video:{file_id:'brand_new_unique_video',duration:100},caption:'新しく出品する作品'},1451);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r'+x.states.get(33).revision);
 await x.callback('edit:price:300|r'+x.states.get(33).revision);
 await x.callback('edit:preview|r'+x.states.get(33).revision);
 await x.callback('review:rights|r'+x.states.get(33).revision);
 assert.equal(created,1);
 assert.equal(updated,0);
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.equal(x.states.get(33).draft,null);
});

test('published listing Edit opens a real metadata editor and saves without publishing',async()=>{
 const x=setup({listingStoreOverride:{
  async getOwned(owner,id){return {id,sellerId:String(owner),revision:2,status:'published',title:'旧タイトル',description:'旧説明',priceStars:300,paidVideo:{fileId:'main777'}};},
  async updatePublishedMetadata(owner,id,rev,d){assert.equal(owner,33);assert.equal(id,'my1');assert.equal(rev,2);assert.equal(d.title,'新タイトル');assert.equal(d.paidVideo.fileId,'main777');return {id};}
 }});
 await x.callback('menu:manage');
 await x.handler.openOwnedVideo({message:{chat:{id:33,type:'private'},from:{id:33},message_id:111}},'my1',1);
 assert.equal(x.states.get(33).screen,'editor');
 assert.equal(x.states.get(33).draft.publishedEdit,true);
 await x.callback('edit:title|r2');
 await x.send({text:'新タイトル'},112);
 await x.callback('edit:save|r4');
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.match(x.screens.at(-1).panel.text,/動画を編集／更新しました/);
});
test('new post Back and Cancel return to the listing including old versioned Back',async()=>{
 const x=setup();
 await x.callback('menu:manage');
 await x.callback('menu:listing');
 const back=x.screens.at(-1).panel.reply_markup.inline_keyboard.flat().find(b=>b.text.includes('戻る'));
 assert.equal(back.callback_data,'menu:manage|r2');
 await x.callback(back.callback_data);
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.equal(x.states.get(33).draft,null);
 await x.callback('menu:listing');
 const cancel=x.screens.at(-1).panel.reply_markup.inline_keyboard.flat().find(b=>b.text.includes('キャンセル'));
 assert.equal(cancel.callback_data,'edit:cancel|r4');
 await x.callback(cancel.callback_data);
 assert.equal(x.states.get(33).screen,'my_videos');
 assert.equal(x.states.get(33).draft,null);
});
test('published prior receipt resolves stale creator lock and allows genuinely new registration',async()=>{
 const x=setup({listingStoreOverride:{
   async getOwned(owner,id){
     assert.equal(owner,33);
     return id==='my1'?{id:'my1',sellerId:String(owner),
       revision:8,status:'published',title:'購入済み作品'}:null;
   }
 }});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'previous_registered_video',duration:80},caption:'前の作品'},1271);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 const prior=x.states.get(33);
 x.states.set(33,{...prior,publishing:'needs_reconcile',
  pendingVideoDraft:{listingId:'my1',revision:7},screen:'review'});
 await x.callback('menu:listing');
 const s=x.states.get(33);
 assert.equal(s.publishing,null);
 assert.equal(s.pendingVideoDraft,null);
 assert.equal(s.draft.mode,'create');
 assert.equal(s.draft.paidVideo,null);
 assert.equal(s.draft.title,'');
 assert.equal(s.screen,'await_video');
 assert.equal(s.waiting,'paidVideo');
 await x.send({video:{file_id:'new_unrelated_video_123',duration:90},caption:'新しい商品'},1272);
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'new_unrelated_video_123');
});
test('recorded publication receipt resolves stale lock even when listing revision matches pending',async()=>{
 const x=setup({listingStoreOverride:{
  async getOwned(owner,id){
    assert.equal(owner,33);
    return id==='my1'?{id:'my1',sellerId:String(owner),revision:7,status:'published',
      publicationState:'recorded',title:'記録済み作品'}:null;
  }
 }});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'stale_lock_video',duration:82},caption:'ロック残存'},1281);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 const prior=x.states.get(33);
 x.states.set(33,{...prior,publishing:'needs_reconcile',
  pendingVideoDraft:{listingId:'my1',revision:7},screen:'review'});
 await x.callback('menu:listing');
 const s=x.states.get(33);
 assert.equal(s.publishing,null);
 assert.equal(s.pendingVideoDraft,null);
 assert.equal(s.draft.mode,'create');
 assert.equal(s.draft.paidVideo,null);
 assert.equal(s.screen,'await_video');
});
test('unresolved prior sale cannot be silently cleared by pressing new post',async()=>{
 const x=setup({listingStoreOverride:{
  async getOwned(owner,id){return {id,sellerId:String(owner),revision:7,status:'draft'};}
 }});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'uncertain_prior_video',duration:90},caption:'旧商品'},1273);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 const prior=x.states.get(33);
 x.states.set(33,{...prior,publishing:'needs_reconcile',
  pendingVideoDraft:{listingId:'my1',revision:7},screen:'review'});
 await x.callback('menu:listing');
 const s=x.states.get(33);
 assert.equal(s.publishing,'needs_reconcile');
 assert.deepEqual(s.pendingVideoDraft,{listingId:'my1',revision:7});
 assert.equal(s.draft.paidVideo.fileId,'uncertain_prior_video');
 assert.equal(s.screen,'editor');
 assert.match(x.screens.at(-1).panel.text,/前の投稿結果が未確定/);
});

 test('rendered sample text link stays inside private wizard and cannot submit',async()=>{
 const x=setup();
 await x.callback('menu:listing');
 await x.send({video:{file_id:'synthetic_main_01'},caption:'テスト'},1101);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 const link=x.screens.at(-1).panel.entities.find(e=>e.url.includes('ved_sample_r'));
 assert.ok(link);
 const revision=Number(new URL(link.url).searchParams.get('start').split('_r')[1]);
 await x.handler.openTextEdit({message:{chat:{id:33,type:'private'},from:{id:33},message_id:1103}},'sample',revision);
 const state=x.states.get(33);
 assert.equal(state.screen,'field');assert.equal(state.waiting,'sample');
 const panel=x.screens.at(-1).panel;
 assert.ok(panel.reply_markup.inline_keyboard.flat().every(b=>!b.callback_data.startsWith('entry:register')));
 assert.match(panel.text,/新しいサンプル動画を送信/);
 assert.equal(x.calls.filter(c=>c.method==='answerCallbackQuery').length,2);
 assert.ok(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===1103));
 await x.send({video:{file_id:'upload001',duration:15}},1102);
 assert.equal(x.states.get(33).draft.sample.fileId,'prepared_sample_001');
 assert.equal(x.states.get(33).screen,'editor');
 });

test('incomplete preview reference set is reported as incomplete and original input is retained',async()=>{
 const x=setup({mediaProcessorOverride:{async prepareMissingPreviews(){return {thumbnail:{fileId:'photo_auto_1'},sample:{fileId:'sample_auto_1',durationSeconds:30}};}}});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'synthetic_source_01'},caption:'Synthetic fixture'},9401);
 const state=x.states.get(33);
 assert.equal(state.draft.paidVideo.fileId,'synthetic_source_01');
 assert.equal(state.draft.thumbnail.secondFileId,undefined);
 assert.match(x.screens.at(-1).panel.text,/取得が完了していません/);
 assert.equal(x.calls.some(c=>c.method==='sendMediaGroup'),false);
 assert.equal(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===9401),false);
});
test('missing preview adapter output is not reported as completed',async()=>{
 const x=setup({mediaProcessorOverride:{async prepareMissingPreviews(){return {};}}});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'synthetic_source_02'},caption:'Synthetic fixture'},9402);
 assert.equal(x.states.get(33).draft.sample,null);
 assert.match(x.screens.at(-1).panel.text,/取得が完了していません/);
 assert.equal(x.calls.some(c=>c.method==='sendMediaGroup'),false);
});

test('independent input and preview failures remain visible together',async()=>{
 const x=setup({mediaProcessorOverride:{
   async optimizeMainVideo(){throw new Error('synthetic optimization failure');},
   async prepareMissingPreviews(){throw new Error('fetch failed');}
 }});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'synthetic_warning_fixture'},caption:'Synthetic fixture'},9403);
 const panel=x.screens.at(-1).panel.text;
 assert.match(panel,/本編圧縮は完了していません/);
 assert.match(panel,/Telegramから動画を取得できませんでした/);
 assert.equal(x.states.get(33).draft.paidVideo.fileId,'synthetic_warning_fixture');
 assert.equal(x.states.get(33).draft.sample,null);
 assert.equal(x.calls.some(c=>c.method==='sendMediaGroup'),false);
 assert.equal(x.calls.some(c=>c.method==='deleteMessage'&&c.params.message_id===9403),false);
});

test('missing terms URL and legacy confirmation never terminate navigation or publish',async()=>{
  let publications=0;
  const x=setup({termsUrl:'',publishListing:async()=>{publications++;throw Error('unexpected publish');}});
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'synthetic fixture'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  await x.callback('edit:price|r'+x.states.get(33).revision);
  await x.callback('edit:price:300|r'+x.states.get(33).revision);
  await x.callback('entry:register|r'+x.states.get(33).revision);
  for(const action of ['review:agree','review:rights','review:publish']){
    const before=x.states.get(33);
    const result=await x.callback(action+'|r'+before.revision);
    assert.equal(result.handled,true);
    assert.equal(x.states.get(33).draft.paidVideo.fileId,'main001');
    assert.notEqual(x.states.get(33).draft.feeTermsAccepted,true);
    assert.match(x.screens.at(-1).panel.text,/規約本文を確認できません/);
    assert.equal(x.screens.at(-1).panel.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:agree')),false);
  }
  await x.callback('review:edit|r'+x.states.get(33).revision);
  assert.equal(x.states.get(33).screen,'editor');
  await x.callback('menu:video');
  assert.equal(x.states.get(33).screen,'my_videos');
  await x.callback('menu:listing');
  assert.equal(x.states.get(33).screen,'await_video');
  assert.equal(publications,0);
});

test('legacy orphaned session can open a genuinely new entry while old receipt remains unknown',async()=>{
 const x=setup({listingStoreOverride:{
  async listByOwner(owner){return [{id:'old1',sellerId:String(owner),title:'旧下書き',status:'draft',publicationState:'unconfirmed'}];},
  async findUnresolvedRegistration(){return null;}
 }});
 x.states.set(33,{revision:1,screenMessageId:101,screen:'home',draft:null,publishing:'needs_reconcile',pendingVideoDraft:null});
 await x.callback('menu:listing');
 assert.equal(x.states.get(33).screen,'await_video');
 assert.equal(x.states.get(33).publishing,null);
 assert.equal(x.states.get(33).draft.paidVideo,null);
});
test('an unresolved same-file registration cannot create another row or call publication',async()=>{
 let creates=0,publishes=0;
 const x=setup({listingStoreOverride:{
  async findUnresolvedRegistration(owner,file){assert.equal(file,'main001');return {id:'old1',status:'draft',publicationState:'unconfirmed'};},
  async createDraft(){creates++;throw Error('must not create');},
  async updateDraft(){throw Error('must not update');},async markPublished(){throw Error('must not mark');}
 },publishListing:async()=>{publishes++;throw Error('must not publish');}});
 await x.callback('menu:listing');
 await x.send({video:{file_id:'main001',duration:90},caption:'検証用'},210);
 await x.callback('entry:skip|r'+x.states.get(33).revision);
 await x.callback('edit:price|r'+x.states.get(33).revision);
 await x.callback('edit:price:300|r'+x.states.get(33).revision);
 await x.callback('entry:register|r'+x.states.get(33).revision);
 await x.callback('review:agree|r'+x.states.get(33).revision);
 assert.equal(creates,0);assert.equal(publishes,0);
 assert.match(x.screens.at(-1).panel.text,/以前の投稿結果が未確認/);
});

test('synthetic registration failure identifies the failed stage without reporting success or retrying',async()=>{
 for(const stage of ['draft_save','delivery','receipt_save']){
  let creates=0,sends=0,marks=0,reservedId;
  const x=setup({listingStoreOverride:{
   async createDraft(owner,id,draft){
    creates++;reservedId=id;
    assert.equal(x.states.get(owner).pendingVideoDraft.listingId,id);
    if(stage==='draft_save')throw Error('fixture database acknowledgement unavailable');
    return {...draft,id,revision:1,sellerId:String(owner)};
   },
   async updateDraft(){throw Error('unexpected fixture update');},
   async markPublished(){marks++;throw Error('fixture receipt save unavailable');}
  },publishListing:async()=>{
    sends++;
    if(stage==='delivery')throw Error('fixture response unknown');
    return {posted:true,paidMessageId:303,freeMessageIds:[301,302]};
  }});
  await x.callback('menu:listing');
  await x.send({video:{file_id:'fixture_video_only',duration:90},caption:'Synthetic test'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  await x.callback('edit:price|r'+x.states.get(33).revision);
  await x.callback('edit:price:300|r'+x.states.get(33).revision);
  await x.callback('entry:register|r'+x.states.get(33).revision);
  await x.callback('review:agree|r'+x.states.get(33).revision);
  const state=x.states.get(33);
  assert.equal(state.publishing,'needs_reconcile');
  assert.equal(state.pendingVideoDraft.listingId,reservedId);
  assert.equal(creates,1);
  assert.equal(sends,stage==='draft_save'?0:1);
  assert.equal(marks,stage==='receipt_save'?1:0);
  const message=x.screens.at(-1).panel.text;
  assert.match(message,/登録完了は確認できません/);
  assert.match(message,{draft_save:/登録情報の保存結果/,delivery:/投稿先への送信結果/,receipt_save:/投稿完了記録の保存結果/}[stage]);
  assert.doesNotMatch(message,/新規動画を登録しました/);
  await x.callback('review:agree|r'+state.revision);
  assert.equal(creates,1);
  assert.equal(sends,stage==='draft_save'?0:1);
 }
});

test('returning from a saved one-thumbnail review restores missing preview assets without publishing',async()=>{
  let recoveries=0,published=0;
  const x=setup({
    mediaProcessorOverride:{async prepareMissingPreviews(draft){
      recoveries++;
      return {thumbnail:{fileId:draft.thumbnail?.fileId??'first_photo',secondFileId:'second_photo'},
        sample:{fileId:'generated_sample',durationSeconds:60}};
    }},
    publishListing:async()=>{published++;return {posted:true,paidMessageId:99};}
  });
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'保存済み作品'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const old=x.states.get(33);
  const saved={...old.draft,thumbnail:{fileId:'first_photo'},
    sample:{fileId:'saved_sample',durationSeconds:30},priceStars:100};
  recoveries=0;
  x.states.set(33,{...old,draft:saved,screen:'review'});
  await x.callback('review:edit|r'+old.revision);
  const state=x.states.get(33);
  assert.equal(state.screen,'editor');
  assert.equal(state.draft.paidVideo.fileId,'main001');
  assert.equal(state.draft.thumbnail.secondFileId,'second_photo');
  assert.deepEqual(state.draft.sample,saved.sample);
  assert.equal(state.draft.priceStars,100);
  assert.equal(recoveries,1);
  assert.equal(published,0);
});
test('return from unresolved review preserves receipt reconciliation and does not regenerate',async()=>{
  let recoveries=0;
  const x=setup({mediaProcessorOverride:{async prepareMissingPreviews(){recoveries++;return {};}}});
  await x.callback('menu:listing');
  await x.send({video:{file_id:'main001',duration:90},caption:'保留作品'},210);
  await x.callback('entry:skip|r'+x.states.get(33).revision);
  const old=x.states.get(33);
  const pending={listingId:'pending_1',revision:1};
  x.states.set(33,{...old,screen:'review',publishing:'needs_reconcile',pendingVideoDraft:pending});
  recoveries=0;
  await x.callback('review:edit|r'+old.revision);
  assert.equal(recoveries,0);
  assert.equal(x.states.get(33).publishing,'needs_reconcile');
  assert.deepEqual(x.states.get(33).pendingVideoDraft,pending);
});
