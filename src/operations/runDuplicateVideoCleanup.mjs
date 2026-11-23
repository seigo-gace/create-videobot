import {readFileSync,statSync} from 'node:fs';
import pg from 'pg';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {readPrivateToken} from '../runtime/config.mjs';
import {createCreatorTelegramFetch} from '../runtime/creatorEgress.mjs';
import {createTelegramBotApi} from '../telegram/botApi.mjs';
import {cleanupDuplicateVideoOffers} from './cleanupDuplicateVideoOffers.mjs';

setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
const root='/var/lib/videobot/media-work';
if(!statSync(root).isDirectory())throw Error('VIDEO_CLEANUP_AUDIT_STORAGE_MISSING');
if(process.env.VIDEOBOT_DB_NAME!=='videobot')throw Error('VIDEO_CLEANUP_DB_NOT_VERIFIED');
const pool=new pg.Pool({
 host:process.env.VIDEOBOT_DB_HOST,
 user:process.env.VIDEOBOT_DB_USER,
 database:process.env.VIDEOBOT_DB_NAME,
 password:readFileSync('/run/secrets/videobot_db_password','utf8').trim(),
 max:1,connectionTimeoutMillis:4500
});
const transport=createCreatorTelegramFetch();
try{
 const api=createTelegramBotApi({
   token:readPrivateToken(process.env.VIDEOBOT_TELEGRAM_TOKEN_FILE),
   fetchImpl:transport.fetch,timeoutMs:25000
 });
 const result=await cleanupDuplicateVideoOffers({
   pool,api,auditFile:root+'/duplicate-video-cleanup-20261124.jsonl'
 });
 console.log('VIDEO_CLEANUP_DELETED='+result.deleted);
 console.log('VIDEO_CLEANUP_SURVIVOR_PROTECTED=YES');
}finally{
 await transport.close();
 await pool.end();
}
