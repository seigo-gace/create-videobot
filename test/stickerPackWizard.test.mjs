import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerWizard} from '../src/telegram/stickerWizard.mjs';

function fixture({timeoutOnMove=false}={}) {
  let state={revision:1,screen:'home',screenMessageId:301,
    draft:{paidVideo:{fileId:'must-preserve'}},stickerSets:{}};
  const pack={pack_name:'s42_112233aabb_by_CreateVdobot',owner_user_id:42,
    kind:'regular',title:'Original',item_count:2,format:'static'};
  let items=[
    {file_unique_id:'unique_a',file_id:'file_a',emoji:'🙂',position:0,format:'static'},
    {file_unique_id:'unique_b',file_id:'file_b',emoji:'😀',position:1,format:'static'}
  ];
  let mutations=0,readbacks=0;
  const store={
    read:async()=>structuredClone(state),
    write:async(_id,revision,next)=>{
      assert.equal(_id,42);
      assert.equal(revision,state.revision);
      state=structuredClone(next);
    },
    setScreen:async(_id,revision,messageId)=>{
      assert.equal(revision,state.revision);
      state.screenMessageId=messageId;
    }
  };
  const inventory={
    listPacks:async(id)=>id===42?[structuredClone(pack)]:[],
    getOwnedPack:async(id,name)=>id===42&&name===pack.pack_name?
      structuredClone(pack):null,
    listOwnedItems:async({ownerId,packName,limit,offset})=>{
      if(ownerId!==42||packName!==pack.pack_name)throw Error('foreign pack');
      return structuredClone(items.slice(offset,offset+limit));
    }
  };
  const apply=command=>{
    if(command.action==='title')pack.title=command.title;
    if(command.action==='move_item') {
      const at=items.findIndex(x=>x.file_unique_id===command.stickerUniqueId);
      const [item]=items.splice(at,1);items.splice(command.position,0,item);
    }
    if(command.action==='emoji')
      items.find(x=>x.file_unique_id===command.stickerUniqueId).emoji=command.emoji;
    if(command.action==='delete_item') {
      items=items.filter(x=>x.file_unique_id!==command.stickerUniqueId);
      pack.item_count=items.length;
    }
    if(command.action==='replace_item') {
      const item=items.find(x=>x.file_unique_id===command.stickerUniqueId);
      item.file_unique_id='new_unique';
      item.file_id='new_file';
    }
    items.forEach((x,i)=>{x.position=i;});
  };
  const editor=async command=>{
    assert.equal(command.owner,42);
    assert.equal(command.packName,pack.pack_name);
    if(command.verifyOnly){
      readbacks++;return {verified:true};
    }
    mutations++;
    if(timeoutOnMove&&command.action==='move_item')throw Error('Telegram timeout');
    if(command.action==='replace_item') {
      assert.equal(command.sourceFileId,'replace_image');
      const receipt={fileUniqueId:'new_unique',format:'static'};
      await command.onUploaded(receipt);
      await command.onBeforeMutation(receipt);
    }
    apply(command);return {verified:true};
  };
  const panels=[];
  const wizard=createStickerWizard({
    api:async(method)=>method==='deleteMessage'?true:true,
    sessionStore:store,packInventory:inventory,
    screenTransport:{show:async(_id,_old,panel)=>{
      panels.push(panel);return {messageId:301};
    }},
    publishSticker:async()=>{throw Error('unexpected publish');},
    editPack:editor,stickerShopBaseUrl:'https://shop.hentaigay.org/'
  });
  const cb=data=>({callback_query:{id:'cb',from:{id:42},data,
    message:{chat:{type:'private',id:42},message_id:301}}});
  const msg=text=>({message:{from:{id:42},chat:{type:'private',id:42},
    message_id:302,text}});
  const click=async action=>wizard.handle(cb(action+'|r'+state.revision));
  const enter=async()=>{await wizard.handle(cb('menu:stickers'));await click('sticker:packs');
    await click('sticker:kind:regular');await click('sticker:edit_pack:0');};
  return {wizard,cb,msg,click,enter,panels,state:()=>state,pack,
    items:()=>items,counts:()=>({mutations,readbacks})};
}

