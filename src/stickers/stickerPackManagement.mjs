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
  return {verified:true,action,name,telegramReportedFailure:resultError!==null};
}
