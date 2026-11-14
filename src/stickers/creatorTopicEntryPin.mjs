/**
 * STK-04: CreateVdobot owns its own Telegram Topic entry message and pin.
 * GateApp supplies ONLY a verified, read-only Topic binding. No other Bot
 * token, user session, or topic ID inferred from a message URL is accepted.
 */
const DESTINATION='https://t.me/CreateVdobot?start=sticker';
const TITLE='ステッカーの公開と販売';
function verifiedTopic(t){
 if(!t||t.board!=='video_chat'||t.purpose!=='sticker'||
    t.enabled!==true||t.verified!==true||t.title!==TITLE||
    t.groupTitle!=='ビデオChatの掲示板'||
    !Number.isSafeInteger(t.chatId)||t.chatId>=0||
    !Number.isSafeInteger(t.threadId)||t.threadId<=0)
   throw Error('CREATOR_STICKER_ENTRY_TOPIC_UNVERIFIED');
 return t;
}
function ownIdentity(me){
 if(me?.is_bot!==true||String(me?.username||'').toLowerCase()!=='createvdobot'||
    !Number.isSafeInteger(me?.id)||me.id<=0)
   throw Error('CREATOR_STICKER_ENTRY_BOT_UNVERIFIED');
 return me;
}
export function createCreatorStickerTopicEntryPin({telegramApi,getVerifiedStickerEntryTopic,receiptStore}={}){
 if(typeof telegramApi!=='function'||typeof getVerifiedStickerEntryTopic!=='function'||
    !receiptStore||['claim','sent','pinRequested','pinned','unknown'].some(k=>typeof receiptStore[k]!=='function'))
   throw Error('CREATOR_STICKER_ENTRY_OWNER_NOT_CONNECTED');
 return async function ensureCreatorStickerEntryPin(){
  const topic=verifiedTopic(await getVerifiedStickerEntryTopic({purpose:'sticker'}));
  const me=ownIdentity(await telegramApi('getMe',{}));
  const chat=await telegramApi('getChat',{chat_id:topic.chatId});
  if(chat?.type!=='supergroup'||chat?.is_forum!==true||chat?.id!==topic.chatId)
    throw Error('CREATOR_STICKER_ENTRY_GROUP_UNVERIFIED');
  const member=await telegramApi('getChatMember',{chat_id:topic.chatId,user_id:me.id});
  if(!['administrator','creator'].includes(member?.status)||
     (member.status==='administrator'&&member.can_pin_messages!==true))
    throw Error('CREATOR_STICKER_ENTRY_ADMIN_REQUIRED');
  const claim=await receiptStore.claim({topic,botId:me.id,botUsername:me.username});
  if(claim.claimed!==true){
    if(claim.status==='pinned_ack'&&Number.isSafeInteger(Number(claim.messageId))&&
       Number(claim.messageId)>0)
      return {acknowledged:true,alreadyPinned:true,readbackVerified:false,
        messageId:Number(claim.messageId),topic};
    throw Error('CREATOR_STICKER_ENTRY_NEEDS_RECONCILE');
  }
  let messageId=null;
  try{
    const sent=await telegramApi('sendMessage',{
      chat_id:topic.chatId,message_thread_id:topic.threadId,
      text:'🎨 ステッカーの作成・投稿はこちら\n下のボタンからCreateVdobotのDMを開いてください。',
      reply_markup:{inline_keyboard:[[{
        text:'🎨 投稿はこちら',url:DESTINATION
      }]]},disable_notification:true
    });
    messageId=sent?.message_id;
    if(!Number.isSafeInteger(messageId)||messageId<=0||
       sent?.chat?.id!==topic.chatId||
       sent?.message_thread_id!==topic.threadId||sent?.is_topic_message!==true||
       sent?.from?.id!==me.id)
      throw Error('CREATOR_STICKER_ENTRY_SEND_UNVERIFIED');
    await receiptStore.sent({topic,botId:me.id,messageId});
    await receiptStore.pinRequested({topic,botId:me.id,messageId});
    const pinned=await telegramApi('pinChatMessage',{
      chat_id:topic.chatId,message_id:messageId,disable_notification:true
    });
    if(pinned!==true)throw Error('CREATOR_STICKER_ENTRY_PIN_UNVERIFIED');
    await receiptStore.pinned({topic,botId:me.id,messageId});
    return {acknowledged:true,alreadyPinned:false,readbackVerified:false,messageId,topic};
  }catch(error){
    // Telegram can have accepted a request even if a network timeout occurs.
    // Do not retry a write without independent reconciliation.
    await receiptStore.unknown({topic,botId:me.id,messageId}).catch(()=>{});
    throw error;
  }
 };
}
