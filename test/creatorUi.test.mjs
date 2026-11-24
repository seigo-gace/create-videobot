import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openCreatorEditor, editCreatorDraft, creatorEditorPanel, myVideosPanel,
  validateWithdrawalText, withdrawalPrompt, confirmedWithdrawal, WithdrawalInputError, creatorReviewPanel, creatorFieldPanel
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
  const view=creatorFieldPanel(d,'price',1);
  assert.match(view.text,/1〜25000/);
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

test('sample media must be verified <=60.1 seconds before being accepted by creator editor', () => {
  let d = openCreatorEditor({ sellerId:'seller1' });
  assert.throws(() => editCreatorDraft(d,{type:'sample',media:{fileId:'file001',durationSeconds:60.2}}), /verified/);
  d = editCreatorDraft(d,{type:'sample',media:{fileId:'file001',durationSeconds:30}});
  assert.equal(d.sample.durationSeconds,30);
  d = editCreatorDraft(d,{type:'removeSample'});
  assert.equal(d.sample,null);
});

test('My Videos displays ten owner-only inline edit links and back/new row',()=>{
 const owned=Array.from({length:12},(_,i)=>({id:'vid'+i,sellerId:'seller1',title:'動画'+i,priceStars:300}));
 const listings=[{id:'other',sellerId:'seller2',title:'他人',priceStars:500},...owned];
 const first=myVideosPanel({sellerId:'seller1',listings,page:0,revision:5});
 assert.equal(first.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data.startsWith('video:edit:')).length,10);
 assert.equal(first.entities,undefined);
 assert.match(first.text,/［編集］🆕動画0/);
 const changed=myVideosPanel({sellerId:'seller1',listings,page:0,revision:5,
   notice:'動画を編集／更新しました。',updatedId:'vid1'});
 assert.match(changed.text,/［編集］📝 動画1/);
 assert.match(changed.text,/動画を編集／更新しました/);
 assert.equal(first.text.includes('他人'),false);
 assert.deepEqual(first.reply_markup.inline_keyboard.at(-2).map(b=>b.text),['🔙 戻る','🆕 新規投稿']);
 assert.equal(first.reply_markup.inline_keyboard.at(-1)[0].text,'次へ ▶');
 const second=myVideosPanel({sellerId:'seller1',listings,page:1,revision:6});
 assert.equal(second.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data.startsWith('video:edit:')).length,2);
 assert.equal(second.reply_markup.inline_keyboard.at(-1)[0].text,'◀ 前へ');
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
 d={...d,termsUrl:'https://example.test/terms.html'};
 assert.deepEqual([d.rightsVerified,d.adultConsentVerified,d.feeTermsAccepted],[true,true,true]);
 let panel=creatorReviewPanel(d,5,'','https://example.test/terms.html');
 assert.match(panel.text,/同意済み/);
 assert.equal(panel.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:agree')),false,'incomplete content cannot be submitted');
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main002'}});
 assert.deepEqual([d.rightsVerified,d.adultConsentVerified,d.feeTermsAccepted],[false,false,false]);
 panel=creatorReviewPanel(d,6,'','https://example.test/terms.html');
 assert.match(panel.text,/出演者の年齢と必要な同意/);
});

