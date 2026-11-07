import {verifyCreateVdoBot} from './identityCheck.mjs';

const UPDATES=Object.freeze(['message','callback_query','purchased_paid_media']);
function requireVerifiedIngress({url,verifiedIngress}){
 if(typeof url!=='string'||typeof verifiedIngress!=='object'||
    verifiedIngress?.verified!==true||verifiedIngress?.purpose!=='create_videobot_webhook'||
    verifiedIngress?.url!==url)
  throw new Error('verified CreatorBot HTTPS ingress required');
 let parsed;
 try{parsed=new URL(url);}catch{throw new Error('invalid CreatorBot HTTPS endpoint');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||
    parsed.hash||parsed.pathname!=='/telegram/creator'||
    !parsed.hostname.includes('.')||parsed.hostname==='localhost'||
    parsed.hostname.endsWith('.local')||parsed.port)
  throw new Error('invalid CreatorBot HTTPS endpoint');
 return parsed.href;
}
/** An operator-only and explicit webhook binding action.
 * Existing different Bot webhook is *never* displaced automatically.
 * The live service must have verified readiness before this is called.
 */
export async function installCreatorWebhook({
 telegramApi,url,secretToken,verifiedIngress,checkReadiness
}={}){
 if(typeof telegramApi!=='function'||typeof checkReadiness!=='function')
   throw new Error('official Bot API and real readiness verifier required');
 const endpoint=requireVerifiedIngress({url,verifiedIngress});
 if(typeof secretToken!=='string'||secretToken.length<20||secretToken.length>256||
   !/^[A-Za-z0-9_-]+$/.test(secretToken))
   throw new Error('invalid private Telegram webhook secret');
 if(await checkReadiness()!==true)
   throw new Error('CreatorBot private listener not ready');
 await verifyCreateVdoBot({api:telegramApi,checkProfile:false});
 const prev=await telegramApi('getWebhookInfo',{});
 if(!prev||typeof prev.url!=='string')
   throw new Error('Telegram webhook state unavailable');
 if(prev.url && prev.url!==endpoint)
   throw new Error('ANOTHER_TELEGRAM_WEBHOOK_ALREADY_ACTIVE');
 const result=await telegramApi('setWebhook',{
   url:endpoint,secret_token:secretToken,
   allowed_updates:[...UPDATES],max_connections:8,
   drop_pending_updates:false
 });
 if(result!==true)throw new Error('Telegram webhook admission rejected');
 const after=await telegramApi('getWebhookInfo',{});
 if(after?.url!==endpoint ||
    !UPDATES.every(x=>after.allowed_updates?.includes(x)))
   throw new Error('WEBHOOK_RESULT_NEEDS_RECONCILE');
 return Object.freeze({
   installed:true,endpointVerified:true,
   pendingUpdates:Number.isSafeInteger(after.pending_update_count)
     ?after.pending_update_count:null,
   updates:[...UPDATES]
 });
}
