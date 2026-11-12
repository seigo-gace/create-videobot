/**
 * Sticker pack editor, bounded to a durable owner-supplied pack receipt.
 * The only mutation methods here are documented Telegram Bot API methods.
 * No product entitlement or paid-asset data is touched.
 */
function allowedSetName(name,botUsername) {
  if(typeof name!=='string'||name.length>64||
     !/^[A-Za-z][A-Za-z0-9_]+$/.test(name)||
     typeof botUsername!=='string'||
     !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botUsername)||
     !name.toLowerCase().endsWith(('_by_'+botUsername).toLowerCase()))
    throw new Error('STICKER_PACK_NAME_NOT_OWNED_BY_BOT');
  return name;
}
function requireSticker(set,fileUniqueId) {
  if(!Array.isArray(set?.stickers)||typeof fileUniqueId!=='string'||!fileUniqueId)
    throw new Error('STICKER_ITEM_INVALID');
  const match=set.stickers.find(s=>s.file_unique_id===fileUniqueId);
  if(!match||typeof match.file_id!=='string'||!match.file_id)
    throw new Error('STICKER_ITEM_NOT_IN_PACK');
  return match;
}
function exactSet(set,name,record) {
  if(!set||set.name!==name||set.sticker_type!==record.kind||
     !Array.isArray(set.stickers))
    throw new Error('STICKER_PACK_RECEIPT_MISMATCH');
}
/** Read-only verification of an uncertain edit. Never issues a second mutation. */
export function verifyStickerPackEditSnapshot({set,name,kind,action,stickerUniqueId,title,position,emoji,newUniqueId}={}) {
  if(!set||set.name!==name||set.sticker_type!==kind||!Array.isArray(set.stickers))
    return false;
  if(action==='title')return set.title===title;
  if(action==='delete_item')
    return !set.stickers.some(s=>s.file_unique_id===stickerUniqueId);
  if(action==='replace_item')
    return typeof newUniqueId==='string'&&newUniqueId!==stickerUniqueId&&
      set.stickers.some(s=>s.file_unique_id===newUniqueId)&&
      !set.stickers.some(s=>s.file_unique_id===stickerUniqueId);
  const found=set.stickers.find(s=>s.file_unique_id===stickerUniqueId);
  if(!found)return false;
  if(action==='move_item')return set.stickers[position]?.file_unique_id===stickerUniqueId;
  if(action==='emoji')return found.emoji===emoji;
  if(action==='replace_item')return false; // handled by newUniqueId below after old item absence
  return false;
}
export async function editStickerPack({
  telegramApi,owner,botUsername,record,action,stickerUniqueId,
  title,position,emoji
}={}) {
  if(typeof telegramApi!=='function'||!Number.isSafeInteger(owner)||owner<=0||
     !record||record.ownerId!==owner||!['regular','custom_emoji'].includes(record.kind))
    throw new Error('STICKER_PACK_OWNER_NOT_VERIFIED');
  const name=allowedSetName(record.name,botUsername);
  if(!['title','delete_item','move_item','emoji'].includes(action))
    throw new Error('STICKER_PACK_ACTION_INVALID');
  const before=await telegramApi('getStickerSet',{name});
  exactSet(before,name,record);
  let method,params,confirm;
  if(action==='title') {
    if(typeof title!=='string'||title.trim().length<1||title.length>64||
       /[\r\n]/.test(title))throw new Error('STICKER_PACK_TITLE_INVALID');
    method='setStickerSetTitle';params={name,title};
    confirm=set=>set.title===title;
  }else {
    const item=requireSticker(before,stickerUniqueId);
    if(action==='delete_item') {
      method='deleteStickerFromSet';params={sticker:item.file_id};
      confirm=set=>!set.stickers.some(s=>s.file_unique_id===stickerUniqueId);
    }else if(action==='move_item') {
      if(!Number.isSafeInteger(position)||position<0||position>=before.stickers.length)
        throw new Error('STICKER_PACK_POSITION_INVALID');
      method='setStickerPositionInSet';params={sticker:item.file_id,position};
      confirm=set=>set.stickers[position]?.file_unique_id===stickerUniqueId;
    }else {
      if(typeof emoji!=='string'||emoji.length<1||emoji.length>16||
         /[\r\n]/.test(emoji))throw new Error('STICKER_EMOJI_INVALID');
      method='setStickerEmojiList';params={sticker:item.file_id,emoji_list:[emoji]};
      confirm=set=>set.stickers.find(s=>s.file_unique_id===stickerUniqueId)?.emoji===emoji;
    }
  }
  // Reconciliation before any retry is the caller's responsibility.
  // Unknown result must not be interpreted as failed, nor submitted twice.
  let resultError=null;
  try {if(await telegramApi(method,params)!==true)resultError=new Error('TELEGRAM_NOT_CONFIRMED');}
  catch(error){resultError=error;}
  let after;
  try{after=await telegramApi('getStickerSet',{name});exactSet(after,name,record);}
  catch{throw new Error('STICKER_PACK_EDIT_RESULT_UNKNOWN');}
  if(!confirm(after))throw new Error('STICKER_PACK_EDIT_RESULT_UNKNOWN');
  return {verified:true,action,name,set:after,telegramReportedFailure:resultError!==null};
}

