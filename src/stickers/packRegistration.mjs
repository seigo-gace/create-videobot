import {readFile} from 'node:fs/promises';

function ownerId(value) {
  if(!Number.isSafeInteger(value)||value<=0)throw new Error('STICKER_OWNER_INVALID');
  return value;
}
function botName(value){
  if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value))
    throw new Error('STICKER_BOT_USERNAME_INVALID');
  return value;
}
export function createStickerSetShortName({owner,botUsername,nonce}={}) {
  ownerId(owner);
  const username=botName(botUsername);
  if(typeof nonce!=='string'||!/^[a-f0-9]{8,24}$/.test(nonce))throw new Error('STICKER_PACK_NONCE_INVALID');
  const suffix='_by_'+username;
  const stem='s'+String(owner)+'_'+nonce;
  if(stem.length+suffix.length>64)throw new Error('STICKER_PACK_NAME_TOO_LONG');
  return stem+suffix;
}
function formatValue(value) {
  if(!['static','video'].includes(value))throw new Error('STICKER_FORMAT_INVALID');
  return value;
}
function packType(value){
  if(!['regular','custom_emoji'].includes(value))throw new Error('STICKER_TYPE_INVALID');
  return value;
}
function validEmoji(value){
  if(typeof value!=='string'||value.length<1||value.length>16||
     /[\r\n]/.test(value))throw new Error('STICKER_EMOJI_INVALID');
  return value;
}
function matchingItem(set,uploaded,kind,format) {
  if(!stickerIdentity(set,uploaded,kind,format))return null;
  const index=set.stickers.findIndex(s=>s.file_unique_id===uploaded.file_unique_id);
  return index<0?null:{...set.stickers[index],position:index};
}
export function stickerIdentity(set,uploaded,kind,format) {
  if(!set||!Array.isArray(set.stickers)||
     set.sticker_type!==kind)return false;
  return set.stickers.some(s=>
    s.file_unique_id===uploaded.file_unique_id &&
    (format==='video'?s.is_video===true:s.is_video!==true&&s.is_animated!==true));
}
/**
 * Reconcile only by the uploaded Telegram file_unique_id and exact pack type.
 * A missing or unreadable set is UNKNOWN, not permission to resubmit a write.
 */
export async function reconcileStickerRegistration({
  telegramApi,name,kind,format,fileUniqueId
}={}) {
  if(typeof telegramApi!=='function'||typeof name!=='string'||
     !/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)||
     typeof fileUniqueId!=='string'||fileUniqueId.length<1)
    throw new Error('STICKER_RECONCILE_RECEIPT_INVALID');
  const type=packType(kind),fmt=formatValue(format);
  let set;
  try {set=await telegramApi('getStickerSet',{name});}
  catch {return {status:'unknown',verified:false};}
  if(!set||set.sticker_type!==type||!Array.isArray(set.stickers))
    return {status:'unknown',verified:false};
  const item=matchingItem(set,{file_unique_id:fileUniqueId},type,fmt);
  if(item)return {status:'registered',verified:true,name,item};
  // No match in the current snapshot does not prove the write did not occur:
  // Telegram API visibility, delayed response, and manual removal are distinct.
  return {status:'not_observed',verified:false,name};
}

async function safelyReadSet(api,name){
  try{return await api('getStickerSet',{name});}
  catch{return null;}
}
/**
 * Register a converted local asset using the existing authenticated Bot API.
 * All uncertainty fails closed; callers MUST persist owner/name/status and
 * reconcile UNKNOWN results before retrying. This does not publish a sale.
 */
