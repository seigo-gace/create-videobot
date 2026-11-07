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
function statusPanel(draft,rev,extra='') {
  const p=creatorEditorPanel(draft,rev);
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
    await sessionStore.write(ownerId,expected,next);
    const result=await screenTransport.show(ownerId,patch.screenMessageId??old?.screenMessageId,drawn);
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
  async function handleCallback(update) {
    const {ownerId,messageId}=privateUser(update);
    const cb=update.callback_query;
    if(typeof cb.id!=='string'||!cb.id)throw new Error('invalid callback');
    await api('answerCallbackQuery',{callback_query_id:cb.id});
    const code=cb.data??'';
    const old=await sessionStore.read(ownerId);
    if(code==='menu:listing') {
      const draft=old?.draft??openCreatorEditor({sellerId:String(ownerId)});
      return persistAndRender(ownerId,old,{
        screenMessageId:messageId,draft,waiting:null
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
    if(code.startsWith('edit:')) {
      expectSession(old,messageId);
      const action=validateRevision(code,old);
      const draft=old.draft;
      const value=action.slice(5);
      if(value==='cancel') {
        return persistAndRender(ownerId,old,{...old,draft:null,waiting:null},menuPage('home'));
      }
      if(['thumbnail','sample','paidVideo','title'].includes(value)) {
        return persistAndRender(ownerId,old,{...old,waiting:value},
          rev=>statusPanel(draft,rev,'Telegramの通常入力欄へ'+
            (value==='thumbnail'?'サムネ画像':value==='sample'?'サンプル動画':value==='paidVideo'?'販売用本編動画':'タイトル')+'を送信してください。'));
      }
      if(value==='price:custom') {
        const changed=editCreatorDraft(draft,{type:'custom'});
        return persistAndRender(ownerId,old,{...old,draft:changed,waiting:'title'},
          rev=>statusPanel(changed,rev));
      }
      if(/^price:(50|100|300|500|1000)$/.test(value)) {
        const changed=editCreatorDraft(draft,{type:'preset',stars:Number(value.slice(6))});
        return persistAndRender(ownerId,old,{...old,draft:changed,waiting:null},
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
        const note=missing.length ? warning : '本人が［投稿する］を押すまでは公開されません。';
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
      if(action==='review:publish') {
        if(old.publishing==='needs_reconcile')throw new Error('PUBLISH_NEEDS_RECONCILE');
        const valid=!!draft.thumbnail&&!!draft.sample&&!!draft.paidVideo&&
          !!draft.title&&Number.isSafeInteger(draft.priceStars)&&
          draft.rightsVerified===true&&draft.adultConsentVerified===true;
        if(!valid)return persistAndRender(ownerId,old,{...old},
          rev=>creatorReviewPanel(draft,rev,'未登録項目と権利の確認を完了してください。'));
        if(typeof publishListing!=='function' ||
          typeof listingStore?.createDraft!=='function' ||
          typeof listingStore?.updateDraft!=='function' ||
          typeof listingStore?.markPublished!=='function')
          return persistAndRender(ownerId,old,{...old},
            rev=>creatorReviewPanel(draft,rev,'公開用の既存GATE・Topic・売上DB接続はまだ検証されていません。投稿は行われません。'));
        const reservation={...old,revision:old.revision+1,publishing:'in_progress'};
        // Reserve callback revision *before* any paid-media send; rejects races.
        await sessionStore.write(ownerId,old.revision,reservation);
        let stored=null;
        try {
          // The price and 30% deduction are shown on the same review screen.
          // Explicit tapping of the existing "投稿する" button records fee
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

  async function handleInput(update) {
    const {ownerId,messageId}=privateUser(update);
    const old=await sessionStore.read(ownerId);
    if(!old?.waiting||!old.draft)return {handled:false};
    let draft=old.draft,error=null;
    try {
      if(old.waiting==='title') {
        draft=editCreatorDraft(draft,{type:'titleInput',text:update.message.text});
      } else if(old.waiting==='thumbnail') {
        const p=update.message.photo?.at(-1);
        if(!p?.file_id)throw new Error('サムネイル画像を送信してください。');
        draft=editCreatorDraft(draft,{type:'thumbnail',media:{fileId:p.file_id}});
      } else if(old.waiting==='paidVideo') {
        if(!update.message.video?.file_id)throw new Error('本編動画を送信してください。');
        draft=editCreatorDraft(draft,{type:'paidVideo',media:{fileId:update.message.video.file_id}});
      } else if(old.waiting==='sample') {
        if(!update.message.video?.file_id)throw new Error('サンプル動画を送信してください。');
        if(typeof mediaProcessor?.prepareUserSample!=='function')throw new Error('サンプル生成サービスは未接続です。');
        const processed=await mediaProcessor.prepareUserSample(update.message.video);
        draft=editCreatorDraft(draft,{type:'sample',media:processed});
      } else throw new Error('UNKNOWN_CREATOR_INPUT');
    } catch(e){error=e instanceof Error?e.message:'入力を確認できません。';}
    // Applies existing common UI rule: remove input even when invalid.
    let inputDeleteFailed=false;
    try{await api('deleteMessage',{chat_id:ownerId,message_id:messageId});}
    catch{inputDeleteFailed=true;}
    const next={...old,draft,waiting:error?old.waiting:null};
    const note=(error?'⚠️ '+error:'✅ 反映しました。')+
      (inputDeleteFailed?'\n入力メッセージを自動削除できませんでした。手動で削除してください。':'');
    return persistAndRender(ownerId,old,next,rev=>statusPanel(draft,rev,note));
  }
  return {
    openHome,
    async handle(update){
      if(update?.callback_query)return handleCallback(update);
      if(update?.message && (update.message.text||update.message.photo||update.message.video))return handleInput(update);
      return {handled:false};
    }
  };
}
