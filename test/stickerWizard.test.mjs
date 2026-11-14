import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerWizard} from '../src/telegram/stickerWizard.mjs';

function fixture(){
 let state={revision:1,screen:'home',screenMessageId:301,
   draft:{paidVideo:{fileId:'preserve-video'}},stickerSets:{}};
 const calls=[];
 const store={
  async read(){return structuredClone(state);},
  async write(id,prev,next){
    assert.equal(id,42);
    assert.equal(state.revision,prev);
    state=structuredClone(next);
  },
  async setScreen(id,rev,messageId){
    assert.equal(rev,state.revision);state.screenMessageId=messageId;
  }
 };
 const screen={async show(id,old,panel){
   calls.push(['show',panel.text]);
   assert.equal(id,42);return {messageId:301,replaced:true};
 }};
 const api=async(name,args)=>{calls.push([name,args]);return true;};
 const publisher=async params=>{
   calls.push(['publish',params]);
   return {name:'s42_112233aabbccddff_by_CreateVdobot',verified:true};
 };
 const wizard=createStickerWizard({api,sessionStore:store,screenTransport:screen,publishSticker:publisher});
 const cb=(data)=>({callback_query:{id:'c1',data,from:{id:42},
   message:{chat:{id:42,type:'private'},message_id:301}}});
 const msg=(attrs)=>({message:{chat:{id:42,type:'private'},from:{id:42},
   message_id:302,...attrs}});
 return {wizard,calls,cb,msg,state:()=>state};
}
test('full DM creation: choose, title, input, explicit register, readback display',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 assert.equal(f.state().screen,'sticker_choose');
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 assert.equal(f.state().screen,'sticker_title');
 await f.wizard.handle(f.msg({text:'My stickers'}));
 assert.equal(f.state().screen,'sticker_input');
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 assert.equal(f.state().screen,'sticker_ready');
 await f.wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_done');
 assert.equal(f.state().stickerSets.regular.title,'My stickers');
 assert.equal(f.state().draft.paidVideo.fileId,'preserve-video');
 assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='deleteMessage').length,2);
});
test('stale callback cannot register a second time',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 const r=await f.wizard.handle(f.cb('sticker:type:regular|r1'));
 assert.equal(r.staleButton,true);
 assert.equal(f.calls.filter(c=>c[0]==='publish').length,0);
});
test('unknown Telegram registration is locked and never auto retried',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:custom_emoji|r2'));
 await f.wizard.handle(f.msg({text:'Emoji pack'}));
 await f.wizard.handle(f.msg({document:{file_id:'filedef'}}));
 const broken=createStickerWizard({
   api:async()=>true,
   sessionStore:{
    read:async()=>f.state(),
    write:async(_id,prev,next)=>{assert.equal(prev,f.state().revision);Object.assign(f.state(),next);},
    setScreen:async()=>{}
   },
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async({onUploaded,onBeforeMutation})=>{
     const receipt={name:'s42_112233aabbccddff_by_CreateVdobot',
       fileUniqueId:'unique-42',format:'static'};
     await onUploaded(receipt);
     await onBeforeMutation(receipt);
     throw new Error('Telegram timeout');
   }
 });
 await broken.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.equal(f.state().stickerPending.status,'needs_reconcile');
 assert.equal(f.state().stickerPending.fileId,'filedef');
 const result=await broken.handle(f.cb('sticker:register|r5'));
 assert.equal(result.registrationLocked,true);
 const menuAttempt=await broken.handle(f.cb('menu:stickers'));
 assert.equal(menuAttempt.handled,true);
 assert.equal(f.state().screen,'sticker_choose');
 assert.equal(f.state().stickerDeferred,true);
 const linkAttempt=await broken.handle(f.msg({text:'/start sticker'}));
 assert.equal(linkAttempt.handled,true);
 assert.equal(f.state().screen,'sticker_choose');
 assert.equal(f.state().stickerPending.status,'needs_reconcile');
 const blocked=await broken.handle(f.cb('sticker:type:regular|r'+f.state().revision));
 assert.equal(blocked.registrationLocked,true);
 const resume=await broken.handle(f.cb('sticker:resume|r'+f.state().revision));
 assert.equal(resume.handled,true);
 assert.equal(f.state().screen,'sticker_reconcile');
 const genericStart=await broken.handle(f.msg({text:'/start'}));
 assert.deepEqual(genericStart,{handled:false},'normal menu must remain available');
 const inputAttempt=await broken.handle(f.msg({document:{file_id:'fileghi'}}));
 assert.equal(inputAttempt.registrationLocked,true);
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.equal(f.state().stickerPending.fileId,'filedef');
});

