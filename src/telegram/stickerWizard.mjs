import {randomBytes} from 'node:crypto';
import {menuPage} from './menuPanel.mjs';

function privateActor(update){
  const message=update?.message??update?.callback_query?.message;
  const from=update?.callback_query?.from??update?.message?.from;
  if(message?.chat?.type!=='private'||!Number.isSafeInteger(message.chat.id)||
    message.chat.id<=0||from?.id!==message.chat.id)throw new Error('STICKER_PRIVATE_OWNER_REQUIRED');
  return {id:message.chat.id,messageId:message.message_id};
}
const button=(name,action,rev)=>({text:name,callback_data:action+'|r'+rev});
function panel(session,revision){
  const d=session?.stickerDraft??{};
  const btn=(text,action)=>button(text,action,revision);
  if(session.screen==='sticker_choose')return {
    text:'🎨 ステッカー・絵文字作成\n作成する種類を選択してください。',
    reply_markup:{inline_keyboard:[
      [btn('🎨 ステッカー','sticker:type:regular'),btn('😀 絵文字','sticker:type:custom_emoji')],
      [btn('↩ 戻る','sticker:cancel')]
    ]}
  };
  if(session.screen==='sticker_title')return {
    text:'📦 初回のパック名を1行で送信してください（64文字以内）。\n2回目以降は同じパックへ追加します。',
    reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:back')]]}
  };
  if(session.screen==='sticker_input')return {
    text:(d.kind==='custom_emoji'?'😀 カスタム絵文字':'🎨 ステッカー')+
      '\nパック：'+d.title+'\n\n画像・GIF・MP4・WebMをTelegramの入力欄から送信してください。\n長辺を自動で合わせ、縦横比は維持します。',
    reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:back')]]}
  };
  if(session.screen==='sticker_ready')return {
    text:'✅ 素材を受信しました。\nパック：'+d.title+
      '\n\n［登録する］を押すと変換・検証後にTelegramのパックへ追加します。\n動画が3秒を超える場合は先頭3秒を使用します。',
    reply_markup:{inline_keyboard:[
      [btn('📦 登録する','sticker:register'),btn('↩ 戻る','sticker:back')]
    ]}
  };
  if(session.screen==='sticker_registering'||session.screen==='sticker_reconcile')return {
    text:session.screen==='sticker_registering'?'⏳ 素材を変換・登録中です。':
      '⚠️ 登録結果を確認できません。二重登録を避けるため自動再実行しません。',
    reply_markup:{inline_keyboard:[[btn('↩ メニューへ','sticker:cancel')]]}
  };
  if(session.screen==='sticker_done')return {
    text:'✅ Telegramパックへの登録を確認しました。\n'+d.link+
      '\n\n続けて同じパックに追加できます。',
    reply_markup:{inline_keyboard:[
      [btn('➕ 続けて作成','sticker:again'),btn('↩ メニューへ','sticker:cancel')]
    ]}
  };
  throw new Error('STICKER_SCREEN_UNKNOWN');
}
function mediaFileId(message){
  const id=message?.document?.file_id??message?.animation?.file_id??
    message?.video?.file_id??(Array.isArray(message?.photo)?message.photo.at(-1)?.file_id:null);
  return typeof id==='string'&&/^[A-Za-z0-9_-]{3,256}$/.test(id)?id:null;
}
/**
 * Sticker-only DM state machine. Shares the VideoBot's durable creator
 * session and shared screen transport; preserves video draft and sales state.
 * Conversion/Telegram API mutations are passed as a bounded port.
 */
