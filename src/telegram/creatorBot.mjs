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
    const message=update?.message;
    if (message && message.chat?.type !== 'private') return {handled:false};
    if (update?.callback_query && update.callback_query.message?.chat?.type !== 'private') return {handled:false};
    if(message?.chat?.type==='private' &&
       typeof message.text==='string' &&
       /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)) {
      return handleMenuUpdate({api:options.api,update});
    }
    const creatorResult=await wizard.handle(update);
    if(creatorResult?.handled)return creatorResult;
    if(update?.callback_query?.data?.startsWith('menu:'))
      return handleMenuUpdate({api:options.api,update});
    return {handled:false};
  };
}
