import {managementFeeDisclosure} from '../sales/managementFee.mjs';
// Creator's pre-sale UI states Master-adopted no-refund policy in the explicit
// terms step. Official charge reconciliation remains in the transaction ledger.
const videoFeeDisclosure=(stars)=>managementFeeDisclosure(stars)
  .split('\n').filter(line=>!line.startsWith('返金が発生した場合')).join('\n');
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const PRICE_PRESETS = Object.freeze([50, 100, 300, 500, 1000]);
const MAX_PRICE = 25000;
/** Same strict custom-price input rule as the verified sticker sales wizard. */
export function parseCreatorStarsPrice(text) {
  if (typeof text !== 'string') throw new Error('Stars price must be an integer from 1 to 25000');
  const value=text.trim();
  if(!/^[1-9][0-9]{0,4}$/.test(value)) throw new Error('Stars price must be an integer from 1 to 25000');
  return price(Number(value));
}

function price(stars) {
  if (!Number.isSafeInteger(stars) || stars < 1 || stars > MAX_PRICE) throw new Error('Stars price must be an integer from 1 to 25000');
  return stars;
}
function title(value) {
  if (typeof value !== 'string') throw new Error('title required');
  const valueTrimmed = value.trim();
  if (!valueTrimmed || valueTrimmed.length > 128 || /[\r\n]/.test(valueTrimmed)) throw new Error('title must be one line (1–128 characters)');
  return valueTrimmed;
}
function media(value, role) {
  if (!value || typeof value.fileId !== 'string' || !/^[A-Za-z0-9_-]{3,256}$/.test(value.fileId)) throw new Error('invalid ' + role + ' file ID');
  if (role === 'sample' && (!Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 30)) {
    throw new Error('sample must be verified <=30 seconds before registration');
  }
  return { fileId: value.fileId, ...(role === 'sample' ? { durationSeconds: value.durationSeconds } : {}) };
}
function expectDraft(draft) {
  if (!draft || !USER_ID.test(draft.sellerId || '') || !['create','edit'].includes(draft.mode)) throw new Error('invalid editor state');
}

/** Single field model for create and edit. Mutations return copies, never edit source records. */
export function openCreatorEditor({ sellerId, existing = null } = {}) {
  if (typeof sellerId !== 'string' || !USER_ID.test(sellerId)) throw new Error('seller verification required');
  if (existing && (existing.sellerId !== sellerId || !ID.test(existing.id || ''))) throw new Error('listing ownership mismatch');
  return {
    mode: existing ? 'edit' : 'create',
    sellerId,
    listingId: existing?.id ?? null,
    revision: existing?.revision ?? 0,
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priceStars: existing?.priceStars ?? null,
    priceMode: existing?.priceMode ?? 'preset',
    thumbnail: existing?.thumbnail ?? null,
    sample: existing?.sample ?? null,
    paidVideo: existing?.paidVideo ?? null,
    rightsVerified: existing?.rightsVerified === true,
    adultConsentVerified: existing?.adultConsentVerified === true,
    feeTermsAccepted: existing?.feeTermsAccepted === true,
    dirtyFields: []
  };
}

