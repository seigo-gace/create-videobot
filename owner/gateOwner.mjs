import {readFile} from 'node:fs/promises';

/**
 * Read-only verified owner adapter for Master-fixed sticker Topic.
 * Proof is the existing CreateVdobot one-shot pinned ACK, not a guessed
 * t.me/c suffix. Neither GateApp tables nor video sales are modified.
 * If the receipt is missing, changed, or ambiguous, public sales stay closed.
 */
const PATH='/var/lib/videobot/sticker-entry/group2373696859_thread4640.json';
const OWNER_PIN_LINK='https://t.me/CreateVdobot?start=sticker';
const ROUTE={board:'video_chat',purpose:'sticker',enabled:true,verified:true,
 chatId:-1002373696859,threadId:4640,
 groupTitle:'ビデオChatの掲示板',title:'ステッカーの公開と販売'};
// Exact pre-existing CreateVdobot one-shot receipt from the successful
// Master Topic 4640 operation (GitHub Actions run #43290509682).
// Read its original snake_case contract; do not create a new Topic receipt.
export function verifyPinnedStickerReceipt(row,me){
 if(row?.status!=='pinned_ack'||Number(row.chat_id)!==ROUTE.chatId||
    Number(row.thread_id)!==ROUTE.threadId||
    Number(row.bot_id)!==me?.id||
    row.link!==OWNER_PIN_LINK||
    !Number.isSafeInteger(Number(row.message_id))||
    Number(row.message_id)<=0)
   throw Error('STICKER_TOPIC_VERIFIED_PIN_RECEIPT_REQUIRED');
 return {...ROUTE};
}

// Video publishing is a creator action, not an engineering CI/release approval.
// The topic must be explicitly configured with its REAL Telegram thread ID;
// a t.me/c message link is never accepted as a substitute.
export function configuredVideoSaleTopic(env=process.env){
 const raw=env.VIDEOBOT_VIDEO_SALE_THREAD_ID;
 const title=env.VIDEOBOT_VIDEO_SALE_TOPIC_TITLE;
 if(typeof raw!=='string'||!/^[1-9][0-9]*$/.test(raw)||
    !Number.isSafeInteger(Number(raw))||typeof title!=='string'||
    !title.trim()||title.length>100)
   throw Error('VIDEO_SALE_TOPIC_CONFIGURATION_MISSING');
 return Object.freeze({id:Number(raw),board:'video_chat',purpose:'video_sale',
   chatId:ROUTE.chatId,threadId:Number(raw),title:title.trim(),
   enabled:true,verified:true});
}

function same(arg){
 return Number(arg?.chatId)===ROUTE.chatId&&
   Number(arg?.threadId??ROUTE.threadId)===ROUTE.threadId;
}
export async function createGateOwner({telegramApi,pool,env=process.env}={}){
 if(typeof telegramApi!=='function'||typeof pool?.query!=='function')
   throw Error('STICKER_GATE_OWNER_DEPENDENCIES_MISSING');
 const me=await telegramApi('getMe',{});
 if(me?.is_bot!==true||String(me.username||'').toLowerCase()!=='createvdobot'||
    !Number.isSafeInteger(me.id)||me.id<=0)
   throw Error('STICKER_GATE_OWNER_BOT_IDENTITY_NOT_VERIFIED');
 const receipt=async()=>{
   const row=JSON.parse(await readFile(PATH,'utf8'));
   const t=verifyPinnedStickerReceipt(row,me);
   const chat=await telegramApi('getChat',{chat_id:t.chatId});
   if(chat?.id!==t.chatId||chat?.type!=='supergroup'||chat?.is_forum!==true)
     throw Error('STICKER_GATE_OWNER_TOPIC_CHAT_NOT_VERIFIED');
   const rights=await telegramApi('getChatMember',{chat_id:t.chatId,user_id:me.id});
   if(!['administrator','creator'].includes(rights?.status))
     throw Error('STICKER_GATE_OWNER_ADMIN_MISSING');
   return t;
 };
 await receipt();
 const verifyVideoTopic=async()=>{
   const topic=configuredVideoSaleTopic(env);
   if(topic.threadId===ROUTE.threadId)
     throw Error('VIDEO_SALE_STICKER_TOPIC_COLLISION');
   const chat=await telegramApi('getChat',{chat_id:topic.chatId});
   if(chat?.id!==topic.chatId||chat?.type!=='supergroup'||chat?.is_forum!==true)
     throw Error('VIDEO_SALE_GROUP_NOT_VERIFIED');
   const rights=await telegramApi('getChatMember',{chat_id:topic.chatId,user_id:me.id});
   if(!['administrator','creator'].includes(rights?.status))
     throw Error('VIDEO_SALE_BOT_POSTING_RIGHTS_MISSING');
   return topic;
 };
 return Object.freeze({
   getVerifiedVideoTopic:verifyVideoTopic,
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
