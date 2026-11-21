// STK-04 CreateVdobot-owned one-message receipt. Never mutate GateApp schema.
export function createPostgresStickerEntryPin(pool){
 if(typeof pool?.query!=='function')throw Error('CREATOR_STICKER_ENTRY_SQL_OWNER_REQUIRED');
 const primary={board:'video_chat',purpose:'sticker',title:'ステッカーの公開と販売'};
 function guard({topic,botId}){
  if(topic?.board!==primary.board||topic?.purpose!==primary.purpose||
     topic?.title!==primary.title||!Number.isSafeInteger(topic.chatId)||
     !Number.isSafeInteger(topic.threadId)||!Number.isSafeInteger(botId)||botId<=0)
   throw Error('CREATOR_STICKER_ENTRY_RECEIPT_INVALID');
 }
 return Object.freeze({
  async claim({topic,botId,botUsername}){
   guard({topic,botId});
   if(typeof botUsername!=='string'||botUsername.toLowerCase()!=='createvdobot')
     throw Error('CREATOR_STICKER_ENTRY_USERNAME_INVALID');
   const inserted=await pool.query(
    `INSERT INTO videobot_sticker_entry_pins
       (entry_key,chat_id,thread_id,bot_id,bot_username,status)
     VALUES ('sticker', $1,$2,$3,$4,'sending')
     ON CONFLICT (entry_key) DO NOTHING RETURNING entry_key`,
    [topic.chatId,topic.threadId,botId,botUsername]);
   if(inserted.rowCount===1)return {claimed:true};
   const existing=await pool.query(
    "SELECT chat_id,thread_id,bot_id,bot_username,status,telegram_message_id FROM videobot_sticker_entry_pins WHERE entry_key='sticker'");
   const row=existing.rows?.[0];
   if(!row||Number(row.chat_id)!==topic.chatId||Number(row.thread_id)!==topic.threadId||
      Number(row.bot_id)!==botId||String(row.bot_username).toLowerCase()!=='createvdobot')
     throw Error('CREATOR_STICKER_ENTRY_RECEIPT_CONFLICT');
   return {claimed:false,status:row.status,messageId:Number(row.telegram_message_id)||null};
  },
  async sent({topic,botId,messageId}){await transition('sending','sent',topic,botId,messageId);},
  async pinRequested({topic,botId,messageId}){await transition('sent','pin_requested',topic,botId,messageId);},
  async pinned({topic,botId,messageId}){await transition('pin_requested','pinned_ack',topic,botId,messageId);},
  async unknown({topic,botId,messageId}){
   guard({topic,botId});
   await pool.query(`UPDATE videobot_sticker_entry_pins
      SET status='needs_reconcile',updated_at=NOW(),
      telegram_message_id=COALESCE(telegram_message_id,$1)
      WHERE entry_key='sticker' AND chat_id=$2 AND thread_id=$3 AND bot_id=$4
      AND status <> 'pinned_ack'`,
      [Number.isSafeInteger(messageId)&&messageId>0?messageId:null,topic.chatId,topic.threadId,botId]);
  }
 });
 async function transition(before,after,topic,botId,messageId){
  guard({topic,botId});
  if(!Number.isSafeInteger(messageId)||messageId<=0)
    throw Error('CREATOR_STICKER_ENTRY_MESSAGE_ID_INVALID');
  const r=await pool.query(`UPDATE videobot_sticker_entry_pins
   SET status=$1,telegram_message_id=$2,updated_at=NOW()
   WHERE entry_key='sticker' AND chat_id=$3 AND thread_id=$4 AND bot_id=$5
     AND status=$6
     AND (telegram_message_id IS NULL OR telegram_message_id=$2)`,
    [after,messageId,topic.chatId,topic.threadId,botId,before]);
  if(r.rowCount!==1)throw Error('CREATOR_STICKER_ENTRY_RECEIPT_CAS_FAILED');
 }
}
