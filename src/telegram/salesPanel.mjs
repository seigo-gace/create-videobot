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
  const text=[
    '⭐ 売上・引き出し',
    '',
    '累計売上：'+summary.grossStars+' Stars',
    '引き出し可能：'+(payoutReady?summary.availableStars+' Stars':'未確認（出品者への公式Stars移転手段は未検証）'),
    '※ 実際の受取可能額は公式取引・返金等の確認後に確定します。'
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
    return (row.type==='sale'?'売上':row.type==='refund'?'返金':'引き出し')+
      '：'+(row.type==='sale'?'+':'−')+row.stars+' Stars';
  });
  return {text:'📋 売上・引き出し履歴\n\n'+(list.join('\n')||'履歴はありません。'),
    reply_markup:{inline_keyboard:[[{
      text:'↩ 戻る',callback_data:cb('sales:back',revision)
    }]]}};
}
export function salesWithdrawalPanel(summary,revision,error='') {
  if(summary?.payoutReady!==true)return {
    text:'⭐ 引き出し\n\n出品者への公式Stars移転手段が未確認のため引き出しは利用できません。',
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
