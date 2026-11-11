const PAGES=Object.freeze({
 home:{text:'🎬 クリエータービデオ\n\n動画の投稿・管理・売上確認ができます。\n販売売上から運営管理費30%を控除し、投稿者分は70%です。',buttons:[
  [['🎬 動画を投稿','menu:listing'],['📦 マイ動画','menu:manage']],
  [['⭐ 売上・引き出し','menu:sales']],
  [['🎨 ステッカー・絵文字','menu:stickers']]
 ]},
 listing:{text:'🎬 新しい動画を投稿\n\n管理費は売上の30%、投稿者分は70%です。実Telegram投稿はまだ接続されていません。',buttons:[[['↩ 戻る','menu:home']]]},
 manage:{text:'📦 マイ動画\n\n本人の動画一覧・編集・削除は現在開発中です。実データにはまだ接続されていません。',buttons:[[['↩ 戻る','menu:home']]]},
 sales:{text:'⭐ 売上・引き出し\n\n販売売上の30%を運営管理費として差し引き、投稿者分は70%です。\nStars残高・履歴の実データは未接続です。クリエーターへのStars払出が検証できるまで引き出しを有効化しません。',buttons:[[['↩ 戻る','menu:home']]]}
});
export function menuPage(page='home'){
 const p=PAGES[page];if(!p)throw new Error('unknown menu page');
 return {text:p.text,reply_markup:{inline_keyboard:p.buttons.map(row=>row.map(([text,callback_data])=>({text,callback_data})))}};
}
export function parseMenuCallback(value){
 if(typeof value!=='string'||!/^menu:(home|listing|manage|sales)$/.test(value))throw new Error('unknown menu action');
 return value.slice(5);
}
export async function handleMenuUpdate({update,api}){
 if(typeof api!=='function'||!update||typeof update!=='object')throw new Error('invalid update');
 const msg=update.message;
 if(msg?.chat?.type==='private' && typeof msg.text==='string' && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(msg.text)){
  if(!Number.isSafeInteger(msg.chat.id))throw new Error('invalid private chat');
  return api('sendMessage',{chat_id:msg.chat.id,...menuPage()});
 }
 const cb=update.callback_query;
 if(!cb)return {handled:false};
 if(typeof cb.id!=='string'||cb.id.length===0||cb.message?.chat?.type!=='private'||cb.from?.id!==cb.message.chat.id){
  throw new Error('unauthorized menu callback');
 }
 let page;
 try{page=parseMenuCallback(cb.data);}catch{
  await api('answerCallbackQuery',{callback_query_id:cb.id,text:'操作を確認できません。',show_alert:true});
  return {handled:false};
 }
 await api('answerCallbackQuery',{callback_query_id:cb.id});
 if(!Number.isSafeInteger(cb.message.chat.id)||!Number.isSafeInteger(cb.message.message_id))throw new Error('invalid menu message');
 return api('editMessageText',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,...menuPage(page)});
}
