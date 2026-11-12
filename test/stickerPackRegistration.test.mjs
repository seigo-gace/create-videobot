import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStickerSetShortName,registerStickerAsset,reconcileStickerRegistration} from '../src/stickers/packRegistration.mjs';

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

test('real registration receipt is persisted before mutating Telegram',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sticker-receipt-test-'));
 try{
  const path=join(dir,'asset.png');await writeFile(path,'stub bytes');
  const events=[];let set=null;
  const api=async(method,params)=>{
   events.push(method);
   if(method==='uploadStickerFile')return {file_id:'file-a',file_unique_id:'identity-a'};
   if(method==='getStickerSet'){if(!set)throw new Error('unknown');return set;}
   if(method==='createNewStickerSet'){
     assert.deepEqual(events.filter(v=>v==='upload-receipt'||v==='mutation-receipt'||v==='createNewStickerSet'),['upload-receipt','mutation-receipt','createNewStickerSet']);
     set={sticker_type:'regular',stickers:[
       {file_unique_id:'identity-a',is_video:false,is_animated:false}]};
     return true;
   }
   throw new Error('unexpected method');
  };
  const result=await registerStickerAsset({telegramApi:api,owner:42,
    botUsername:'CreateVdobot',title:'Test',nonce:'1234abcd',
    format:'static',mediaPath:path,
    onUploaded:receipt=>{
      assert.equal(receipt.fileUniqueId,'identity-a');
      events.push('upload-receipt');
    },
    onBeforeMutation:receipt=>{
      assert.equal(receipt.name,'s42_1234abcd_by_CreateVdobot');
      events.push('mutation-receipt');
    }});
  assert.equal(result.verified,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reconcile requires matching Telegram file identity and pack type',async()=>{
 const telegramApi=async()=>({sticker_type:'regular',stickers:[
   {file_unique_id:'content-1',is_video:false,is_animated:false}]});
 const args={telegramApi,name:'s42_1234abcd_by_CreateVdobot',
   kind:'regular',format:'static'};
 assert.deepEqual((await reconcileStickerRegistration({...args,fileUniqueId:'content-1'})).status,'registered');
 const miss=await reconcileStickerRegistration({...args,fileUniqueId:'other'});
 assert.equal(miss.verified,false);
 assert.equal(miss.status,'not_observed');
 const mismatch=await reconcileStickerRegistration({...args,kind:'custom_emoji',fileUniqueId:'content-1'});
 assert.equal(mismatch.verified,false);
 assert.equal(mismatch.status,'unknown');
 const unreachable=await reconcileStickerRegistration({...args,telegramApi:async()=>{throw new Error('network');},fileUniqueId:'content-1'});
 assert.equal(unreachable.status,'unknown');
});

test('definitively rejected set mutation is not misclassified as ambiguous timeout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sticker-rejected-'));
 try{
  const path=join(dir,'a.png');await writeFile(path,Buffer.from('valid'));
  let mutations=0;
  const stages=[];
  const api=async(method)=>{
   if(method==='uploadStickerFile')return {file_id:'file-1',file_unique_id:'uniq-1'};
   if(method==='getStickerSet')throw Error('pack absent');
   if(method==='createNewStickerSet'){
    mutations++;
    const e=new Error('STICKER_TELEGRAM_REGISTRATION_REJECTED');
    e.definitiveTelegramRejection=true;
    throw e;
   }
   throw Error('unexpected method');
  };
  await assert.rejects(()=>registerStickerAsset({
   telegramApi:api,owner:42,botUsername:'CreateVdobot',title:'Test',
   nonce:'1234abcd',format:'static',mediaPath:path,
   onUploaded:async()=>stages.push('uploaded'),
   onBeforeMutation:async()=>stages.push('submission_started')
  }),e=>e.definitiveTelegramRejection===true);
  assert.equal(mutations,1);
  assert.deepEqual(stages,['uploaded','submission_started']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unique newly created pack recovers when Telegram normalizes uploaded identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sticker-normalized-'));
 try{
  const path=join(dir,'a.png');await writeFile(path,'valid-normalized');
  const name='s42_1234abcd_by_CreateVdobot';
  const set={name,title:'Normalized pack',sticker_type:'regular',
   stickers:[{file_id:'telegram-file',file_unique_id:'telegram-unique',
     is_video:false,is_animated:false,emoji:'🙂'}]};
  let created=false,verifiedReceipt;
  const api=async(method)=>{
   if(method==='uploadStickerFile')return {file_id:'upload-file',file_unique_id:'upload-unique'};
   if(method==='getStickerSet'){
    if(!created)throw Error('not created yet');
    return set;
   }
   if(method==='createNewStickerSet'){created=true;return true;}
   throw Error('unrecognized');
  };
  const result=await registerStickerAsset({
   telegramApi:api,owner:42,botUsername:'CreateVdobot',title:'Normalized pack',
   nonce:'1234abcd',format:'static',mediaPath:path,
   onVerified:async receipt=>{verifiedReceipt=receipt;}
  });
  assert.equal(result.verified,true);
  assert.equal(result.name,name);
  assert.equal(verifiedReceipt.proof,'unique_new_pack');
  assert.equal(verifiedReceipt.item.file_unique_id,'telegram-unique');
  const recovered=await reconcileStickerRegistration({
   telegramApi:api,name,kind:'regular',format:'static',
   fileUniqueId:'upload-unique',expectedTitle:'Normalized pack',isNewPack:true
  });
  assert.equal(recovered.verified,true);
  assert.equal(recovered.proof,'unique_new_pack');
  assert.equal(recovered.item.file_unique_id,'telegram-unique');
  const invalidExisting=await reconcileStickerRegistration({
   telegramApi:api,name,kind:'regular',format:'static',
   fileUniqueId:'upload-unique',expectedTitle:'Normalized pack',isNewPack:false
  });
  assert.equal(invalidExisting.verified,false);
  const wrongTitle=await reconcileStickerRegistration({
   telegramApi:api,name,kind:'regular',format:'static',
   fileUniqueId:'upload-unique',expectedTitle:'Another title',isNewPack:true
  });
  assert.equal(wrongTitle.verified,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
