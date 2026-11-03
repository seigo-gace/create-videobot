const PAGES=Object.freeze({
 home:{text:'🎬 動画販売・出品サポート\n\n下のボタンから操作を選択してください。',buttons:[[['🎥 動画を出品','menu:listing']],[['📋 出品・販売管理','menu:manage']],[['❓ 利用案内','menu:help']]]},
 listing:{text:'🎥 動画の出品\n\n動画登録と価格設定は現在準備中です。公開や販売はまだ開始されません。',buttons:[[['🏠 メニューへ','menu:home']]]},
 manage:{text:'📋 出品・販売管理\n\n出品一覧・販売履歴の表示は準備中です。',buttons:[[['🏠 メニューへ','menu:home']]]},
 help:{text:'❓ ご利用案内\n\nこのBotは動画の出品準備と販売管理を支援します。権利確認と承認が必要です。現在、販売機能は開発中です。',buttons:[[['🏠 メニューへ','menu:home']]]}
});
export function menuPage(page='home'){
 const p=PAGES[page];if(!p)throw new Error('unknown menu page');
 return {text:p.text,reply_markup:{inline_keyboard:p.buttons.map(row=>row.map(([text,callback_data])=>({text,callback_data})))}};
}
export function parseMenuCallback(value){
 if(typeof value!=='string'||!/^menu:(home|listing|manage|help)$/.test(value))throw new Error('unknown menu action');
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
