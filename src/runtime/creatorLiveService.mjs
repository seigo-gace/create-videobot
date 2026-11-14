import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {verifyCreateVdoBot} from '../telegram/identityCheck.mjs';
import {createVideoBotSourceModule} from '../telegram/creatorWiring.mjs';
import {createCreatorHttpService} from './creatorHttpService.mjs';

/**
 * Executable CreatorBot private ingress. Unlike the earlier Gserver event
 * bootstrap, this listens for real Telegram webhook updates, backed by the
 * existing VideoBot database/session/Stars modules and GATE owner contracts.
 *
 * It does not configure Telegram webhook or create a public HTTPS endpoint.
 * Those are owned by the existing private ingress and Bot administrator.
 */
export function createCreatorLiveService({
  botToken,webhookSecret,pool,gateOwner,
  verifyPrivateMediaStore,mediaPorts,storageApproved=false,
  fetchImpl=globalThis.fetch,screenTransport,
  host='127.0.0.1',port=8766
}={}) {
  if(typeof webhookSecret!=='string'||webhookSecret.length<20||
     typeof pool?.query!=='function')
    throw new Error('private Telegram webhook secret and VideoBot DB required');
  const telegramApi=createTelegramBotApi({token:botToken,fetchImpl});
  const creator=createVideoBotSourceModule({
    pool,telegramApi,gateOwner,mediaPorts,
    webhookSecret,storageApproved,botToken,verifyPrivateMediaStore,fetchImpl,
    screenTransport
  });
  let verifiedIdentity=false;
  let stickerEntryStatus='NOT_VERIFIED';
  const listener=createCreatorHttpService({
    host,port,handleTelegramWebhook:creator.handleTelegramWebhook,
    readiness:async()=>{
      if(verifiedIdentity!==true)return false;
      try{
        const result=await pool.query("SELECT to_regclass('videobot_webhook_updates') AS updates, to_regclass('videobot_creator_sessions') AS sessions, to_regclass('videobot_listings') AS listings, to_regclass('videobot_stars_ledger') AS stars");
        const row=result?.rows?.[0];
        return Boolean(row?.updates&&row?.sessions&&row?.listings&&row?.stars);
      }catch{return false;}
    }
  });
  return Object.freeze({
    async start(){
      // Reject a token belonging to any other group/admin Bot.
      await verifyCreateVdoBot({api:telegramApi,checkProfile:false});
      verifiedIdentity=true;
      if(await (async()=>{
        try{
          const q=await pool.query("SELECT to_regclass('videobot_webhook_updates') AS updates, to_regclass('videobot_creator_sessions') AS sessions, to_regclass('videobot_listings') AS listings, to_regclass('videobot_stars_ledger') AS stars");
          const r=q?.rows?.[0];
          return !!(r?.updates&&r?.sessions&&r?.listings&&r?.stars);
        }catch{return false;}
      })()!==true)throw new Error('VideoBot migrations missing');
      // This is a safe, idempotent owner-managed effect when the real GateApp
      // adapter is present. Missing/failed pin must not take down video sales.
      try{
        const pin=await creator.ensureStickerEntryPin();
        stickerEntryStatus=pin.readbackVerified===true?'VERIFIED_READBACK':
          pin.acknowledged===true?'TELEGRAM_ACK_ONLY':'NOT_VERIFIED';
      }catch{stickerEntryStatus='NOT_VERIFIED';}
      return listener.listen();
    },
    async close(){await listener.close();},
    creator,
    telegramApi,
    getStickerEntryStatus:()=>stickerEntryStatus
  });
}
