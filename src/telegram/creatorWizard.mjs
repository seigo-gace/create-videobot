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
function safePreviewFailure(error) {
  const message=String(error instanceof Error?error.message:'');
  if(/file exceeds Bot API download limit|download exceeds configured limit|file is too big/i.test(message))
    return '⚠️ 動画がBot APIの20MB取得上限を超えています。元動画は保持していますが、現在の取得方式ではサムネとサンプルを生成できません。';
  if(/video too short|invalid video duration|invalid sample length/i.test(message))
    return '⚠️ 動画が短すぎる、または再生時間を確認できないため、無料サンプルを生成できませんでした。';
  if(/download failed|file path invalid|getFile|ETELEGRAM|timeout|fetch failed/i.test(message))
    return '⚠️ Telegramから動画を取得できませんでした。動画を保持したまま再試行できます。';
  if(/ffmpeg|ffprobe|thumbnail not generated|sample|spawn|invalid data found|conversion/i.test(message))
    return '⚠️ 動画の変換処理に失敗しました。元動画を保持しています。';
  if(/upload|sendPhoto|sendVideo|storage/i.test(message))
    return '⚠️ 自動生成した素材をTelegramへ登録できませんでした。元動画は保持しています。';
  return '⚠️ サムネ・サンプルの自動生成に失敗しました。元動画は保持されています。';
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
    if(['editor','price'].includes(next.screen)&&
       Number.isSafeInteger(next.albumMessageId)&&next.albumMessageId>0 &&
       drawn.text.length<=1024)
      drawn.albumMessageId=next.albumMessageId;
    await sessionStore.write(ownerId,expected,next);
    // A text message cannot gain a reply-to-album relation through editMessageText.
    // After the first upload, create one replacement screen replying to the album.
    const firstAlbumScreen=Number.isSafeInteger(next.previewMessageId) &&
      next.previewMessageId>0 && next.previewMessageId!==old?.previewMessageId &&
      ['description','editor'].includes(next.screen);
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
    const items=await listingStore.listByOwner(ownerId);
    return persistAndRender(ownerId,old,{
      ...old,screen:'my_videos',page:0,waiting:null
    },rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
  }
  /** Telegram deep links from the inline [編集] text, owner/revision scoped.
   * No pre-registration edit link exists. Old/forwarded links cannot mutate
   * another owner, a replaced screen, or a completed publication.
   */
  async function openTextEdit(update,field,linkRevision) {
    const {ownerId,messageId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    const fields=['title','description','price','paidVideo','thumbnail','sample'];
    if(!fields.includes(field) || !Number.isSafeInteger(linkRevision) ||
      linkRevision<1 || old?.revision!==linkRevision ||
      !['editor','price'].includes(old?.screen) || !old?.draft ||
      !Number.isSafeInteger(old.screenMessageId) || old.screenMessageId<=0)
      return {handled:true,staleTextLink:true};
    const draft=old.draft;
    const registered=!!draft.paidVideo && !!draft.title;
    if(!registered)return {handled:true,staleTextLink:true};
    const isPrice=field==='price';
    const patch={...old,screen:isPrice?'price':'editor',waiting:isPrice?null:field};
    const note=field==='title'?'タイトルを1行で送信してください。':
      field==='description'?'説明文を送信してください（最大800文字・省略可）。':
      field==='thumbnail'?'変更するサムネ画像を送信してください。':
      field==='sample'?'変更するサンプル動画を送信してください。':
      field==='paidVideo'?'変更する本編動画を送信してください。':
      'Stars価格を選択してください。';
    const result=await persistAndRender(ownerId,old,patch,
      rev=>statusPanel(draft,rev,note,isPrice?'price':'editor'));
    // Telegram deep link generates a /start message; remove only that message.
    await api('deleteMessage',{chat_id:ownerId,message_id:messageId}).catch(()=>{});
    return result;
  }

  async function openOwnedVideo(update,listingId,linkRevision) {
    const {ownerId,messageId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    if(!old || old.revision!==linkRevision || old.screen!=='my_videos')
      return {handled:true,staleTextLink:true};
    const owned=await listingStore.getOwned(ownerId,listingId);
    if(!owned)return {handled:true,staleTextLink:true};
    // Publicly sold media are immutable. Never silently overwrite purchases.
    if(owned.status==='published'||owned.status==='paused') {
      const result=await persistAndRender(ownerId,old,{...old,screen:'video_detail',detailId:listingId},
        rev=>videoInfoPanel(owned,rev));
      await api('deleteMessage',{chat_id:ownerId,message_id:messageId}).catch(()=>{});
      return result;
    }
    const draft=openCreatorEditor({sellerId:String(ownerId),existing:owned});
    const result=await persistAndRender(ownerId,old,{...old,draft,screen:'editor',waiting:null},
      rev=>statusPanel(draft,rev));
    await api('deleteMessage',{chat_id:ownerId,message_id:messageId}).catch(()=>{});
    return result;
  }

  async function registerVideo(ownerId,old,draft) {

        if(old.publishing==='needs_reconcile')throw new Error('PUBLISH_NEEDS_RECONCILE');
        const valid=!!draft.thumbnail&&!!draft.sample&&!!draft.paidVideo&&
          !!draft.title&&Number.isSafeInteger(draft.priceStars)&&
          draft.rightsVerified===true&&draft.adultConsentVerified===true&&
          draft.feeTermsAccepted===true;
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
          const acceptedDraft=draft;
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
          const items=await listingStore.listByOwner(ownerId);
          return persistAndRender(ownerId,current,{...current,draft:null,
            screen:'my_videos',page:0,publishing:null,waiting:null},
            rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,
              revision:rev,notice:draft.mode==='edit'?
                '動画を編集／更新しました。':'新規動画を登録しました。'}));
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
    // Older bot screens can remain visible after a deployment. If the owner
    // taps an obsolete video-editor control, recover the current durable
    // draft instead of silently swallowing a stale-screen rejection.
    const legacyEditorTap=/^edit:(?:price|back)(?:\|r[1-9][0-9]*)?$/.test(code);
    const actionRevision=/\|r([1-9][0-9]*)$/.exec(code);
    const oldScreen=old?.screenMessageId!==messageId ||
      (actionRevision && Number(actionRevision[1])!==old?.revision);
    if((code.startsWith('entry:register') || code.startsWith('edit:cancel')) &&
       old?.draft?.paidVideo && oldScreen) {
      // Obsolete destructive/publishing buttons can never execute the old
      // action. Refresh the saved draft and require a fresh explicit tap.
      return persistAndRender(ownerId,old,{
        ...old,screen:'editor',waiting:null
      },rev=>statusPanel(old.draft,rev,
        '前の画面のボタンでした。現在の登録内容を表示しました。もう一度選択してください。'));
    }
    if(legacyEditorTap && old?.draft?.paidVideo && oldScreen) {
      const recovered=(!old.draft.thumbnail||!old.draft.sample)
        ?await autoPreview(ownerId,old.draft)
        :{draft:old.draft,warning:'',previewMessageId:old.previewMessageId??null};
      return persistAndRender(ownerId,old,{
        ...old,screen:'editor',waiting:null,draft:recovered.draft,
        previewMessageId:recovered.previewMessageId??old.previewMessageId??null
      },rev=>statusPanel(recovered.draft,rev,recovered.warning));
    }
    if(code==='menu:video') {
      const items=await listingStore.listByOwner(ownerId);
      return persistAndRender(ownerId,old,{
        ...old,screenMessageId:messageId,screen:'my_videos',page:0,waiting:null
      },rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
    }
    if(/^menu:listing(?:\|r[1-9][0-9]*)?$/.test(code)) {
      if(code!=='menu:listing')validateRevision(code,old);
      const draft=old?.draft??openCreatorEditor({sellerId:String(ownerId)});
      // Older in-progress drafts may have been saved before the automatic
      // preview pipeline was active. Repair only missing derived media on
      // explicit editor re-entry; never require a second main-video upload.
      const recovery=draft.paidVideo && (!draft.thumbnail || !draft.sample)
        ?await autoPreview(ownerId,draft)
        :{draft,warning:'',previewMessageId:old?.previewMessageId??null};
      return persistAndRender(ownerId,old,{
        ...old,screenMessageId:messageId,
        previewMessageId:recovery.previewMessageId??old?.previewMessageId??null,
        albumMessageId:recovery.previewMessageId??old?.albumMessageId??null,
        screen:recovery.draft.paidVideo?'editor':'await_video',
        draft:recovery.draft,waiting:recovery.draft.paidVideo?null:'paidVideo'
      },rev=>statusPanel(recovery.draft,rev,recovery.warning));
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
    // Old review keyboards survive a deployment. Telegram can deliver their
    // callbacks after the owning session has advanced to another screen.
    // Reconstruct a current owner-only panel, but do NOT publish, delete or
    // approve rights from an obsolete callback.
    if(code.startsWith('review:') && !old?.draft) {
      // A completed publication has no editable draft. Old buttons must
      // respond with the owner's current listing screen, never repeat a sale.
      const items=await listingStore.listByOwner(ownerId);
      return persistAndRender(ownerId,old,{
        ...old,screen:'my_videos',page:0,waiting:null
      },rev=>myVideosPanel({sellerId:String(ownerId),
        listings:items,page:0,revision:rev}));
    }
    if(code.startsWith('review:') && old?.draft) {
      const receivedRevision=/\|r([1-9][0-9]*)$/.exec(code);
      const obsolete=old.screen!=='review' || old.screenMessageId!==messageId ||
        !receivedRevision || Number(receivedRevision[1])!==old.revision;
      if(obsolete) {
        return persistAndRender(ownerId,old,{
          ...old,screen:'review',waiting:null
        },rev=>creatorReviewPanel(old.draft,rev,
          '前の画面のボタンでした。現在の登録内容を表示しました。もう一度選択してください。'));
      }
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
        // Publishing is impossible until a separate visible agreement step.
        return persistAndRender(ownerId,old,
          {...old,screen:'review',waiting:null},
          rev=>creatorReviewPanel(old.draft,rev));
      }
      throw new Error('UNKNOWN_CREATOR_ENTRY_ACTION');
    }
    if(code.startsWith('edit:')) {
      expectSession(old,messageId);
      const action=validateRevision(code,old);
      const draft=old.draft;
      const value=action.slice(5);
      if(value==='cancel') {
        const items=await listingStore.listByOwner(ownerId);
        // Cancel navigation, not the user's media or a destructive delete.
        return persistAndRender(ownerId,old,{...old,screen:'my_videos',page:0,waiting:null},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
      }
      if(value==='back') {
        // Existing drafts from the former UI can be repaired by returning
        // from Stars settings, without losing their stored main video.
        const recovery=draft.paidVideo && (!draft.thumbnail || !draft.sample)
          ?await autoPreview(ownerId,draft)
          :{draft,warning:'',previewMessageId:old.previewMessageId??null};
        return persistAndRender(ownerId,old,{
          ...old,screen:'editor',waiting:null,draft:recovery.draft,
          previewMessageId:recovery.previewMessageId??old.previewMessageId??null,
          albumMessageId:recovery.previewMessageId??old.albumMessageId??null
        },rev=>statusPanel(recovery.draft,rev,recovery.warning));
      }
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
      if(action==='review:cancel') {
        const items=await listingStore.listByOwner(ownerId);
        return persistAndRender(ownerId,old,
          {...old,waiting:null,screen:'my_videos',page:0},
          rev=>myVideosPanel({sellerId:String(ownerId),listings:items,page:0,revision:rev}));
      }
      if(action==='review:agree'||action==='review:rights') {
        const agreed=editCreatorDraft(draft,
          {type:draft.feeTermsAccepted?'clearTerms':'confirmTerms'});
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
        warning=safePreviewFailure(e);
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
    let draft=old.draft,error=null,previewWarning='',
      previewMessageId=old.previewMessageId??null,albumMessageId=old.albumMessageId??null;
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
        // New creation requires a caption-title; replacement may retain title.
        const caption=update.message.caption;
        const withTitle=caption?editCreatorDraft(draft,{type:'captionTitle',text:caption}):
          draft.title?draft:editCreatorDraft(draft,{type:'captionTitle',text:caption});
        draft=editCreatorDraft(withTitle,{type:'paidVideo',media:{fileId:update.message.video.file_id}});
        // A replacement invalidates automatically-derived previews from the previous source video.
        if(old.draft.paidVideo?.fileId!==update.message.video.file_id){
          draft=editCreatorDraft(editCreatorDraft(draft,{type:'removeThumbnail'}),{type:'removeSample'});
        }
        // Telegram may supply a native thumbnail for a video even when
        // its full bytes exceed the public Bot API download limit.
        // Reuse this owner-provided file_id before attempting FFmpeg.
        const nativeThumbnail=update.message.video.thumbnail?.file_id;
        if(!draft.thumbnail && typeof nativeThumbnail==='string')
          draft=editCreatorDraft(draft,{type:'thumbnail',media:{fileId:nativeThumbnail}});
        const preview=await autoPreview(ownerId,draft);
        draft=preview.draft;
        previewWarning=preview.warning;
        previewMessageId=preview.previewMessageId;
        albumMessageId=preview.previewMessageId;
      } else if(old.waiting==='sample') {
        if(!update.message.video?.file_id)throw new Error('サンプル動画を送信してください。');
        if(typeof mediaProcessor?.prepareUserSample!=='function')throw new Error('サンプル生成サービスは未接続です。');
        const processed=await mediaProcessor.prepareUserSample({...update.message.video,ownerId});
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
    const nextScreen=error?old.screen:'editor';
    const next={...old,draft,previewMessageId,albumMessageId,
      waiting:error?old.waiting:null,
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
    openOwnedVideo,
    async handle(update){
      if(update?.callback_query)return handleCallback(update);
      if(update?.message && (update.message.text||update.message.photo||update.message.video))return handleInput(update);
      return {handled:false};
    }
  };
}