test('readback reconciliation can unlock a successful but timed-out Telegram pack write',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Recovered pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 const store={
   read:async()=>structuredClone(f.state()),
   write:async(_owner,prev,next)=>{
     assert.equal(prev,f.state().revision);
     Object.assign(f.state(),structuredClone(next));
   },
   setScreen:async(_owner,revision,messageId)=>{
     assert.equal(revision,f.state().revision);
     f.state().screenMessageId=messageId;
   }
 };
 let writeCount=0,checkCount=0;
 const wizard=createStickerWizard({
   api:async()=>true,
   sessionStore:store,
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async({onUploaded,onBeforeMutation})=>{
     await onUploaded({name:'s42_112233aabbccddff_by_CreateVdobot',
       fileUniqueId:'unique-42',format:'static'});
     await onBeforeMutation({name:'s42_112233aabbccddff_by_CreateVdobot',
       fileUniqueId:'unique-42',format:'static'});
     writeCount++;
     throw new Error('Telegram lost successful response');
   },
   reconcileSticker:async({pending})=>{
     checkCount++;
     assert.equal(pending.fileUniqueId,'unique-42');
     assert.equal(pending.phase,'submission_started');
     return {status:'registered',verified:true,
       name:'s42_112233aabbccddff_by_CreateVdobot'};
   }
 });
 await wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.equal(f.state().stickerPending.status,'needs_reconcile');
 const recovered=await wizard.handle(f.cb('sticker:check|r'+f.state().revision));
 assert.equal(recovered.handled,true);
 assert.equal(f.state().screen,'sticker_done');
 assert.equal(f.state().stickerPending,null);
 assert.equal(f.state().stickerSets.regular.title,'Recovered pack');
 assert.equal(writeCount,1);
 assert.equal(checkCount,1);
});
test('negative readback never retries registration or clears unknown state',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Unknown pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 let writes=0;
 const store={read:async()=>structuredClone(f.state()),write:async(_id,rev,next)=>{
   assert.equal(rev,f.state().revision);
   Object.assign(f.state(),structuredClone(next));
 },setScreen:async()=>{}};
 const wizard=createStickerWizard({api:async()=>true,sessionStore:store,
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async({onUploaded,onBeforeMutation})=>{
     await onUploaded({name:'s42_112233aabbccddff_by_CreateVdobot',
       fileUniqueId:'unique-42',format:'static'});
     await onBeforeMutation({name:'s42_112233aabbccddff_by_CreateVdobot',
       fileUniqueId:'unique-42',format:'static'});
     writes++;
     throw new Error('timeout');
   },
   reconcileSticker:async()=>({status:'not_observed',verified:false})
 });
 await wizard.handle(f.cb('sticker:register|r5'));
 await wizard.handle(f.cb('sticker:check|r'+f.state().revision));
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.equal(f.state().stickerPending.status,'needs_reconcile');
 assert.equal(writes,1);
});

