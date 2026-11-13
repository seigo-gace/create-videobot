/** Searchable metadata only; file bytes are stored by the resident download port. */
export function createPostgresPublicChannelVideoCatalog(pool) {
  if(typeof pool?.query!=='function')throw new Error('PRIVATE_SQL_POOL_REQUIRED');
  return {
    async recordDownload(video) {
      const r=await pool.query(
        `INSERT INTO videobot_public_channel_videos
          (channel_id,channel_username,channel_title,message_id,storage_key,file_unique_id,message_date,caption,caption_ja,thumbnail_1,thumbnail_2)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (channel_id,message_id) DO NOTHING RETURNING message_id`,
        [video.channelId,video.channelUsername,video.channelTitle,video.messageId,
         video.storageKey,video.fileUniqueId,video.messageDate,video.caption,
         video.captionJapanese,video.thumbnail1,video.thumbnail2]
      );
      return {inserted:r.rowCount===1};
    },
    async search({query='',limit=30,offset=0}={}) {
      if(typeof query!=='string'||query.length>256)throw Error('INVALID_SEARCH_QUERY');
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||
         !Number.isSafeInteger(offset)||offset<0)throw Error('INVALID_PAGINATION');
      const r=await pool.query(
        `SELECT channel_id,channel_username,channel_title,message_id,storage_key,
                file_unique_id,message_date,caption,caption_ja,thumbnail_1,thumbnail_2,downloaded_at
           FROM videobot_public_channel_videos
          WHERE ($1 = '' OR channel_title ILIKE '%' || $1 || '%' OR
                 channel_username ILIKE '%' || $1 || '%' OR caption ILIKE '%' || $1 || '%' OR caption_ja ILIKE '%' || $1 || '%')
          ORDER BY downloaded_at DESC, channel_id, message_id DESC
          LIMIT $2 OFFSET $3`,[query,limit,offset]);
      return r.rows;
    }
  };
}
