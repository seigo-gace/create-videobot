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
  assert.match(view.text,/数字のみ（1〜25000）/);
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

test('My Videos displays ten owner-only inline edit links and back/new row',()=>{
 const owned=Array.from({length:12},(_,i)=>({id:'vid'+i,sellerId:'seller1',title:'動画'+i,priceStars:300}));
 const listings=[{id:'other',sellerId:'seller2',title:'他人',priceStars:500},...owned];
 const first=myVideosPanel({sellerId:'seller1',listings,page:0,revision:5});
 assert.equal(first.entities.length,10);
 assert.match(first.text,/［編集］🆕動画0/);
 assert.equal(first.text.includes('他人'),false);
 assert.deepEqual(first.reply_markup.inline_keyboard[0].map(b=>b.text),['🔙 戻る','🆕 新規投稿']);
 assert.equal(first.reply_markup.inline_keyboard[1][0].text,'次へ ▶');
 const second=myVideosPanel({sellerId:'seller1',listings,page:1,revision:6});
 assert.equal(second.entities.length,2);
 assert.equal(second.reply_markup.inline_keyboard[1][0].text,'◀ 前へ');
 const empty=myVideosPanel({sellerId:'seller1',listings:[],revision:1});
 assert.match(empty.text,/現在動画は未登録です/);
 assert.throws(()=>myVideosPanel({sellerId:'seller1',listings,page:2}),/page outside/);
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

test('seller consent is explicit, reversible and reset when video changes',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main001'}});
 assert.equal(d.feeTermsAccepted,false);
 d=editCreatorDraft(d,{type:'confirmTerms'});
 assert.deepEqual([d.rightsVerified,d.adultConsentVerified,d.feeTermsAccepted],[true,true,true]);
 let panel=creatorReviewPanel(d,5);
 assert.match(panel.text,/同意済み/);
 assert.equal(panel.reply_markup.inline_keyboard[0][0].callback_data,'review:agree|r5');
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main002'}});
 assert.deepEqual([d.rightsVerified,d.adultConsentVerified,d.feeTermsAccepted],[false,false,false]);
 panel=creatorReviewPanel(d,6);
 assert.match(panel.text,/出演者全員が18歳以上/);
});

test('preview uses inline edit links and fee disclosure, review gates publication on consent',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 d=editCreatorDraft(d,{type:'captionTitle',text:'テストタイトル'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'vid001'}});
 const editor=creatorEditorPanel(d,2);
 assert.match(editor.text,/管理費90 Stars／投稿者分210 Stars/);
 assert.equal(editor.entities.length,6);
 assert.deepEqual(editor.reply_markup.inline_keyboard[0].map(b=>b.text),['✅ 投稿する','❌ キャンセル']);
 assert.match(editor.text,/説明:\[未登録\]/);
 const review=creatorReviewPanel(d,3);
 assert.match(review.text,/30%/);
 assert.equal(review.reply_markup.inline_keyboard.flat().some(b=>b.callback_data.startsWith('review:publish')),false);
 assert.match(review.text,/原則として返金を行いません/);
 d=editCreatorDraft(d,{type:'confirmTerms'});
 const ready=creatorReviewPanel(d,4);
 assert.equal(ready.reply_markup.inline_keyboard.flat().some(b=>b.callback_data.startsWith('review:publish')),false,
   'missing thumbnail/sample block publication even if consent granted');
 const existing=openCreatorEditor({sellerId:'seller1',existing:{
   id:'abc123',sellerId:'seller1',revision:1,title:'sample',priceStars:101,
   paidVideo:{fileId:'file111'},rightsVerified:true,adultConsentVerified:true,feeTermsAccepted:true
 }});
 assert.match(creatorEditorPanel(existing).text,/☑ 規約約款同意済み/);
 assert.equal(editCreatorDraft(existing,{type:'preset',stars:100}).feeTermsAccepted,false);
});

test('video-caption title is accepted atomically without custom-price title parsing',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'custom'});
 d=editCreatorDraft(d,{type:'captionTitle',text:'キャプション題名'});
 assert.equal(d.title,'キャプション題名');
 assert.throws(()=>editCreatorDraft(d,{type:'captionTitle',text:'複数\n行'}),/one line/);
 const pricePanel=creatorEditorPanel(d,5,'price');
 assert.deepEqual(pricePanel.reply_markup.inline_keyboard[2].map(b=>b.text),['🔙 戻る']);
});

test('first video opens inline preview with six edit links and no extra description screen',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 const initial=creatorEditorPanel(d,1,'await_video');
 assert.match(initial.text,/タイトルと動画を投稿してください/);
 assert.equal(initial.entities,undefined);
 d=editCreatorDraft(d,{type:'captionTitle',text:'作品タイトル'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'file_123'}});
 d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb123'}});
 d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample123',durationSeconds:30}});
 const final=creatorEditorPanel(d,3,'editor');
 assert.match(final.text,/［編集］タイトル：作品タイトル/);
 assert.match(final.text,/説明:\[未登録\]/);
 assert.match(final.text,/［編集］価格：未設定/);
 assert.deepEqual(final.reply_markup.inline_keyboard[0].map(b=>b.text),['✅ 投稿する','❌ キャンセル']);
 assert.equal(final.entities.length,6);
 for(const e of final.entities)
   assert.match(final.text.slice(e.offset,e.offset+e.length),/編集|未登録/);
 d=editCreatorDraft(d,{type:'descriptionInput',text:'説明本文'});
 assert.match(creatorEditorPanel(d,4).text,/［編集］説明：説明本文/);
 assert.throws(()=>editCreatorDraft(d,{type:'descriptionInput',text:'x'.repeat(801)}),/description/);
});

test('terms summary has checkbox and only reveals publish after all content and explicit agreement',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'captionTitle',text:'作品'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main11'}});
 d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb11'}});
 d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample11',durationSeconds:30}});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 const before=creatorReviewPanel(d,2);
 assert.equal(before.reply_markup.inline_keyboard.flat().some(b=>b.text==='✅ 投稿する'),false);
 d=editCreatorDraft(d,{type:'confirmTerms'});
 const after=creatorReviewPanel(d,3);
 assert.equal(after.reply_markup.inline_keyboard.flat().some(b=>b.text==='✅ 投稿する'),true);
 assert.match(after.text,/☑ 規約・約款に同意済み/);
});
