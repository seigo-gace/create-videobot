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

test('preset price requires one line title and custom uses one Telegram message with two lines', () => {
  let d = openCreatorEditor({ sellerId:'seller1' });
  d = editCreatorDraft(d, { type:'preset', stars:300 });
  d = editCreatorDraft(d, { type:'titleInput', text:'夏の思い出動画' });
  assert.equal(d.title,'夏の思い出動画');
  assert.equal(d.priceStars,300);
  d = editCreatorDraft(d, { type:'custom' });
  const view = creatorEditorPanel(d);
  assert.match(view.text, /改行して2行目/);
  assert.equal(view.reply_markup.inline_keyboard[3].length,3);
  d = editCreatorDraft(d, { type:'titleInput', text:'新しい動画\n250' });
  assert.equal(d.priceStars,250);
  assert.equal(d.title,'新しい動画');
  assert.throws(() => editCreatorDraft(d,{type:'titleInput',text:'タイトルだけ'}), /first line/);
  assert.throws(() => editCreatorDraft(d,{type:'titleInput',text:'タイトル\n2.5'}), /numeric Stars/);
  assert.throws(() => editCreatorDraft(d,{type:'titleInput',text:'タイトル\n25001'}), /25000/);
  assert.throws(() => editCreatorDraft(d,{type:'preset',stars:99}), /unknown/);
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
 assert.equal(editor.reply_markup.inline_keyboard.length,5);
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