test('preview has only inline edit links; fees appear only in consent review',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 d=editCreatorDraft(d,{type:'captionTitle',text:'テストタイトル'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'vid001'}});
 const editor=creatorEditorPanel(d,2);
 assert.equal(editor.text.includes('管理費'),false);
 assert.equal(editor.entities,undefined);
 assert.equal(editor.reply_markup.inline_keyboard.flat().filter(b=>/^edit:(title|description|price|thumbnail|sample|paidVideo)\|r/.test(b.callback_data)).length,6);
 assert.deepEqual(editor.reply_markup.inline_keyboard.at(-1).map(b=>b.text),['✅ 投稿する','❌ キャンセル']);
 assert.match(editor.text,/［未登録］ 説明：/);
 const review=creatorReviewPanel(d,3,'','https://example.test/terms.html');
 assert.match(review.text,/30%/);
 assert.match(review.text,/管理費90 Stars／投稿者分210 Stars/);
 assert.equal(review.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:publish')),false);
 assert.match(review.text,/購入者都合の通常返金はありません/);
 d=editCreatorDraft(d,{type:'confirmTerms'});
 d={...d,termsUrl:'https://example.test/terms.html'};
 const ready=creatorReviewPanel(d,4,'','https://example.test/terms.html');
 assert.equal(ready.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:publish')),false,
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
 const pricePanel=creatorFieldPanel(d,'price',5);
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
 assert.match(final.text,/［編集］ タイトル：作品タイトル/);
 assert.match(final.text,/［未登録］ 説明：/);
 assert.match(final.text,/［未登録］ 価格：/);
 assert.deepEqual(final.reply_markup.inline_keyboard.at(-1).map(b=>b.text),['✅ 投稿する','❌ キャンセル']);
 assert.equal(final.entities,undefined);
 assert.ok(final.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='edit:sample|r3'));
 assert.ok(final.reply_markup.inline_keyboard.flat().every(b=>!b.url));
 d=editCreatorDraft(d,{type:'descriptionInput',text:'説明本文'});
 assert.match(creatorEditorPanel(d,4).text,/［編集］ 説明：説明本文/);
 assert.throws(()=>editCreatorDraft(d,{type:'descriptionInput',text:'x'.repeat(801)}),/description/);
});

test('terms summary offers one final consent action only when content is complete',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'captionTitle',text:'作品'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main11'}});
 d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb11',secondFileId:'thumb12'}});
 d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample11',durationSeconds:30}});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 const before=creatorReviewPanel(d,2,'','https://example.test/terms.html');
 assert.deepEqual(before.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data?.startsWith('review:agree')).map(b=>b.text),['✅ 同意して登録する']);
 assert.equal(before.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:publish')),false);
 d=editCreatorDraft(d,{type:'confirmTerms'});
 d={...d,termsUrl:'https://example.test/terms.html'};
 const after=creatorReviewPanel(d,3,'','https://example.test/terms.html');
 assert.deepEqual(after.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data?.startsWith('review:agree')).map(b=>b.text),['✅ 同意して登録を再試行']);
 assert.equal(after.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('review:publish')),false);
 assert.match(after.text,/☑ 同意済み/);
});

test('field editor isolates one requested item and shows only back/delete actions',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'titleInput',text:'サンプル作品'});
 d=editCreatorDraft(d,{type:'descriptionInput',text:'紹介文'});
 const titlePanel=creatorFieldPanel(d,'title',7);
 assert.match(titlePanel.text,/タイトル：サンプル作品/);
 assert.equal(titlePanel.text.includes('説明：'),false);
 assert.equal(titlePanel.text.includes('管理費'),false);
 assert.deepEqual(titlePanel.reply_markup.inline_keyboard[0].map(b=>b.text),['🔙 戻る','🗑 削除']);
 const description=creatorFieldPanel(d,'description',8);
 assert.deepEqual(description.reply_markup.inline_keyboard[0].map(b=>b.text),['🔙 戻る','🗑 削除']);
});
test('shared preview guide follows create/edit mode and preserves action buttons and link ranges',()=>{
 let fresh=openCreatorEditor({sellerId:'seller1'});
 fresh=editCreatorDraft(fresh,{type:'captionTitle',text:'作品'});
 fresh=editCreatorDraft(fresh,{type:'paidVideo',media:{fileId:'video123'}});
 const newPanel=creatorEditorPanel(fresh,3);
 assert.match(newPanel.text,/📝 登録方法\n下の［編集］ボタンから変更したい項目を選べます。\n内容を確認したら［投稿する］をタップして登録手続きに進んでください。/);
 assert.doesNotMatch(newPanel.text,/販売手数料|管理費30%|投稿者の取り分/);
 assert.match(newPanel.text,/［未登録］ 説明：/);
 assert.ok(newPanel.text.indexOf('📝 登録方法')>newPanel.text.indexOf('有料本編：'));
 assert.doesNotMatch(newPanel.text,/販売手数料|管理費|投稿者の取り分|30%|70%|出金|払出|引き出し可能/);
 assert.equal(newPanel.entities,undefined);
 assert.deepEqual(newPanel.reply_markup.inline_keyboard.at(-1).map(b=>b.text),['✅ 投稿する','❌ キャンセル']);
 assert.ok(newPanel.reply_markup.inline_keyboard.flat().every(b=>!b.url));
 const existing=openCreatorEditor({sellerId:'seller1',existing:{
   id:'mine_1',sellerId:'seller1',revision:2,title:'既存作品',paidVideo:{fileId:'main123'}
 }});
 const unchanged=creatorEditorPanel(existing,4);
 assert.match(unchanged.text,/📝 編集方法\n下の［編集］ボタンから変更したい項目を選んでください。\n変更が終わったら［変更］をタップしてください。/);
 assert.doesNotMatch(unchanged.text,/📝 登録方法|登録手続き|［投稿する］/);
 assert.ok(unchanged.text.indexOf('📝 編集方法')>unchanged.text.indexOf('有料本編：'));
 assert.doesNotMatch(unchanged.text,/販売手数料|管理費|投稿者の取り分|30%|70%|出金|払出|引き出し可能/);
 assert.equal(unchanged.entities,undefined);
 assert.deepEqual(unchanged.reply_markup.inline_keyboard.at(-1).map(b=>b.text),['🔙 戻る','✅ 変更','❌ キャンセル','🗑 削除']);
 const modified=creatorEditorPanel(editCreatorDraft(existing,{type:'titleInput',text:'変更後'}),5);
 assert.deepEqual(modified.reply_markup.inline_keyboard.at(-1).map(b=>b.text),['✅ 変更','❌ キャンセル','🗑 削除']);
 assert.ok(modified.reply_markup.inline_keyboard.flat().every(b=>!b.url));
});

