import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openCreatorEditor, editCreatorDraft, creatorEditorPanel, myVideosPanel,
  validateWithdrawalText, withdrawalPrompt, confirmedWithdrawal, WithdrawalInputError, creatorReviewPanel
} from '../src/telegram/creatorUi.mjs';

test('new and existing listing share field editor, edit protects existing fields', () => {
  const existing = {
    id:'listing1', sellerId:'seller1', revision:3, title:'元のタイトル', priceStars:300,
    paidVideo:{fileId:'main_001'}, thumbnail:{fileId:'photo_001'}, sample:{fileId:'sample_001',durationSeconds:25}
  };
  const current = openCreatorEditor({ sellerId:'seller1', existing });
  assert.equal(current.mode,'edit');
  assert.equal(current.listingId,'listing1');
  const changed = editCreatorDraft(current, { type:'thumbnail', media:{fileId:'photo_002'} });
  assert.deepEqual(changed.dirtyFields,['thumbnail']);
  assert.deepEqual(changed.sample,existing.sample);
  assert.deepEqual(changed.paidVideo,existing.paidVideo);
  assert.equal(existing.thumbnail.fileId,'photo_001');
  assert.throws(() => openCreatorEditor({ sellerId:'other1', existing }), /ownership/);
});

test('sticker and video use numeric-only custom Stars price without changing title', () => {
  let d = openCreatorEditor({ sellerId:'seller1' });
  d = editCreatorDraft(d,{type:'preset',stars:300});
  d = editCreatorDraft(d,{type:'captionTitle',text:'夏の思い出動画'});
  d = editCreatorDraft(d,{type:'custom'});
  const view=creatorEditorPanel(d,1,'price');
  assert.match(view.text,/1〜25000 Starsの整数/);
  assert.equal(view.reply_markup.inline_keyboard[1].length,3);
  d=editCreatorDraft(d,{type:'customPriceInput',text:'250'});
  assert.equal(d.title,'夏の思い出動画');
  assert.equal(d.priceStars,250);
  assert.equal(d.priceMode,'custom');
  assert.throws(()=>editCreatorDraft(d,{type:'customPriceInput',text:'タイトル\\n251'}),/integer/);
  for(const invalid of ['0','2.5','-1','25001','001','abc','']) {
    assert.throws(()=>editCreatorDraft(d,{type:'customPriceInput',text:invalid}),/integer/);
  }
  d=editCreatorDraft(d,{type:'titleInput',text:'改訂タイトル'});
  assert.equal(d.priceStars,250);
  assert.equal(d.title,'改訂タイトル');
  assert.throws(()=>editCreatorDraft(d,{type:'preset',stars:99}),/unknown/);
});

test('sample media must be verified <=30 seconds before being accepted by creator editor', () => {
  let d = openCreatorEditor({ sellerId:'seller1' });
  assert.throws(() => editCreatorDraft(d,{type:'sample',media:{fileId:'file001',durationSeconds:30.1}}), /verified/);
  d = editCreatorDraft(d,{type:'sample',media:{fileId:'file001',durationSeconds:30}});
  assert.equal(d.sample.durationSeconds,30);
  d = editCreatorDraft(d,{type:'removeSample'});
  assert.equal(d.sample,null);
});

test('my videos: exactly 10 per page, sticker-style compact owner rows', () => {
  const owned = Array.from({length:12},(_,i)=>({ id:'vid'+i, sellerId:'seller1', title:'動画'+i, priceStars:300 }));
  const listings = [{id:'other',sellerId:'seller2',title:'他人',priceStars:500}, ...owned];
  const first = myVideosPanel({sellerId:'seller1',listings,page:0});
  assert.equal(first.reply_markup.inline_keyboard.length,13);
  assert.equal(first.reply_markup.inline_keyboard[0].length,3);
  assert.equal(first.reply_markup.inline_keyboard[1].length,3);
  assert.equal(first.reply_markup.inline_keyboard[10][0].callback_data,'menu:listing');
  assert.deepEqual(first.reply_markup.inline_keyboard[11].map(x=>x.text),['次へ ▶']);
  const second = myVideosPanel({sellerId:'seller1',listings,page:1});
  assert.equal(second.reply_markup.inline_keyboard.length,5);
  assert.deepEqual(second.reply_markup.inline_keyboard[3].map(x=>x.text),['◀ 前へ']);
  assert.throws(()=>myVideosPanel({sellerId:'seller1',listings,page:2}),/page outside/);
  assert.equal(first.text.includes('他人'),false);
});

test('withdrawal text uses Telegram chat input, shows deficits, never transfers itself', () => {
  const view = withdrawalPrompt(210);
  assert.equal(view.reply_markup.inline_keyboard.length,1);
  assert.equal(view.reply_markup.inline_keyboard[0][0].callback_data,'menu:sales');
  assert.equal(validateWithdrawalText('100',210),100);
  for (const value of ['abc','2.5','-1','0','9999999999999999999999']) {
    assert.throws(()=>validateWithdrawalText(value,210),WithdrawalInputError);
  }
  assert.throws(()=>validateWithdrawalText('3',0),x=>x.code==='NO_BALANCE');
  assert.throws(()=>validateWithdrawalText('300',210),x=>x.code==='INSUFFICIENT'&&x.message.includes('90 Stars'));
  assert.throws(()=>confirmedWithdrawal({amount:100,availableBefore:210,officialTransferConfirmed:false}),/not confirmed/);
  assert.match(confirmedWithdrawal({amount:100,availableBefore:210,officialTransferConfirmed:true}).text,/110 Stars/);
});

