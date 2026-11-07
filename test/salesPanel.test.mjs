import test from 'node:test';
import assert from 'node:assert/strict';
import {
 salesOverviewPanel,salesWithdrawalPanel,salesHistoryPanel,
 validateSaleWithdrawalInput,confirmedWithdrawal,WithdrawalInputError
} from '../src/telegram/salesPanel.mjs';

test('summary renders exactly agreed owner Stars buttons, no unnecessary stage menu',()=>{
 const panel=salesOverviewPanel({grossStars:850,availableStars:210,payoutReady:true},5);
 assert.match(panel.text,/累計売上：850 Stars/);
 assert.match(panel.text,/引き出し可能：210 Stars/);
 assert.deepEqual(panel.reply_markup.inline_keyboard.map(r=>r.length),[2,1]);
 assert.deepEqual(panel.reply_markup.inline_keyboard[0].map(b=>b.text),['⭐ 引き出す','📋 履歴']);
 assert.equal(panel.reply_markup.inline_keyboard[0][0].callback_data,'sales:withdraw|r5');
});
test('not-yet-official user payout never displays a fake ready balance',()=>{
 const summary={grossStars:850,payoutReady:false};
 const main=salesOverviewPanel(summary,7);
 assert.match(main.text,/未確認/);
 assert.match(salesWithdrawalPanel(summary,8).text,/利用できません/);
 assert.throws(()=>validateSaleWithdrawalInput('100',summary),/not enabled/);
});
test('one Telegram text amount validates insufficient balance without transfer',()=>{
 const summary={grossStars:850,availableStars:210,payoutReady:true};
 const panel=salesWithdrawalPanel(summary,3);
 assert.match(panel.text,/メッセージ入力欄/);
 assert.equal(panel.reply_markup.inline_keyboard.length,1);
 assert.equal(validateSaleWithdrawalInput('100',summary),100);
 assert.throws(()=>validateSaleWithdrawalInput('300',summary),e=>
   e instanceof WithdrawalInputError&&e.code==='INSUFFICIENT'&&e.message.includes('90 Stars'));
 assert.throws(()=>confirmedWithdrawal({amount:100,availableBefore:210,officialTransferConfirmed:false}));
 assert.match(confirmedWithdrawal({amount:100,availableBefore:210,officialTransferConfirmed:true}).text,/110 Stars/);
});
test('history presents bounded sales/refund/withdrawal and back only',()=>{
 const panel=salesHistoryPanel([
  {type:'sale',stars:300},{type:'refund',stars:100},{type:'withdrawal',stars:50}
 ],12);
 assert.match(panel.text,/売上：\+300/);
 assert.match(panel.text,/返金：−100/);
 assert.match(panel.text,/引き出し：−50/);
 assert.equal(panel.reply_markup.inline_keyboard[0][0].callback_data,'sales:back|r12');
 assert.throws(()=>salesHistoryPanel([{type:'sale',stars:-1}],1),/invalid/);
});

test('verified gross vs refund-adjusted Stars discloses management 30% and creator 70%',()=>{
 const panel=salesOverviewPanel({
   grossStars:400,netRecordedStars:300,
   managementFeeTenths:900,creatorShareTenths:2100,payoutReady:false
 },6);
 assert.match(panel.text,/累計売上：400 Stars/);
 assert.match(panel.text,/返金控除後売上：300 Stars/);
 assert.match(panel.text,/運営管理費（30%）：90 Stars/);
 assert.match(panel.text,/投稿者分（70%）：210 Stars/);
 assert.match(panel.text,/引き出し可能：未確認/);
 assert.deepEqual(panel.reply_markup.inline_keyboard.map(r=>r.length),[2,1]);
 assert.throws(()=>salesOverviewPanel({
   grossStars:300,netRecordedStars:300,managementFeeTenths:999,payoutReady:false
 },6),/fee split mismatch/);
});
test('refund events reverse both accounting shares, no second management fee on withdrawal',()=>{
 const panel=salesHistoryPanel([
  {type:'sale',stars:300},{type:'refund',stars:100},
  {type:'withdrawal',stars:10}
 ],3);
 assert.match(panel.text,/売上：\+300 Stars（管理費30% 90 \/ 投稿者分70% 210/);
 assert.match(panel.text,/返金：−100 Stars（管理費戻し30% 30 \/ 投稿者戻し70% 70/);
 assert.match(panel.text,/引き出し：−10 Stars/);
 assert.equal(panel.text.includes('引き出し：−10 Stars（管理費'),false);
});