test('registered video editor uses four actions, return only when unchanged and never shows publish',()=>{
 const existing={id:'mine_1',sellerId:'seller1',revision:2,title:'作品',paidVideo:{fileId:'main123'}};
 const original=openCreatorEditor({sellerId:'seller1',existing});
 assert.deepEqual(creatorEditorPanel(original,2).reply_markup.inline_keyboard.at(-1).map(b=>b.text),
 ['🔙 戻る','✅ 変更','❌ キャンセル','🗑 削除']);
 const changed=editCreatorDraft(original,{type:'titleInput',text:'改題'});
 assert.deepEqual(creatorEditorPanel(changed,3).reply_markup.inline_keyboard.at(-1).map(b=>b.text),
 ['✅ 変更','❌ キャンセル','🗑 削除']);
});

test('clearing title or price is reversible in an edit draft but cannot authorize publication',()=>{
 const owned={id:'mine1',sellerId:'seller1',revision:2,title:'元タイトル',priceStars:300,
   paidVideo:{fileId:'video001'}};
 const original=openCreatorEditor({sellerId:'seller1',existing:owned});
 const noTitle=editCreatorDraft(original,{type:'clearTitle'});
 assert.equal(noTitle.title,'');
 assert.equal(original.title,'元タイトル');
 assert.ok(creatorEditorPanel(noTitle,3).text.includes('［未登録］ タイトル：'));
 const noPrice=editCreatorDraft(original,{type:'clearPrice'});
 assert.equal(noPrice.priceStars,null);
 assert.equal(original.priceStars,300);
});

test('missing Cloudflare legal-page URL cannot offer consent or Stars publish',()=>{
 let draft=openCreatorEditor({sellerId:'seller1'});
 draft=editCreatorDraft(draft,{type:'captionTitle',text:'作品'});
 draft=editCreatorDraft(draft,{type:'paidVideo',media:{fileId:'main001'}});
 draft=editCreatorDraft(draft,{type:'thumbnail',media:{fileId:'photo001'}});
 draft=editCreatorDraft(draft,{type:'sample',media:{fileId:'sample001',durationSeconds:30}});
 draft=editCreatorDraft(draft,{type:'preset',stars:300});
 draft=editCreatorDraft(draft,{type:'confirmTerms'});
 const unavailable=creatorReviewPanel(draft,8);
 assert.match(unavailable.text,/規約本文の公開先が未確認/);
 assert.ok(unavailable.reply_markup.inline_keyboard.flat().every(b=>
   !String(b.callback_data||'').startsWith('review:agree') &&
   !String(b.callback_data||'').startsWith('review:publish')));
 const available=creatorReviewPanel(draft,9,'','https://example.test/createvdobot-terms.html');
 assert.equal(available.reply_markup.inline_keyboard[0][0].url,
   'https://example.test/createvdobot-terms.html');
 assert.match(available.text,/投稿者は自らの責任で作品を公開/);
});

