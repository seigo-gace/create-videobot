/**
 * Collect downloadable videos from public channels already joined by the
 * existing resident Userbot. The injected resident port MUST be the authorized
 * local IPC client; this module never starts a Telegram session.
 *
 * No posting, sales, purchases, forwarding, or Telegram login is performed.
 */
function positiveInt(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_'+field);
  return value;
}

export function createPublicChannelVideoCollector({residentUserbot, catalog, maxPerChannel=100}={}) {
  for (const method of ['listJoinedPublicChannels','listChannelVideos','downloadVideo']) {
    if (typeof residentUserbot?.[method] !== 'function')
      throw new Error('RESIDENT_USERBOT_PORT_UNAVAILABLE:'+method);
  }
  if(typeof catalog?.recordDownload !== 'function')
    throw new Error('VIDEO_CATALOG_UNAVAILABLE');
  if(!Number.isSafeInteger(maxPerChannel)||maxPerChannel<1||maxPerChannel>1000)
    throw new Error('INVALID_CHANNEL_LIMIT');

  return {
    async collectOnce() {
      const channels=await residentUserbot.listJoinedPublicChannels();
      if(!Array.isArray(channels))throw new Error('INVALID_CHANNEL_LIST');
      const summary={channels:0,downloaded:0,alreadyPresent:0,failed:0};
      for(const channel of channels) {
        if(channel?.isPublic!==true)continue;
        const channelId=positiveInt(channel.id,'CHANNEL_ID');
        const username=channel.username;
        if(typeof username!=='string'||!/^[A-Za-z0-9_]{5,32}$/.test(username))
          continue;
        summary.channels++;
        const videos=await residentUserbot.listChannelVideos({channelId,limit:maxPerChannel});
        if(!Array.isArray(videos))throw new Error('INVALID_VIDEO_LIST');
        for(const item of videos) {
          const messageId=positiveInt(item?.messageId,'MESSAGE_ID');
          if(item?.kind!=='video')continue;
          // The database owns deduplication. Resident IPC owns physical writes.
          // Never construct an arbitrary destination path from Telegram text.
          try {
            const result=await residentUserbot.downloadVideo({channelId,messageId});
            if(typeof result?.storageKey!=='string'||!result.storageKey.trim())
              throw new Error('DOWNLOAD_NOT_CONFIRMED');
            const recorded=await catalog.recordDownload({
              channelId,channelUsername:username,channelTitle:String(channel.title??'').slice(0,256),
              messageId,storageKey:result.storageKey,
              fileUniqueId:typeof item.fileUniqueId==='string'?item.fileUniqueId:null,
              messageDate:item.date??null,
              caption:typeof item.caption==='string'?item.caption.slice(0,4096):''
            });
            if(recorded?.inserted===true)summary.downloaded++;
            else summary.alreadyPresent++;
          }catch{
            summary.failed++;
          }
        }
      }
      return summary;
    }
  };
}
