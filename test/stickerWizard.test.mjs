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
 assert.equal(menuAttempt.registrationLocked,true);
 const linkAttempt=await broken.handle(f.msg({text:'/start sticker'}));
 assert.equal(linkAttempt.registrationLocked,true);
 const genericStart=await broken.handle(f.msg({text:'/start'}));
 assert.equal(genericStart.registrationLocked,true);
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

test('interrupted registration restores read-only reconciliation screen on /start',async()=>{
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
 const res=await wizard.handle(f.msg({text:'/start'}));
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