test('interrupted registration restores reconciliation screen on sticker deep link',async()=>{
 const f=fixture();
 const state=f.state();
 state.revision=6;
 state.screen='sticker_registering';
 state.stickerDraft={kind:'regular',title:'Recovered',fileId:'fileabc',nonce:'112233aabbccddff'};
 state.stickerPending={status:'in_progress',kind:'regular',title:'Recovered',
   fileId:'fileabc',nonce:'112233aabbccddff',format:'static',
   fileUniqueId:'unique-42',packName:'s42_112233aabbccddff_by_CreateVdobot',
   phase:'submission_started'};
 let writes=0;
 const store={read:async()=>structuredClone(state),
   write:async(_id,rev,next)=>{assert.equal(rev,state.revision);Object.assign(state,structuredClone(next));},
   setScreen:async(_id,rev,messageId)=>{assert.equal(rev,state.revision);state.screenMessageId=messageId;}};
 const wizard=createStickerWizard({api:async()=>true,sessionStore:store,
  screenTransport:{show:async()=>({messageId:301})},
  publishSticker:async()=>{writes++;throw Error('should never publish');},
  reconcileSticker:async()=>({status:'registered',verified:true,name:'s42_112233aabbccddff_by_CreateVdobot'})
 });
 const res=await wizard.handle(f.msg({text:'/start sticker'}));
 assert.equal(res.handled,true);
 assert.equal(state.screen,'sticker_reconcile');
 assert.equal(state.stickerPending.status,'needs_reconcile');
 assert.equal(state.stickerPending.fileUniqueId,'unique-42');
 assert.equal(writes,0);
 const confirmed=await wizard.handle(f.cb('sticker:check|r'+state.revision));
 assert.equal(confirmed.handled,true);
 assert.equal(state.screen,'sticker_done');
 assert.equal(state.stickerPending,null);
 assert.equal(writes,0);
});

test('failure before pack mutation permits retry; after mutation remains locked',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Preflight pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 const store={
   read:async()=>structuredClone(f.state()),
   write:async(_id,rev,next)=>{
     assert.equal(rev,f.state().revision);
     Object.assign(f.state(),structuredClone(next));
   },
   setScreen:async()=>{}
 };
 let attempts=0;
 const wizard=createStickerWizard({
   api:async()=>true,sessionStore:store,
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async()=>{
     attempts++;
     const error=new Error('FFmpeg failed before Telegram pack mutation');
     error.preMutationVerified=true; // Simulates publisher DB-receipt release.
     throw error;
   }
 });
 await wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerPending,null);
 assert.equal(f.state().stickerDraft.fileId,'fileabc');
 await wizard.handle(f.cb('sticker:register|r'+f.state().revision));
 assert.equal(attempts,2);
 assert.equal(f.state().screen,'sticker_ready');
});

test('unsupported material gets explanatory guidance in the same DM screen',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:custom_emoji|r2'));
 await f.wizard.handle(f.msg({text:'Friendly emoji'}));
 const r=await f.wizard.handle(f.msg({text:'PDF please'}));
 assert.equal(r.handled,true);
 assert.equal(f.state().screen,'sticker_input');
 assert.match(f.state().stickerHelp,/JPG\/PNG/);
 assert.equal(f.state().draft.paidVideo.fileId,'preserve-video');
 await f.wizard.handle(f.msg({document:{file_id:'valid_image'}}));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerHelp,null);
});
test('oversize media explains 20MB limit before any registration',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Normal pack'}));
 await f.wizard.handle(f.msg({video:{file_id:'large_video',file_size:20_000_001}}));
 assert.equal(f.state().screen,'sticker_input');
 assert.match(f.state().stickerHelp,/20MB/);
 assert.equal(f.state().stickerDraft.fileId,null);
 assert.equal(f.calls.filter(c=>c[0]==='publish').length,0);
});
test('pre-submission conversion error tells creator what to do without raw exception',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Conversion pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'photo_file'}]}));
 const store={read:async()=>structuredClone(f.state()),
   write:async(_id,revision,next)=>{
     assert.equal(revision,f.state().revision);
     Object.assign(f.state(),structuredClone(next));
   },setScreen:async()=>{}};
 const wizard=createStickerWizard({api:async()=>true,sessionStore:store,
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async()=>{
     const error=new Error('STICKER_OUTPUT_SIZE_EXCEEDED');
     error.preMutationVerified=true; // DB claim cleanup has succeeded.
     throw error;
   }});
 await wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerPending,null);
 assert.match(f.state().stickerHelp,/容量上限/);
});

