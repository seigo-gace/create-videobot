import { menuPage } from './menuPanel.mjs';
import { openCreatorEditor, editCreatorDraft, creatorEditorPanel, creatorReviewPanel, myVideosPanel, videoInfoPanel } from './creatorUi.mjs';
import { randomUUID } from 'node:crypto';
import {salesOverviewPanel,salesWithdrawalPanel,salesHistoryPanel} from './salesPanel.mjs';

function privateUser(update) {
  const message=update?.message??update?.callback_query?.message;
  const from=update?.callback_query?.from??update?.message?.from;
  if(!message || message.chat?.type!=='private' || !Number.isSafeInteger(message.chat.id) ||
     message.chat.id<=0 || from?.id!==message.chat.id)
    throw new Error('PRIVATE_OWNER_REQUIRED');
  return {ownerId:message.chat.id,messageId:message.message_id};
}
function requireFunctions(store,names) {
  for(const name of names) if(typeof store?.[name]!=='function')throw new Error('session store missing '+name);
}
function validateRevision(action,session) {
  const m=/^(.*)\|r([1-9][0-9]*)$/.exec(action||'');
  if(!m || !session || Number(m[2])!==session.revision)throw new Error('STALE_CREATOR_BUTTON');
  return m[1];
}
function expectSession(session,screenMessageId) {
  if(!session?.draft || session.screenMessageId!==screenMessageId)throw new Error('CREATOR_SCREEN_STALE');
}
function statusPanel(draft,rev,extra='',screen='editor') {
  const p=creatorEditorPanel(draft,rev,screen);
  return {...p,text:p.text+(extra?'\n\n'+extra:'')};
}
/**
 * Connects VideoBot-specific draft actions to the EXISTING shared DM screen
 * transport contract. screenTransport.show owns edit/fallback/delete-old as
 * implemented by GateApp-Bot PR#11; VideoBot does not clone its transport.
 * sessionStore owns durable optimistic CAS, must not use GATE admin sessions.
 */