export function createStickerWizard({api,sessionStore,screenTransport,publishSticker}={}){
  if(typeof api!=='function'||typeof sessionStore?.read!=='function'||
    typeof sessionStore?.write!=='function'||typeof sessionStore?.setScreen!=='function'||
    typeof screenTransport?.show!=='function'||typeof publishSticker!=='function')
    throw new Error('STICKER_WIZARD_DEPENDENCIES_MISSING');

  async function persist(id,old,patch){
    const prev=old?.revision??0,revision=prev+1;
    const next={...old,...patch,revision};
    await sessionStore.write(id,prev,next);
    const screen=next.screen==='home'?menuPage('home'):panel(next,revision);
    const result=await screenTransport.show(id,next.screenMessageId??null,screen);
    if(result?.messageId!==next.screenMessageId)
      await sessionStore.setScreen(id,revision,result.messageId);
    return {handled:true,revision,messageId:result.messageId};
  }
  async function handle(update){
    const message=update?.message,cb=update?.callback_query;
    if(cb){
      const data=cb.data??'';
      if(data!=='menu:stickers'&&!data.startsWith('sticker:'))return {handled:false};
      const {id,messageId}=privateActor(update);
      await api('answerCallbackQuery',{callback_query_id:cb.id});
      const old=await sessionStore.read(id);
      if(data==='menu:stickers'){
        return persist(id,old,{screen:'sticker_choose',stickerDraft:null,waiting:null,
          screenMessageId:messageId});
      }
      const match=/^(sticker:[a-z_]+(?::[a-z_]+)?)\|r([1-9][0-9]*)$/.exec(data);
      if(!match||Number(match[2])!==old?.revision||messageId!==old?.screenMessageId)
        return {handled:true,staleButton:true};
      const action=match[1],draft=old.stickerDraft??{};
      if(action==='sticker:cancel')return persist(id,old,{screen:'home',stickerDraft:null,waiting:null});
      if(action==='sticker:back')return persist(id,old,{
        screen:old.screen==='sticker_ready'?'sticker_input':'sticker_choose',
        stickerDraft:old.screen==='sticker_ready'?{...draft,fileId:null}:null
      });
      if(action.startsWith('sticker:type:')){
        const kind=action.slice('sticker:type:'.length);
        if(!['regular','custom_emoji'].includes(kind))throw new Error('STICKER_KIND_UNKNOWN');
        const name=old.stickerSets?.[kind]??null;
        return persist(id,old,{
          screen:name?'sticker_input':'sticker_title',
          stickerDraft:{kind,title:name?.title??null,setName:name?.name??null,
            nonce:randomBytes(8).toString('hex'),fileId:null}
        });
      }
      if(action==='sticker:again'&&old.screen==='sticker_done')
        return persist(id,old,{screen:'sticker_input',
          stickerDraft:{...draft,fileId:null,link:null}});
      if(action==='sticker:register'){
        if(old.screen!=='sticker_ready'||!draft.fileId||!draft.kind||!draft.title)
          return {handled:true,staleButton:true};
        // Claim revision BEFORE side effects; any error remains non-retryable
        // until an explicit reconciliation of the actual Telegram set.
        const claimed={...old,revision:old.revision+1,screen:'sticker_registering'};
        await sessionStore.write(id,old.revision,claimed);
        try{
          const result=await publishSticker({owner:id,draft});
          if(result?.verified!==true||!result.name)throw new Error('STICKER_REGISTRATION_UNVERIFIED');
          const current=await sessionStore.read(id);
          const set={name:result.name,title:draft.title};
          const saved={...current.stickerSets,[draft.kind]:set};
          const link=draft.kind==='custom_emoji'
            ?'https://t.me/addemoji/'+result.name
            :'https://t.me/addstickers/'+result.name;
          return persist(id,current,{screen:'sticker_done',stickerSets:saved,
            stickerDraft:{...draft,setName:result.name,link,fileId:null}});
        }catch{
          const current=await sessionStore.read(id);
          return persist(id,current,{screen:'sticker_reconcile'});
        }
      }
      return {handled:true,staleButton:true};
    }
    if(!message||message.chat?.type!=='private')return {handled:false};
    const {id}=privateActor(update);
    const old=await sessionStore.read(id);
    // Telegram standard /start deep-link from the pinned public Topic.
    if(typeof message.text==='string'&&
       /^\/start(?:@[A-Za-z0-9_]+)?\s+sticker$/.test(message.text.trim())) {
      return persist(id,old,{screen:'sticker_choose',stickerDraft:null,waiting:null});
    }
    if(old?.screen==='sticker_title'){
      const title=message.text?.trim();
      try{
        if(typeof title!=='string'||title.length<1||title.length>64||
          /[\r\n]/.test(title))return persist(id,old,{screen:'sticker_title'});
        return persist(id,old,{screen:'sticker_input',stickerDraft:{...old.stickerDraft,title}});
      }finally{await api('deleteMessage',{chat_id:id,message_id:message.message_id}).catch(()=>{});}
    }
    if(old?.screen==='sticker_input'){
      const fileId=mediaFileId(message);
      try{
        if(!fileId)return persist(id,old,{screen:'sticker_input'});
        return persist(id,old,{screen:'sticker_ready',
          stickerDraft:{...old.stickerDraft,fileId}});
      }finally{await api('deleteMessage',{chat_id:id,message_id:message.message_id}).catch(()=>{});}
    }
    return {handled:false};
  }
  return {handle};
}