test('PDF is explained and can be replaced by image/video in common DM panel',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Easy pack'}));
 await f.wizard.handle(f.msg({document:{file_id:'pdf_file',mime_type:'application/pdf',file_size:5000}}));
 assert.equal(f.state().screen,'sticker_input');
 assert.match(f.state().stickerHelp,/画像・動画ではありません/);
 assert.equal(f.state().stickerDraft.fileId,null);
 await f.wizard.handle(f.msg({photo:[{file_id:'jpg_image',file_size:3000}]}));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerHelp,null);
 await f.wizard.handle(f.cb('sticker:replace|r'+f.state().revision));
 assert.equal(f.state().screen,'sticker_input');
 assert.equal(f.state().stickerDraft.fileId,null);
 await f.wizard.handle(f.msg({video:{file_id:'movie_clip',file_size:8000}}));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerDraft.fileId,'movie_clip');
 assert.equal(f.calls.filter(c=>c[0]==='publish').length,0);
});
test('invalid pack title is explained and corrected without new DM message',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'   '}));
 assert.equal(f.state().screen,'sticker_title');
 assert.match(f.state().stickerHelp,/1〜64文字/);
 await f.wizard.handle(f.msg({text:'Corrected name'}));
 assert.equal(f.state().screen,'sticker_input');
 assert.equal(f.state().stickerHelp,null);
 assert.equal(f.state().stickerDraft.title,'Corrected name');
 assert.equal(f.calls.filter(c=>c[0]==='sendMessage').length,0);
});

test('shared DM contract: failed user-input deletion displays manual removal guidance',async()=>{
 let state={revision:1,screen:'home',screenMessageId:301,
   draft:{paidVideo:{fileId:'do-not-touch'}},stickerSets:{}};
 const panels=[];
 const store={
   read:async()=>structuredClone(state),
   write:async(_owner,revision,next)=>{
     assert.equal(revision,state.revision);state=structuredClone(next);
   },
   setScreen:async(_owner,revision,messageId)=>{
     assert.equal(revision,state.revision);state.screenMessageId=messageId;
   }
 };
 const wizard=createStickerWizard({
   api:async(method)=>{if(method==='deleteMessage')throw new Error('forbidden');return true;},
   sessionStore:store,
   screenTransport:{show:async(_owner,_previous,panel)=>{
     panels.push(panel.text);return {messageId:301};
   }},
   publishSticker:async()=>{throw new Error('must not publish');}
 });
 const cb=data=>({callback_query:{id:'c',data,from:{id:42},
   message:{chat:{id:42,type:'private'},message_id:301}}});
 const msg=attrs=>({message:{chat:{id:42,type:'private'},from:{id:42},
   message_id:302,...attrs}});
 await wizard.handle(cb('menu:stickers'));
 await wizard.handle(cb('sticker:type:regular|r2'));
 await wizard.handle(msg({text:'Friendly pack'}));
 assert.equal(state.screen,'sticker_input');
 assert.match(state.stickerHelp,/長押しして削除/);
 assert.match(panels.at(-1),/長押しして削除/);
 assert.equal(state.draft.paidVideo.fileId,'do-not-touch');
 await wizard.handle(msg({photo:[{file_id:'image_file'}]}));
 assert.equal(state.screen,'sticker_ready');
 assert.match(state.stickerHelp,/長押しして削除/);
});

test('unverified DB receipt cleanup never unlocks a prepared sticker for retry',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Keep pending pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 const store={
   read:async()=>structuredClone(f.state()),
   write:async(_owner,revision,next)=>{
     assert.equal(revision,f.state().revision);
     Object.assign(f.state(),structuredClone(next));
   },
   setScreen:async()=>{}
 };
 let attempts=0;
 const wizard=createStickerWizard({api:async()=>true,sessionStore:store,
   screenTransport:{show:async()=>({messageId:301})},
   publishSticker:async()=>{
     attempts++;
     const error=new Error('STICKER_PRE_MUTATION_ABORT_NOT_CONFIRMED');
     error.registrationLocked=true;
     throw error;
   }});
 await wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.equal(f.state().stickerPending.status,'needs_reconcile');
 const attempt=await wizard.handle(f.cb('sticker:register|r'+f.state().revision));
 assert.equal(attempt.registrationLocked,true);
 assert.equal(attempts,1);
});

