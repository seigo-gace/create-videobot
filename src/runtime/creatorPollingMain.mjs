import {setDefaultResultOrder} from 'node:dns';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {readPrivateToken} from './config.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {verifyCreateVdoBot} from '../telegram/identityCheck.mjs';
import {createTelegramVideoFetcher} from '../telegram/telegramFileFetch.mjs';
import {createVideoBotSourceModule} from '../telegram/creatorWiring.mjs';
import {createCreatorPollingConsumer} from './creatorPollingConsumer.mjs';
import {applyCreatorSchema} from './creatorMigrate.mjs';

const {Pool}=pg;
// Gserver host network has verified IPv4 Telegram egress, while default
// IPv6-first connections timed out. Apply only to this new Bot process.
setDefaultResultOrder('ipv4first');
function mode(env){
 if(env.NODE_ENV!=='production'||env.VIDEOBOT_RUN_MODE!=='telegram_poll'||
    env.VIDEOBOT_PRIVATE_INGRESS_ONLY!=='true')
   throw Error('CREATOR_POLL_PRIVATE_MODE_REQUIRED');
 for(const name of ['VIDEOBOT_TELEGRAM_TOKEN_FILE','VIDEOBOT_DATABASE_URL_FILE']){
  if(typeof env[name]!=='string'||!env[name].startsWith('/run/secrets/'))
    throw Error('CREATOR_POLL_PRIVATE_SECRET_MOUNT_REQUIRED');
 }
 return env;
}
function explicitUnavailable(){
 throw Error('GATE_OWNER_PUBLIC_POSTING_NOT_CONNECTED');
}
const privateStickerGate=Object.freeze({
 getVerifiedVideoTopic:explicitUnavailable,
 verifyMembership:explicitUnavailable,
 verifyReview:explicitUnavailable,
 verifyRelease:explicitUnavailable
});
export async function createCreatorPollingRuntime({
 env=process.env,poolCtor=Pool,readSecret=readPrivateToken,
 importOwner=specifier=>import(specifier),
 createSource=createVideoBotSourceModule,
 applySchema=applyCreatorSchema,
 fetchImpl=globalThis.fetch
}={}){
 mode(env);
 const token=readSecret(env.VIDEOBOT_TELEGRAM_TOKEN_FILE);
 const dburl=readSecret(env.VIDEOBOT_DATABASE_URL_FILE);
 const pool=new poolCtor({connectionString:dburl,max:3,
  connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 let api,source,poller;
 try{
  // An explicitly mounted GateApp owner bridge enables the approved public
  // video/sticker release path. Without it, private sticker creation and
  // pack management still work, but public operations fail closed.
  let gateOwner=privateStickerGate,gateConnected=false;
  if(env.VIDEOBOT_GATE_OWNER_ADAPTER){
   if(env.VIDEOBOT_GATE_OWNER_ADAPTER!=='/opt/videobot/owner/gateOwner.mjs')
     throw Error('CREATOR_POLL_GATE_OWNER_PATH_INVALID');
   const owner=await importOwner(pathToFileURL(env.VIDEOBOT_GATE_OWNER_ADAPTER).href);
   if(typeof owner?.createGateOwner!=='function')
     throw Error('CREATOR_POLL_GATE_OWNER_PROVIDER_INVALID');
   gateOwner=await owner.createGateOwner();
   gateConnected=true;
  }
  api=createTelegramBotApi({token,fetchImpl,timeoutMs:25000});
  await verifyCreateVdoBot({api,checkProfile:false});
  const info=await api('getWebhookInfo',{});
  if(typeof info?.url!=='string'||info.url!=='')
   throw Error('CREATOR_POLL_EXISTING_WEBHOOK_MUST_NOT_BE_REPLACED');
  if(env.VIDEOBOT_SCHEMA_MIGRATE!=='YES')
   throw Error('CREATOR_POLL_SCHEMA_OWNER_CONSENT_MISSING');
  const schema=await applySchema({pool});
  if(schema.migrations!==12)throw Error('CREATOR_POLL_SCHEMA_INCOMPLETE');
  const fetchSource=createTelegramVideoFetcher({telegramApi:api,token,fetchImpl});
  source=createSource({
   pool,telegramApi:api,gateOwner,botToken:token,
   webhookSecret:randomBytes(32).toString('hex'),
   storageApproved:false,
   mediaPorts:{
    fetchSource,
    saveGenerated:async()=>{throw Error('CREATOR_PRIVATE_VIDEO_STORAGE_NOT_VERIFIED');}
   }
  });
  poller=createCreatorPollingConsumer({
   telegramApi:api,
   handleTelegramWebhook:source.handleTelegramWebhook,
   webhookSecret:source.webhookSecretForPolling??null,
   pool
  });
  return {pool,source,api,poller,gateConnected,
   async close(){await pool.end();}};
 }catch(err){await pool.end();throw err;}
}
export async function runCreatorPollingMain({
 createRuntime=createCreatorPollingRuntime,signal=undefined,onStatus=()=>{}
}={}){
 const rt=await createRuntime();
 try{
  onStatus('CREATOR_DM_POLL_READY=PASS');
  onStatus('CREATOR_GATE_PUBLIC_RELEASE='+(rt.gateConnected?'CONNECTED':'NOT_VERIFIED'));
  while(!signal?.aborted){
   const outcome=await rt.poller.pollBatch({timeout:8});
   if(outcome.accepted>0)onStatus('CREATOR_DM_UPDATES_HANDLED='+outcome.accepted);
  }
 }finally{await rt.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const stop=new AbortController();
 for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>stop.abort());
 try{await runCreatorPollingMain({signal:stop.signal,onStatus:t=>process.stdout.write(t+'\\n')});}
 catch(e){
  const code=String(e?.message??'CREATOR_POLL_RUNTIME_FAILED');
  const name=/^CREATOR_[A-Z_]+$|^GATE_OWNER_PUBLIC_POSTING_NOT_CONNECTED$/.test(code)?
    code:'CREATOR_POLL_RUNTIME_FAILED';
  process.stderr.write(name+'\\n');
  process.exitCode=1;
 }
}
