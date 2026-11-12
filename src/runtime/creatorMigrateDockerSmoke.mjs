import pg from 'pg';
import {applyCreatorSchema} from './creatorMigrate.mjs';
import {createPostgresStickerInventory} from '../stickers/pgStickerInventory.mjs';
const {Pool}=pg;
if(process.env.CI_DOCKER_DB_TEST_ONLY!=='YES' ||
   !/^postgres:\/\/videobot_ci:ci_only_not_a_secret@127\.0\.0\.1:5432\/videobot_migration_ci$/.test(process.env.CI_VIDEO_DB_DSN||'')){
 throw new Error('local disposable Docker CI database only');
}
const pool=new Pool({connectionString:process.env.CI_VIDEO_DB_DSN,max:1});
try {
 const result=await applyCreatorSchema({pool});
 if(result.applied!==true||result.migrations!==7)throw new Error('seven migrations not confirmed');
 const q=await pool.query("SELECT to_regclass('videobot_webhook_updates') IS NOT NULL AS webhook, to_regclass('videobot_stars_ledger') IS NOT NULL AS ledger, to_regclass('videobot_sticker_packs') IS NOT NULL AS packs, to_regclass('videobot_sticker_items') IS NOT NULL AS items, to_regclass('videobot_sticker_registration_receipts') IS NOT NULL AS receipts");
 if(q.rows.length!==1||!Object.values(q.rows[0]).every(v=>v===true))
   throw new Error('Docker-installed schema not readable');
 // A second real transaction must be idempotent on a migrated database.
 const repeat=await applyCreatorSchema({pool});
 if(repeat.applied!==true||repeat.migrations!==7)throw new Error('schema re-application invalid');
 // Exercise the actual Node adapter against PostgreSQL, not an in-memory fake.
 const inventory=createPostgresStickerInventory(pool);
 // Regression: a failed conversion/upload before the Telegram pack-write
 // may release its receipt, while a submitted/unknown write never may.
 const retryId='s42_ci_retry';
 const retryName='s42_ci_retry_by_CreateVdobot';
 await inventory.beginRegistration({operationId:retryId,ownerId:42,
   packName:retryName,kind:'regular',sourceFileId:'source_for_retry'});
 await inventory.uploaded({operationId:retryId,ownerId:42,format:'static',
   fileUniqueId:'unique_before_mutation'});
 const released=await inventory.abandonBeforeMutation({operationId:retryId,ownerId:42});
 if(released.abandoned!==true||
    await inventory.getRegistration({operationId:retryId,ownerId:42})!==null)
   throw new Error('STICKER_PRE_MUTATION_RELEASE_FAILED');
 await inventory.beginRegistration({operationId:retryId,ownerId:42,
   packName:retryName,kind:'regular',sourceFileId:'source_for_retry'});
 await inventory.uploaded({operationId:retryId,ownerId:42,format:'static',
   fileUniqueId:'unique_before_mutation'});
 await inventory.submitting({operationId:retryId,ownerId:42});
 const uncertainDenied=await inventory.abandonBeforeMutation({
   operationId:retryId,ownerId:42
 }).then(()=>false,e=>e?.message==='STICKER_PRE_MUTATION_ABORT_NOT_CONFIRMED');
 if(!uncertainDenied||
    (await inventory.getRegistration({operationId:retryId,ownerId:42}))?.phase!=='submission_started')
   throw new Error('STICKER_UNKNOWN_RECEIPT_MUST_REMAIN_LOCKED');
 const id='s42_ciabcdef';
 const name='s42_ciabcdef_by_CreateVdobot';
 await inventory.beginRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',sourceFileId:'ci_source_file'});
 await inventory.uploaded({operationId:id,ownerId:42,format:'static',
   fileUniqueId:'ci_unique_sticker'});
 await inventory.submitting({operationId:id,ownerId:42});
 await inventory.confirmRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',title:'CI Sticker pack',format:'static',
   fileId:'ci_sticker_file_id',fileUniqueId:'ci_unique_sticker',position:0});
 const found=await inventory.listPacks(42);
 const foreign=await inventory.listPacks(99);
 const receipt=await inventory.getRegistration({operationId:id,ownerId:42});
 if(found.length!==1||found[0].pack_name!==name||foreign.length!==0||
    receipt?.phase!=='registered')
   throw new Error('STICKER_PERSISTENT_RECEIPT_READBACK_FAILED');
 await inventory.confirmRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',title:'CI Sticker pack',format:'static',
   fileId:'ci_sticker_file_id',fileUniqueId:'ci_unique_sticker',position:0});
 const duplicate=await inventory.beginRegistration({operationId:id,ownerId:42,
   packName:name,kind:'regular',sourceFileId:'ci_source_file'}).then(()=>false,
     error=>error?.message==='STICKER_REGISTRATION_ALREADY_CLAIMED');
 if(!duplicate)throw new Error('STICKER_DUPLICATE_OPERATION_NOT_DENIED');
 process.stdout.write('DOCKER_NODE_POSTGRES_STICKER_INVENTORY=PASS\n');
 process.stdout.write('DOCKER_NODE_POSTGRES_MIGRATION=PASS\n');
}finally{await pool.end();}