test('confirmed Telegram rejection safely restores the existing DM draft with fresh nonce',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Recoverable pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 const originalNonce=f.state().stickerDraft.nonce;
 let attempts=0;
 const wizard=createStickerWizard({
  api:async()=>true,
  sessionStore:{
   read:async()=>structuredClone(f.state()),
   write:async(_id,revision,next)=>{assert.equal(revision,f.state().revision);Object.assign(f.state(),structuredClone(next));},
   setScreen:async()=>{}
  },
  screenTransport:{show:async()=>({messageId:301})},
  publishSticker:async()=>{
   attempts++;
   const error=new Error('STICKER_TELEGRAM_REGISTRATION_REJECTED');
   error.safeToRetryVerified=true;
   throw error;
  }
 });
 await wizard.handle(f.cb('sticker:register|r5'));
 assert.equal(f.state().screen,'sticker_ready');
 assert.equal(f.state().stickerPending,null);
 assert.equal(f.state().stickerDraft.fileId,'fileabc');
 assert.notEqual(f.state().stickerDraft.nonce,originalNonce);
 assert.match(f.state().stickerHelp,/登録を拒否/);
 await wizard.handle(f.cb('sticker:register|r'+f.state().revision));
 assert.equal(attempts,2);
});
test('unknown registration can leave the DM screen without dropping receipt or resubmitting',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Still unknown'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 let writes=0;
 const wizard=createStickerWizard({
  api:async()=>true,
  sessionStore:{
   read:async()=>structuredClone(f.state()),
   write:async(_id,revision,next)=>{assert.equal(revision,f.state().revision);Object.assign(f.state(),structuredClone(next));},
   setScreen:async()=>{}
  },
  screenTransport:{show:async()=>({messageId:301})},
  publishSticker:async({onUploaded,onBeforeMutation})=>{
   writes++;
   await onUploaded({name:'s42_112233aabbccddff_by_CreateVdobot',fileUniqueId:'unique-42',format:'static'});
   await onBeforeMutation({name:'s42_112233aabbccddff_by_CreateVdobot',fileUniqueId:'unique-42',format:'static'});
   throw Error('UNKNOWN_AFTER_SUBMISSION');
  },
  reconcileSticker:async()=>({status:'not_observed',verified:false})
 });
 await wizard.handle(f.cb('sticker:register|r5'));
 const pending=structuredClone(f.state().stickerPending);
 await wizard.handle(f.cb('sticker:check|r'+f.state().revision));
 assert.equal(f.state().screen,'sticker_reconcile');
 assert.match(f.state().stickerHelp,/見つかりません/);
 await wizard.handle(f.cb('sticker:defer|r'+f.state().revision));
 assert.equal(f.state().screen,'sticker_choose');
 assert.equal(f.state().stickerDeferred,true);
 assert.deepEqual(f.state().stickerPending,pending);
 assert.equal((await wizard.handle(f.msg({text:'video editor text'}))).handled,false);
 await wizard.handle(f.cb('menu:stickers'));
 assert.equal(f.state().screen,'sticker_choose');
 assert.equal(f.state().stickerDeferred,true);
 assert.deepEqual(f.state().stickerPending,pending);
 assert.equal(writes,1);
});

