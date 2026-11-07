import {verifyTelegramWebhookHeader,validateTelegramUpdateSize} from './webhookAdmission.mjs';

/**
 * Runtime-independent Telegram webhook admission, reusing the existing
 * verified VideoBot update router. This is not an HTTP server or deployment.
 * HTTP host must supply X-Telegram-Bot-Api-Secret-Token and raw request body,
 * enforce one consumer, await completion before acknowledging Telegram.
 */
export function createCreatorWebhookAdmission({expectedSecret,handleCreatorUpdate,maxBytes=262144}={}) {
  if(typeof handleCreatorUpdate!=='function'||typeof expectedSecret!=='string'||
     expectedSecret.length<20||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144)
    throw new Error('webhook admission unavailable');
  return async function handleTelegramWebhook({secretHeader,body}={}) {
    // Authorization *before* JSON parsing and every business-side effect.
    verifyTelegramWebhookHeader(secretHeader,expectedSecret);
    const update=validateTelegramUpdateSize(body,maxBytes);
    const result=await handleCreatorUpdate(update);
    if(result?.handled!==true &&
       (update.purchased_paid_media||update.callback_query))
      throw new Error('Telegram update not durably handled');
    return {accepted:true,handled:result?.handled===true,updateId:update.update_id};
  };
}