export function editCreatorDraft(draft, action) {
  expectDraft(draft);
  if (!action || typeof action.type !== 'string') throw new Error('editor action required');
  let field;
  let value;
  switch (action.type) {
    case 'thumbnail':
    case 'sample':
    case 'paidVideo':
      field = action.type;
      value = media(action.media, field);
      if (field === 'paidVideo') return { ...draft, paidVideo: value, rightsVerified:false, adultConsentVerified:false, feeTermsAccepted:false,
        dirtyFields: [...new Set([...draft.dirtyFields,'paidVideo','rightsVerified','adultConsentVerified'])] };
      if(draft.feeTermsAccepted) return {...draft,[field]:value,feeTermsAccepted:false,
        rightsVerified:false,adultConsentVerified:false,
        dirtyFields:[...new Set([...draft.dirtyFields,field,'feeTermsAccepted','rightsVerified','adultConsentVerified'])]};
      break;
    case 'confirmTerms':
      if(!draft.paidVideo)throw new Error('main video required before agreement');
      return {...draft,rightsVerified:true,adultConsentVerified:true,feeTermsAccepted:true,
        dirtyFields:[...new Set([...draft.dirtyFields,'rightsVerified','adultConsentVerified','feeTermsAccepted'])]};
    case 'clearTerms':
      return {...draft,rightsVerified:false,adultConsentVerified:false,feeTermsAccepted:false,
        dirtyFields:[...new Set([...draft.dirtyFields,'rightsVerified','adultConsentVerified','feeTermsAccepted'])]};
    case 'confirmRights':
      if (!draft.paidVideo) throw new Error('paid video required before rights confirmation');
      if (action.rightsVerified !== true || action.adultConsentVerified !== true)
        throw new Error('rights, adult and performer consent required');
      return { ...draft, rightsVerified:true, adultConsentVerified:true,
        dirtyFields: [...new Set([...draft.dirtyFields,'rightsVerified','adultConsentVerified'])] };
    case 'removeThumbnail':
      field = 'thumbnail'; value = null; break;
    case 'removeSample':
      field = 'sample'; value = null; break;
    case 'preset':
      if (!PRICE_PRESETS.includes(action.stars)) throw new Error('unknown price preset');
      return { ...draft, priceStars: action.stars, priceMode: 'preset', feeTermsAccepted:false, dirtyFields: [...new Set([...draft.dirtyFields, 'priceStars'])] };
    case 'custom':
      return { ...draft, priceMode: 'custom' };
    case 'captionTitle':
      field = 'title'; value = title(action.text); break;
    case 'customPriceInput': {
      const stars = parseCreatorStarsPrice(action.text);
      return { ...draft, priceStars:stars, priceMode:'custom', feeTermsAccepted:false,
        dirtyFields:[...new Set([...draft.dirtyFields,'priceStars'])] };
    }
    case 'titleInput':
      field = 'title'; value = title(action.text); break;
    case 'descriptionInput':
      if(typeof action.text!=='string'||action.text.trim().length>800)
        throw new Error('description must be up to 800 characters');
      field='description'; value=action.text.trim(); break;
    default: throw new Error('unknown editor action');
  }
  return { ...draft, [field]: value, dirtyFields: [...new Set([...draft.dirtyFields, field])] };
}

/** Telegram creator registration: upload -> automatic private preview -> optional description -> registration. */
export function creatorEditorPanel(draft, revision = 0, screen = 'editor') {
  expectDraft(draft);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('invalid screen revision');
  const btn=(text,action)=>({text,callback_data:action+(revision?'|r'+revision:'')});
  if(screen==='await_video' || (screen==='editor'&&!draft.paidVideo)){
    return {text:'🎬 新規動画を投稿\n\nタイトルと動画を投稿してください。\n動画のキャプションへタイトルを入力し、一緒に送信してください。',
      reply_markup:{inline_keyboard:[[btn('🔙 戻る','menu:manage'),btn('❌ キャンセル','edit:cancel')]]}};
  }
  const rows=['👁 プレビュー','','［編集］タイトル：'+(draft.title||'未登録')];
  if(draft.description)rows.push('［編集］説明：'+draft.description);
  else rows.push('説明：[未登録]');
  rows.push(
    '［編集］価格：'+(draft.priceStars==null?'未設定':'⭐ '+draft.priceStars+' Stars'),
    '［編集］🖼 サムネ：'+(draft.thumbnail?'登録済み':'未生成'),
    '［編集］🎞 サンプル：'+(draft.sample?'登録済み（'+draft.sample.durationSeconds+'秒）':'未生成'),
    '［編集］🎬 有料本編：'+(draft.paidVideo?'登録済み':'未登録')
  );
  if(draft.mode==='edit'&&draft.rightsVerified&&draft.adultConsentVerified&&draft.feeTermsAccepted)
    rows.push('☑ 規約約款同意済み');
  rows.push('',videoFeeDisclosure(draft.priceStars));
  const text=rows.join('\n');
  const entities=[];
  const fields=[
    ['title',2,'［編集］'],
    ['description',3,draft.description?'［編集］':'[未登録]'],
    ['price',4,'［編集］'],
    ['thumbnail',5,'［編集］'],
    ['sample',6,'［編集］'],
    ['paidVideo',7,'［編集］']
  ];
  for(const [field,index,mark] of fields) {
    const offset=rows.slice(0,index).reduce((n,v)=>n+v.length+1,0);
    const inRow=rows[index].indexOf(mark);
    if(inRow<0)throw new Error('invalid inline editor label');
    entities.push({type:'text_link',offset:offset+inRow,length:mark.length,
      url:'https://t.me/CreateVdobot?start=ved_'+field+'_r'+revision});
  }
  if(screen==='price'){
    return {text:text+'\n\nStars価格を選択してください。自由入力は通常の入力欄へ数字のみ（1〜25000）。',entities,
      reply_markup:{inline_keyboard:[
        PRICE_PRESETS.slice(0,3).map(n=>btn(n+' ⭐','edit:price:'+n)),
        [...PRICE_PRESETS.slice(3).map(n=>btn(n+' ⭐','edit:price:'+n)),
          btn('自分で決める','edit:price:custom')],
        [btn('🔙 戻る','edit:back')]
      ]}};
  }
  return {text,entities,reply_markup:{inline_keyboard:[
    [btn('✅ 投稿する','entry:register'),btn('❌ キャンセル','edit:cancel')]
  ]}};
}