test('Topic deep link verifies outstanding registration and restores full sticker creation menu',async()=>{
 const f=fixture(),state=f.state();
 state.screen='sticker_reconcile';
 state.stickerPending={status:'needs_reconcile',kind:'regular',title:'Saved pack',
  nonce:'112233aabbccddff',fileId:'file_old'};
 const store={
  read:async()=>structuredClone(f.state()),
  write:async(_id,prev,next)=>{
   assert.equal(prev,f.state().revision);
   Object.assign(f.state(),structuredClone(next));
  },setScreen:async()=>{}
 };
 let readbacks=0,writes=0;
 const wizard=createStickerWizard({api:async()=>true,sessionStore:store,
  screenTransport:{show:async(_id,_message,panel)=>{
   assert.match(panel.text,/ステッカー・絵文字作成/);
   return {messageId:301};
  }},
  publishSticker:async()=>{writes++;throw Error('DUPLICATE_UPLOAD');},
  reconcileSticker:async({owner,pending})=>{
   assert.equal(owner,42);assert.equal(pending.nonce,'112233aabbccddff');
   readbacks++;return {status:'registered',verified:true,
    name:'s42_112233aabbccddff_by_CreateVdobot'};
  }
 });
 const result=await wizard.handle(f.msg({text:'/start sticker'}));
 assert.equal(result.handled,true);
 assert.equal(f.state().screen,'sticker_choose');
 assert.equal(f.state().stickerPending,null);
 assert.equal(f.state().stickerSets.regular.title,'Saved pack');
 assert.equal(f.state().draft.paidVideo.fileId,'preserve-video');
 assert.equal(readbacks,1);assert.equal(writes,0);
});

test('pending Topic deep link shows usable menu and allows read-only owned pack listing',async()=>{
 let state={revision:1,screen:'sticker_reconcile',screenMessageId:301,
   stickerDeferred:false,stickerSets:{},
   stickerPending:{status:'needs_reconcile',kind:'regular',title:'Old pack',nonce:'n1'}};
 const displayed=[];
 const inventory={
   async listPacks(owner,{limit,offset}){
     assert.equal(owner,42);assert.equal(limit,10);assert.equal(offset,0);
     return [{pack_name:'owned_pack',title:'Owned pack',kind:'regular'}];
   },
   async getOwnedPack(owner,name){
     assert.equal(owner,42);assert.equal(name,'owned_pack');
     return {pack_name:name,title:'Owned pack',kind:'regular',item_count:1};
   },
   async listOwnedItems(){return [];}
 };
 const sessionStore={
   async read(){return structuredClone(state);},
   async write(owner,prev,next){
     assert.equal(owner,42);assert.equal(prev,state.revision);
     state=structuredClone(next);
   },
   async setScreen(owner,rev,messageId){
     assert.equal(owner,42);assert.equal(rev,state.revision);
     state.screenMessageId=messageId;
   }
 };
 const wizard=createStickerWizard({
   api:async()=>true,sessionStore,
   screenTransport:{async show(_id,_old,panel){
     displayed.push(panel);return {messageId:301};
   }},
   publishSticker:async()=>{throw new Error('must not publish while pending');},
   reconcileSticker:async()=>({status:'unknown',verified:false}),
   packInventory:inventory
 });
 const message={message:{chat:{id:42,type:'private'},from:{id:42},
   message_id:302,text:'/start sticker'}};
 const callback=data=>({callback_query:{id:'c',data,from:{id:42},
   message:{chat:{id:42,type:'private'},message_id:301}}});
 await wizard.handle(message);
 assert.equal(state.screen,'sticker_choose');
 assert.equal(state.stickerPending.status,'needs_reconcile');
 assert.ok(displayed.at(-1).reply_markup.inline_keyboard.flat()
   .some(button=>button.text.includes('マイパック')));
 await wizard.handle(callback('sticker:packs|r2'));
 assert.equal(state.screen,'sticker_pack_kinds');
 await wizard.handle(callback('sticker:kind:regular|r3'));
 assert.equal(state.screen,'sticker_packs');
 await wizard.handle(callback('sticker:edit_pack:0|r4'));
 assert.equal(state.screen,'sticker_pack');
 assert.equal(state.stickerSelectedPack.title,'Owned pack');
 const blocked=await wizard.handle(callback('sticker:add|r5'));
 assert.equal(blocked.registrationLocked,true);
 assert.equal(state.stickerPending.status,'needs_reconcile');
 await wizard.handle(callback('sticker:pack_back|r5'));
 assert.equal(state.screen,'sticker_choose');
});