test('a changed legal page is not treated as previously accepted by the preview',()=>{
 let d=openCreatorEditor({sellerId:'seller1'});
 d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main001'}});
 d=editCreatorDraft(d,{type:'captionTitle',text:'タイトル'});
 d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb001'}});
 d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample001',durationSeconds:30}});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 d=editCreatorDraft(d,{type:'confirmTerms'});
 d=editCreatorDraft(d,{type:'captionTitle',text:'作品'});
 d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb01',secondFileId:'thumb02'}});
 d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample01',durationSeconds:30}});
 d=editCreatorDraft(d,{type:'preset',stars:300});
 d=editCreatorDraft(d,{type:'confirmTerms'});
 d={...d,termsUrl:'https://example.test/old-terms.html'};
 const p=creatorReviewPanel(d,8,'','https://example.test/new-terms.html');
 assert.ok(p.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='review:agree|r8'));
 assert.ok(p.reply_markup.inline_keyboard.flat().every(b=>b.callback_data!=='review:publish|r8'));
 assert.match(p.text,/同意ボタンを押すと登録手続きが開始/);
});

test('published buyer-protected videos retain their editor entrance',()=>{
 const panel=myVideosPanel({sellerId:'seller1',revision:7,listings:[
  {id:'preserved_paid',sellerId:'seller1',title:'購入済みの動画',status:'published'},
  {id:'editable_draft',sellerId:'seller1',title:'下書き',status:'draft'}
 ]});
 assert.match(panel.text,/🎬 購入済みの動画/);
 assert.match(panel.text,/［編集］🎬/);
 assert.match(panel.text,/［編集］🆕下書き/);
 assert.equal(panel.entities,undefined);
 assert.ok(panel.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='video:edit:preserved_paid|r7'));
 assert.ok(panel.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='video:edit:editable_draft|r7'));
 assert.equal(panel.reply_markup.inline_keyboard.at(-1)[1].callback_data,'menu:listing');
});

 test('sample duration label reflects stored duration, never a fixed thirty seconds',()=>{
  let draft=openCreatorEditor({sellerId:'seller1'});
  draft=editCreatorDraft(draft,{type:'paidVideo',media:{fileId:'main001'}});
  for(const durationSeconds of [60,30,12.5]){
    const updated=editCreatorDraft(draft,{type:'sample',media:{fileId:'sample001',durationSeconds}});
    const expected='サンプル：登録済み（'+durationSeconds+'秒）';
    assert.ok(creatorEditorPanel(updated,2).text.includes(expected));
    assert.ok(creatorFieldPanel(updated,'sample',3).text.includes(expected));
  }
  assert.match(creatorFieldPanel(draft,'sample',4).text,/サンプル：未登録/);
 });
 test('consent screen has one submit action and no revoke or second submit',()=>{
  let d=openCreatorEditor({sellerId:'seller1'});
  d=editCreatorDraft(d,{type:'captionTitle',text:'Test'});
  d=editCreatorDraft(d,{type:'paidVideo',media:{fileId:'main001'}});
  d=editCreatorDraft(d,{type:'thumbnail',media:{fileId:'thumb001',secondFileId:'thumb002'}});
  d=editCreatorDraft(d,{type:'sample',media:{fileId:'sample001',durationSeconds:60}});
  d=editCreatorDraft(d,{type:'preset',stars:300});
  const url='https://example.test/terms.html';
  for(const draft of [d,{...editCreatorDraft(d,{type:'confirmTerms'}),termsUrl:url}]){
    const p=creatorReviewPanel(draft,3,'',url);
    const keys=p.reply_markup.inline_keyboard.flat();
    assert.equal(keys.filter(b=>b.callback_data?.startsWith('review:agree|')).length,1);
    assert.ok(keys.every(b=>!b.text.includes('取り消す')&&!b.callback_data?.startsWith('review:publish')));
  }
 });
