/**
 * Telegram Bot API HTTPS transport. Only explicit allowed methods are exposed.
 * Do not log request URL: it contains the Bot Token.
 */
const METHODS = new Set(['getMe', 'sendPaidMedia', 'sendMediaGroup', 'deleteMessage', 'getFile', 'getStarTransactions', 'getMyName', 'getMyDescription', 'getMyShortDescription', 'getMyCommands', 'getWebhookInfo', 'setWebhook', 'setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands', 'sendMessage', 'editMessageText', 'answerCallbackQuery', 'uploadStickerFile', 'getStickerSet', 'createNewStickerSet', 'addStickerToSet', 'replaceStickerInSet', 'deleteStickerFromSet', 'setStickerPositionInSet', 'setStickerEmojiList', 'setStickerSetTitle', 'deleteStickerSet', 'sendInvoice', 'answerPreCheckoutQuery', 'sendSticker', 'getChatMember', 'pinChatMessage']);
export function createTelegramBotApi({token, fetchImpl=globalThis.fetch, timeoutMs=8000}) {
 if(typeof token!=='string' || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('invalid Bot Token');
 if(typeof fetchImpl!=='function') throw new Error('fetch implementation required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000) throw new Error('invalid API timeout');
 return async function telegramBotApi(method, params={}) {
  if(!METHODS.has(method)) throw new Error('Telegram method not allowed');
  if(!params || typeof params!=='object'||Array.isArray(params)) throw new Error('invalid Telegram parameters');
  // Telegram sticker-file upload is multipart, while all existing methods
  // remain JSON. Keep one authenticated/sanitized transport for both.
  let body,headers;
  if(method==='uploadStickerFile'){
    const bytes=params.sticker;
    const fmt=params.sticker_format;
    if(!Number.isSafeInteger(params.user_id)||params.user_id<=0||
       !(bytes instanceof Uint8Array)||bytes.byteLength===0||
       !['static','video'].includes(fmt)||
       bytes.byteLength>(fmt==='video'?256*1024:512*1024))
      throw new Error('invalid Telegram sticker upload');
    const form=new FormData();
    form.set('user_id',String(params.user_id));
    form.set('sticker_format',fmt);
    form.set('sticker',new Blob([bytes],{type:fmt==='video'?'video/webm':'image/png'}),
      fmt==='video'?'sticker.webm':'sticker.png');
    body=form;
    headers=undefined; // fetch provides the multipart boundary
  } else {
    body=JSON.stringify(params);
    headers={'content-type':'application/json'};
  }
  const response=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',...(headers?{headers}:{}),
   body,signal:AbortSignal.timeout(timeoutMs),redirect:'error'
  });
  if(!response)throw new Error('Telegram API request failed');
  // Only known edit-screen failures may be converted into predictable UI
  // outcomes. Other Telegram descriptions can contain user-supplied data;
  // never pass them through to logs or the caller.
  if(response.status===400&&method==='editMessageText'){
    let reply;
    try{reply=await response.json();}catch{throw new Error('Telegram API request failed');}
    const description=typeof reply?.description==='string'?reply.description.toLowerCase():'';
    if(/^bad request: message is not modified$/.test(description))
      throw new Error('message is not modified');
    if(/^bad request: (message to edit not found|message to be edited not found|message can.t be edited|message cannot be edited|message_id_invalid)$/.test(description))
      throw new Error('message cannot be edited');
    throw new Error('Telegram API request failed');
  }
  if(response.status!==200)throw new Error('Telegram API request failed');
  const reply=await response.json();
  if(reply?.ok!==true || !reply.result) throw new Error('Telegram API rejected request');
  return reply.result;
 };
}
