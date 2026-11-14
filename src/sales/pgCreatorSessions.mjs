/** Persistent VideoBot-only session adapter. Matches the owner-revision
 * semantics used by TGtumbler's existing publicPostRepository, but keeps
 * the separate SalesBot's customer drafts in its own database.
 */
function validOwner(ownerId) {
  if(!Number.isSafeInteger(ownerId)||ownerId<=0)throw new Error('invalid creator ID');
  return ownerId;
}
function validRevision(revision) {
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('invalid revision');
  return revision;
}
export function createPostgresCreatorSessionStore(pool) {
  if(typeof pool?.query!=='function')throw new Error('private SQL pool required');
  return {
    async read(ownerId) {
      validOwner(ownerId);
      const r=await pool.query(
        'SELECT revision,screen_message_id,state FROM videobot_creator_sessions WHERE owner_user_id=$1',
        [ownerId]
      );
      if(!r.rows?.length)return null;
      const row=r.rows[0];
      const state=row.state;
      if(!state||typeof state!=='object')throw new Error('invalid stored creator state');
      return {...state,revision:Number(row.revision),
        screenMessageId:row.screen_message_id===null?null:Number(row.screen_message_id)};
    },
    async write(ownerId,expectedRevision,next) {
      validOwner(ownerId);validRevision(expectedRevision);
      if(!next||next.revision!==expectedRevision+1)throw new Error('creator revision mismatch');
      const {revision,screenMessageId,...payload}=next;
      const sql=expectedRevision===0
        ? "INSERT INTO videobot_creator_sessions (owner_user_id,revision,screen_message_id,state) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(owner_user_id) DO NOTHING RETURNING revision"
        : "UPDATE videobot_creator_sessions SET revision=$2,screen_message_id=$3,state=$4::jsonb,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$5 RETURNING revision";
      const params=[ownerId,revision,screenMessageId??null,JSON.stringify(payload)];
      if(expectedRevision!==0)params.push(expectedRevision);
      const r=await pool.query(sql,params);
      if(r?.rowCount!==1)throw new Error('CREATOR_SESSION_REVISION_STALE');
    },
    // Recovery is owned by the existing Bot poller, not a second worker.
    // Cursor pagination prevents older unresolved owners from starving.
    async listPendingStickerRegistrations({afterOwnerId=0,limit=10}={}) {
      if(!Number.isSafeInteger(afterOwnerId)||afterOwnerId<0||
         !Number.isInteger(limit)||limit<1||limit>20)
        throw new Error('STICKER_RECOVERY_PAGE_INVALID');
      const r=await pool.query(
        "SELECT owner_user_id,updated_at FROM videobot_creator_sessions"+
        " WHERE owner_user_id>$1"+
        " AND state ? 'stickerPending'"+
        " AND (state->'stickerPending'->>'status'='needs_reconcile'"+
        " OR (state->'stickerPending'->>'status'='in_progress'"+
        " AND updated_at < NOW()-INTERVAL '2 minutes'))"+
        " ORDER BY owner_user_id ASC LIMIT $2",[afterOwnerId,limit]);
      return (r.rows??[]).map(row=>({ownerId:Number(row.owner_user_id),
        updatedAt:row.updated_at}));
    },
    async setScreen(ownerId,revision,messageId) {
      validOwner(ownerId);validRevision(revision);
      if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error('invalid screen message');
      const r=await pool.query(
        'UPDATE videobot_creator_sessions SET screen_message_id=$3,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$2 RETURNING owner_user_id',
        [ownerId,revision,messageId]
      );
      if(r?.rowCount!==1)throw new Error('CREATOR_SCREEN_REVISION_STALE');
    }
  };
}
