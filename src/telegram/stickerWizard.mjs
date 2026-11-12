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
function stickerHelp(error){
  const code=String(error?.message??'');
  // Do not display raw Telegram errors, local paths, or secret-bearing URLs.
  if(/STICKER_INPUT_SIZE_INVALID|file exceeds Bot API download limit|download exceeds configured limit/.test(code))
    return '素材が20MBの取得上限を超えています。20MB以下に圧縮して送り直してください。';
  if(/STICKER_SOURCE_PATH_INVALID|STICKER_INPUT_SIZE_INVALID_EMPTY/.test(code))
    return '素材を読み取れませんでした。画像や動画を保存し直してから送ってください。';
  if(/STICKER_DIMENSIONS_UNSUPPORTED/.test(code))
    return '画像サイズを読み取れません。壊れていない画像・動画を送り直してください。';
  if(/STICKER_OUTPUT_SIZE_EXCEEDED/.test(code))
    return '自動調整しても容量上限に収まりません。動きを減らすか短い素材を送ってください。';
  if(/STICKER_MEDIA_COMMAND_FAILED|STICKER_STATIC_CODEC_INVALID|STICKER_VIDEO_CODEC_INVALID|STICKER_VIDEO_DURATION_INVALID|STICKER_VIDEO_FPS_INVALID/.test(code))
    return '素材の変換に失敗しました。JPG・PNG・GIF・MP4・WebM形式の再生できる素材を送り直してください。';
  if(/STICKER_OWNER_INVALID|STICKER_PRIVATE_OWNER_REQUIRED/.test(code))
    return 'このパックを変更する権限がありません。ご自身のパックを選んでください。';
  if(/STICKER_SET_TYPE_CONFLICT|STICKER_EXISTING_PACK_NOT_FOUND|STICKER_NEW_PACK_NAME_CONFLICT/.test(code))
    return '登録先パックの種類または状態が一致しません。マイパックを確認してください。';
  if(/STICKER_UPLOAD_RECEIPT_INVALID|Telegram API request failed|Telegram API rejected request|Telegram file download failed/.test(code))
    return 'Telegramへの素材送信を確認できませんでした。通信状態を確認してからもう一度お試しください。';
  if(/STICKER_REPLACEMENT_FORMAT_MISMATCH|STICKER_REPLACEMENT_DUPLICATE_MEDIA/.test(code))
    return '現在のパックに合う別の素材を送ってください。既存の素材と同一のファイルには置換できません。';
  if(/STICKER_PENDING_SESSION_MISMATCH|STICKER_REGISTRATION_UNVERIFIED|STICKER_PACK_INVENTORY_UNAVAILABLE/.test(code))
    return '保存した作業状態を確認できませんでした。二重登録を防ぐため、管理者に登録状況を確認してください。';
  return '内部処理を完了できませんでした。時間をおいてもう一度お試しください。解決しない場合は管理者にお知らせください。';
}
const stickerHint=session=>session?.stickerHelp?'\n\n⚠️ '+session.stickerHelp:'';
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
      '｜'+(p.item_count??0)+'個'+stickerHint(session),
      reply_markup:{inline_keyboard:[
        [btn('➕ このパックに追加','sticker:add')],
        [btn('✏️ タイトル変更','sticker:rename'),btn('🧩 素材を管理','sticker:items')],
        [btn('↩ マイパックへ','sticker:packs')]
      ]}};
  }
  if(session.screen==='sticker_pack_title')return {
    text:'✏️ パックの新しいタイトルを1行で入力してください（1〜64文字）。'+stickerHint(session),
    reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:pack_back')]]}
  };
  if(session.screen==='sticker_pack_items') {
    const rows=Array.isArray(session.stickerItemRows)?session.stickerItemRows:[];
    const page=session.stickerItemPage??0;
    const keys=rows.map((item,index)=>[
      btn(String(item.emoji).slice(0,12)+' '+String(item.position+1)+'番目','sticker:item:'+index)
    ]);
    keys.push([
      ...(page>0?[btn('◀ 前へ','sticker:items_prev')]:[]),
      ...(rows.length===10?[btn('次へ ▶','sticker:items_next')]:[])
    ]);
    keys.push([btn('↩ パックへ','sticker:pack_back')]);
    return {text:'🧩 素材の編集（'+(page+1)+'ページ）'+stickerHint(session),
      reply_markup:{inline_keyboard:keys.filter(x=>x.length>0)}};
  }
  if(session.screen==='sticker_item'||session.screen==='sticker_item_delete_confirm'||
     session.screen==='sticker_item_emoji') {
    const item=session.stickerSelectedItem;
    if(!item)throw new Error('STICKER_ITEM_SELECTION_INVALID');
    if(session.screen==='sticker_item_emoji')return {
      text:'😀 この素材に設定する絵文字を送信してください。'+stickerHint(session),
      reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:items_back')]]}
    };
    if(session.screen==='sticker_item_delete_confirm')return {
      text:'⚠️ この素材をTelegramのパックから削除します。購入済みの商品データには触れません。続けますか？',
      reply_markup:{inline_keyboard:[
        [btn('🗑 削除する','sticker:delete_confirm')],
        [btn('↩ やめる','sticker:items_back')]
      ]}
    };
    return {text:'🧩 '+item.emoji+'｜'+(item.position+1)+'番目'+stickerHint(session),
      reply_markup:{inline_keyboard:[
        [btn('⬆ 上へ','sticker:move_up'),btn('⬇ 下へ','sticker:move_down')],
        [btn('🔄 素材を置換','sticker:replace_item')],
        [btn('😀 絵文字変更','sticker:emoji'),btn('🗑 削除','sticker:delete')],
        [btn('↩ 一覧へ','sticker:items')]
      ]}
    };
  }
  if(session.screen==='sticker_replace_input'||session.screen==='sticker_replace_ready')return {
    text:session.screen==='sticker_replace_input'
      ?'🔄 この素材を置換します。新しい写真・GIF・動画を送ってください。縦横比を維持し、自動でパック形式に変換します（20MB以下）。'+stickerHint(session)
      :'✅ 置換する素材を受信しました。［置換する］で現在の素材を差し替えます。'+stickerHint(session),
    reply_markup:{inline_keyboard:session.screen==='sticker_replace_input'
      ?[[btn('↩ 戻る','sticker:items_back')]]
      :[[btn('🔄 置換する','sticker:replace_confirm'),btn('📎 素材を変更','sticker:replace_change')],
        [btn('↩ 戻る','sticker:items_back')]]}
  };
  if(session.screen==='sticker_edit_pending'||session.screen==='sticker_edit_reconcile')return {
    text:session.screen==='sticker_edit_pending'?'⏳ パックを更新しています。':
      '⚠️ 編集結果をまだ確定できません。二重変更を防ぐため再実行せず、Telegramの状態を確認します。',
    reply_markup:{inline_keyboard:session.screen==='sticker_edit_reconcile'
      ?[[btn('🔄 編集結果を確認','sticker:edit_check')]]:[]}
  };
  if(session.screen==='sticker_title')return {
    text:'📦 パック名を1行で送信してください（64文字以内）。\nその後は素材をそのまま送れます。'+stickerHint(session),
    reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:back')]]}
  };
  if(session.screen==='sticker_input')return {
    text:(d.kind==='custom_emoji'?'😀 カスタム絵文字':'🎨 ステッカー')+
      '\nパック：'+d.title+'\n\n📎 JPG・PNG・GIF・MP4・WebMをそのまま送ってください。形式を選ぶ操作は不要です（20MB以下）。\n縦横比を維持して自動でリサイズ・変換し、動画は3秒・30fps以内に調整します。'+stickerHint(session),
    reply_markup:{inline_keyboard:[[btn('↩ 戻る','sticker:back')]]}
  };
  if(session.screen==='sticker_ready')return {
    text:'✅ 素材を受信しました。\nパック：'+d.title+
      '\n\n［登録する］で素材を自動判定・変換しパックへ追加します。動画は先頭3秒に調整します。'+stickerHint(session),
    reply_markup:{inline_keyboard:[
      [btn('📦 登録する','sticker:register'),btn('🔄 素材を変更','sticker:replace')],
      [btn('↩ 戻る','sticker:back')]
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
export function createStickerWizard({api,sessionStore,screenTransport,publishSticker,reconcileSticker,packInventory,editPack}={}){
  if(typeof api!=='function'||typeof sessionStore?.read!=='function'||
    typeof sessionStore?.write!=='function'||typeof sessionStore?.setScreen!=='function'||
    typeof screenTransport?.show!=='function'||typeof publishSticker!=='function'||
    (reconcileSticker!==undefined&&typeof reconcileSticker!=='function')||
    (editPack!==undefined&&typeof editPack!=='function')||
    (packInventory!==undefined&&(
      typeof packInventory?.listPacks!=='function'||
      typeof packInventory?.getOwnedPack!=='function'||
      typeof packInventory?.listOwnedItems!=='function')))
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
  async function deleteInputOrWarn(id,messageId){
    try{await api('deleteMessage',{chat_id:id,message_id:messageId});}
    catch{
      // TGtumbler common DM contract: do not claim that an undeleted input
      // has disappeared. Preserve previous guidance and the selected draft.
      const current=await sessionStore.read(id);
      if(!current||!['sticker_title','sticker_input','sticker_ready','sticker_pack','sticker_pack_items','sticker_pack_title','sticker_item_emoji','sticker_replace_input','sticker_replace_ready'].includes(current.screen))return;
      const guidance='入力メッセージを自動で削除できませんでした。ご自身で送信したメッセージを長押しして削除してください。';
      if(current.stickerHelp?.includes(guidance))return;
      return persist(id,current,{stickerHelp:[current.stickerHelp,guidance].filter(Boolean).join(' ')});
    }
  }
  async function itemsPage(id,old,page){
    if(!old.stickerSelectedPack?.pack_name||!packInventory)
      throw new Error('STICKER_PACK_SELECTION_INVALID');
    const rows=await packInventory.listOwnedItems({
      ownerId:id,packName:old.stickerSelectedPack.pack_name,
      limit:10,offset:page*10});
    return persist(id,old,{screen:'sticker_pack_items',stickerItemPage:page,
      stickerItemRows:rows,stickerSelectedItem:null,stickerHelp:null});
  }
  async function editFinished(id,current,pending){
    const pack=await packInventory.getOwnedPack(id,pending.packName);
    if(!pack)throw new Error('STICKER_PACK_OWNER_NOT_VERIFIED');
    if(pending.action==='title')
      return persist(id,current,{screen:'sticker_pack',stickerSelectedPack:pack,
        stickerEditPending:null,stickerHelp:null});
    let page=current.stickerItemPage??0;
    let rows=await packInventory.listOwnedItems({
      ownerId:id,packName:pack.pack_name,limit:10,offset:page*10});
    if(!rows.length&&page>0) {
      page--;
      rows=await packInventory.listOwnedItems({
        ownerId:id,packName:pack.pack_name,limit:10,offset:page*10});
    }
    return persist(id,current,{screen:'sticker_pack_items',stickerSelectedPack:pack,
      stickerItemRows:rows,stickerItemPage:page,stickerSelectedItem:null,
      stickerEditPending:null,stickerReplaceFileId:null,stickerHelp:null});
  }
  async function commitEdit(id,old,command){
    if(!editPack||!packInventory||!old?.stickerSelectedPack?.pack_name)
      throw new Error('STICKER_PACK_EDIT_DEPENDENCIES_MISSING');
    const pending={...command,packName:old.stickerSelectedPack.pack_name,
      status:'in_progress'};
    // Durable CAS claim BEFORE any Telegram mutation. A restart cannot
    // blindly replay an edit whose outcome may be unknown.
    const claimed={...old,revision:old.revision+1,
      screen:'sticker_edit_pending',stickerEditPending:pending};
    await sessionStore.write(id,old.revision,claimed);
    try{
      const result=await editPack({owner:id,...pending,
        onUploaded:async receipt=>{
          const current=await sessionStore.read(id);
          if(current?.stickerEditPending?.status!=='in_progress'||
             current.stickerEditPending.packName!==pending.packName||
             current.stickerEditPending.sourceFileId!==pending.sourceFileId)
            throw new Error('STICKER_EDIT_RECEIPT_SESSION_MISMATCH');
          await sessionStore.write(id,current.revision,{
            ...current,revision:current.revision+1,
            stickerEditPending:{...current.stickerEditPending,
              newUniqueId:receipt.fileUniqueId,phase:'uploaded'}
          });
        },
        onBeforeMutation:async receipt=>{
          const current=await sessionStore.read(id);
          if(current?.stickerEditPending?.newUniqueId!==receipt.fileUniqueId)
            throw new Error('STICKER_EDIT_RECEIPT_SESSION_MISMATCH');
          await sessionStore.write(id,current.revision,{
            ...current,revision:current.revision+1,
            stickerEditPending:{...current.stickerEditPending,
              phase:'submission_started'}
          });
        }});
      if(result?.verified!==true)throw new Error('STICKER_PACK_EDIT_RESULT_UNKNOWN');
      const current=await sessionStore.read(id);
      return await editFinished(id,current,pending);
    }catch(error){
      const current=await sessionStore.read(id);
      if(error?.preMutationVerified===true&&pending.action==='replace_item')
        return persist(id,current,{screen:'sticker_replace_ready',
          stickerEditPending:null,stickerHelp:stickerHelp(error)});
      // Never resubmit the write on timeout, DB failure, or lost UI result.
      return persist(id,current,{screen:'sticker_edit_reconcile',
        stickerEditPending:{...current.stickerEditPending,status:'needs_reconcile'}});
    }
  }
  async function handle(update){
    const message=update?.message,cb=update?.callback_query;
    if(cb){
      const data=cb.data??'';
      if(data!=='menu:stickers'&&!data.startsWith('sticker:'))return {handled:false};
      const {id,messageId}=privateActor(update);
      await api('answerCallbackQuery',{callback_query_id:cb.id});
      const old=await sessionStore.read(id);
      if(old?.stickerEditPending){
        const pending=old.stickerEditPending;
        if(pending.status!=='needs_reconcile'||
           data!=='sticker:edit_check|r'+old.revision||
           messageId!==old.screenMessageId||!editPack)
          return {handled:true,editLocked:true};
        const checked=await editPack({owner:id,...pending,verifyOnly:true})
          .catch(()=>({verified:false}));
        if(checked?.verified!==true)return {handled:true,editLocked:true};
        const current=await sessionStore.read(id);
        return editFinished(id,current,pending);
      }
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
          stickerSets:saved,stickerHelp:null,stickerDraft:{...draft,setName:outcome.name,link,fileId:null}});
      }
      if(data==='menu:stickers'){
        return persist(id,old,{screen:'sticker_choose',stickerDraft:null,waiting:null,
          screenMessageId:messageId,stickerHelp:null});
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
      if(action==='sticker:rename'&&old.screen==='sticker_pack')
        return persist(id,old,{screen:'sticker_pack_title',stickerHelp:null});
      if(action==='sticker:pack_back'&&
         ['sticker_pack_title','sticker_pack_items'].includes(old.screen))
        return persist(id,old,{screen:'sticker_pack',stickerHelp:null});
      if(action==='sticker:items'||action==='sticker:items_next'||
         action==='sticker:items_prev'){
        if(!['sticker_pack','sticker_pack_items','sticker_item'].includes(old.screen))
          return {handled:true,staleButton:true};
        const previous=old.screen==='sticker_pack_items'?(old.stickerItemPage??0):0;
        return itemsPage(id,old,action==='sticker:items_next'?previous+1:
          action==='sticker:items_prev'?Math.max(0,previous-1):previous);
      }
      if(action.startsWith('sticker:item:')&&old.screen==='sticker_pack_items'){
        const idx=Number(action.slice('sticker:item:'.length));
        const item=old.stickerItemRows?.[idx];
        if(!Number.isSafeInteger(idx)||idx<0||idx>=10||!item)
          return {handled:true,staleButton:true};
        return persist(id,old,{screen:'sticker_item',stickerSelectedItem:item,
          stickerHelp:null});
      }
      if(action==='sticker:items_back'&&
         ['sticker_item_emoji','sticker_item_delete_confirm','sticker_replace_input','sticker_replace_ready'].includes(old.screen))
        return persist(id,old,{screen:'sticker_item',stickerHelp:null});
      if(action==='sticker:replace_item'&&old.screen==='sticker_item')
        return persist(id,old,{screen:'sticker_replace_input',
          stickerReplaceFileId:null,stickerHelp:null});
      if(action==='sticker:replace_change'&&old.screen==='sticker_replace_ready')
        return persist(id,old,{screen:'sticker_replace_input',
          stickerReplaceFileId:null,stickerHelp:null});
      if(action==='sticker:replace_confirm'&&old.screen==='sticker_replace_ready'){
        if(!old.stickerReplaceFileId||!old.stickerSelectedItem?.file_unique_id)
          return {handled:true,staleButton:true};
        return commitEdit(id,old,{action:'replace_item',
          stickerUniqueId:old.stickerSelectedItem.file_unique_id,
          sourceFileId:old.stickerReplaceFileId});
      }
      if(action==='sticker:emoji'&&old.screen==='sticker_item')
        return persist(id,old,{screen:'sticker_item_emoji',stickerHelp:null});
      if(action==='sticker:delete'&&old.screen==='sticker_item')
        return persist(id,old,{screen:'sticker_item_delete_confirm',stickerHelp:null});
      if(action==='sticker:delete_confirm'&&old.screen==='sticker_item_delete_confirm')
        return commitEdit(id,old,{action:'delete_item',
          stickerUniqueId:old.stickerSelectedItem.file_unique_id});
      if((action==='sticker:move_up'||action==='sticker:move_down')&&
         old.screen==='sticker_item'){
        const item=old.stickerSelectedItem,pack=old.stickerSelectedPack;
        if(!item||!pack)return {handled:true,staleButton:true};
        const position=item.position+(action==='sticker:move_up'?-1:1);
        if(position<0||position>=pack.item_count)
          return persist(id,old,{screen:'sticker_item',
            stickerHelp:'これ以上移動できません。'});
        return commitEdit(id,old,{action:'move_item',
          stickerUniqueId:item.file_unique_id,position});
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
        },stickerHelp:null});
      }
      if(action==='sticker:replace'&&old.screen==='sticker_ready')
        return persist(id,old,{screen:'sticker_input',stickerHelp:null,
          stickerDraft:{...draft,fileId:null}});
      if(action==='sticker:cancel')return persist(id,old,{screen:'home',stickerDraft:null,waiting:null});
      if(action==='sticker:back')return persist(id,old,{
        screen:old.screen==='sticker_ready'?'sticker_input':'sticker_choose',
        stickerDraft:old.screen==='sticker_ready'?{...draft,fileId:null}:null,
        stickerHelp:null
      });
      if(action.startsWith('sticker:type:')){
        const kind=action.slice('sticker:type:'.length);
        if(!['regular','custom_emoji'].includes(kind))throw new Error('STICKER_KIND_UNKNOWN');
        const name=old.stickerSets?.[kind]??null;
        return persist(id,old,{
          screen:name?'sticker_input':'sticker_title',
          stickerDraft:{kind,title:name?.title??null,setName:name?.name??null,
            nonce:randomBytes(8).toString('hex'),fileId:null},stickerHelp:null
        });
      }
      if(action==='sticker:again'&&old.screen==='sticker_done')
        return persist(id,old,{screen:'sticker_input',
          stickerDraft:{...draft,fileId:null,link:null},stickerHelp:null});
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
            stickerDraft:{...draft,setName:result.name,link,fileId:null},stickerHelp:null});
        }catch(error){
          const current=await sessionStore.read(id);
          // The only pack-writing APIs run AFTER submission_started is
          // durably recorded. Failures before that phase cannot have written
          // a pack, so allow the user to correct/retry the same media safely.
          // Once submission_started is recorded, never retry without readback.
          const phase=current?.stickerPending?.phase;
          // The publisher must confirm DB claim release before allowing
          // retry. Session phase alone is not proof that the DB released it.
          if(error?.preMutationVerified===true){
            return persist(id,current,{screen:'sticker_ready',stickerPending:null,
              stickerHelp:stickerHelp(error)});
          }
          return persist(id,current,{screen:'sticker_reconcile',
            stickerPending:{...current.stickerPending,status:'needs_reconcile'}});
        }
      }
      return {handled:true,staleButton:true};
    }
    if(!message||message.chat?.type!=='private')return {handled:false};
    const {id}=privateActor(update);
    const old=await sessionStore.read(id);
    if(old?.stickerEditPending){
      if(typeof message.text==='string'&&
         /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text.trim()))
        return persist(id,old,{screen:'sticker_edit_reconcile',
          stickerEditPending:{...old.stickerEditPending,status:'needs_reconcile'}});
      return {handled:true,editLocked:true};
    }
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
    if(old?.screen==='sticker_replace_input'){
      try{
        const fileId=mediaFileId(message);
        const size=message.document?.file_size??message.animation?.file_size??
          message.video?.file_size??(Array.isArray(message.photo)?message.photo.at(-1)?.file_size:null);
        const mime=message.document?.mime_type;
        if(!fileId||size>20_000_000||
           (typeof mime==='string'&&/^(application\\/pdf|audio\\/|text\\/)/i.test(mime)))
          return persist(id,old,{screen:'sticker_replace_input',
            stickerHelp:'20MB以下のJPG・PNG・GIF・MP4・WebMを送ってください。'});
        return persist(id,old,{screen:'sticker_replace_ready',
          stickerReplaceFileId:fileId,stickerHelp:null});
      }finally{await deleteInputOrWarn(id,message.message_id);}
    }
    if(old?.screen==='sticker_pack_title'||old?.screen==='sticker_item_emoji'){
      try {
        const value=message.text?.trim();
        if(typeof value!=='string'||!value||value.length>
           (old.screen==='sticker_pack_title'?64:16)||/[\r\n]/.test(value))
          return persist(id,old,{stickerHelp:'入力は1行で、指定の文字数以内にしてください。'});
        return commitEdit(id,old,old.screen==='sticker_pack_title'
          ?{action:'title',title:value}
          :{action:'emoji',stickerUniqueId:old.stickerSelectedItem?.file_unique_id,
            emoji:value});
      }finally{await deleteInputOrWarn(id,message.message_id);}
    }
    if(old?.screen==='sticker_title'){
      const title=message.text?.trim();
      try{
        if(typeof title!=='string'||title.length<1||title.length>64||
          /[\r\n]/.test(title))return persist(id,old,{screen:'sticker_title',
            stickerHelp:'パック名は1行の1〜64文字で入力してください。空欄や改行は使えません。'});
        return persist(id,old,{screen:'sticker_input',stickerHelp:null,
          stickerDraft:{...old.stickerDraft,title}});
      }finally{await deleteInputOrWarn(id,message.message_id);}
    }
    if(old?.screen==='sticker_input'){
      const fileId=mediaFileId(message);
      try{
        if(!fileId)return persist(id,old,{screen:'sticker_input',
          stickerHelp:'素材を認識できませんでした。写真・画像（JPG/PNG）・GIF・動画（MP4/WebM）を送ってください。PDFや文章だけでは作成できません。'});
        const mime=message.document?.mime_type;
        if(typeof mime==='string'&&(/^(application\/pdf|audio\/|text\/)/i.test(mime)))
          return persist(id,old,{screen:'sticker_input',
            stickerHelp:'このファイルは画像・動画ではありません。JPG・PNG・GIF・MP4・WebMの画像・動画を送ってください。'});
        const size=message.document?.file_size??message.animation?.file_size??
          message.video?.file_size??(Array.isArray(message.photo)?message.photo.at(-1)?.file_size:null);
        if(Number.isFinite(size)&&size>20_000_000)
          return persist(id,old,{screen:'sticker_input',
            stickerHelp:stickerHelp(new Error('STICKER_INPUT_SIZE_INVALID'))});
        return persist(id,old,{screen:'sticker_ready',stickerHelp:null,
          stickerDraft:{...old.stickerDraft,fileId}});
      }finally{await deleteInputOrWarn(id,message.message_id);}
    }
    return {handled:false};
  }
  return {handle};
}
