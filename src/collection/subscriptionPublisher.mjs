/**
 * One channel subscription, one existing public video-board topic.
 * Telegram owns subscription charging, membership, cancellations and renewals.
 * This module only uploads full videos then 60s samples with invite URL.
 *
 * The trusted target owner must verify destination IDs, rights and privileges.
 * All inputs are injected; no new Telegram client or Bot session is created.
 */
function targetId(n) {
  if(!Number.isSafeInteger(n)||n>=0)throw Error('SUBSCRIPTION_DESTINATION_NOT_VERIFIED');
  return n;
}
export function assertSubscriptionTargets(targets) {
  if(targets?.verified!==true||targets?.rightsApproved!==true||
     targets?.subscription?.verified!==true||
     targets?.subscription?.type!=='channel' ||
     targets?.topic?.verified!==true ||
     targets?.topic?.board!=='video_chat' ||
     targets?.topic?.groupTitle!=='ビデオChatの掲示板' ||
     targets?.topic?.enabled!==true)
    throw Error('SUBSCRIPTION_TARGETS_NOT_VERIFIED');
  targetId(targets.subscription.chatId);
  targetId(targets.topic.chatId);
  if(!Number.isSafeInteger(targets.topic.threadId)||targets.topic.threadId<=0||
     !Number.isSafeInteger(targets.subscription.priceStars)||
     targets.subscription.priceStars<1||targets.subscription.priceStars>10000||
     targets.subscription.periodSeconds!==2592000)
    throw Error('SUBSCRIPTION_CONFIGURATION_INVALID');
  const url=targets.subscription.inviteUrl;
  if(typeof url!=='string'||!/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{8,}$/.test(url))
    throw Error('SUBSCRIPTION_INVITE_URL_UNVERIFIED');
  return targets;
}
function sourceGuard(video) {
  if(!Number.isSafeInteger(video?.channelId)||video.channelId<=0||
     !Number.isSafeInteger(video?.messageId)||video.messageId<=0||
     video?.redistributionApproved!==true||video?.commercialUseApproved!==true||
     video?.sampleEditApproved!==true||
     typeof video?.fullFileId!=='string'||!video.fullFileId.trim()||
     typeof video?.sampleFileId!=='string'||!video.sampleFileId.trim()||
     video?.sampleStreamingReady!==true)
    throw Error('SUBSCRIPTION_VIDEO_NOT_PUBLISHABLE');
  return video;
}
function captionForSample(video,priceStars) {
  const title=String(video.title||'動画サンプル').trim().slice(0,100);
  const description=String(video.captionJapanese||'').trim().slice(0,600);
  const caption=[
    '🎬 '+title+'｜無料サンプル',
    description,
    '続きやほかの動画は非公開のStars月額見放題チャンネルで視聴できます。',
    '30日ごとに '+priceStars+' Stars'
  ].filter(Boolean).join('\n\n');
  if(caption.length>1024)throw Error('SUBSCRIPTION_CAPTION_TOO_LONG');
  return caption;
}
function sentMessageId(result,chatId) {
  const id=result?.message_id;
  if(!Number.isSafeInteger(id)||id<=0)throw Error('SUBSCRIPTION_TELEGRAM_ACK_UNKNOWN');
  if(result?.chat?.id!==chatId)throw Error('SUBSCRIPTION_TELEGRAM_CHAT_MISMATCH');
  return id;
}
export function createSubscriptionPublisher({
  telegramApi,verifiedTargets,receipts,verifyBotPostingAccess
}={}) {
  if(typeof telegramApi!=='function'||typeof verifiedTargets!=='function'||
     typeof verifyBotPostingAccess!=='function')
    throw Error('SUBSCRIPTION_OWNER_PORTS_UNAVAILABLE');
  for(const method of ['read','claim','sent','markUnknown']) {
    if(typeof receipts?.[method]!=='function')
      throw Error('SUBSCRIPTION_RECEIPT_PORT_UNAVAILABLE:'+method);
  }
  async function ensureSend(video,kind,chatId,threadId,params) {
    const key={channelId:video.channelId,messageId:video.messageId,kind,
      targetChatId:chatId,targetThreadId:threadId};
    const prior=await receipts.read(key);
    if(prior) {
      if(prior.target_chat_id!==chatId ||
         (prior.target_thread_id??null)!==(threadId??null))
        throw Error('SUBSCRIPTION_TARGET_CHANGED_NEEDS_RECONCILE');
      if(prior.status==='sent' && Number.isSafeInteger(Number(prior.telegram_message_id)) &&
         Number(prior.telegram_message_id)>0)
        return {messageId:Number(prior.telegram_message_id),alreadySent:true};
      throw Error('SUBSCRIPTION_POST_NEEDS_RECONCILE');
    }
    const claim=await receipts.claim(key);
    if(!claim?.claimed)throw Error('SUBSCRIPTION_POST_NEEDS_RECONCILE');
    try {
      const result=await telegramApi('sendVideo',{
        chat_id:chatId,
        ...(threadId?{message_thread_id:threadId}:{}),
        ...params,
        supports_streaming:true
      });
      const messageId=sentMessageId(result,chatId);
      if(threadId && (result?.message_thread_id!==threadId || result?.is_topic_message!==true))
        throw Error('SUBSCRIPTION_TOPIC_ACK_MISMATCH');
      await receipts.sent(key,messageId);
      return {messageId,alreadySent:false};
    } catch (error) {
      // Even an API exception may mean Telegram received the request.
      // Without an idempotency token, DO NOT blindly resend.
      await receipts.markUnknown(key).catch(()=>{});
      throw error;
    }
  }
  return {
    async publish(videoInput) {
      const video=sourceGuard(videoInput);
      const targets=assertSubscriptionTargets(await verifiedTargets({
        purpose:'subscription_preview_and_member_video'
      }));
      if(await verifyBotPostingAccess(targets)!==true)
        throw Error('SUBSCRIPTION_BOT_POST_RIGHTS_UNVERIFIED');

      // Publish member content first. No public teaser for unavailable content.
      const full=await ensureSend(video,'member_full',targets.subscription.chatId,null,{
        video:video.fullFileId,
        caption:String(video.title||'フル動画').slice(0,1024)
      });
      const sample=await ensureSend(video,'sample',targets.topic.chatId,targets.topic.threadId,{
        video:video.sampleFileId,
        caption:captionForSample(video,targets.subscription.priceStars),
        reply_markup:{
          inline_keyboard:[[
            {text:'⭐ 見放題チャンネルに参加',url:targets.subscription.inviteUrl}
          ]]
        }
      });
      return {published:true,full,sample};
    }
  };
}
