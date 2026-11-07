import {managementFeeDisclosure} from '../sales/managementFee.mjs';
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const PRICE_PRESETS = Object.freeze([50, 100, 300, 500, 1000]);
const MAX_PRICE = 25000;

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
      if (field === 'paidVideo') return { ...draft, paidVideo: value, rightsVerified:false, adultConsentVerified:false,
        dirtyFields: [...new Set([...draft.dirtyFields,'paidVideo','rightsVerified','adultConsentVerified'])] };
      break;
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
    case 'titleInput': {
      if (draft.priceMode === 'custom') {
        if (typeof action.text !== 'string') throw new Error('enter title on first line and Stars on second line');
        const lines = action.text.replace(/\r\n/g, '\n').split('\n');
        if (lines.length !== 2 || !/^[0-9]+$/.test(lines[1].trim())) throw new Error('enter title on first line and numeric Stars on second line: 夏の思い出動画\\n250');
        const stars = price(Number(lines[1].trim()));
        return { ...draft, title: title(lines[0]), priceStars: stars, feeTermsAccepted:false, dirtyFields: [...new Set([...draft.dirtyFields, 'title','priceStars'])] };
      }
      field = 'title'; value = title(action.text); break;
    }
    default: throw new Error('unknown editor action');
  }
  return { ...draft, [field]: value, dirtyFields: [...new Set([...draft.dirtyFields, field])] };
}

/** Telegram has one ordinary chat input; it does not provide inline numeric fields. */
export function creatorEditorPanel(draft, revision = 0) {
  expectDraft(draft);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid screen revision');
  const row = items => items.map(([text, callback_data]) => ({ text, callback_data }));
  const text = [
    draft.mode === 'edit' ? '✏️ 動画を編集' : '🎬 新しい動画を投稿',
    '', '🖼 サムネ：' + (draft.thumbnail ? '登録済み' : '未登録'),
    '🎞 サンプル：' + (draft.sample ? '登録済み（' + draft.sample.durationSeconds + '秒）' : '未登録'),
    '🎬 本編：' + (draft.paidVideo ? '登録済み' : '未登録'),
    '📝 タイトル：' + (draft.title || '未入力'),
    '⭐ 価格：' + (draft.priceStars == null ? '未設定' : draft.priceStars + ' Stars'),
    managementFeeDisclosure(draft.priceStars),
    '', draft.priceMode === 'custom'
      ? 'タイトルを1行目に入力し、改行して2行目に希望するStars数を数字で入力してください。\n例：夏の思い出動画\n250'
      : 'タイトルはTelegramの通常のメッセージ入力欄から送信してください。'
  ].join('\n');
  const keyboard = [
    row([['🖼 サムネ登録・変更','edit:thumbnail'],['🎞 サンプル登録・変更','edit:sample']]),
    row([['🎬 本編登録・変更','edit:paidVideo'],['📝 タイトル入力','edit:title']]),
    row(PRICE_PRESETS.slice(0, 3).map(n => [String(n) + (draft.priceStars === n && draft.priceMode === 'preset' ? ' ✓' : ''), 'edit:price:' + n])),
    row([...PRICE_PRESETS.slice(3).map(n => [String(n) + (draft.priceStars === n && draft.priceMode === 'preset' ? ' ✓' : ''), 'edit:price:' + n]),['自分で決める','edit:price:custom']]),
    row([['👁 プレビュー','edit:preview'],['❌ キャンセル','edit:cancel']])
  ];
  return { text, reply_markup: { inline_keyboard: keyboard.map(row => row.map(button => ({...button, callback_data: revision ? button.callback_data + '|r' + revision : button.callback_data}))) } };
}

