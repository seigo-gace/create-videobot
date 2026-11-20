import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresUnifiedStarsSales,CREATOR_STARS_EVENTS_SQL} from '../src/sales/pgUnifiedStarsSales.mjs';
import {salesOverviewPanel,salesHistoryPanel,salesWithdrawalPanel} from '../src/telegram/salesPanel.mjs';

function fixture({summary,history}={}){
 const calls=[];
 const data=summary??{gross_stars:'400',net_stars:'300',video_gross_stars:'300',
  sticker_gross_stars:'100',fees_valid:true};
 const events=history??[
  {source:'sticker_paid_photo',type:'sale',stars:50,fee_ok:true},
  {source:'sticker_pack',type:'refund',stars:50,fee_ok:true},
  {source:'sticker_pack',type:'sale',stars:50,fee_ok:true},
  {source:'video',type:'refund',stars:50,fee_ok:true},
  {source:'video',type:'sale',stars:300,fee_ok:true}
 ];
 const pool={async query(sql,args){
  calls.push({sql,args});
  if(!sql.startsWith('WITH events AS ('))throw Error('unapproved accounting SQL');
  if(sql.includes('BOOL_AND(COALESCE(fee_ok,FALSE))'))return {rows:[data]};
  if(sql.includes('ORDER BY happened_at DESC'))return {rows:events};
  throw Error('unrecognized accounting projection');
 }};
 return {store:createPostgresUnifiedStarsSales({pool}),calls};
}

test('common seller sums video paid/refunds and sticker invoice/PaidPhoto with exact 30/70',async()=>{
 const x=fixture();
 const summary=await x.store.getSummary(44);
 assert.deepEqual(summary,{grossStars:400,netRecordedStars:300,
   videoGrossStars:300,stickerGrossStars:100,
   managementFeeTenths:900,creatorShareTenths:2100,payoutReady:false});
 const panel=salesOverviewPanel(summary,3);
 assert.match(panel.text,/累計売上：400 Stars/);
 assert.match(panel.text,/動画売上：300 Stars/);
 assert.match(panel.text,/ステッカー・絵文字売上：100 Stars/);
 assert.match(panel.text,/投稿者分（70%）：210 Stars/);
 assert.match(panel.text,/引き出し可能：未確認/);
 assert.match(salesWithdrawalPanel(summary,4).text,/利用できません/);
 assert.equal(x.calls[0].args[0],44);
 assert.equal(x.calls[0].sql.includes('INSERT '),false);
});

test('each purchase protocol retains its own charge row; the single sale view is owner-scoped',()=>{
 const sql=CREATOR_STARS_EVENTS_SQL;
 for(const table of ['videobot_stars_ledger','videobot_sticker_orders',
  'videobot_sticker_paid_photo_sales','videobot_sticker_products','videobot_sticker_refunds'])
   assert.ok(sql.includes(table),table);
 assert.match(sql,/UNION ALL/);
 assert.match(sql,/l.seller_user_id=\$1/);
 assert.match(sql,/p.seller_user_id=\$1/g);
 assert.match(sql,/o.invoice_state='paid'/);
 assert.match(sql,/o.telegram_payment_charge_id IS NOT NULL/);
 assert.match(sql,/s.fee_policy_id='sticker-admin-30-20261113'/);
 assert.equal(sql.includes('UPDATE '),false);
});

test('combined sales history labels video, sticker pack and sticker photo without changing buttons',async()=>{
 const x=fixture();
 const rows=await x.store.getHistory(44);
 assert.deepEqual(rows.map(r=>r.source),
  ['sticker_paid_photo','sticker_pack','sticker_pack','video','video']);
 const panel=salesHistoryPanel(rows,5);
 assert.match(panel.text,/〔🎨 ステッカー写真ロック〕/);
 assert.match(panel.text,/〔🎨 ステッカー・絵文字〕/);
 assert.match(panel.text,/〔🎬 動画〕/);
 assert.match(panel.text,/公式決済取消：−50 Stars/);
 assert.match(panel.text,/返金：−50 Stars.*〔🎨 ステッカー・絵文字〕/);
 assert.equal(panel.reply_markup.inline_keyboard.length,1);
 assert.equal(panel.reply_markup.inline_keyboard[0][0].callback_data,'sales:back|r5');
});

test('no sale is not a withdrawable seller balance',async()=>{
 const x=fixture({summary:{gross_stars:'0',net_stars:'0',video_gross_stars:'0',
  sticker_gross_stars:'0',fees_valid:true},history:[]});
 const result=await x.store.getSummary(1);
 assert.equal(result.creatorShareTenths,0);
 assert.equal(result.payoutReady,false);
 assert.deepEqual(await x.store.getHistory(1),[]);
});

test('unconsented legacy rows, malformed counters and unjustified refund sums fail closed',async()=>{
 const badFee=fixture({summary:{gross_stars:'300',net_stars:'300',
  video_gross_stars:'300',sticker_gross_stars:'0',fees_valid:false}});
 await assert.rejects(()=>badFee.store.getSummary(44),/fee agreement/);
 const badTotals=fixture({summary:{gross_stars:'400',net_stars:'400',
  video_gross_stars:'300',sticker_gross_stars:'99',fees_valid:true}});
 await assert.rejects(()=>badTotals.store.getSummary(44),/mismatch/);
 const badRefund=fixture({summary:{gross_stars:'300',net_stars:'-1',
  video_gross_stars:'300',sticker_gross_stars:'0',fees_valid:true}});
 await assert.rejects(()=>badRefund.store.getSummary(44),/amount invalid/);
 const badEvent=fixture({history:[{source:'sticker_pack',type:'invalid',
  stars:50,fee_ok:true}]});
 await assert.rejects(()=>badEvent.store.getHistory(44),/history event invalid/);
 await assert.rejects(()=>fixture().store.getSummary(0),/seller/);
 await assert.rejects(()=>fixture().store.getHistory(-7),/seller/);
 assert.throws(()=>createPostgresUnifiedStarsSales(),/pool required/);
});
