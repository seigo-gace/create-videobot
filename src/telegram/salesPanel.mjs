import {splitStarsExact,formatTenths,managementFeeDisclosure} from '../sales/managementFee.mjs';
import {withdrawalPrompt,validateWithdrawalText,confirmedWithdrawal,WithdrawalInputError} from './creatorUi.mjs';

function nonnegative(value,name) {
  if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid '+name);
  return value;
}
function cb(action,revision) {
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('invalid sales screen revision');
  return action+'|r'+revision;
}
/** UI only: all Stars amounts must come from a verified owner ledger provider. */
export function salesOverviewPanel(summary,revision) {
  if(!summary||typeof summary!=='object')throw new Error('sales summary unavailable');
  nonnegative(summary.grossStars,'gross Stars');
  const payoutReady=summary.payoutReady===true;
  if(payoutReady)nonnegative(summary.availableStars,'available Stars');
  const netKnown=summary.netRecordedStars!==undefined;
  const net=netKnown?nonnegative(summary.netRecordedStars,'refund-adjusted Stars'):null;
  if(netKnown&&net>summary.grossStars)throw new Error('refund-adjusted Stars exceed gross');
  const split=netKnown?splitStarsExact(net):null;
  if(split&&(summary.managementFeeTenths!==undefined&&
     summary.managementFeeTenths!==split.managementFeeTenths ||
     summary.creatorShareTenths!==undefined&&
     summary.creatorShareTenths!==split.creatorShareTenths))
    throw new Error('ledger fee split mismatch');
  const text=[
    '⭐ 売上・引き出し',
    '',
    '累計売上：'+summary.grossStars+' Stars',
    '返金控除後売上：'+(netKnown?net+' Stars':'未確認'),
    '運営管理費（30%）：'+(split?formatTenths(split.managementFeeTenths)+' Stars（計算上）':'未確認'),
    '投稿者分（70%）：'+(split?formatTenths(split.creatorShareTenths)+' Stars（計算上）':'未確認'),
    '引き出し可能：'+(payoutReady?summary.availableStars+' Stars':'未確認（出品者への公式Stars移転手段は未検証）'),
    '※ 1 Star未満の端数処理は未決定です。管理費・投稿者分の計算額は引き出し可能残高ではありません。'
  ].join('\n');
  return {text,reply_markup:{inline_keyboard:[
    [{text:'⭐ 引き出す',callback_data:cb('sales:withdraw',revision)},
     {text:'📋 履歴',callback_data:cb('sales:history',revision)}],
    [{text:'↩ 戻る',callback_data:cb('menu:home',revision)}]
  ]}};
}
export function salesHistoryPanel(history,revision) {
  if(!Array.isArray(history))throw new Error('invalid sales history');
  const list=history.slice(0,10).map(row=>{
    if(!row||!['sale','refund','withdrawal'].includes(row.type)||
       !Number.isSafeInteger(row.stars)||row.stars<1)
      throw new Error('invalid ledger history event');
    const label=(row.type==='sale'?'売上':row.type==='refund'?'返金':'引き出し')+
      '：'+(row.type==='sale'?'+':'−')+row.stars+' Stars';
    if(row.type==='withdrawal')return label;
    const split=splitStarsExact(row.stars);
    return label+'（管理費'+(row.type==='refund'?'戻し':'')+'30% '+
      formatTenths(split.managementFeeTenths)+' / 投稿者'+(row.type==='refund'?'戻し':'分')+'70% '+
      formatTenths(split.creatorShareTenths)+' Stars・計算上）';
  });
  return {text:'📋 売上・引き出し履歴\n\n'+(list.join('\n')||'履歴はありません。'),
    reply_markup:{inline_keyboard:[[{
      text:'↩ 戻る',callback_data:cb('sales:back',revision)
    }]]}};
}
export function salesWithdrawalPanel(summary,revision,error='') {
  if(summary?.payoutReady!==true)return {
    text:'⭐ 引き出し\n\n販売売上の30%は運営管理費、投稿者分は70%です。\n出品者への公式Stars移転手段が未確認のため引き出しは利用できません。',
    reply_markup:{inline_keyboard:[[{
      text:'↩ 戻る',callback_data:cb('sales:back',revision)
    }]]}
  };
  const amount=nonnegative(summary.availableStars,'available Stars');
  const base=withdrawalPrompt(amount);
  return {...base,text:base.text+(error?'\n\n'+error:''),
    reply_markup:{inline_keyboard:[[{
      text:'↩ 戻る',callback_data:cb('sales:back',revision)
    }]]}};
}
export function validateSaleWithdrawalInput(text,summary) {
  if(summary?.payoutReady!==true)throw new Error('official Stars transfer not enabled');
  return validateWithdrawalText(text,nonnegative(summary.availableStars,'available Stars'));
}
export {confirmedWithdrawal,WithdrawalInputError};