test('rights confirmation is per-video; replacement invalidates previous consent',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main001'}});
 assert.throws(()=>editCreatorDraft(d,{type:'confirmRights',rightsVerified:false,adultConsentVerified:true}),/rights/);
 d=editCreatorDraft(d,{type:'confirmRights',rightsVerified:true,adultConsentVerified:true});
 assert.equal(d.rightsVerified,true);
 assert.equal(d.adultConsentVerified,true);
 let panel=creatorReviewPanel(d,5);
 assert.match(panel.text,/未登録/);
 assert.equal(panel.reply_markup.inline_keyboard[1].length,3);
 assert.equal(panel.reply_markup.inline_keyboard[0][0].callback_data,'review:rights|r5');
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main002'}});
 assert.equal(d.rightsVerified,false);
 assert.equal(d.adultConsentVerified,false);
 panel=creatorReviewPanel(d,6);
 assert.match(panel.text,/出演者全員の成人/);
});

test('new/edit and review all disclose 30 percent management fee without adding buttons',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 const editor=creatorEditorPanel(d,2);
 assert.match(editor.text,/管理費90 Stars／投稿者分210 Stars/);
 assert.match(editor.text,/30%/);
 assert.equal(editor.reply_markup.inline_keyboard.length,3);
 assert.equal(editor.reply_markup.inline_keyboard[0][0].text,'🎬 本編を登録');
 assert.equal(editor.reply_markup.inline_keyboard.flat().some(x=>x.text==='⭐ 価格を設定'),false,
   'the test already assigned price; do not re-offer registration');
 assert.ok(editor.reply_markup.inline_keyboard.flat().every(b=>!b.text.includes('編集')),
   'unpublished video cannot display edit controls');
 const review=creatorReviewPanel(d,3);
 assert.match(review.text,/管理費90 Stars／投稿者分210 Stars/);
 assert.match(review.text,/投稿する.*30%を運営管理費/);
 assert.equal(review.reply_markup.inline_keyboard.length,2);
 assert.equal(review.reply_markup.inline_keyboard[1].length,3);
 assert.match(myVideosPanel({sellerId:'seller1',listings:[]}).text,/管理費30%/);
 const existing=openCreatorEditor({sellerId:'seller1',existing:{
   id:'abc123',sellerId:'seller1',revision:1,title:'sample',priceStars:101,
   paidVideo:{fileId:'file111'},feeTermsAccepted:true
 }});
 assert.match(creatorEditorPanel(existing).text,/30.3 Stars／投稿者分70.7 Stars/);
 assert.equal(editCreatorDraft(existing,{type:'preset',stars:100}).feeTermsAccepted,false);
});

test('video-caption title is accepted atomically without custom-price title parsing',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'custom'});
 d=editCreatorDraft(d,{type:'captionTitle',text:'キャプション題名'});
 assert.equal(d.title,'キャプション題名');
 assert.throws(()=>editCreatorDraft(d,{type:'captionTitle',text:'複数\n行'}),/one line/);
 const pricePanel=creatorEditorPanel(d,5,'price');
 assert.deepEqual(pricePanel.reply_markup.inline_keyboard[2].map(b=>b.text),['🔙 登録画面へ戻る']);
});

test('new registration has no edit action; registered fields use working Telegram text links instead of buttons',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 const before=creatorEditorPanel(d,3);
 assert.doesNotMatch(before.text,/［編集］/);
 assert.equal(before.entities,undefined);
 assert.ok(before.reply_markup.inline_keyboard.flat().some(b=>b.text==='🎬 本編を登録'));
 d=editCreatorDraft(d,{type:'captionTitle',text:'サンプル'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'file_123'}});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 const after=creatorEditorPanel(d,4);
 assert.match(after.text,/［編集］ 📝 タイトル/);
 assert.match(after.text,/［編集］ 🎬 有料本編/);
 assert.match(after.text,/［編集］ ⭐ 価格/);
 assert.ok(after.reply_markup.inline_keyboard.flat().every(b=>!/編集/.test(b.text)));
 assert.equal(after.reply_markup.inline_keyboard.flat().some(b=>b.text==='🎬 本編を登録'),false);
 assert.equal(after.reply_markup.inline_keyboard.flat().some(b=>b.text==='⭐ 価格を設定'),false);
 assert.equal(after.entities.length,3);
 for(const e of after.entities) {
   assert.equal(after.text.slice(e.offset,e.offset+e.length),'［編集］');
   assert.match(e.url,/^https:\/\/t\.me\/CreateVdobot\?start=ved_(title|paidVideo|price)_r4$/);
 }
});
