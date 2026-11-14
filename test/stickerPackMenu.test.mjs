import test from 'node:test';
import assert from 'node:assert/strict';
import {createStickerWizard} from '../src/telegram/stickerWizard.mjs';

function setup(){
  const packs=[
    ...Array.from({length:12},(_,i)=>({
      pack_name:'regular_'+i,kind:'regular',title:'Sticker '+(i+1),item_count:i===0?12:1
    })),
    ...Array.from({length:3},(_,i)=>({
      pack_name:'emoji_'+i,kind:'custom_emoji',title:'Emoji '+(i+1),item_count:1
    }))
  ];
  const items=Array.from({length:12},(_,i)=>({
    position:i,file_unique_id:'unique_'+i,file_id:'file_'+i,emoji:'😀'
  }));
  let state={revision:1,screen:'home',screenMessageId:301,stickerSets:{},
    draft:{paidVideo:{id:'keep'}}};
  const calls=[],panels=[],seenPacks=[];
  const inventory={
    async listPacks(owner,{limit,offset,packKind}){
      assert.equal(owner,42);
      assert.ok(limit===10||limit===1);
      const rows=packs.filter(p=>packKind===null||p.kind===packKind).slice(offset,offset+limit);
      seenPacks.push({limit,offset,packKind});
      return structuredClone(rows);
    },
    async getOwnedPack(owner,name){
      assert.equal(owner,42);
      return structuredClone(packs.find(p=>p.pack_name===name)??null);
    },
    async listOwnedItems({ownerId,packName,limit,offset}){
      assert.equal(ownerId,42);
      return packName==='regular_0'?structuredClone(items.slice(offset,offset+limit)):
        [{position:0,file_unique_id:'one',file_id:'fileone',emoji:'✨'}].slice(offset,offset+limit);
    }
  };
  const wizard=createStickerWizard({
    api:async(method,args)=>{calls.push([method,args]);return true;},
    sessionStore:{
      async read(){return structuredClone(state);},
      async write(id,expected,value){
        assert.equal(id,42);assert.equal(expected,state.revision);
        state=structuredClone(value);
      },
      async setScreen(id,revision,messageId){
        assert.equal(id,42);assert.equal(revision,state.revision);
        state.screenMessageId=messageId;
      }
    },
    screenTransport:{async show(id,_old,panel){
      assert.equal(id,42);panels.push(panel);return {messageId:301};
    }},
    packInventory:inventory,stickerShopBaseUrl:'https://shop.hentaigay.org/',
    publishSticker:async()=>{throw Error('NO_PUBLISH_EXPECTED');}
  });
  const tap=async action=>wizard.handle({callback_query:{
    id:'q',data:action+'|r'+state.revision,from:{id:42},
    message:{chat:{id:42,type:'private'},message_id:301}
  }});
  const labels=()=>panels.at(-1).reply_markup.inline_keyboard.map(row=>row.map(b=>b.text));
  return {tap,labels,state:()=>state,calls,seenPacks,panels,selectGalleryItem:wizard.selectGalleryItem};
}

test('My Packs selects kind, shows 10 compact rows and remains separated from emoji packs',async()=>{
  const f=setup();
  await f.tap('menu:stickers');
  await f.tap('sticker:packs');
  assert.deepEqual(f.labels(),[
    ['🎨 ステッカーパック'],['😀 絵文字パック'],['↩ 戻る']
  ]);
  await f.tap('sticker:kind:regular');
  assert.equal(f.state().stickerPackRows.length,10);
  assert.equal(f.state().stickerPackHasNext,true);
  assert.deepEqual(f.labels()[0],['Sticker 1','➕ 追加','✏️ 編集']);
  assert.deepEqual(f.labels().at(-1),['🔙 戻る','キャンセル','次 ➔']);
  await f.tap('sticker:next');
  assert.equal(f.state().stickerPackPage,1);
  assert.equal(f.state().stickerPackRows.length,2);
  assert.equal(f.labels().at(-1)[0],'◀ 前へ');
  await f.tap('sticker:pack_kinds');
  await f.tap('sticker:kind:custom_emoji');
  assert.equal(f.state().stickerPackRows.length,3);
  assert.equal(f.state().stickerPackRows.every(r=>r.kind==='custom_emoji'),true);
  assert.ok(!f.labels().flat().includes('次 ➔'));
});

test('per-pack add preserves exact pack and edit opens its actual item list',async()=>{
  const f=setup();
  await f.tap('menu:stickers');await f.tap('sticker:packs');
  await f.tap('sticker:kind:regular');
  await f.tap('sticker:add_pack:0');
  assert.equal(f.state().screen,'sticker_input');
  assert.equal(f.state().stickerDraft.setName,'regular_0');
  assert.equal(f.state().draft.paidVideo.id,'keep');
  await f.tap('sticker:cancel');
  await f.tap('sticker:packs');await f.tap('sticker:kind:regular');
  await f.tap('sticker:edit_pack:0');
  assert.equal(f.state().screen,'sticker_pack_items');
  assert.equal(f.state().stickerItemRows.length,10);
  assert.equal(f.state().stickerItemHasNext,true);
  assert.ok(f.labels().flat().includes('✏️ パック名の変更'));
  assert.ok(f.labels().flat().includes('👀 パックの中身を見る'));
  assert.deepEqual(f.labels().at(-2),['🔙 戻る','キャンセル','次 ➔']);
  await f.tap('sticker:items_next');
  assert.equal(f.state().stickerItemPage,1);
  assert.equal(f.state().stickerItemRows.length,2);
  assert.ok(f.panels.at(-1).reply_markup.inline_keyboard.flat().some(b=>
    b.web_app?.url==='https://shop.hentaigay.org/shop/my-pack?pack=regular_0'));
  assert.ok(!f.labels().flat().some(x=>x.includes('番目を編集')));
  await f.selectGalleryItem({ownerId:42,packName:'regular_0',index:0});
  assert.equal(f.state().screen,'sticker_item');
  assert.ok(f.labels().flat().includes('🔄 素材の変更'));
  assert.ok(f.labels().flat().includes('😀 ステッカーの絵文字変更'));
});

test('new pack is independent of the default kind and creates a fresh title draft',async()=>{
  const f=setup();
  await f.tap('menu:stickers');await f.tap('sticker:packs');
  await f.tap('sticker:kind:custom_emoji');
  await f.tap('sticker:new_pack');
  assert.equal(f.state().screen,'sticker_title');
  assert.equal(f.state().stickerDraft.kind,'custom_emoji');
  assert.equal(f.state().stickerDraft.setName,null);
  assert.equal(f.state().stickerDraft.title,null);
  assert.equal(f.state().draft.paidVideo.id,'keep');
});

test('old inline keyboard cannot mutate a selected pack',async()=>{
  const f=setup();
  await f.tap('menu:stickers');await f.tap('sticker:packs');
  await f.tap('sticker:kind:regular');
  const rev=f.state().revision;
  await f.tap('sticker:next');
  const old=await f.tap('sticker:edit_pack:0|r'+rev);
  assert.equal(old.staleButton,true);
  assert.equal(f.state().screen,'sticker_packs');
});