test('ordinary /start yields to shared home while unresolved sticker receipts survive',async()=>{
 for(const pendingType of ['stickerPending','stickerEditPending']){
  let state={revision:3,screen:'sticker_reconcile',screenMessageId:301,
    [pendingType]:{status:'needs_reconcile',nonce:'preserved'}};
  const original=structuredClone(state);
  const wizard=createStickerWizard({
   api:async()=>true,
   sessionStore:{
    read:async()=>structuredClone(state),
    write:async()=>{throw Error('plain start must not change sticker state');},
    setScreen:async()=>{throw Error('plain start must not change sticker screen')}
   },
   screenTransport:{show:async()=>{throw Error('sticker wizard must yield to home')}},
   publishSticker:async()=>{throw Error('must not publish')}
  });
  const result=await wizard.handle({message:{
   from:{id:42},chat:{id:42,type:'private'},message_id:401,text:'/start'
  }});
  assert.deepEqual(result,{handled:false});
  assert.deepEqual(state,original);
 }
});

test('Topic sticker entry and cancel remain in sticker-only DM navigation',async()=>{
 const f=fixture();
 await f.wizard.handle(f.msg({text:'/start sticker'}));
 assert.equal(f.state().screen,'sticker_choose');
 assert.match(f.calls.at(-1)[1],/ステッカー・絵文字作成/);
 assert.ok(!f.calls.at(-1)[1].includes('クリエータービデオ'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 assert.equal(f.state().screen,'sticker_title');
 await f.wizard.handle(f.cb('sticker:cancel|r3'));
 assert.equal(f.state().screen,'sticker_choose');
 assert.match(f.calls.at(-1)[1],/ステッカー・絵文字作成/);
 assert.ok(!f.calls.at(-1)[1].includes('クリエータービデオ'));
});

test('unverified registration stays in sticker UI and offers pack inspection instead of video home',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'Pending pack'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 const state=f.state();
 const broken=createStickerWizard({
   api:async()=>true,
   sessionStore:{
     read:async()=>structuredClone(state),
     write:async(_id,prev,next)=>{assert.equal(state.revision,prev);Object.assign(state,structuredClone(next));},
     setScreen:async()=>{}
   },
   screenTransport:{show:async(_id,_messageId,panel)=>{
     assert.doesNotMatch(panel.text,/クリエータービデオ/);
     return {messageId:301};
   }},
   publishSticker:async({onUploaded,onBeforeMutation})=>{
     const receipt={name:'pending_by_CreateVdobot',fileUniqueId:'unique-42',format:'static'};
     await onUploaded(receipt);await onBeforeMutation(receipt);
     throw new Error('Telegram timeout');
   }
 });
 await broken.handle(f.cb('sticker:register|r5'));
 assert.equal(state.screen,'sticker_reconcile');
 await broken.handle(f.cb('sticker:defer|r'+state.revision));
 assert.equal(state.screen,'sticker_choose');
 assert.equal(state.stickerPending.status,'needs_reconcile');
 assert.equal(state.stickerDeferred,true);
 assert.equal(state.draft.paidVideo.fileId,'preserve-video');
});
test('successful creation gives visible pack link and same-pack add and pack inspection actions',async()=>{
 const f=fixture();
 await f.wizard.handle(f.cb('menu:stickers'));
 await f.wizard.handle(f.cb('sticker:type:regular|r2'));
 await f.wizard.handle(f.msg({text:'My stickers'}));
 await f.wizard.handle(f.msg({photo:[{file_id:'fileabc'}]}));
 await f.wizard.handle(f.cb('sticker:register|r5'));
 assert.match(f.calls.at(-1)[1],/登録できました！/);
 assert.match(f.calls.at(-1)[1],/https:\/\/t.me\/addstickers\//);
 assert.equal(f.state().screen,'sticker_done');
});
