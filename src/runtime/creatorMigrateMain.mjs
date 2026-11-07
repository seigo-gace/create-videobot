import pg from 'pg';
import {readPrivateToken} from './config.mjs';
import {applyCreatorSchema} from './creatorMigrate.mjs';
const {Pool}=pg;

export async function runCreatorMigration({
 env=process.env,PoolCtor=Pool,readSecret=readPrivateToken,apply=applyCreatorSchema
}={}){
 if(env.NODE_ENV!=='production'||env.VIDEOBOT_SCHEMA_MIGRATE!=='YES')
  throw new Error('explicit VideoBot schema migration mode required');
 const path=env.VIDEOBOT_DATABASE_URL_FILE;
 if(typeof path!=='string'||!path.startsWith('/run/secrets/'))
  throw new Error('private VideoBot DB secret mount required');
 const url=readSecret(path);
 const pool=new PoolCtor({connectionString:url,max:1,connectionTimeoutMillis:5000});
 try{return await apply({pool});}finally{await pool.end();}
}
if(process.argv[1]&&process.argv[1].endsWith('/creatorMigrateMain.mjs')){
 try{
  const outcome=await runCreatorMigration();
  process.stdout.write('VIDEOBOT_SCHEMA_MIGRATED='+outcome.migrations+'\n');
 }catch{
  process.stderr.write('VIDEOBOT_SCHEMA_MIGRATION_FAILED\n');
  process.exitCode=1;
 }
}
