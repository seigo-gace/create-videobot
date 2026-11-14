/**
 * VideoBot-owned PostgreSQL store for sticker packs and Telegram registration.
 * Never stores uploaded bytes, Bot tokens, paid-video records or customer fees.
 */
function owner(value){
  if(!Number.isSafeInteger(value)||value<=0)throw new Error('STICKER_OWNER_INVALID');
  return value;
}
function requiredText(value,field,max=256){
  if(typeof value!=='string'||value.length<1||value.length>max||
     /[\r\n\0]/.test(value))throw new Error('STICKER_'+field+'_INVALID');
  return value;
}
function kind(value){
  if(!['regular','custom_emoji'].includes(value))throw new Error('STICKER_KIND_INVALID');
  return value;
}
export function createPostgresStickerInventory(pool){
  if(typeof pool?.query!=='function'||typeof pool?.connect!=='function')
    throw new Error('STICKER_SQL_POOL_REQUIRED');
  return {
    async beginRegistration({operationId,ownerId,packName,kind:packKind,sourceFileId}){
      const args=[requiredText(operationId,'OPERATION',128),owner(ownerId),
        requiredText(packName,'PACK_NAME',64),requiredText(sourceFileId,'SOURCE_FILE'),kind(packKind)];
      const q=await pool.query(
        "INSERT INTO videobot_sticker_registration_receipts"+
        " (operation_id,owner_user_id,pack_name,source_file_id,kind,phase)"+
        " VALUES ($1,$2,$3,$4,$5,'preparing') ON CONFLICT(operation_id) DO NOTHING RETURNING operation_id",args);
      if(q.rowCount!==1)throw new Error('STICKER_REGISTRATION_ALREADY_CLAIMED');
      return {claimed:true};
    },
    async uploaded({operationId,ownerId,format,fileUniqueId}){
      const f=requiredText(format,'FORMAT',8);
      if(!['static','video'].includes(f))throw new Error('STICKER_FORMAT_INVALID');
      const q=await pool.query(
        "UPDATE videobot_sticker_registration_receipts"+
        " SET format=$3,file_unique_id=$4,uploaded_file_unique_id=$4,"+
        " phase='uploaded',updated_at=NOW()"+
        " WHERE operation_id=$1 AND owner_user_id=$2 AND phase='preparing'"+
        " RETURNING operation_id",[requiredText(operationId,'OPERATION',128),owner(ownerId),f,
          requiredText(fileUniqueId,'UNIQUE_FILE')]);
      if(q.rowCount!==1)throw new Error('STICKER_UPLOAD_RECEIPT_CONFLICT');
      return {saved:true};
    },
    async submitting({operationId,ownerId}){
      const q=await pool.query(
        "UPDATE videobot_sticker_registration_receipts"+
        " SET phase='submission_started',updated_at=NOW()"+
        " WHERE operation_id=$1 AND owner_user_id=$2 AND phase='uploaded'"+
        " RETURNING operation_id",[requiredText(operationId,'OPERATION',128),owner(ownerId)]);
      if(q.rowCount!==1)throw new Error('STICKER_SUBMISSION_RECEIPT_CONFLICT');
      return {saved:true};
    },
    // Only preparing/uploaded are safe to abandon. A submission_started
    // receipt is immutable/uncertain and must never be deleted for retry.
    async abandonBeforeMutation({operationId,ownerId}) {
      const q=await pool.query(
        "DELETE FROM videobot_sticker_registration_receipts"+
        " WHERE operation_id=$1 AND owner_user_id=$2"+
        " AND phase IN ('preparing','uploaded')"+
        " RETURNING operation_id",
        [requiredText(operationId,'OPERATION',128),owner(ownerId)]);
      if(q.rowCount!==1)
        throw new Error('STICKER_PRE_MUTATION_ABORT_NOT_CONFIRMED');
      return {abandoned:true};
    },
    // Keep the rejected operation for audit. A verified HTTP 400 means the
    // specific Telegram mutation did not commit, so a NEW nonce may be used.
    // Do not apply this transition to timeouts or uncertain acknowledgments.
    async recordDefinitiveRejection({operationId,ownerId}){
      const q=await pool.query(
        "UPDATE videobot_sticker_registration_receipts"+
        " SET phase='needs_reconcile',latest_error_code='TELEGRAM_DEFINITIVE_REJECTION',updated_at=NOW()"+
        " WHERE operation_id=$1 AND owner_user_id=$2 AND phase='submission_started'"+
        " AND latest_error_code IS NULL RETURNING operation_id",
        [requiredText(operationId,'OPERATION',128),owner(ownerId)]);
      if(q.rowCount!==1)throw new Error('STICKER_REJECTION_RECEIPT_CONFLICT');
      return {rejected:true};
    },
    async needsReconcile({operationId,ownerId}){
      const q=await pool.query(
        "UPDATE videobot_sticker_registration_receipts"+
        " SET phase='needs_reconcile',updated_at=NOW()"+
        " WHERE operation_id=$1 AND owner_user_id=$2"+
        " AND phase IN ('preparing','uploaded','submission_started','needs_reconcile')"+
        " RETURNING operation_id",[requiredText(operationId,'OPERATION',128),owner(ownerId)]);
      if(q.rowCount!==1)throw new Error('STICKER_RECONCILIATION_STATE_CONFLICT');
      return {saved:true};
    },
    async getRegistration({operationId,ownerId}){
      const q=await pool.query(
        "SELECT operation_id,owner_user_id,pack_name,source_file_id,kind,format,file_unique_id,phase"+
        " FROM videobot_sticker_registration_receipts WHERE operation_id=$1 AND owner_user_id=$2",
        [requiredText(operationId,'OPERATION',128),owner(ownerId)]);
      return q.rows?.[0]??null;
    },
    async confirmRegistration({operationId,ownerId,packName,kind:packKind,
      title,format,fileId,fileUniqueId,position,emoji='🙂',isDefault=true,freshPackProof=false,acknowledgedAppendProof=false}){
      const o=owner(ownerId),op=requiredText(operationId,'OPERATION',128),
        name=requiredText(packName,'PACK_NAME',64),type=kind(packKind),
        t=requiredText(title,'TITLE',64),file=requiredText(fileId,'FILE'),
        unique=requiredText(fileUniqueId,'UNIQUE_FILE');
      if(!['static','video'].includes(format)||!Number.isSafeInteger(position)||position<0)
        throw new Error('STICKER_ITEM_RECEIPT_INVALID');
      const client=await pool.connect();
      let committed=false;
      try{
        await client.query('BEGIN');
        const claimed=await client.query(
          "SELECT phase,pack_name,kind,file_unique_id,uploaded_file_unique_id,format"+
          " FROM videobot_sticker_registration_receipts"+
          " WHERE operation_id=$1 AND owner_user_id=$2 FOR UPDATE",[op,o]);
        const row=claimed.rows?.[0];
        // A Telegram-produced sticker can have a distinct file_unique_id
        // from uploadStickerFile. This is valid ONLY for a freshly named,
        // verified one-item pack; an existing pack requires exact identity.
        const normalized=row?.file_unique_id!==unique;
        const allowNormalized=normalized&&row?.uploaded_file_unique_id===row?.file_unique_id&&
          ((freshPackProof===true&&isDefault===true&&
            ['submission_started','needs_reconcile'].includes(row?.phase))||
           (acknowledgedAppendProof===true&&isDefault===false&&
            row?.phase==='submission_started'));
        if(!row||row.pack_name!==name||row.kind!==type||row.format!==format||
           (normalized&&!allowNormalized)||
           !['uploaded','submission_started','needs_reconcile','registered'].includes(row.phase))
          throw new Error('STICKER_CONFIRM_RECEIPT_MISMATCH');
        const p=await client.query(
          "INSERT INTO videobot_sticker_packs"+
          " (pack_name,owner_user_id,kind,title,format,is_default,status,telegram_verified_at)"+
          " VALUES ($1,$2,$3,$4,$5,$6,'active',NOW())"+
          " ON CONFLICT(pack_name) DO UPDATE SET title=EXCLUDED.title,"+
          " telegram_verified_at=NOW(),status='active'"+
          " WHERE videobot_sticker_packs.owner_user_id=EXCLUDED.owner_user_id"+
          " AND videobot_sticker_packs.kind=EXCLUDED.kind"+
          " RETURNING pack_name",[name,o,type,t,format,isDefault]);
        if(p.rowCount!==1)throw new Error('STICKER_PACK_OWNER_CONFLICT');
        const item=await client.query(
          "INSERT INTO videobot_sticker_items"+
          " (pack_name,file_unique_id,file_id,format,emoji,position,telegram_verified_at)"+
          " VALUES ($1,$2,$3,$4,$5,$6,NOW())"+
          " ON CONFLICT(pack_name,file_unique_id) DO UPDATE"+
          " SET file_id=EXCLUDED.file_id,position=EXCLUDED.position,"+
          " telegram_verified_at=NOW() RETURNING file_unique_id",
          [name,unique,file,format,requiredText(emoji,'EMOJI',16),position]);
        if(item.rowCount!==1)throw new Error('STICKER_ITEM_SAVE_FAILED');
        const ok=await client.query(
          "UPDATE videobot_sticker_registration_receipts SET phase='registered',"+
          " file_unique_id=$3,latest_error_code=NULL,updated_at=NOW()"+
          " WHERE operation_id=$1 AND owner_user_id=$2 RETURNING operation_id",[op,o,unique]);
        if(ok.rowCount!==1)throw new Error('STICKER_REGISTRATION_CONFIRM_FAILED');
        await client.query('COMMIT');committed=true;
        return {confirmed:true};
      }catch(error){
        if(!committed)await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    },
    async getOwnedPack(ownerId,packName){
      const q=await pool.query(
        "SELECT p.pack_name,p.owner_user_id,p.kind,p.title,p.format,p.is_default,p.status,"+
        " (SELECT COUNT(*)::INTEGER FROM videobot_sticker_items i"+
        " WHERE i.pack_name=p.pack_name) AS item_count"+
        " FROM videobot_sticker_packs p"+
        " WHERE p.pack_name=$2 AND p.owner_user_id=$1 AND p.status='active'",
        [owner(ownerId),requiredText(packName,'PACK_NAME',64)]);
      return q.rows?.[0]??null;
    },
    async listOwnedItems({ownerId,packName,limit=10,offset=0}={}){
      const o=owner(ownerId),name=requiredText(packName,'PACK_NAME',64);
      if(!Number.isSafeInteger(limit)||limit<1||limit>10||
         !Number.isSafeInteger(offset)||offset<0)
        throw new Error('STICKER_ITEM_PAGE_INVALID');
      const q=await pool.query(
        "SELECT i.file_unique_id,i.file_id,i.emoji,i.position,i.format"+
        " FROM videobot_sticker_items i JOIN videobot_sticker_packs p"+
        " ON p.pack_name=i.pack_name WHERE p.owner_user_id=$1"+
        " AND p.pack_name=$2 AND p.status='active'"+
        " ORDER BY i.position ASC,i.file_unique_id LIMIT $3 OFFSET $4",
        [o,name,limit,offset]);
      return q.rows??[];
    },
    // Apply only an authenticated owner's real Telegram getStickerSet snapshot.
    // The transaction is atomic: a partial edit never leaves mixed inventory.
    async syncOwnedPackSnapshot({ownerId,packName,set}={}){
      const o=owner(ownerId),name=requiredText(packName,'PACK_NAME',64);
      if(!set||set.name!==name||
         !['regular','custom_emoji'].includes(set.sticker_type)||
         typeof set.title!=='string'||!set.title.trim()||set.title.length>64||
         !Array.isArray(set.stickers)||set.stickers.length>200)
        throw new Error('STICKER_SNAPSHOT_INVALID');
      const items=set.stickers.map((s,index)=>{
        if(typeof s.file_id!=='string'||!s.file_id||
           typeof s.file_unique_id!=='string'||!s.file_unique_id||
           s.is_animated===true||typeof s.emoji!=='string'||!s.emoji)
          throw new Error('STICKER_SNAPSHOT_ITEM_INVALID');
        return {fileId:s.file_id,fileUniqueId:s.file_unique_id,
          emoji:s.emoji,format:s.is_video===true?'video':'static',position:index};
      });
      if(new Set(items.map(i=>i.fileUniqueId)).size!==items.length)
        throw new Error('STICKER_SNAPSHOT_DUPLICATE_ITEM');
      const client=await pool.connect();
      let committed=false;
      try{
        await client.query('BEGIN');
        const pack=await client.query(
          "SELECT kind FROM videobot_sticker_packs"+
          " WHERE owner_user_id=$1 AND pack_name=$2 AND status='active' FOR UPDATE",
          [o,name]);
        if(pack.rowCount!==1||pack.rows[0].kind!==set.sticker_type)
          throw new Error('STICKER_PACK_OWNER_CONFLICT');
        await client.query(
          "UPDATE videobot_sticker_packs SET title=$3,telegram_verified_at=NOW(),"+
          " updated_at=NOW() WHERE owner_user_id=$1 AND pack_name=$2",
          [o,name,set.title]);
        await client.query("DELETE FROM videobot_sticker_items WHERE pack_name=$1",[name]);
        for(const item of items)
          await client.query(
            "INSERT INTO videobot_sticker_items"+
            " (pack_name,file_unique_id,file_id,format,emoji,position,telegram_verified_at)"+
            " VALUES ($1,$2,$3,$4,$5,$6,NOW())",
            [name,item.fileUniqueId,item.fileId,item.format,item.emoji,item.position]);
        await client.query('COMMIT');committed=true;
        return {synced:true,title:set.title,itemCount:items.length};
      }catch(error){
        if(!committed)await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    },
    async listPacks(ownerId,{limit=10,offset=0,packKind=null}={}){
      if(!Number.isSafeInteger(limit)||limit<1||limit>10||
         !Number.isSafeInteger(offset)||offset<0)
        throw new Error('STICKER_PACK_PAGE_INVALID');
      if(packKind!==null)kind(packKind);
      const q=packKind===null?
        await pool.query(
          "SELECT pack_name,owner_user_id,kind,title,format,is_default,status"+
          " FROM videobot_sticker_packs WHERE owner_user_id=$1 AND status='active'"+
          " ORDER BY created_at DESC,pack_name LIMIT $2 OFFSET $3",
          [owner(ownerId),limit,offset]):
        await pool.query(
          "SELECT pack_name,owner_user_id,kind,title,format,is_default,status"+
          " FROM videobot_sticker_packs WHERE owner_user_id=$1 AND status='active' AND kind=$2"+
          " ORDER BY created_at DESC,pack_name LIMIT $3 OFFSET $4",
          [owner(ownerId),packKind,limit,offset]);
      return q.rows??[];
    }
  };
}
