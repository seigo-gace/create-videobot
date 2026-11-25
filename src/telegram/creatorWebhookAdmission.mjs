import {verifyTelegramWebhookHeader,validateTelegramUpdateSize} from './webhookAdmission.mjs';
import {createHash} from 'node:crypto';

/**
 * Runtime-independent Telegram webhook admission, reusing the existing
 * verified VideoBot update router. This is not an HTTP server or deployment.
 * HTTP host must supply X-Telegram-Bot-Api-Secret-Token and raw request body,
 * enforce one consumer, await completion before acknowledging Telegram.
 */
export function createCreatorWebhookAdmission({expectedSecret,handleCreatorUpdate,maxBytes=262144,updateStore}={}) {
  if(typeof handleCreatorUpdate!=='function'||typeof expectedSecret!=='string'||
     expectedSecret.length<20||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144)
    throw new Error('webhook admission unavailable');
  if(updateStore)for(const name of ['claim','complete','markUnknown']) {
    if(typeof updateStore[name]!=='function')
      throw new Error('durable webhook update store missing '+name);
  }
  return async function handleTelegramWebhook({secretHeader,body}={}) {
    // Authorization *before* decoding or any SQL/Telegram/side effects.
    verifyTelegramWebhookHeader(secretHeader,expectedSecret);
    const update=validateTelegramUpdateSize(body,maxBytes);
    if(updateStore) {
      const digest=createHash('sha256').update(body).digest('hex');
      const recoverStickerPayment=
        /^stk:so_[a-f0-9]{24}$/.test(String(
          update?.message?.successful_payment?.invoice_payload??''));
      const recoverStickerPhotoPurchase=
        /^stkmedia_sp_[a-f0-9]{24}$/.test(String(
          update?.purchased_paid_media?.paid_media_payload??''));
      // Replaying an identical private /start only redraws the existing DM
      // editor. Never extend this recovery to purchases or sticker mutations.
      const recoverNavigation=update?.message?.chat?.type==='private' &&
        update.message?.from?.id===update.message.chat.id &&
        /^\/start(?:@[A-Za-z0-9_]+)?$/.test(String(update.message.text??'').trim());
      const admission=await updateStore.claim(update.update_id,digest,{
        recoverStickerPayment,recoverStickerPhotoPurchase,recoverNavigation});
      if(!admission?.claimed) {
        if(admission?.completed!==true||typeof admission.handled!=='boolean')
          throw new Error('WEBHOOK_UPDATE_NEEDS_RECONCILE');
        return {accepted:true,handled:admission.handled,
          updateId:update.update_id,duplicate:true};
      }
    }
    try {
      const result=await handleCreatorUpdate(update);
      if(result?.handled!==true &&
         (update.purchased_paid_media||update.callback_query))
        throw new Error('Telegram update not durably handled');
      const handled=result?.handled===true;
      if(updateStore)await updateStore.complete(update.update_id,handled);
      return {accepted:true,handled,updateId:update.update_id};
    } catch(error) {
      if(updateStore)await updateStore.markUnknown(update.update_id);
      throw error;
    }
  };
}