test('STK-02 title edit uses one DM screen, owner inventory and preserves video draft',async()=>{
  const f=fixture();
  await f.enter();
  await f.click('sticker:rename');
  assert.equal(f.state().screen,'sticker_pack_title');
  await f.wizard.handle(f.msg('New title'));
  assert.equal(f.state().screen,'sticker_pack_items');
  assert.equal(f.pack.title,'New title');
  assert.equal(f.state().stickerEditPending,null);
  assert.equal(f.state().draft.paidVideo.fileId,'must-preserve');
  assert.equal(f.counts().mutations,1);
  const keyboard=f.panels.at(-1).reply_markup.inline_keyboard;
  assert.ok(keyboard.flat().some(b=>b.web_app?.url?.includes('/shop/my-pack?pack=')));
});
test('STK-02 edit timeout survives as a locked receipt; readback never repeats mutation',async()=>{
  const f=fixture({timeoutOnMove:true});
  await f.enter();
  await f.wizard.selectGalleryItem({ownerId:42,packName:f.pack.pack_name,index:1});
  await f.click('sticker:move_up');
  assert.equal(f.state().screen,'sticker_edit_reconcile');
  assert.equal(f.state().stickerEditPending.status,'needs_reconcile');
  assert.equal(f.counts().mutations,1);
  const blocked=await f.click('sticker:move_up');
  assert.equal(blocked.editLocked,true);
  const check=await f.click('sticker:edit_check');
  assert.equal(check.handled,true);
  assert.equal(f.state().screen,'sticker_pack_items');
  assert.equal(f.state().stickerEditPending,null);
  assert.deepEqual(f.counts(),{mutations:1,readbacks:1});
});
test('STK-02 deletion requires explicit confirmation and updates item inventory',async()=>{
  const f=fixture();
  await f.enter();
  await f.wizard.selectGalleryItem({ownerId:42,packName:f.pack.pack_name,index:0});
  await f.click('sticker:delete');
  assert.equal(f.counts().mutations,0);
  assert.equal(f.state().screen,'sticker_item_delete_confirm');
  await f.click('sticker:delete_confirm');
  assert.equal(f.counts().mutations,1);
  assert.equal(f.state().screen,'sticker_pack_items');
  assert.deepEqual(f.items().map(x=>x.file_unique_id),['unique_b']);
  assert.equal(f.state().draft.paidVideo.fileId,'must-preserve');
});
test('STK-02 stale callbacks cannot edit a pack twice',async()=>{
  const f=fixture();
  await f.enter();
  const action='sticker:rename|r'+f.state().revision;
  await f.wizard.handle(f.cb(action));
  const stale=await f.wizard.handle(f.cb(action));
  assert.equal(stale.staleButton,true);
  assert.equal(f.counts().mutations,0);
});

test('STK-02 item replacement uses durable upload checkpoint before Telegram mutation',async()=>{
  const f=fixture();
  await f.enter();
  await f.wizard.selectGalleryItem({ownerId:42,packName:f.pack.pack_name,index:0});
  await f.click('sticker:replace_item');
  assert.equal(f.state().screen,'sticker_replace_input');
  await f.wizard.handle({message:{from:{id:42},chat:{id:42,type:'private'},
    message_id:305,photo:[{file_id:'replace_image',file_size:1234}]}});
  assert.equal(f.state().screen,'sticker_replace_ready');
  assert.equal(f.counts().mutations,0);
  await f.click('sticker:replace_confirm');
  assert.equal(f.counts().mutations,1);
  assert.equal(f.state().stickerEditPending,null);
  assert.equal(f.state().screen,'sticker_pack_items');
  assert.equal(f.items()[0].file_unique_id,'new_unique');
  assert.equal(f.state().draft.paidVideo.fileId,'must-preserve');
});

test('STK-02 selected pack exposes native Telegram contents preview with correct pack identity',async()=>{
 const f=fixture();
 await f.enter();
 const panel=f.panels.at(-1);
 assert.equal(panel.text.includes('素材一覧'),true);
 const links=panel.reply_markup.inline_keyboard.flat().filter(b=>b.url);
 assert.deepEqual(links,[{text:'👀 パックの中身を見る',
   url:'https://t.me/addstickers/s42_112233aabb_by_CreateVdobot'}]);
 await f.click('sticker:items');
 const itemLinks=f.panels.at(-1).reply_markup.inline_keyboard.flat().filter(b=>b.url);
 assert.deepEqual(itemLinks,links);
});
