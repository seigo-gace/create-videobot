import {pathToFileURL} from 'node:url';
import {readPrivateToken} from './config.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {installCreatorWebhook} from '../telegram/creatorWebhookInstall.mjs';

export async function registerCreatorWebhookFromPrivateMounts({
 env=process.env,readSecret=readPrivateToken,
 importOwner=url=>import(url),fetchImpl=globalThis.fetch
}={}){
 if(env.NODE_ENV!=='production'||env.VIDEOBOT_WEBHOOK_REGISTER!=='YES'||
    env.VIDEOBOT_GATE_OWNER_ADAPTER!=='/opt/videobot/owner/gateOwner.mjs')
   throw new Error('explicit owner-controlled webhook registration required');
 for(const field of ['VIDEOBOT_TELEGRAM_TOKEN_FILE','VIDEOBOT_WEBHOOK_SECRET_FILE']){
   if(typeof env[field]!=='string'||!env[field].startsWith('/run/secrets/'))
     throw new Error('private CreatorBot token mounts required');
 }
 if(typeof fetchImpl!=='function')throw new Error('private readiness fetch required');
 const api=createTelegramBotApi({
  token:readSecret(env.VIDEOBOT_TELEGRAM_TOKEN_FILE),
  fetchImpl
 });
 const secretToken=readSecret(env.VIDEOBOT_WEBHOOK_SECRET_FILE);
 const owner=await importOwner(pathToFileURL(env.VIDEOBOT_GATE_OWNER_ADAPTER).href);
 if(typeof owner?.verifyCreatorIngress!=='function')
   throw new Error('owner-provided CreatorBot ingress verification unavailable');
 const url=env.VIDEOBOT_WEBHOOK_URL;
 const verifiedIngress=await owner.verifyCreatorIngress({url,purpose:'create_videobot_webhook'});
 const checkReadiness=async()=>{
   try{
    const response=await fetchImpl('http://videobot-telegram:8766/readyz',{
      redirect:'error',signal:AbortSignal.timeout(5000)
    });
    return response?.status===200;
   }catch{return false;}
 };
 return installCreatorWebhook({
   telegramApi:api,url,secretToken,verifiedIngress,checkReadiness
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
   const result=await registerCreatorWebhookFromPrivateMounts();
   if(result.installed!==true)throw new Error('unverified registration');
   process.stdout.write('CREATOR_WEBHOOK_REGISTERED=PASS\n');
 }catch{
   process.stderr.write('CREATOR_WEBHOOK_REGISTRATION=NOT_VERIFIED\n');
   process.exitCode=1;
 }
}