/** Replaces exactly one bot-owned sticker after a durable pre-write receipt.
 * Does not guess success from a timeout; a matching getStickerSet is mandatory.
 */
export async function replaceStickerItem({telegramApi,owner,botUsername,
  record,stickerUniqueId,bytes,format,onUploaded,onBeforeMutation}={}) {
  if(typeof telegramApi!=='function'||!Number.isSafeInteger(owner)||owner<=0||
     !record||record.ownerId!==owner||!['regular','custom_emoji'].includes(record.kind))
    throw new Error('STICKER_PACK_OWNER_NOT_VERIFIED');
  const name=allowedSetName(record.name,botUsername);
  if(!(bytes instanceof Uint8Array)||!bytes.length||
     !['static','video'].includes(format)||
     bytes.length>(format==='video'?256*1024:512*1024))
    throw new Error('STICKER_REPLACEMENT_MEDIA_INVALID');
  if(typeof onUploaded!=='function'||typeof onBeforeMutation!=='function')
    throw new Error('STICKER_REPLACEMENT_RECEIPT_REQUIRED');
  const before=await telegramApi('getStickerSet',{name});
  exactSet(before,name,record);
  const prior=requireSticker(before,stickerUniqueId);
  const actualFormat=prior.is_video===true?'video':'static';
  if(actualFormat!==format)
    throw new Error('STICKER_REPLACEMENT_FORMAT_MISMATCH');
  const result=await telegramApi('uploadStickerFile',{
    user_id:owner,sticker:bytes,sticker_format:format});
  if(typeof result?.file_id!=='string'||!result.file_id||
     typeof result?.file_unique_id!=='string'||!result.file_unique_id)
    throw new Error('STICKER_UPLOAD_RECEIPT_INVALID');
  if(result.file_unique_id===stickerUniqueId||
     before.stickers.some(s=>s.file_unique_id===result.file_unique_id))
    throw new Error('STICKER_REPLACEMENT_DUPLICATE_MEDIA');
  const receipt={fileUniqueId:result.file_unique_id,format};
  await onUploaded(receipt);
  await onBeforeMutation(receipt);
  let error=null;
  try {
    if(await telegramApi('replaceStickerInSet',{
      user_id:owner,name,old_sticker:prior.file_id,
      sticker:{sticker:result.file_id,format,emoji_list:[prior.emoji??'🙂']}
    })!==true)error=new Error('STICKER_REPLACE_UNCONFIRMED');
  }catch(cause){error=cause;}
  let after=null;
  try{after=await telegramApi('getStickerSet',{name});exactSet(after,name,record);}
  catch{throw new Error('STICKER_REPLACE_RESULT_UNKNOWN');}
  if(!verifyStickerPackEditSnapshot({set:after,name,kind:record.kind,
    action:'replace_item',stickerUniqueId,newUniqueId:receipt.fileUniqueId}))
    throw new Error('STICKER_REPLACE_RESULT_UNKNOWN');
  return {verified:true,action:'replace_item',name,set:after,
    newUniqueId:receipt.fileUniqueId,telegramReportedFailure:!!error};
}