export function myVideosPanel({ sellerId, listings, page = 0, revision = 0, notice = '', updatedId = null } = {}) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid listing screen revision');
  if (typeof sellerId !== 'string' || !USER_ID.test(sellerId)) throw new Error('seller verification required');
  if (!Array.isArray(listings) || !Number.isSafeInteger(page) || page < 0) throw new Error('invalid pagination');
  const owned = listings.filter(v => v.sellerId === sellerId);
  if (owned.some(v => !ID.test(v.id || '') || typeof v.title !== 'string')) throw new Error('invalid video listing');
  const pages = Math.max(1, Math.ceil(owned.length / 10));
  if (page >= pages) throw new Error('page outside listing range');
  const items=owned.slice(page*10,page*10+10);
  const intro=notice || (owned.length ? '🎬 登録済み動画' : '現在動画は未登録です。\n🆕新規動画を登録してください。');
  const rows=[intro];
  const entities=[];
  for(const [index,item] of items.entries()){
    const prefix='［編集］';
    const row=prefix + (item.id===updatedId?'📝 ':item.status==='published'?'🎬 ':'🆕') + item.title;
    const offset=rows.join('\n').length+1;
    // Telegram deep link is owner- and revision-validated by the wizard.
    entities.push({type:'text_link',offset,length:prefix.length,
      url:'https://t.me/CreateVdobot?start=ved_video_'+item.id+'_r'+revision});
    rows.push(row);
  }
  const btn=(text,data)=>({text,callback_data:data});
  const nav=[];
  if(page>0)nav.push(btn('◀ 前へ','video:page:'+(page-1)+'|r'+revision));
  if(page+1<pages)nav.push(btn('次へ ▶','video:page:'+(page+1)+'|r'+revision));
  const keyboard=[[btn('🔙 戻る','menu:home'),btn('🆕 新規投稿','menu:listing')]];
  if(nav.length)keyboard.push(nav);
  return {text:rows.join('\n'),...(entities.length?{entities}:{}),
    reply_markup:{inline_keyboard:keyboard}};
}

/** Read-only detail for the existing title and price buttons on My Videos.
 * No separate command, publication or extra persistent document.
 */
export function videoInfoPanel(listing,revision,mode='open') {
  if(!listing||!ID.test(listing.id||'')||
     typeof listing.title!=='string'||
     !Number.isSafeInteger(revision)||revision<1||
     !['open','price'].includes(mode))
    throw new Error('invalid owner video information panel');
  const lines=[
    mode==='price'?'⭐ 動画の価格・手数料':'🎬 マイ動画の詳細',
    '',
    'タイトル：'+listing.title,
    '販売価格：'+(listing.priceStars==null?'未設定':'⭐ '+price(listing.priceStars)+' Stars'),
    videoFeeDisclosure(listing.priceStars)
  ];
  if(mode==='open')lines.push(
    'サムネ：'+(listing.thumbnail?'登録済み':'未登録'),
    'サンプル：'+(listing.sample?'登録済み':'未登録'),
    '本編：'+(listing.paidVideo?'登録済み':'未登録'),
    '状態：'+(listing.status==='published'?'公開済み':listing.status==='paused'?'停止中':'未公開')
  );
  return {
    text:lines.join('\n'),
    reply_markup:{inline_keyboard:[[{
      text:'↩ マイ動画へ',callback_data:'video:back:'+listing.id+'|r'+revision
    }]]}
  };
}

