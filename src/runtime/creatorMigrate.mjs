import {readFile} from 'node:fs/promises';

const FILES=Object.freeze([
 '001_video_post_receipts.sql',
 '002_creator_sessions.sql',
 '003_video_listings.sql',
 '004_stars_ledger.sql',
 '005_management_fee_30.sql',
 '006_webhook_updates.sql'
]);

/** Apply the owned VideoBot schema atomically under a PostgreSQL advisory
 * transaction lock. Never touch GateApp-Bot, Gserver or MPB schema.
 * Migration 005 itself refuses silent retroactive fees on historical sales.
 */
export async function applyCreatorSchema({pool,loadSql}={}) {
 if(typeof pool?.connect!=='function')throw new Error('VideoBot migration pool required');
 const read=loadSql??(async name=>readFile(new URL('../../sql/'+name,import.meta.url),'utf8'));
 if(typeof read!=='function')throw new Error('VideoBot migration reader unavailable');
 const statements=[];
 for(const name of FILES){
  const sql=await read(name);
  if(typeof sql!=='string'||sql.trim().length<20)
    throw new Error('VideoBot migration unavailable: '+name);
  statements.push({name,sql});
 }
 const client=await pool.connect();
 if(typeof client?.query!=='function'||typeof client?.release!=='function')
  throw new Error('VideoBot migration database client unavailable');
 let committed=false;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(731107, 2607)');
  for(const entry of statements)await client.query(entry.sql);
  await client.query('COMMIT');
  committed=true;
  return {applied:true,migrations:FILES.length};
 }catch(error){
  if(!committed)await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }
}
