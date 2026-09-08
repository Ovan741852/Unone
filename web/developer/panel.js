// This view has no privileged engine access: every read and action uses the API.
export function mountPanel(api){
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./panel.css',import.meta.url);document.head.append(css);
  const root=document.createElement('section');root.id='unone-developer';root.setAttribute('aria-label','Unone 開發工具');
  root.innerHTML=`<button class="dev-launch" aria-expanded="true">◈ 開發工具</button><div class="dev-panel"><header><div><small>UNONE / DEVELOPMENT</small><h2>看見狀態，驗證想法</h2></div><button class="dev-close" aria-label="收起開發工具">×</button></header><div class="dev-toolbar"><button data-method="pause">暫停</button><button data-method="step">前進 1 幀</button><button data-method="bloom">Bloom</button><span class="dev-frame"></span></div><nav aria-label="除錯分頁"></nav><div class="dev-summary"></div><div class="dev-body"></div><footer><span class="dev-status">AI 與面板共用同一套 API</span><button class="dev-copy">複製資料</button></footer></div>`;
  document.body.append(root);
  const captureButton=document.createElement('button');captureButton.textContent='截圖';root.querySelector('.dev-toolbar').append(captureButton);
  captureButton.onclick=async()=>{
    captureButton.disabled=true;
    try{
      const result=await send({method:'screenshot'});if(!result.ok)return;
      const capture=result.value,dialog=el('dialog',null,'dev-capture'),img=document.createElement('img');
      img.src=capture.data_url;img.alt=`${capture.host} game viewport frame ${capture.frame}`;img.style.cssText='display:block;max-width:80vw;max-height:70vh';
      const download=el('a','下載 PNG');download.href=capture.data_url;download.download=`unone-${capture.host}-${capture.frame}.png`;
      const close=el('button','關閉');close.onclick=()=>dialog.close();
      dialog.append(el('p',`${capture.host} · frame ${capture.frame} · ${capture.width} × ${capture.height} · 遊戲畫布（不含 DOM UI／開發面板）`),img,download,close);
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
    }finally{captureButton.disabled=false;}
  };
  const panel=root.querySelector('.dev-panel'),body=root.querySelector('.dev-body'),nav=root.querySelector('nav'),status=root.querySelector('.dev-status');
  let active='tools',open=true,selected=null,filter='',lastValue=null,tabSignature='',lastBodySignature='',refreshGeneration=0;
  const builtin=[['tools','遊戲工具'],['hierarchy','Hierarchy'],['console','Console'],['network','Network'],['profile','Profile'],['memory','Memory'],['journal','操作紀錄']];
  function el(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
  async function send(request){const result=await api.request(request);status.textContent=result.ok?'已完成 · '+request.method:result.diagnostics.map(d=>d.explanation).join('\n');status.dataset.error=String(!result.ok);refresh(true);return result;}
  function json(value){return el('pre',JSON.stringify(value,null,2),'dev-json');}
  function empty(message){body.append(el('p',message,'dev-empty'));}
  function card(label,value,note){const card=el('div',null,'dev-card');card.append(el('small',label),el('strong',value));if(note)card.append(el('p',note));body.append(card);}
  const ms=value=>typeof value==='number'?value.toFixed(2)+' ms':'不可取得';
  const bytes=value=>typeof value==='number'?(value/1048576).toFixed(2)+' MiB':'不可取得';
  function setOpen(value){open=value;panel.hidden=!open;root.querySelector('.dev-launch').setAttribute('aria-expanded',String(open));if(open)refresh(true);}
  root.querySelector('.dev-launch').onclick=()=>setOpen(!open);root.querySelector('.dev-close').onclick=()=>setOpen(false);
  root.querySelector('[data-method="pause"]').onclick=async()=>{const p=await api.request({method:'profile'});if(p.ok)send({method:'pause',paused:!p.value.paused});};
  root.querySelector('[data-method="step"]').onclick=()=>send({method:'step',count:1});
  root.querySelector('[data-method="bloom"]').onclick=async()=>{const p=await api.request({method:'profile'});if(p.ok)send({method:'bloom',enabled:!p.value.renderer?.bloom});};
  root.querySelector('.dev-copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(lastValue,null,2));status.textContent='已複製目前分頁資料';}catch{status.textContent='此瀏覽器無法使用剪貼簿；AI 可直接讀取同一份 API 資料。';}};
  function renderTools(tools){
    const tabId=active.startsWith('game:')?active.slice(5):null;
    const controls=tools.controls.filter(c=>!tabId||c.tab===tabId);
    if(!controls.length){empty('由 Lua 註冊這個遊戲的測試工具。AI 可以用 tools.list 探索，再用 tools.invoke 操作。');return;}
    for(const control of controls){
      const row=el('div',null,'dev-control');
      if(control.kind==='label'){row.append(el('small',control.id),el('p',control.text));}
      if(control.kind==='button'){const b=el('button',control.label,'dev-action');b.title=control.id;b.onclick=()=>send({method:'tools.invoke',id:control.id,revision:tools.revision});row.append(b);}
      if(control.kind==='checkbox'){const label=el('label',null,'dev-check'),input=document.createElement('input');input.type='checkbox';input.checked=control.checked;input.onchange=()=>send({method:'tools.invoke',id:control.id,revision:tools.revision,value:input.checked});label.append(input,el('span',control.label));row.append(label);}
      body.append(row);
    }
    const hint=el('details');hint.append(el('summary','AI 操作契約'),json({method:'tools.invoke',id:'<control.id>',revision:tools.revision,value:'checkbox 才需要 boolean'}));body.append(hint);
  }
  async function refresh(force=false){
    if(!open)return; const generation=++refreshGeneration;
    const [toolResult,profile]=await Promise.all([api.request({method:'tools.list'}),api.request({method:'profile'})]);
    if(generation!==refreshGeneration||!open)return; if(!toolResult.ok||!profile.ok){status.textContent='等待 runtime：'+JSON.stringify((toolResult.ok?profile:toolResult).diagnostics);return;}
    const tools=toolResult.value,p=profile.value;
    root.querySelector('header small').textContent=p.host==='native'?'UNONE / NATIVE DEVELOPMENT':'UNONE / WEB DEVELOPMENT';
    root.querySelector('[data-method="bloom"]').disabled=p.host==='native';
    root.querySelector('.dev-frame').textContent='FRAME '+p.runtime.frames;
    root.querySelector('[data-method="pause"]').textContent=p.paused?'繼續':'暫停';root.querySelector('[data-method="step"]').disabled=!p.paused;
    root.querySelector('[data-method="bloom"]').textContent=p.renderer?.bloom?'Bloom ON':'Bloom OFF';
    root.querySelector('.dev-summary').textContent=`${p.runtime.counts.entities} entities · Lua ${ms(p.runtime.phases.find(v=>v.name==='script')?.mean_ms)} · `+(p.host==='native'?`render ${ms(p.renderer?.render_ms)}`:`${p.renderer?.draw_calls??'—'} Three draws`);
    const tabs=[...builtin,...tools.tabs.map(t=>['game:'+t.id,t.label])],signature=JSON.stringify(tabs);
    if(signature!==tabSignature){tabSignature=signature;nav.replaceChildren();for(const [id,label] of tabs){const button=el('button',label);button.dataset.tab=id;button.onclick=()=>{active=id;selected=null;filter='';refresh(true);};nav.append(button);}}
    for(const button of nav.children)button.setAttribute('aria-current',String(button.dataset.tab===active));
    const method=active==='tools'||active.startsWith('game:')?'tools.list':active;
    const response=await api.request({method});if(generation!==refreshGeneration||!open)return; if(!response.ok){status.textContent=JSON.stringify(response.diagnostics);return;}
    const value=response.value;lastValue=value;
    // Preserve focus/selection while a human is editing the hierarchy filter.
    if(document.activeElement?.classList.contains('dev-filter')&&!force)return;
    const next=JSON.stringify([active,value,selected,filter]);if(next===lastBodySignature&&!force)return;lastBodySignature=next;
    body.replaceChildren();
    if(method==='tools.list'){renderTools(value);return;}
    if(method==='hierarchy'){
      const input=document.createElement('input');input.placeholder='搜尋 entity ID';input.className='dev-filter';input.setAttribute('aria-label','搜尋 entity ID');input.value=filter;input.oninput=async()=>{filter=input.value;await refresh(true);const next=body.querySelector('.dev-filter');next.focus();next.setSelectionRange(filter.length,filter.length);};body.append(input);
      const entities=Array.isArray(value.entities)?value.entities:Object.values(value.entities??{});
      for(const entity of entities.filter(e=>e.id.includes(filter))){const b=el('button','◇ '+entity.id,'dev-entity');b.setAttribute('aria-pressed',String(selected===entity.id));b.onclick=()=>{selected=entity.id;refresh(true);};body.append(b);}
      if(selected){const entity=entities.find(e=>e.id===selected);body.append(el('h3',selected),json(entity??'Entity 已移除'));}
      const ui=el('details');ui.append(el('summary','UI tree'),json(value.ui));body.append(ui);return;
    }
    if(method==='console'){
      const rows=[...value.game.map(v=>({level:'game',message:v.details?.message??JSON.stringify(v.details),time:'frame '+v.frame})),...value.browser.map(v=>({...v,time:Math.round(v.time_ms)+' ms'}))];
      if(!rows.length)empty('目前沒有日誌。Lua 可以用 api.log 記錄要驗證的事實。');
      for(const row of rows){const item=el('div',null,'dev-log');item.dataset.level=row.level;item.append(el('small',row.level+' · '+row.time),el('pre',row.message));body.append(item);}return;
    }
    if(method==='network'){
      empty(value.note??'資源載入紀錄；不擷取 headers 或 request body。');
      for(const r of value.resources){const row=el('div',null,'dev-resource');row.append(el('strong',decodeURIComponent(r.url.split('/').pop()||r.url)),el('small',`${r.initiator} · ${ms(r.duration_ms)} · ${bytes(r.encoded_bytes)} · HTTP ${r.status??'—'}`));row.title=r.url;body.append(row);}return;
    }
    if(method==='profile'){
      card('Simulation P50 / P95',ms(value.runtime.median_frame_ms)+' / '+ms(value.runtime.p95_frame_ms),'固定步長模擬耗時，不是螢幕 FPS');
      card('Render CPU / GPU',ms(value.renderer?.render_ms)+' / '+ms((value.renderer?.bloom?value.renderer?.gpu_on:value.renderer?.gpu_off)?.median_ms),'GPU timer 不支援時顯示不可取得');
      for(const phase of value.runtime.phases){const row=el('div',null,'dev-phase');row.append(el('span',phase.name),el('span',ms(phase.mean_ms)));const bar=el('i');bar.style.width=Math.max(0,Math.min(100,phase.share*100))+'%';row.append(bar);body.append(row);}
      body.append(json({counts:value.runtime.counts,renderer:value.renderer}));return;
    }
    if(method==='memory'){
      card('Luau 使用量',bytes(value.luau_used_bytes));if(value.host==='native'){empty(value.note);return;}card('WASM 線性記憶體容量',bytes(value.wasm_linear_bytes),'容量包含未使用空間，並非活躍配置量');card('JavaScript heap 使用量',bytes(value.js_heap?.used_bytes),'瀏覽器未提供時不估算');empty('貼圖／geometry 計數不是 GPU 記憶體位元組數。');return;
    }
    if(method==='journal'){if(!value.events.length)empty('操作後會記錄方法、參數、frame 與結果。');for(const event of [...value.events].reverse()){const row=el('div',null,'dev-log');row.dataset.level=event.ok?'info':'error';row.append(el('strong',`#${event.sequence} · frame ${event.frame} · ${event.ok?'成功':'失敗'}`),json(event.request));if(!event.ok)row.append(json(event.diagnostics));body.append(row);}}
  }
  refresh();setInterval(()=>refresh(),500);
}