export function myVideosPanel({ sellerId, listings, page = 0, revision = 0 } = {}) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid listing screen revision');
  if (typeof sellerId !== 'string' || !USER_ID.test(sellerId)) throw new Error('seller verification required');
  if (!Array.isArray(listings) || !Number.isSafeInteger(page) || page < 0) throw new Error('invalid pagination');
  const owned = listings.filter(v => v.sellerId === sellerId);
  if (owned.some(v => !ID.test(v.id || '') || typeof v.title !== 'string')) throw new Error('invalid video listing');
  const pages = Math.max(1, Math.ceil(owned.length / 10));
  if (page >= pages) throw new Error('page outside listing range');
  const keyboard = [];
  for (const item of owned.slice(page * 10, page * 10 + 10)) {
    keyboard.push([{ text: item.title, callback_data: 'video:open:' + item.id }]);
    keyboard.push([
      { text: item.priceStars==null?'⭐ 未設定':'⭐ ' + price(item.priceStars) + ' Stars', callback_data: 'video:price:' + item.id },
      { text: '✏️ 編集', callback_data: 'video:edit:' + item.id },
      { text: '🗑 削除', callback_data: 'video:delete:' + item.id }
    ]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '◀ 前へ', callback_data: 'video:page:' + (page - 1) });
  if (page + 1 < pages) nav.push({ text: '次へ ▶', callback_data: 'video:page:' + (page + 1) });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: '↩ 戻る', callback_data: 'menu:home' }]);
  return { text: '📦 マイ動画\n※ 販売売上から管理費30%が差し引かれ、投稿者分は70%です。\n' + (owned.length ? (page * 10 + 1) + '〜' + Math.min(owned.length, page * 10 + 10) + ' / ' + owned.length + '件' : 'まだ登録された動画はありません。'), reply_markup: { inline_keyboard: revision ? keyboard.map(row => row.map(b=>({...b,callback_data:b.callback_data==='menu:home'?'menu:home':b.callback_data+'|r'+revision}))) : keyboard } };
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
export function creatorReviewPanel(draft, revision = 0, note = '') {
  expectDraft(draft);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('invalid review revision');
  const missing=['thumbnail','sample','paidVideo','title','priceStars'].filter(k=>!draft[k]);
  const ready=missing.length===0 && draft.rightsVerified===true && draft.adultConsentVerified===true;
  const keys=[
    [{text:draft.rightsVerified&&draft.adultConsentVerified?'✅ 権利・出演者確認済み':'📜 権利・出演者を確認',callback_data:'review:rights|r'+revision}],
    [{text:'✅ 投稿する',callback_data:'review:publish|r'+revision},
     {text:'✏️ 修正',callback_data:'review:edit|r'+revision},
     {text:'❌ 中止',callback_data:'review:cancel|r'+revision}]
  ];
  const text=['👁 動画販売プレビュー','',
    'タイトル：'+(draft.title||'未入力'),
    '価格：'+(draft.priceStars==null?'未設定':'⭐ '+draft.priceStars+' Stars'),
    managementFeeDisclosure(draft.priceStars),
    '🖼 サムネ：'+(draft.thumbnail?'登録済み（ネタバレ）':'未登録'),
    '🎞 サンプル：'+(draft.sample?'登録済み（'+draft.sample.durationSeconds+'秒・ネタバレ）':'未登録'),
    '🎬 有料本編：'+(draft.paidVideo?'登録済み・Starsロック':'未登録'),
    '📜 権利・同意：'+(draft.rightsVerified&&draft.adultConsentVerified?'確認済み':'未確認（出演者全員の成人・掲載同意）'),
    '', missing.length?'⚠️ 未登録：'+missing.join('・'):ready?'✅ 投稿内容を確認してください。':'⚠️ この動画の権利・出演者全員の成人と掲載同意を確認してください。',
    '無料アルバムとStars有料本編は別メッセージで投稿します。',
    '［✅ 投稿する］を押すと、売上の30%を運営管理費として差し引く条件に同意した扱いになります。',note].filter(Boolean).join('\n');
  return {text,reply_markup:{inline_keyboard:keys}};
}