export async function registerStickerAsset({
  telegramApi,owner,botUsername,title,nonce,kind='regular',format,
  mediaPath,emoji='🙂',existingSetName=null,
  onUploaded, onBeforeMutation, onVerified
}={}){
  if(typeof telegramApi!=='function')throw new Error('STICKER_API_REQUIRED');
  const user_id=ownerId(owner);
  const sticker_type=packType(kind),stickerFormat=formatValue(format);
  const emojiValue=validEmoji(emoji);
  if(typeof title!=='string'||title.length<1||title.length>64)
    throw new Error('STICKER_PACK_TITLE_INVALID');
  const username=botName(botUsername);
  let name;
  if(existingSetName!==null) {
    if(typeof existingSetName!=='string'||existingSetName.length>64||
       !existingSetName.toLowerCase().endsWith(('_by_'+username).toLowerCase())||
       !/^[A-Za-z][A-Za-z0-9_]*$/.test(existingSetName))
      throw new Error('STICKER_SET_NAME_INVALID');
    name=existingSetName;
  }else{
    name=createStickerSetShortName({owner:user_id,botUsername:username,nonce});
  }
  if(typeof mediaPath!=='string'||!mediaPath.startsWith('/'))
    throw new Error('STICKER_MEDIA_PATH_INVALID');
  const bytes=await readFile(mediaPath);
  const max=stickerFormat==='video'?256*1024:512*1024;
  if(bytes.length<1||bytes.length>max)throw new Error('STICKER_MEDIA_SIZE_INVALID');
  // uploadStickerFile's transport already builds multipart/form-data.
  const uploaded=await telegramApi('uploadStickerFile',{
    user_id,sticker:new Uint8Array(bytes),sticker_format:stickerFormat
  });
  if(typeof uploaded?.file_id!=='string'||!uploaded.file_id||
    typeof uploaded?.file_unique_id!=='string'||!uploaded.file_unique_id)
    throw new Error('STICKER_UPLOAD_RECEIPT_INVALID');

  // Persist Telegram's immutable content identity before any pack mutation.
  // Callback failures prevent the mutation; they must never be ignored.
  if(onUploaded!==undefined) {
    if(typeof onUploaded!=='function')throw new Error('STICKER_RECEIPT_CALLBACK_INVALID');
    await onUploaded({name,kind:sticker_type,format:stickerFormat,
      fileUniqueId:uploaded.file_unique_id});
  }
  const input={sticker:uploaded.file_id,format:stickerFormat,emoji_list:[emojiValue]};
  const before=await safelyReadSet(telegramApi,name);
  if(before){
    if(before.sticker_type!==sticker_type)throw new Error('STICKER_SET_TYPE_CONFLICT');
    const existing=matchingItem(before,uploaded,sticker_type,stickerFormat);
    if(existing){
      if(onVerified!==undefined){
        if(typeof onVerified!=='function')throw new Error('STICKER_VERIFIED_CALLBACK_INVALID');
        await onVerified({name,kind:sticker_type,format:stickerFormat,item:existing});
      }
      return {name,alreadyRegistered:true,verified:true,
        item:existing,link:'https://t.me/'+(sticker_type==='custom_emoji'?'addemoji/':'addstickers/')+name};
    }
    if(existingSetName===null)throw new Error('STICKER_NEW_PACK_NAME_CONFLICT');
  }else if(existingSetName!==null)throw new Error('STICKER_EXISTING_PACK_NOT_FOUND');

  if(onBeforeMutation!==undefined){
    if(typeof onBeforeMutation!=='function')throw new Error('STICKER_MUTATION_CALLBACK_INVALID');
    // Commit the 'may have mutated Telegram' phase before performing it.
    await onBeforeMutation({name,kind:sticker_type,format:stickerFormat,
      fileUniqueId:uploaded.file_unique_id});
  }
  let requestError=null;
  try{
    const result=existingSetName!==null?
      await telegramApi('addStickerToSet',{user_id,name,sticker:input}):
      await telegramApi('createNewStickerSet',{user_id,name,title,stickers:[input],sticker_type});
    if(result!==true)requestError=new Error('STICKER_REGISTRATION_NOT_CONFIRMED');
  }catch(error){requestError=error;}

  const after=await safelyReadSet(telegramApi,name);
  const item=matchingItem(after,uploaded,sticker_type,stickerFormat);
  if(!item){
    // A final HTTP 400 proves that this particular mutation was rejected.
    // Only after checking the remote set may we release its durable claim.
    // Timeouts, 5xx and ambiguous responses must stay locked for readback.
    if(requestError?.definitiveTelegramRejection===true)
      throw requestError;
    throw new Error(requestError?'STICKER_REGISTRATION_RESULT_UNKNOWN':'STICKER_REGISTRATION_READBACK_FAILED');
  }
  if(onVerified!==undefined){
    if(typeof onVerified!=='function')throw new Error('STICKER_VERIFIED_CALLBACK_INVALID');
    await onVerified({name,kind:sticker_type,format:stickerFormat,item});
  }
  return {name,alreadyRegistered:false,verified:true,item,
    link:'https://t.me/'+(sticker_type==='custom_emoji'?'addemoji/':'addstickers/')+name};
}
