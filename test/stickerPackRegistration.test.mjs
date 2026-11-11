import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStickerSetShortName,registerStickerAsset} from '../src/stickers/packRegistration.mjs';

test('short name follows Telegram bot suffix rule',()=>{
  assert.equal(createStickerSetShortName({owner:42,botUsername:'CreateVdobot',nonce:'1234abcd'}),
    's42_1234abcd_by_CreateVdobot');
  assert.throws(()=>createStickerSetShortName({owner:42,botUsername:'bad name',nonce:'1234abcd'}));
});
test('pack registration uploads bytes, creates pack, and reads back real matching sticker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sticker-pack-test-'));
 try {
  const path=join(dir,'a.png');await writeFile(path,Buffer.from('source asset'));
  const calls=[];let set=null;
  const api=async(method,params)=>{
   calls.push(method);
   if(method==='uploadStickerFile'){
    assert.equal(params.sticker_format,'static');
    assert.ok(params.sticker instanceof Uint8Array);
    return {file_id:'file-1',file_unique_id:'uniq-1'};
   }
   if(method==='getStickerSet'){
    if(!set)throw new Error('not found');
    return set;
   }
   if(method==='createNewStickerSet'){
    assert.equal(params.sticker_type,'regular');
    set={name:params.name,sticker_type:'regular',stickers:[{file_id:'file-2',file_unique_id:'uniq-1',is_video:false,is_animated:false}]};
    return true;
   }
   throw new Error('unexpected '+method);
  };
  const result=await registerStickerAsset({telegramApi:api,owner:42,botUsername:'CreateVdobot',title:'Test',
   nonce:'1234abcd',format:'static',mediaPath:path});
  assert.equal(result.verified,true);
  assert.equal(calls.filter(x=>x==='createNewStickerSet').length,1);
  assert.equal(result.name,'s42_1234abcd_by_CreateVdobot');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('registration timeout with no readback never claims success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sticker-fail-test-'));
 try{
  const path=join(dir,'a.png');await writeFile(path,'fake');
  const api=async(method)=>{
   if(method==='uploadStickerFile')return {file_id:'f',file_unique_id:'u'};
   throw new Error('unavailable');
  };
  await assert.rejects(registerStickerAsset({telegramApi:api,owner:42,botUsername:'CreateVdobot',
    title:'Test',nonce:'1234abcd',format:'static',mediaPath:path}),/RESULT_UNKNOWN/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
