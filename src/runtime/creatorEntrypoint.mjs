import {Pool} from 'pg';
import {pathToFileURL} from 'node:url';
import {readPrivateToken} from './config.mjs';
import {createCreatorLiveService} from './creatorLiveService.mjs';

function requiredSecret(env,key){
 const path=env[key];
 if(typeof path!=='string'||!path.startsWith('/run/secrets/'))
  throw new Error('private runtime secret mount required: '+key);
 return readPrivateToken(path);
}
function runtimeOptions(env){
 if(env.NODE_ENV!=='production'||env.VIDEOBOT_RUN_MODE!=='telegram'||
    env.VIDEOBOT_PRIVATE_INGRESS_ONLY!=='true')
   throw new Error('private Telegram runtime mode required');
 const port=Number(env.VIDEOBOT_PRIVATE_PORT||8766);
 if(!Number.isSafeInteger(port)||port<1||port>65535)
   throw new Error('invalid private listener port');
 if(env.VIDEOBOT_GATE_OWNER_ADAPTER!=='/opt/videobot/owner/gateOwner.mjs')
   throw new Error('verified GateApp owner adapter mount required');
 return {port,host:env.VIDEOBOT_PRIVATE_BIND||'0.0.0.0'};
}

export async function startCreatorFromPrivateMounts({
  env=process.env,pgPoolCtor=Pool,
  importOwner=specifier=>import(specifier)
}={}) {
 const options=runtimeOptions(env);
 const botToken=requiredSecret(env,'VIDEOBOT_TELEGRAM_TOKEN_FILE');
 const webhookSecret=requiredSecret(env,'VIDEOBOT_WEBHOOK_SECRET_FILE');
 const databaseUrl=requiredSecret(env,'VIDEOBOT_DATABASE_URL_FILE');
 if(typeof pgPoolCtor!=='function')throw new Error('PostgreSQL pool driver required');
 const pool=new pgPoolCtor({
   connectionString:databaseUrl,
   max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:30000
 });
 let service;
 try {
   const owner=await importOwner(pathToFileURL(env.VIDEOBOT_GATE_OWNER_ADAPTER).href);
   if(typeof owner?.createGateOwner!=='function'||
      typeof owner?.verifyPrivateMediaStore!=='function')
     throw new Error('trusted existing GATE owner bridge missing');
   const gateOwner=await owner.createGateOwner();
   const checkStorage=()=>owner.verifyPrivateMediaStore();
   const storage=await checkStorage();
   if(storage?.kind!=='private_video_media_store'||storage.verified!==true||
      storage.private!==true||!Number.isSafeInteger(storage.chatId)||
      storage.chatId>=0)
     throw new Error('private Creator media storage not verified');
   service=createCreatorLiveService({
     botToken,webhookSecret,pool,gateOwner,storageApproved:true,
     verifyPrivateMediaStore:checkStorage,host:options.host,port:options.port
   });
   const listener=await service.start();
   return Object.freeze({
     listener,
     async close(){
       try{await service.close();}finally{await pool.end();}
     }
   });
 }catch(error){
   await service?.close().catch(()=>{});
   await pool.end().catch(()=>{});
   throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  startCreatorFromPrivateMounts().then(runtime=>{
    process.stdout.write('CREATOR_BOT_RUNTIME=LISTENING_PRIVATE\n');
    let closing=false;
    for(const signal of ['SIGINT','SIGTERM']){
      process.once(signal,()=>{
        if(closing)return;
        closing=true;
        runtime.close().then(()=>process.exit(0),()=>process.exit(1));
      });
    }
  }).catch(error=>{
    // Do not leak private DSN, Telegram token, buyer IDs or private paths.
    const allowed=new Set([
      'private Telegram runtime mode required','invalid private listener port',
      'verified GateApp owner adapter mount required',
      'trusted existing GATE owner bridge missing',
      'private Creator media storage not verified',
      'VideoBot migrations missing','unexpected Telegram bot identity'
    ]);
    const code=allowed.has(error?.message)?error.message:'CREATOR_RUNTIME_STARTUP_FAILED';
    process.stderr.write(code+'\n');
    process.exitCode=1;
  });
}
