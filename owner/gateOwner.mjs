import {readFile} from 'node:fs/promises';

/**
 * Read-only verified owner adapter for Master-fixed sticker Topic.
 * Proof is the existing CreateVdobot one-shot pinned ACK, not a guessed
 * t.me/c suffix. Neither GateApp tables nor video sales are modified.
 * If the receipt is missing, changed, or ambiguous, public sales stay closed.
 */
const PATH='/var/lib/videobot/sticker-entry/sticker-entry.json';
const ROUTE={board:'video_chat',purpose:'sticker',enabled:true,verified:true,
 chatId:-1002373696859,threadId:4640,
 groupTitle:'ビデオChatの掲示板',title:'ステッカーの公開と販売'};
function proof(row,me){
 if(row?.status!=='pinned_ack'||Number(row.chatId)!==ROUTE.chatId||
    Number(row.threadId)!==ROUTE.threadId||
    Number(row.botId)!==me.id||
    String(row.botUsername||'').toLowerCase()!=='createvdobot'||
    !Number.isSafeInteger(Number(row.messageId))||Number(row.messageId)<=0)
   throw Error('STICKER_TOPIC_VERIFIED_PIN_RECEIPT_REQUIRED');
 return {...ROUTE};
}
function same(arg){
 return Number(arg?.chatId)===ROUTE.chatId&&
   Number(arg?.threadId??ROUTE.threadId)===ROUTE.threadId;
}
export async function createGateOwner({telegramApi,pool}={}){
 if(typeof telegramApi!=='function'||typeof pool?.query!=='function')
   throw Error('STICKER_GATE_OWNER_DEPENDENCIES_MISSING');
 const me=await telegramApi('getMe',{});
 if(me?.is_bot!==true||String(me.username||'').toLowerCase()!=='createvdobot'||
    !Number.isSafeInteger(me.id)||me.id<=0)
   throw Error('STICKER_GATE_OWNER_BOT_IDENTITY_NOT_VERIFIED');
 const receipt=async()=>{
   const row=JSON.parse(await readFile(PATH,'utf8'));
   const t=proof(row,me);
   const chat=await telegramApi('getChat',{chat_id:t.chatId});
   if(chat?.id!==t.chatId||chat?.type!=='supergroup'||chat?.is_forum!==true)
     throw Error('STICKER_GATE_OWNER_TOPIC_CHAT_NOT_VERIFIED');
   const rights=await telegramApi('getChatMember',{chat_id:t.chatId,user_id:me.id});
   if(!['administrator','creator'].includes(rights?.status))
     throw Error('STICKER_GATE_OWNER_ADMIN_MISSING');
   return t;
 };
 await receipt();
 return Object.freeze({
   getVerifiedVideoTopic:async()=>{throw Error('VIDEO_TOPIC_NOT_CONNECTED');},
   verifyReview:async()=>{throw Error('VIDEO_REVIEW_NOT_CONNECTED');},
   async getVerifiedStickerTopic(){return receipt();},
   async getVerifiedStickerEntryTopic(){return receipt();},
   async verifyMembership({sellerId,chatId}={}){
     if(Number(chatId)!==ROUTE.chatId||!/^[1-9][0-9]*$/.test(String(sellerId)))return false;
     const member=await telegramApi('getChatMember',{
       chat_id:ROUTE.chatId,user_id:Number(sellerId)});
     return ['member','administrator','creator'].includes(member?.status)||
       (member?.status==='restricted'&&member.is_member===true);
   },
   async verifyStickerReview({sellerId,productId}={}){
     if(!/^[1-9][0-9]*$/.test(String(sellerId))||
        !/^sp_[a-f0-9]{24}$/.test(String(productId)))return false;
     const q=await pool.query(
       "SELECT 1 FROM videobot_sticker_products WHERE product_id=$1 AND seller_user_id=$2 AND status='published' AND fee_policy_id='sticker-admin-30-20261113' AND management_fee_bps=3000 AND fee_terms_accepted_at IS NOT NULL LIMIT 1",
       [productId,Number(sellerId)]);
     return q.rowCount===1;
   },
   async verifyRelease(args={}){
     if(args.purpose!=='sticker'||!same(args))return false;
     await receipt();
     return true;
   }
 });
}
