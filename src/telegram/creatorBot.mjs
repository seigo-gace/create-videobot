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
    // Invoice pre-checkout must be approved/rejected promptly.
    if(update?.pre_checkout_query){
      if(typeof options.stickerSalesPayments!=='function')
        throw Error('STICKER_SALE_PAYMENT_OWNER_MISSING');
      return options.stickerSalesPayments(update);
    }
    // Paid-media purchase updates have no DM message envelope. They are not
    // ordinary creator input and must never be counted without transaction proof.
    if (update?.purchased_paid_media) {
      if (typeof options.starsLedger?.confirmPurchase !== 'function')
        throw new Error('verified Stars receipt ledger unavailable');
      const receipt=await options.starsLedger.confirmPurchase(update);
      return {handled:true,purchaseRecorded:receipt?.recorded===true,duplicate:receipt?.duplicate===true};
    }
    const message=update?.message;
    if(message?.successful_payment){
      if(typeof options.stickerSalesPayments!=='function')
        throw Error('STICKER_SALE_PAYMENT_OWNER_MISSING');
      return options.stickerSalesPayments(update);
    }
    if (message && message.chat?.type !== 'private') return {handled:false};
    if (update?.callback_query && update.callback_query.message?.chat?.type !== 'private') return {handled:false};
    if(message?.chat?.type==='private' &&
       typeof message.text==='string' &&
       /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)) {
      // A paid-sticker offer or one-time gift is an explicit sales deep
      // link. Route it before a dormant sticker media-input screen so that
      // recipients need not cancel their unrelated draft to claim the gift.
      // The sales handler itself preserves unresolved registration locks.
      if(/^\/start(?:@[A-Za-z0-9_]+)?\s+(?:buy_sp_[a-f0-9]{24}|gift_[A-Za-z0-9_-]{32})$/
          .test(message.text.trim())&&typeof options.stickerSalesHandler==='function'){
        const sale=await options.stickerSalesHandler(update);
        if(sale?.handled)return sale;
      }
      // The sticker wizard owns unresolved registrations even when a user
      // reopens the generic /start; it must run before the video home page.
      if(typeof options.stickerHandler==='function') {
        const sticker=await options.stickerHandler(update);
        if(sticker?.handled)return sticker;
      }
      if(typeof options.stickerSalesHandler==='function') {
        const sales=await options.stickerSalesHandler(update);
        if(sales?.handled)return sales;
      }
      return wizard.openHome(update);
    }
    // Sticker-specific private updates share the durable DM screen/session but
    // must not be parsed by the paid-video wizard or sales ledger.
    if(typeof options.stickerHandler==='function') {
      const sticker=await options.stickerHandler(update);
      if(sticker?.handled===true)return sticker;
    }
    if(typeof options.stickerSalesHandler==='function'){
      const sales=await options.stickerSalesHandler(update);
      if(sales?.handled===true)return sales;
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
