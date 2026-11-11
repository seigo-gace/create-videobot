import { handleMenuUpdate } from './menuPanel.mjs';
import { createCreatorWizard } from './creatorWizard.mjs';

/**
 * The VideoBot update router composes the EXISTING top-menu handler and the
 * creator-specific wizard. It does not replace GATE/MPB/Topic verification.
 * It is an injectable offline-compatible handler, NOT a webhook or poller.
 */
export function createCreatorBotUpdateHandler(options={}) {
  const wizard=createCreatorWizard(options);
  return async function handleCreatorBotUpdate(update) {
    // Paid-media purchase updates have no DM message envelope. They are not
    // ordinary creator input and must never be counted without transaction proof.
    if (update?.purchased_paid_media) {
      if (typeof options.starsLedger?.confirmPurchase !== 'function')
        throw new Error('verified Stars receipt ledger unavailable');
      const receipt=await options.starsLedger.confirmPurchase(update);
      return {handled:true,purchaseRecorded:receipt?.recorded===true,duplicate:receipt?.duplicate===true};
    }
    const message=update?.message;
    if (message && message.chat?.type !== 'private') return {handled:false};
    if (update?.callback_query && update.callback_query.message?.chat?.type !== 'private') return {handled:false};
    if(message?.chat?.type==='private' &&
       typeof message.text==='string' &&
       /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)) {
      if(/\\s+sticker$/.test(message.text.trim())&&typeof options.stickerHandler==='function') {
        const sticker=await options.stickerHandler(update);
        if(sticker?.handled)return sticker;
      }
      return wizard.openHome(update);
    }
    // Sticker-specific private updates share the durable DM screen/session but
    // must not be parsed by the paid-video wizard or sales ledger.
    if(typeof options.stickerHandler==='function') {
      const sticker=await options.stickerHandler(update);
      if(sticker?.handled===true)return sticker;
    }
    let creatorResult;
    try {
      creatorResult=await wizard.handle(update);
    } catch(error) {
      // Old keyboard revisions and screens are routine Telegram navigation,
      // not a payment or delivery failure. The wizard already acknowledged
      // their callback before checking the stored revision. Never lock the
      // entire webhook update as "needs_reconcile" for a stale tap.
      const harmless=new Set([
        'STALE_CREATOR_BUTTON','CREATOR_SCREEN_STALE','VIDEO_SCREEN_STALE',
        'SALES_SCREEN_STALE','CREATOR_NOT_IN_REVIEW'
      ]);
      if(update?.callback_query&&harmless.has(error?.message))
        return {handled:true,staleButton:true};
      throw error;
    }
    if(creatorResult?.handled)return creatorResult;
    if(update?.callback_query?.data?.startsWith('menu:'))
      return handleMenuUpdate({api:options.api,update});
    return {handled:false};
  };
}
