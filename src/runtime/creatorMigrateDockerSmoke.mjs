import pg from 'pg';
import {applyCreatorSchema} from './creatorMigrate.mjs';
const {Pool}=pg;
if(process.env.CI_DOCKER_DB_TEST_ONLY!=='YES' ||
   !/^postgres:\/\/videobot_ci:ci_only_not_a_secret@127\.0\.0\.1:5432\/videobot_migration_ci$/.test(process.env.CI_VIDEO_DB_DSN||'')){
 throw new Error('local disposable Docker CI database only');
}
const pool=new Pool({connectionString:process.env.CI_VIDEO_DB_DSN,max:1});
try {
 const result=await applyCreatorSchema({pool});
 if(result.applied!==true||result.migrations!==6)throw new Error('six migrations not confirmed');
 const q=await pool.query("SELECT to_regclass('videobot_webhook_updates') IS NOT NULL AS webhook, to_regclass('videobot_stars_ledger') IS NOT NULL AS ledger");
 if(q.rows.length!==1||q.rows[0].webhook!==true||q.rows[0].ledger!==true)
   throw new Error('Docker-installed schema not readable');
 // A second real transaction must be idempotent on a migrated database.
 const repeat=await applyCreatorSchema({pool});
 if(repeat.applied!==true||repeat.migrations!==6)throw new Error('schema re-application invalid');
 process.stdout.write('DOCKER_NODE_POSTGRES_MIGRATION=PASS\n');
}finally{await pool.end();}
