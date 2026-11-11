import test from 'node:test';
import assert from 'node:assert/strict';
import {stickerSetName,inputSticker,createStickerSetParams} from '../src/stickers/packContract.mjs';
test('valid Telegram set names include the verified bot suffix',()=>{
  const name=stickerSetName('GayBBS','CreateVdobot','a1b2c3');
  assert.equal(name,'GayBBS_a1b2c3_by_CreateVdobot');
  assert.ok(name.length<=64);
});
test('rejects invalid names instead of guessing or silently truncating',()=>{
  assert.throws(()=>stickerSetName('invalid name','CreateVdobot','a1b2c3'));
  assert.throws(()=>stickerSetName('GayBBS','CreateVdobot','123'));
  assert.throws(()=>stickerSetName('GayBBS','CreateVdobot','a1b2c345678901234567'));
});
test('static/emoji and video/regular sets carry the required API fields',()=>{
  const s=inputSticker({fileId:'abc_def123',format:'static'});
  assert.deepEqual(s,{sticker:'abc_def123',format:'static',emoji_list:['🙂']});
  const emoji=createStickerSetParams({userId:123,name:'GayBBS_abcdef_by_CreateVdobot',
    title:'GayBBS Emojis',sticker:s,type:'custom_emoji'});
  assert.equal(emoji.user_id,123);
  assert.equal(emoji.sticker_type,'custom_emoji');
  assert.equal(emoji.stickers.length,1);
  assert.equal(inputSticker({fileId:'abc_def123',format:'video'}).format,'video');
});
test('rejects wrong owner, empty emoji, absent uploaded file and mismatched type',()=>{
  assert.throws(()=>inputSticker({fileId:'x',format:'video'}));
  assert.throws(()=>inputSticker({fileId:'abc123',format:'video',emoji:''}));
  assert.throws(()=>inputSticker({fileId:'abc123',format:'animated'}));
  assert.throws(()=>createStickerSetParams({userId:0}));
  assert.throws(()=>createStickerSetParams({userId:123,name:'GayBBS_abcdef_by_CreateVdobot',
    title:'x',sticker:inputSticker({fileId:'abc123',format:'static'}),type:'unknown'}));
});
