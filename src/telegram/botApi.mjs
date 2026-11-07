/**
 * Telegram Bot API HTTPS transport. Only explicit allowed methods are exposed.
 * Do not log request URL: it contains the Bot Token.
 */
const METHODS = new Set(['getMe', 'sendPaidMedia', 'sendMediaGroup', 'deleteMessage', 'getFile', 'getStarTransactions', 'getMyName', 'getMyDescription', 'getMyShortDescription', 'getMyCommands', 'getWebhookInfo', 'setWebhook', 'setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands', 'sendMessage', 'editMessageText', 'answerCallbackQuery']);
export function createTelegramBotApi({token, fetchImpl=globalThis.fetch, timeoutMs=8000}) {
 if(typeof token!=='string' || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('invalid Bot Token');
 if(typeof fetchImpl!=='function') throw new Error('fetch implementation required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000) throw new Error('invalid API timeout');
 return async function telegramBotApi(method, params={}) {
  if(!METHODS.has(method)) throw new Error('Telegram method not allowed');
  if(!params || typeof params!=='object'||Array.isArray(params)) throw new Error('invalid Telegram parameters');
  const response=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify(params),signal:AbortSignal.timeout(timeoutMs),redirect:'error'
  });
  if(!response || response.status!==200) throw new Error('Telegram API request failed');
  const reply=await response.json();
  if(reply?.ok!==true || !reply.result) throw new Error('Telegram API rejected request');
  return reply.result;
 };
}
