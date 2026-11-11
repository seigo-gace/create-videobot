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
      [btn('📦 マイパック','sticker:packs')],
      [btn('↩ 戻る','sticker:cancel')]
    ]}
  };
  if(session.screen==='sticker_packs') {
    const rows=Array.isArray(session.stickerPackRows)?session.stickerPackRows:[];
    const page=session.stickerPackPage??0;
    const keys=rows.map((r,i)=>[btn(String(r.title).slice(0,48)+
      (r.kind==='custom_emoji'?' 😀':' 🎨'),'sticker:pick:'+i)]);
    keys.push([
      ...(page>0?[btn('◀ 前へ','sticker:prev')]:[]),
      ...(rows.length===10?[btn('次へ ▶','sticker:next')]:[])
    ]);
    keys.push([btn('↩ 戻る','sticker:back')]);
    return {text:'📦 マイパック（'+(page+1)+'ページ）'+
      (rows.length?'\n編集するパックを選択してください。':'\n登録済みパックはありません。'),
      reply_markup:{inline_keyboard:keys.filter(x=>x.length>0)}};
  }
  if(session.screen==='sticker_pack') {
    const p=session.stickerSelectedPack;
    if(!p||typeof p.title!=='string')throw new Error('STICKER_PACK_SELECTION_INVALID');
    return {text:'📦 '+p.title+'\n'+
      (p.kind==='custom_emoji'?'カスタム絵文字':'ステッカー')+
      '｜'+(p.item_count??0)+'個\n\n素材を追加できます。',
      reply_markup:{inline_keyboard:[
        [btn('➕ このパックに追加','sticker:add')],
        [btn('↩ マイパックへ','sticker:packs')]
      ]}};
  }
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
      '⚠️ Telegramの登録結果を確認できません。再登録は行わず、確認だけ実行できます。',
    reply_markup:{inline_keyboard:session.screen==='sticker_reconcile'
      ?[[btn('🔄 登録結果を確認','sticker:check')]]
      :[]}
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
export function createStickerWizard({api,sessionStore,screenTransport,publishSticker,reconcileSticker,packInventory}={}){
  if(typeof api!=='function'||typeof sessionStore?.read!=='function'||
    typeof sessionStore?.write!=='function'||typeof sessionStore?.setScreen!=='function'||
    typeof screenTransport?.show!=='function'||typeof publishSticker!=='function'||
    (reconcileSticker!==undefined&&typeof reconcileSticker!=='function')||
    (packInventory!==undefined&&(
      typeof packInventory?.listPacks!=='function'||
      typeof packInventory?.getOwnedPack!=='function')))
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
      // Design v0.6 X10: allow read-only reconciliation, never a fresh write.
      if(old?.stickerPending?.status==='in_progress'||
         old?.stickerPending?.status==='needs_reconcile'){
        const check=/^sticker:check\\|r([1-9][0-9]*)$/.exec(data);
        if(!check||old.stickerPending.status!=='needs_reconcile'||
           Number(check[1])!==old.revision||
           messageId!==old.screenMessageId||
           typeof reconcileSticker!=='function')
          return {handled:true,registrationLocked:true};
        const outcome=await reconcileSticker({owner:id,pending:old.stickerPending})
          .catch(()=>({status:'unknown',verified:false}));
        const current=await sessionStore.read(id);
        if(outcome?.verified!==true||outcome.status!=='registered'||!outcome.name)
          return {handled:true,registrationLocked:true};
        const draft=current.stickerDraft??{};
        const set={name:outcome.name,title:current.stickerPending.title};
        const saved={...current.stickerSets,[current.stickerPending.kind]:set};
        const link=current.stickerPending.kind==='custom_emoji'
          ?'https://t.me/addemoji/'+outcome.name
          :'https://t.me/addstickers/'+outcome.name;
        return persist(id,current,{screen:'sticker_done',stickerPending:null,
          stickerSets:saved,stickerDraft:{...draft,setName:outcome.name,link,fileId:null}});
      }
      if(data==='menu:stickers'){
        return persist(id,old,{screen:'sticker_choose',stickerDraft:null,waiting:null,
          screenMessageId:messageId});
      }
      const match=/^(sticker:[a-z_]+(?::[a-z_0-9]+)?)\|r([1-9][0-9]*)$/.exec(data);
      if(!match||Number(match[2])!==old?.revision||messageId!==old?.screenMessageId)
        return {handled:true,staleButton:true};
      const action=match[1],draft=old.stickerDraft??{};
      if(action==='sticker:packs'||action==='sticker:next'||action==='sticker:prev') {
        if(!packInventory)throw new Error('STICKER_PACK_INVENTORY_UNAVAILABLE');
        const prior=old.screen==='sticker_packs'?(old.stickerPackPage??0):0;
        const page=action==='sticker:next'?prior+1:
          action==='sticker:prev'?Math.max(0,prior-1):
          old.screen==='sticker_pack'?(old.stickerPackPage??0):0;
        const rows=await packInventory.listPacks(id,{limit:10,offset:page*10});
        return persist(id,old,{screen:'sticker_packs',stickerPackPage:page,
          stickerPackRows:rows,stickerSelectedPack:null});
      }
      if(action.startsWith('sticker:pick:')){
        if(old.screen!=='sticker_packs'||!packInventory)
          return {handled:true,staleButton:true};
        const idx=Number(action.slice('sticker:pick:'.length));
        const candidate=old.stickerPackRows?.[idx];
        if(!Number.isSafeInteger(idx)||idx<0||idx>=10||!candidate)
          return {handled:true,staleButton:true};
        const p=await packInventory.getOwnedPack(id,candidate.pack_name);
        if(!p||p.kind!==candidate.kind)return {handled:true,staleButton:true};
        return persist(id,old,{screen:'sticker_pack',stickerSelectedPack:p});
      }
      if(action==='sticker:add'){
        if(old.screen!=='sticker_pack'||!packInventory||
           !old.stickerSelectedPack?.pack_name)return {handled:true,staleButton:true};
        const p=await packInventory.getOwnedPack(id,old.stickerSelectedPack.pack_name);
        if(!p||p.kind!==old.stickerSelectedPack.kind)
          return {handled:true,staleButton:true};
        return persist(id,old,{screen:'sticker_input',stickerDraft:{
          kind:p.kind,title:p.title,setName:p.pack_name,
          nonce:randomBytes(8).toString('hex'),fileId:null
        }});
      }
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
        if(old.stickerPending) return {handled:true,registrationLocked:true};
        const claimed={...old,revision:old.revision+1,screen:'sticker_registering',
          stickerPending:{status:'in_progress',kind:draft.kind,
            setName:draft.setName??null,nonce:draft.nonce,fileId:draft.fileId,
            title:draft.title,phase:'preparing'}};
        await sessionStore.write(id,old.revision,claimed);
        try{
          const checkpoint=async(stage,receipt)=>{
            const current=await sessionStore.read(id);
            if(current?.stickerPending?.status!=='in_progress'||
               current.stickerPending.fileId!==draft.fileId||
               current.stickerPending.nonce!==draft.nonce)
              throw new Error('STICKER_PENDING_SESSION_MISMATCH');
            await sessionStore.write(id,current.revision,{
              ...current,revision:current.revision+1,
              stickerPending:{...current.stickerPending,
                packName:receipt.name,fileUniqueId:receipt.fileUniqueId,
                format:receipt.format,phase:stage}
            });
          };
          const result=await publishSticker({owner:id,draft,
            onUploaded:receipt=>checkpoint('uploaded',receipt),
            onBeforeMutation:receipt=>checkpoint('submission_started',receipt)});
          if(result?.verified!==true||!result.name)throw new Error('STICKER_REGISTRATION_UNVERIFIED');
          const current=await sessionStore.read(id);
          const set={name:result.name,title:draft.title};
          const saved={...current.stickerSets,[draft.kind]:set};
          const link=draft.kind==='custom_emoji'
            ?'https://t.me/addemoji/'+result.name
            :'https://t.me/addstickers/'+result.name;
          return persist(id,current,{screen:'sticker_done',stickerPending:null,stickerSets:saved,
            stickerDraft:{...draft,setName:result.name,link,fileId:null}});
        }catch{
          const current=await sessionStore.read(id);
          return persist(id,current,{screen:'sticker_reconcile',
            stickerPending:{...current.stickerPending,status:'needs_reconcile'}});
        }
      }
      return {handled:true,staleButton:true};
    }
    if(!message||message.chat?.type!=='private')return {handled:false};
    const {id}=privateActor(update);
    const old=await sessionStore.read(id);
    // Protect the common VideoBot DM owner as well as sticker callbacks.
    // Any private text/media while a registration is unresolved must not be
    // routed to the video editor or wipe the pending Telegram receipt.
    if(old?.stickerPending?.status==='in_progress'||
       old?.stickerPending?.status==='needs_reconcile'){
      // A crash may leave an in_progress receipt but the original screen
      // could still show [Register]. Recover the panel without re-registering.
      // This only changes UI state: the Telegram mutation is NEVER reissued.
      if(typeof message.text==='string'&&
         /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text.trim())&&
         old.stickerPending.status==='in_progress'){
        return persist(id,old,{screen:'sticker_reconcile',
          stickerPending:{...old.stickerPending,status:'needs_reconcile'}});
      }
      if(typeof message.text==='string'&&
         /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text.trim())&&
         old.screen!=='sticker_reconcile'){
        return persist(id,old,{screen:'sticker_reconcile'});
      }
      return {handled:true,registrationLocked:true};
    }
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
