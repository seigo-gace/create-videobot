/** Official Stars channel subscription. Not an invoice, sale or join-request. */
export function createOfficialSubscriptionInvite({telegramApi,verifyChannelAdmin}={}) {
  if(typeof telegramApi!=='function'||typeof verifyChannelAdmin!=='function')
    throw Error('SUBSCRIPTION_INVITE_PORTS_UNAVAILABLE');
  return async function createInvite({channelId,priceStars,name='見放題'}={}) {
    if(!Number.isSafeInteger(channelId)||channelId>=0||
       !Number.isSafeInteger(priceStars)||priceStars<1||priceStars>10000||
       typeof name!=='string'||name.length>32)
      throw Error('SUBSCRIPTION_INVITE_CONFIGURATION_INVALID');
    if(await verifyChannelAdmin({channelId,requiredRight:'can_invite_users'})!==true)
      throw Error('SUBSCRIPTION_INVITE_ADMIN_NOT_VERIFIED');
    const link=await telegramApi('createChatSubscriptionInviteLink',{
      chat_id:channelId,name,
      subscription_period:2592000,
      subscription_price:priceStars
    });
    if(typeof link?.invite_link!=='string'||
       !/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{8,}$/.test(link.invite_link)||
       link.subscription_period!==2592000||
       link.subscription_price!==priceStars)
      throw Error('SUBSCRIPTION_INVITE_RESULT_UNKNOWN');
    return {
      channelId,priceStars,periodSeconds:2592000,
      inviteUrl:link.invite_link
    };
  };
}
