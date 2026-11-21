(() => {
 'use strict';
 const app=window.Telegram?.WebApp;
 const $=id=>document.getElementById(id);
 const pid=new URLSearchParams(location.search).get('product');
 const initData=app?.initData;
 let catalog,loading=false,invoicePending=false,purchased=false;
 const notice=(value,error=false)=>{$('notice').textContent=value;$('notice').className=error?'error':'';};
 const progress=(value)=>{$('progress').textContent=value;};
 function invalid(){notice('CreateVdobotの「パックを見る」から開いてください。',true);}
 async function request(path,extra={}){
  const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},
   credentials:'same-origin',cache:'no-store',
   body:JSON.stringify({initData,productId:pid,...extra})});
  const json=await r.json();
  if(!r.ok)throw Error(json.error||'request_failed');
  return json;
 }
 async function refreshOwnership(){
  const result=await request('/api/status');
  if(result.purchased){
   purchased=true;invoicePending=false;
   $('buy').disabled=true;
   $('buy').textContent='購入済み ✓';
   progress('購入記録を確認しました。ステッカー素材はCreateVdobotのDMで受け取れます。');
   return true;
  }
  return false;
 }
 async function buy(){
  if(loading||invoicePending||purchased||!catalog||!$('consent').checked)return;
  loading=true;$('buy').disabled=true;progress('TelegramのStars購入画面を準備しています…');
  try{
   const result=await request('/api/invoice',{acceptTerms:true});
   if(result.purchased){await refreshOwnership();return;}
   if(typeof result.invoiceUrl!=='string'||!app?.openInvoice)throw Error('invoice_unavailable');
   invoicePending=true;
   app.openInvoice(result.invoiceUrl,async status=>{
    if(status==='paid'){
     progress('決済通知を確認しています…');
     for(let i=0;i<3;i++){
      try{if(await refreshOwnership())return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,1200));
     }
     progress('決済通知の処理中です。二重購入せずCreateVdobotのDMをご確認ください。');
    }else if(status==='cancelled'||status==='failed'){
     invoicePending=false;
     progress('購入は確定していません。再度開く場合も同じ請求書を使います。');
     $('buy').disabled=!$('consent').checked||purchased;
    }
   });
  }catch{
   invoicePending=false;
   progress('購入画面を開けません。二重決済を防ぐため、CreateVdobotのDMで状態をご確認ください。');
  }finally{loading=false;$('buy').disabled=invoicePending||purchased||!$('consent').checked;}
 }
 async function ownerGallery(){
  const packName=new URLSearchParams(location.search).get('pack');
  if(!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(packName??'')||
     typeof initData!=='string'||!initData){invalid();return;}
  $('title').textContent='パックを読み込み中…';
  const requestOwner=async(path,extra={})=>{
    const res=await fetch(path,{method:'POST',
      headers:{'content-type':'application/json'},credentials:'same-origin',cache:'no-store',
      body:JSON.stringify({initData,packName,...extra})});
    const result=await res.json();
    if(!res.ok)throw Error(result.error||'gallery_failed');
    return result;
  };
  let page=0;
  const grid=$('grid');
  const controls=document.createElement('nav');
  controls.className='gallery-navigation';
  controls.setAttribute('aria-label','画像一覧ページ送り');
  grid.insertAdjacentElement('afterend',controls);
  async function display(requestedPage){
    loading=true;
    grid.textContent='';controls.textContent='';
    notice('画像を読み込んでいます…');
    try{
      const list=await requestOwner('/api/my-pack/catalog',{page:requestedPage});
      page=requestedPage;
      $('title').textContent=list.title;
      $('summary').textContent=(list.kind==='custom_emoji'?'絵文字':'ステッカー')+
        ' · '+list.page+'ページ · '+list.items.length+'個';
      if(!list.items.length){notice('このページには素材がありません。',true);return;}
      notice('編集する画像をタップしてください。');
      for(const item of list.items){
        const tile=document.createElement('button');
        tile.type='button';tile.className='gallery-tile';
        tile.setAttribute('aria-label','素材 '+(page*10+item.index+1)+'を編集');
        const img=document.createElement('img');
        img.src=item.preview;img.alt='素材 '+(page*10+item.index+1);
        img.loading='lazy';
        img.addEventListener('error',()=>{
          tile.disabled=true;tile.textContent='画像を取得できません';
        });
        tile.appendChild(img);
        tile.addEventListener('click',async()=>{
          if(loading)return;
          loading=true;
          [...grid.querySelectorAll('button')].forEach(b=>{b.disabled=true;});
          notice('選んだ素材をBotの編集画面で開いています…');
          try{
            await requestOwner('/api/my-pack/select',{page,index:item.index});
            notice('BotのDMに編集メニューを表示しました。');
            app?.close?.();
          }catch{
            notice('選択を確認できません。BotのDMから開き直してください。',true);
            [...grid.querySelectorAll('button')].forEach(b=>{b.disabled=false;});
          }finally{loading=false;}
        });
        grid.appendChild(tile);
      }
      const addButton=(text,onClick)=>{
        const control=document.createElement('button');
        control.type='button';control.textContent=text;
        control.addEventListener('click',()=>{if(!loading)onClick();});
        controls.appendChild(control);
      };
      addButton('🔙 戻る',()=>page>0?display(page-1):app?.close?.());
      addButton('キャンセル',()=>app?.close?.());
      if(list.hasNext)addButton('次 ➔',()=>display(page+1));
    }catch{notice('パックの画像を表示できません。BotのDMから開き直してください。',true);}
    finally{loading=false;}
  }
  await display(0);
 }
 async function main(){
  app?.ready?.();app?.expand?.();
  if(location.pathname==='/shop/my-pack'){await ownerGallery();return;}
  if(!/^sp_[a-f0-9]{24}$/.test(pid??'')||typeof initData!=='string'||!initData){
   invalid();return;
  }
  try{
   catalog=await request('/api/catalog');
   $('title').textContent=catalog.title;
   $('summary').textContent='固定版 '+catalog.version+' · '+catalog.count+'個'+
     (catalog.kind==='custom_emoji'?' · カスタム絵文字':' · ステッカー');
   $('price').textContent='⭐ '+catalog.priceStars;
   const grid=$('grid');
   for(const item of catalog.items){
    const box=document.createElement('div');
    box.className='item';
    const img=document.createElement('img');
    img.src=item.url;img.alt='ステッカー '+(item.index+1);
    img.loading='lazy';
    img.addEventListener('error',()=>{box.textContent='表示できません';box.className='item fallback';});
    box.appendChild(img);grid.appendChild(box);
   }
   $('payment').hidden=false;
   $('consent').addEventListener('change',()=>{$('buy').disabled=invoicePending||purchased||!$('consent').checked;});
   $('buy').addEventListener('click',buy);
   if(catalog.purchased){
    purchased=true;
    $('buy').textContent='購入済み ✓';$('buy').disabled=true;
    $('consent').disabled=true;
    progress('購入済みの商品です。追加のStarsは必要ありません。');
   }
   notice('パックの内容を確認してから購入できます。');
  }catch{notice('一覧を読み込めませんでした。CreateVdobotから開き直してください。',true);}
 }
 main();
})();