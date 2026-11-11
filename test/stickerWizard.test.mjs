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
   publishSticker:async()=>{throw new Error('Telegram timeout');}
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