export function withdrawalPrompt(availableStars) {
  if (!Number.isSafeInteger(availableStars) || availableStars < 0) throw new Error('invalid available Stars');
  return { text: '⭐ Starsを引き出す\n\n引き出し可能：' + availableStars + ' Stars\nTelegramのメッセージ入力欄へ引き出すStars数を数字で入力し、通常の送信ボタンで送信してください。', reply_markup: { inline_keyboard: [[{ text: '↩ 戻る', callback_data: 'menu:sales' }]] } };
}
export class WithdrawalInputError extends Error {
  constructor(code, message) { super(message); this.name = 'WithdrawalInputError'; this.code = code; }
}
export function validateWithdrawalText(text, availableStars) {
  if (!Number.isSafeInteger(availableStars) || availableStars < 0) throw new Error('invalid available Stars');
  if (availableStars === 0) throw new WithdrawalInputError('NO_BALANCE', '引き出し可能なStarsはありません。');
  if (typeof text !== 'string' || !/^[0-9]+$/.test(text.trim())) throw new WithdrawalInputError('INVALID_AMOUNT', '正の整数を数字だけで入力してください。');
  const amount = Number(text.trim());
  if (!Number.isSafeInteger(amount) || amount < 1) throw new WithdrawalInputError('INVALID_AMOUNT', '1以上の正しい整数を入力してください。');
  if (amount > availableStars) throw new WithdrawalInputError('INSUFFICIENT', '❌ 残高不足です。引き出し可能なStars数を超えています。\n引き出し可能：' + availableStars + ' Stars\n入力額：' + amount + ' Stars\n不足額：' + (amount - availableStars) + ' Stars\n' + availableStars + ' Stars以下の数字を入力して、もう一度送信してください。');
  return amount; // Valid input is NOT a transfer; the payout adapter is intentionally absent.
}
export function confirmedWithdrawal({ amount, availableBefore, officialTransferConfirmed }) {
  if (officialTransferConfirmed !== true) throw new Error('official Stars transfer not confirmed');
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(availableBefore) || amount < 1 || availableBefore < amount) throw new Error('invalid confirmed transfer');
  return { text: '✅ 引き出し完了\n今回引き出したStars数：' + amount + '\n差引後の引き出し可能残高：' + (availableBefore - amount) + ' Stars' };
}

/** Creator can see exactly what will publish, then explicitly confirm rights
 * for the current paid-video revision before publishing. No side effects.
 */
/** One explicit terms step after preview. Telegram buttons are only
 * offered when the private user's agreement flag is persisted. */
export function creatorReviewPanel(draft, revision = 0, note = '') {
  expectDraft(draft);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('invalid review revision');
  const missing=['thumbnail','sample','paidVideo','title','priceStars'].filter(k=>!draft[k]);
  const agreed=draft.rightsVerified===true&&draft.adultConsentVerified===true&&
    draft.feeTermsAccepted===true;
  const text=[
    '📋 投稿前の規約・約款確認','',
    '投稿タイトル：'+(draft.title||'未登録'),
    '販売価格：'+(draft.priceStars==null?'未設定':draft.priceStars+' Stars'),
    videoFeeDisclosure(draft.priceStars),'',
    '・投稿者は動画の掲載権限を持ち、出演者全員が18歳以上で掲載に同意していることを確認します。',
    '・設定したStars売上の30%を運営費として差し引きます。',
    '・購入後にコンテンツが引き渡された取引は、原則として返金を行いません。ただし法令やTelegramの公式制度で必要な対応を除きます。',
    '・Botは出品者と購入者の取引を仲介します。',
    '',
    agreed?'☑ 規約・約款に同意済み':'☐ 内容を確認し、規約・約款に同意する',
    missing.length?'⚠️ 未生成・未設定：'+missing.join('・'):'',
    note
  ].filter(Boolean).join('\n');
  const row=[
    {text:agreed?'☑ 同意を取り消す':'☐ 内容を確認して同意する',callback_data:'review:agree|r'+revision}
  ];
  const actions=[
    ...(agreed&&!missing.length?[[{text:'✅ 投稿する',callback_data:'review:publish|r'+revision}]]:[]),
    [{text:'🔙 プレビューへ戻る',callback_data:'review:edit|r'+revision},
     {text:'❌ キャンセル',callback_data:'review:cancel|r'+revision}]
  ];
  return {text,reply_markup:{inline_keyboard:[row,...actions]}};
}