export function createCreatorWizard({api,sessionStore,screenTransport,listingStore,mediaProcessor,publishListing,salesProvider}={}) {
  if(typeof api!=='function'||typeof screenTransport?.show!=='function')
    throw new Error('trusted Telegram/screen transport unavailable');
  requireFunctions(sessionStore,['read','write','setScreen']);
  if(typeof listingStore?.listByOwner!=='function'||typeof listingStore?.getOwned!=='function')
    throw new Error('owner listing source required');

  async function persistAndRender(ownerId,old,patch,panel) {
    const expected=old?.revision??0;
    // Never let an unrelated menu screen discard an ambiguous Stars
    // publication result. Only the verified reconciliation owner may
    // clear that lock; ordinary UI navigation must preserve it.
    const next={...patch,revision:expected+1,
      ...(old?.publishing==='needs_reconcile'?{publishing:'needs_reconcile'}:{})};
    const drawn=typeof panel==='function'?panel(next.revision):panel;
    // Keep the editable text screen visually attached to the owner's album preview.
    if(['description','editor','price'].includes(next.screen) &&
       Number.isSafeInteger(next.previewMessageId) && next.previewMessageId>0)
      drawn.replyToMessageId=next.previewMessageId;
    await sessionStore.write(ownerId,expected,next);
    // A text message cannot gain a reply-to-album relation through editMessageText.
    // After the first upload, create one replacement screen replying to the album.
    const firstAlbumScreen=next.screen==='description' && old?.screen==='await_video' &&
      Number.isSafeInteger(next.previewMessageId) && next.previewMessageId>0;
    const previousScreenId=patch.screenMessageId??old?.screenMessageId;
    const result=await screenTransport.show(ownerId,firstAlbumScreen?null:previousScreenId,drawn);
    if(firstAlbumScreen && Number.isSafeInteger(previousScreenId) && previousScreenId>0 &&
       previousScreenId!==result.messageId)
      await api('deleteMessage',{chat_id:ownerId,message_id:previousScreenId}).catch(()=>{});
    if(!Number.isSafeInteger(result?.messageId)||result.messageId<=0)throw new Error('WIZARD_SCREEN_UNKNOWN');
    if(result.messageId!==next.screenMessageId)
      await sessionStore.setScreen(ownerId,next.revision,result.messageId);
    return {handled:true,revision:next.revision,messageId:result.messageId};
  }
  async function openHome(update) {
    const {ownerId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    // /start is a navigation action, not a new Bot conversation.
    // Reuse the current private Bot message and preserve any unresolved
    // paid-media publication lock. Do not reset the creator's owned draft.
    return persistAndRender(ownerId,old,{
      ...old,draft:old?.draft??null,waiting:null,screen:'home'
    },menuPage('home'));
  }
  async function openVideoMenu(update) {
    const {ownerId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    return persistAndRender(ownerId,old,{
      ...old,screen:'video_home',waiting:null
    },menuPage('video'));
  }
  /** Telegram deep links from the inline [編集] text, owner/revision scoped.
   * No pre-registration edit link exists. Old/forwarded links cannot mutate
   * another owner, a replaced screen, or a completed publication.
   */
  async function openTextEdit(update,field,linkRevision) {
    const {ownerId,messageId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    const fields=['title','description'];
    if(!fields.includes(field) || !Number.isSafeInteger(linkRevision) ||
      linkRevision<1 || old?.revision!==linkRevision ||
      !['editor','price'].includes(old?.screen) || !old?.draft ||
      !Number.isSafeInteger(old.screenMessageId) || old.screenMessageId<=0)
      return {handled:true,staleTextLink:true};
    const draft=old.draft;
    const registered=!!draft.paidVideo && (field==='description'||!!draft.title);
    if(!registered)return {handled:true,staleTextLink:true};
    const patch={...old,screen:'editor',waiting:field};
    const note=field==='title'?'タイトルを1行で送信してください。':
      '動画の説明を送信してください（最大800文字・省略可）。';
    const result=await persistAndRender(ownerId,old,patch,
      rev=>statusPanel(draft,rev,note));
    // Telegram deep link generates a /start message; remove only that message.
    await api('deleteMessage',{chat_id:ownerId,message_id:messageId}).catch(()=>{});
    return result;
  }

  async function registerVideo(ownerId,old,draft) {

        if(old.publishing==='needs_reconcile')throw new Error('PUBLISH_NEEDS_RECONCILE');
        const valid=!!draft.thumbnail&&!!draft.sample&&!!draft.paidVideo&&
          !!draft.title&&Number.isSafeInteger(draft.priceStars)&&
          draft.rightsVerified===true&&draft.adultConsentVerified===true;
        if(!valid)return persistAndRender(ownerId,old,{...old},
          rev=>old.screen==='review'
            ?creatorReviewPanel(draft,rev,'未登録項目と権利の確認を完了してください。')
            :statusPanel(draft,rev,'⚠️ 本編・サムネ・サンプル・Stars価格を登録してから［登録］してください。'));
        if(typeof publishListing!=='function' ||
          typeof listingStore?.createDraft!=='function' ||
          typeof listingStore?.updateDraft!=='function' ||
          typeof listingStore?.markPublished!=='function')
          return persistAndRender(ownerId,old,{...old},
            rev=>old.screen==='review'
              ?creatorReviewPanel(draft,rev,'公開用の既存GATE・Topic・売上DB接続はまだ検証されていません。投稿は行われません。')
              :statusPanel(draft,rev,'⚠️ 公開先と売上DBの接続が未確認です。投稿は行われていません。'));
        const reservation={...old,revision:old.revision+1,publishing:'in_progress'};
        // Reserve callback revision *before* any paid-media send; rejects races.
        await sessionStore.write(ownerId,old.revision,reservation);
        let stored=null;
        try {
          // The price and 30% deduction are shown beside the final 登録 button.
          // Explicit tapping of 登録 records fee
          // acceptance; no extra button or user command is introduced.
          const acceptedDraft={...draft,feeTermsAccepted:true};
          stored=draft.mode==='edit'
            ? await listingStore.updateDraft(ownerId,draft.listingId,draft.revision,acceptedDraft)
            : await listingStore.createDraft(ownerId,randomUUID(),acceptedDraft);
          const published=await publishListing({
            ...stored,ownerConfirmedPublish:true,
            rightsVerified:draft.rightsVerified,
            adultConsentVerified:draft.adultConsentVerified
          });
          if(published?.posted!==true || !Number.isSafeInteger(published.paidMessageId))
            throw new Error('publication not confirmed');
          await listingStore.markPublished(ownerId,stored.id,stored.revision,published);
          const current=await sessionStore.read(ownerId);
          return persistAndRender(ownerId,current,{...current,draft:null,
            screen:'home',publishing:null,waiting:null},
            {text:'✅ 動画の投稿を確認しました。マイ動画から確認できます。',
             reply_markup:{inline_keyboard:[[{
               text:'📦 マイ動画',callback_data:'menu:manage'
             }],[{text:'↩ 戻る',callback_data:'menu:home'}]]}});
        } catch(e) {
          const current=await sessionStore.read(ownerId);
          return persistAndRender(ownerId,current,{
            ...current,publishing:'needs_reconcile',waiting:null,
            screen:'review',draft
          },rev=>creatorReviewPanel(draft,rev,
            '⚠️ 送信または保存結果の照合が必要です。重複投稿を防止するため、再投稿しません。'));
        }
      
  }

  async function handleCallback(update) {
    const {ownerId,messageId}=privateUser(update);
    const cb=update.callback_query;
    if(typeof cb.id!=='string'||!cb.id)throw new Error('invalid callback');
    await api('answerCallbackQuery',{callback_query_id:cb.id});
    const code=cb.data??'';
    const old=await sessionStore.read(ownerId);
    if(code==='menu:video') {
      return persistAndRender(ownerId,old,{
        ...old,screenMessageId:messageId,screen:'video_home',waiting:null
      },menuPage('video'));
    }
    if(/^menu:listing(?:\|r[1-9][0-9]*)?$/.test(code)) {
      if(code!=='menu:listing')validateRevision(code,old);
      const draft=old?.draft??openCreatorEditor({sellerId:String(ownerId)});
      return persistAndRender(ownerId,old,{
        ...old,screenMessageId:messageId,screen:draft.paidVideo?'editor':'await_video',draft,waiting:draft.paidVideo?null:'paidVideo'
      },rev=>statusPanel(draft,rev));
    }
    if(code==='menu:manage') {
      const items=await listingStore.listByOwner(ownerId);
      return persistAndRender(ownerId,old,{
        screenMessageId:messageId,draft:old?.draft??null,waiting:null,
        screen:'my_videos',page:0
      },rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
    }
    if(code==='menu:sales'||code==='menu:home') {
      const summary=code==='menu:sales'&&typeof salesProvider?.getSummary==='function'
        ? await salesProvider.getSummary(ownerId):null;
      const panel=summary
        ? rev=>salesOverviewPanel(summary,rev)
        :menuPage(code==='menu:sales'?'sales':'home');
      return persistAndRender(ownerId,old,{
        screenMessageId:messageId,draft:old?.draft??null,waiting:null,
        screen:code==='menu:sales'?'sales':'home'
      },panel);
    }
    if(code.startsWith('sales:')||code.startsWith('menu:home|r')) {
      if(old?.screenMessageId!==messageId || !['sales','sales_history','sales_withdrawal'].includes(old?.screen))
        throw new Error('SALES_SCREEN_STALE');
      const action=validateRevision(code,old);
      if(action==='menu:home')return persistAndRender(ownerId,old,
        {...old,screen:'home',waiting:null},menuPage('home'));
      if(typeof salesProvider?.getSummary!=='function')
        throw new Error('verified sales ledger unavailable');
      const summary=await salesProvider.getSummary(ownerId);
      if(action==='sales:history') {
        if(typeof salesProvider.getHistory!=='function')throw new Error('sales history unavailable');
        const history=await salesProvider.getHistory(ownerId);
        return persistAndRender(ownerId,old,{...old,screen:'sales_history',waiting:null},
          rev=>salesHistoryPanel(history,rev));
      }
      if(action==='sales:withdraw') {
        // Do not enable a third-party Stars transfer based on an ordinary
        // internal balance. The official creator payout path is not verified.
        return persistAndRender(ownerId,old,{...old,screen:'sales_withdrawal',waiting:null},
          rev=>salesWithdrawalPanel({...summary,payoutReady:false},rev));
      }
      if(action==='sales:back')return persistAndRender(ownerId,old,
        {...old,screen:'sales',waiting:null},rev=>salesOverviewPanel(summary,rev));
      throw new Error('UNKNOWN_SALES_ACTION');
    }
    if(code.startsWith('entry:')) {
      expectSession(old,messageId);
      const action=validateRevision(code,old);
      if(action==='entry:skip'&&old.screen==='description') {
        return persistAndRender(ownerId,old,
          {...old,screen:'editor',waiting:null,descriptionEntered:true},
          rev=>statusPanel(old.draft,rev));
      }
      if(action==='entry:register'&&old.screen==='editor') {
        // The actual 登録 control explicitly accepts the adjacent rights/
        // adult-performer and 30-percent fee disclosures; no extra menu.
        const draft=old.draft.paidVideo
          ?editCreatorDraft(old.draft,{type:'confirmRights',
             rightsVerified:true,adultConsentVerified:true})
          :old.draft;
        return registerVideo(ownerId,old,draft);
      }
      throw new Error('UNKNOWN_CREATOR_ENTRY_ACTION');
    }
    if(code.startsWith('edit:')) {
      expectSession(old,messageId);
      const action=validateRevision(code,old);
      const draft=old.draft;
      const value=action.slice(5);
      if(value==='cancel') {
        return persistAndRender(ownerId,old,{...old,draft:null,waiting:null},menuPage('home'));
      }
      if(value==='back')return persistAndRender(ownerId,old,{...old,screen:'editor',waiting:null},
        rev=>statusPanel(draft,rev));
      if(value==='price')return persistAndRender(ownerId,old,{...old,screen:'price',waiting:null},
        rev=>statusPanel(draft,rev,'','price'));
      if(['thumbnail','sample','paidVideo','title','description'].includes(value)) {
        return persistAndRender(ownerId,old,{...old,screen:'editor',waiting:value},
          rev=>statusPanel(draft,rev,'Telegramの通常入力欄へ'+
            (value==='thumbnail'?'サムネ画像':value==='sample'?'サンプル動画':value==='paidVideo'?'販売用本編動画とキャプションタイトル':value==='description'?'説明文':'タイトル')+'を送信してください。'));
      }
      if(value==='price:custom') {
        const changed=editCreatorDraft(draft,{type:'custom'});
        return persistAndRender(ownerId,old,{...old,draft:changed,waiting:'customPrice'},
          rev=>statusPanel(changed,rev,'','price'));
      }
      if(/^price:(50|100|300|500|1000)$/.test(value)) {
        const changed=editCreatorDraft(draft,{type:'preset',stars:Number(value.slice(6))});
        return persistAndRender(ownerId,old,{...old,draft:changed,screen:'editor',waiting:null},
          rev=>statusPanel(changed,rev));
      }
      if(value==='preview') {
        let prepared=draft;
        let warning='';
        if(draft.paidVideo && (!draft.thumbnail || !draft.sample)) {
          if(typeof mediaProcessor?.prepareMissingPreviews==='function') {
            try {
              const refs=await mediaProcessor.prepareMissingPreviews(draft);
              if(!draft.thumbnail && refs?.thumbnail) prepared=editCreatorDraft(prepared,{type:'thumbnail',media:refs.thumbnail});
              if(!draft.sample && refs?.sample) prepared=editCreatorDraft(prepared,{type:'sample',media:refs.sample});
            } catch(e) {warning='自動生成に失敗しました：'+(e instanceof Error?e.message:'処理できません');}
          } else warning='自動生成サービスが未接続です。';
        }
        const missing=['paidVideo','thumbnail','sample','title','priceStars'].filter(k=>!prepared[k]);
        const note=missing.length ? warning : '本人が［登録］を押すまでは公開されません。';
        return persistAndRender(ownerId,old,{...old,draft:prepared,waiting:null,screen:'review'},
          rev=>creatorReviewPanel(prepared,rev,note));
      }
      throw new Error('UNKNOWN_CREATOR_ACTION');
    }
    if(code.startsWith('review:')) {
      expectSession(old,messageId);
      if(old.screen!=='review')throw new Error('CREATOR_NOT_IN_REVIEW');
      const action=validateRevision(code,old);
      const draft=old.draft;
      if(action==='review:edit')return persistAndRender(ownerId,old,
        {...old,screen:'editor',waiting:null},rev=>statusPanel(draft,rev));
      if(action==='review:cancel')return persistAndRender(ownerId,old,
        {...old,draft:null,waiting:null,screen:'home'},menuPage('home'));
      if(action==='review:rights') {
        const agreed=editCreatorDraft(draft,
          {type:'confirmRights',rightsVerified:true,adultConsentVerified:true});
        return persistAndRender(ownerId,old,{...old,draft:agreed},
          rev=>creatorReviewPanel(agreed,rev));
      }
      if(action==='review:publish')return registerVideo(ownerId,old,draft);
      throw new Error('UNKNOWN_REVIEW_ACTION');
    }
    if(code.startsWith('video:')) {
      if(old?.screenMessageId!==messageId || !['my_videos','delete_confirm','video_detail'].includes(old?.screen))
        throw new Error('VIDEO_SCREEN_STALE');
      const action=validateRevision(code,old);
      const parts=action.split(':');
      if(parts[0]!=='video')throw new Error('unknown video action');
      if(parts[1]==='page') {
        if(old.screen!=='my_videos'||!/^\d+$/.test(parts[2]||''))throw new Error('invalid video page');
        const page=Number(parts[2]),items=await listingStore.listByOwner(ownerId);
        return persistAndRender(ownerId,old,{...old,screen:'my_videos',page},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page,revision:rev}));
      }
      const id=parts[2];
      if(!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id))throw new Error('invalid video listing id');
      const v=await listingStore.getOwned(ownerId,id);
      if(!v)throw new Error('LISTING_NOT_OWNED');
      if(parts[1]==='edit' && old.screen==='my_videos') {
        if(v.status==='published'||v.status==='paused') {
          return persistAndRender(ownerId,old,{...old},
            rev=>({text:'購入済み動画の価格・本編は直接変更できません。購入者の権利を保護する再掲載経路の検証が必要です。',
              reply_markup:{inline_keyboard:[[{
                text:'↩ 戻る',callback_data:'menu:manage'
              }]]}}));
        }
        const draft=openCreatorEditor({sellerId:String(ownerId),existing:v});
        return persistAndRender(ownerId,old,{screenMessageId:messageId,draft,waiting:null,screen:'editor'},
          rev=>statusPanel(draft,rev));
      }
      if(parts[1]==='delete'&&old.screen==='my_videos') {
        if(v.status==='published'||v.status==='paused')return persistAndRender(ownerId,old,{...old},
          {text:'購入済み有料動画は、購入者の権利と取引履歴を保護する処理が未検証のため、ここから削除しません。',
           reply_markup:{inline_keyboard:[[{
             text:'↩ 戻る',callback_data:'menu:manage'
           }]]}});
        return persistAndRender(ownerId,old,{...old,screen:'delete_confirm',deleteId:id},
          rev=>({text:'🗑 この動画を削除しますか？\n'+v.title+'\n※未公開の商品だけを非表示にし、売上や購入履歴を消しません。',
            reply_markup:{inline_keyboard:[
              [{text:'🗑 削除する',callback_data:'video:confirmDelete:'+id+'|r'+rev}],
              [{text:'↩ 中止',callback_data:'video:cancelDelete:'+id+'|r'+rev}]
            ]}}));
      }
      if(parts[1]==='cancelDelete'&&old.screen==='delete_confirm'&&old.deleteId===id) {
        const items=await listingStore.listByOwner(ownerId);
        return persistAndRender(ownerId,old,{...old,screen:'my_videos',deleteId:null},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:old.page??0,revision:rev}));
      }
      if(parts[1]==='confirmDelete'&&old.screen==='delete_confirm'&&old.deleteId===id) {
        if(typeof listingStore.removeUnpublished!=='function')throw new Error('safe listing deletion unavailable');
        await listingStore.removeUnpublished(ownerId,id,v.revision);
        const items=await listingStore.listByOwner(ownerId);
        return persistAndRender(ownerId,old,{...old,screen:'my_videos',deleteId:null,page:0},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
      }
      if((parts[1]==='price'||parts[1]==='open')&&old.screen==='my_videos') {
        return persistAndRender(ownerId,old,{
          ...old,screen:'video_detail',detailId:id
        },rev=>videoInfoPanel(v,rev,parts[1]));
      }
      if(parts[1]==='back'&&old.screen==='video_detail'&&old.detailId===id) {
        const items=await listingStore.listByOwner(ownerId);
        return persistAndRender(ownerId,old,{...old,screen:'my_videos',detailId:null},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:old.page??0,revision:rev}));
      }
      throw new Error('VIDEO_ACTION_NOT_CONNECTED');
    }
    return {handled:false};
  }

  async function autoPreview(ownerId,draft) {
    let prepared=draft,warning='',previewMessageId=null;
    if(!draft.paidVideo)return {draft:prepared,warning,previewMessageId};
    if((!draft.thumbnail||!draft.sample)&&typeof mediaProcessor?.prepareMissingPreviews==='function'){
      try{
        const refs=await mediaProcessor.prepareMissingPreviews(draft);
        if(!prepared.thumbnail&&refs?.thumbnail)
          prepared=editCreatorDraft(prepared,{type:'thumbnail',media:refs.thumbnail});
        if(!prepared.sample&&refs?.sample)
          prepared=editCreatorDraft(prepared,{type:'sample',media:refs.sample});
      }catch(e){
        warning='⚠️ 自動サムネ・サンプル生成に失敗しました。素材変更から登録してください。';
      }
    }
    if(prepared.thumbnail&&prepared.sample){
      // Only the owner receives this three-item preview. No paid-media
      // publication/charge is triggered until the final registration.
      try{
        const response=await api('sendMediaGroup',{chat_id:ownerId,
          protect_content:true,disable_notification:true,
          media:[
            {type:'photo',media:prepared.thumbnail.fileId,caption:'🖼 サムネ'},
            {type:'video',media:prepared.sample.fileId,caption:'🎞 30秒サンプル'},
            {type:'video',media:prepared.paidVideo.fileId,caption:'🎬 本動画（作成者向けプレビュー）'}
          ]});
        if(!Array.isArray(response)||response.length!==3||
          response.some(m=>!Number.isSafeInteger(m?.message_id)||m.message_id<1))
          warning+='\n⚠️ アルバム表示の応答を確認できません。重複送信は行いません。';
        else previewMessageId=response[2].message_id;
      }catch{
        warning+='\n⚠️ プレビューアルバムの表示を確認できません。重複送信は行いません。';
      }
    }
    return {draft:prepared,warning,previewMessageId};
  }

  async function handleInput(update) {
    const {ownerId,messageId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    if(!old?.draft)return {handled:false};
    if(!old.waiting && !old.draft.paidVideo && update.message.video?.file_id){
      // Incoming captioned video on the new-listing screen, without extra title step.
      old.waiting='paidVideo';
    }
    if(!old.waiting)return {handled:false};
    let draft=old.draft,error=null,previewWarning='',previewMessageId=old.previewMessageId??null;
    try {
      if(old.waiting==='title') {
        draft=editCreatorDraft(draft,{type:'captionTitle',text:update.message.text});
      } else if(old.waiting==='description') {
        draft=editCreatorDraft(draft,{type:'descriptionInput',text:update.message.text});
      } else if(old.waiting==='customPrice') {
        draft=editCreatorDraft(draft,{type:'customPriceInput',text:update.message.text});
      } else if(old.waiting==='thumbnail') {
        const p=update.message.photo?.at(-1);
        if(!p?.file_id)throw new Error('サムネイル画像を送信してください。');
        draft=editCreatorDraft(draft,{type:'thumbnail',media:{fileId:p.file_id}});
      } else if(old.waiting==='paidVideo') {
        if(!update.message.video?.file_id)throw new Error('本編動画を送信してください。');
        // Only accept video + valid one-line caption as one atomic input.
        const caption=update.message.caption;
        const withTitle=editCreatorDraft(draft,{type:'captionTitle',text:caption});
        draft=editCreatorDraft(withTitle,{type:'paidVideo',media:{fileId:update.message.video.file_id}});
        // A replacement invalidates automatically-derived previews from the previous source video.
        if(old.draft.paidVideo?.fileId!==update.message.video.file_id){
          draft=editCreatorDraft(editCreatorDraft(draft,{type:'removeThumbnail'}),{type:'removeSample'});
        }
        const preview=await autoPreview(ownerId,draft);
        draft=preview.draft;
        previewWarning=preview.warning;
        previewMessageId=preview.previewMessageId;
      } else if(old.waiting==='sample') {
        if(!update.message.video?.file_id)throw new Error('サンプル動画を送信してください。');
        if(typeof mediaProcessor?.prepareUserSample!=='function')throw new Error('サンプル生成サービスは未接続です。');
        const processed=await mediaProcessor.prepareUserSample(update.message.video);
        draft=editCreatorDraft(draft,{type:'sample',media:processed});
      } else throw new Error('UNKNOWN_CREATOR_INPUT');
    } catch(e){error=e instanceof Error?e.message:'入力を確認できません。';}
    const firstVideo=old.waiting==='paidVideo' && old.screen==='await_video';
    // Never erase the only visible video while three-item album creation failed.
    // Preserve the original video as the visible editor anchor until an album exists.
    const keepOriginalVideo=firstVideo && !error && !previewMessageId;
    if(keepOriginalVideo && !error)previewMessageId=messageId;
    let inputDeleteFailed=false;
    if(!keepOriginalVideo){
      try{await api('deleteMessage',{chat_id:ownerId,message_id:messageId});}
      catch{inputDeleteFailed=true;}
    }
    const nextScreen=error?old.screen:firstVideo?'description':'editor';
    const next={...old,draft,previewMessageId,waiting:error?old.waiting:nextScreen==='description'?'description':null,
      screen:nextScreen,
      ...(nextScreen==='editor'&&old.waiting==='description'?{descriptionEntered:true}:{})};
    const note=(error?'⚠️ '+error:firstVideo?'': '✅ 反映しました。')+
      (previewWarning?'\n'+previewWarning:'')+
      (inputDeleteFailed?'\n入力メッセージを自動削除できませんでした。手動で削除してください。':'');
    return persistAndRender(ownerId,old,next,
      rev=>statusPanel(draft,rev,note,nextScreen));
  }
  return {
    openHome,
    openVideoMenu,
    openTextEdit,
    async handle(update){
      if(update?.callback_query)return handleCallback(update);
      if(update?.message && (update.message.text||update.message.photo||update.message.video))return handleInput(update);
      return {handled:false};
    }
  };
}
