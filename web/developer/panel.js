// This view has no privileged engine access: every read and action uses the API.
export function mountPanel(api){
  const css=document.createElement('link');css.rel='stylesheet';const cssUrl=new URL('./panel.css',import.meta.url);cssUrl.search=new URL(import.meta.url).search;css.href=cssUrl;document.head.append(css);
  const root=document.createElement('section');root.id='unone-developer';root.setAttribute('aria-label','Unone 開發工具');
  root.innerHTML=`<button class="dev-launch" aria-expanded="true">◈ 開發工具</button><div class="dev-panel"><header><div><small>UNONE / DEVELOPMENT</small><h2>看見狀態，驗證想法</h2></div><button class="dev-close" aria-label="收起開發工具">×</button></header><div class="dev-toolbar"><button data-method="pause">暫停模擬</button><button data-method="step">前進 1 幀</button><button data-method="bloom">Bloom</button><span class="dev-sim-state">模擬運行中</span><span class="dev-frame"></span></div><nav aria-label="除錯分頁"></nav><div class="dev-summary"></div><div class="dev-body"></div><footer><span class="dev-status">開發面板不會自動暫停遊戲</span><button class="dev-copy">複製分頁資料</button></footer></div>`;
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
  let active='tools',open=true,selected=null,selectedUi=null,filter='',lastValue=null,tabSignature='',lastBodySignature='',refreshGeneration=0,pausePending=false,paused=false,pickMode=false,uiNodes=[],collapsedUi=new Set(),reservedWidth=-1;
  let lastPick=null;
  let assetQuery='',assetResult=null,assetBusy=false,assetGeneration=0;
  let supportsAssets=true;
  const outline=el('div',null,'dev-selection-outline');outline.hidden=true;outline.setAttribute('aria-hidden','true');root.append(outline);
  const picker=el('div','點一下遊戲畫面中的 UI 節點','dev-pick-layer');picker.hidden=true;picker.setAttribute('role','button');picker.setAttribute('aria-label','Hierarchy 選取模式');picker.dataset.hint='同處連點選取下層元件 · 不會觸發遊戲';picker.setAttribute('tabindex','0');root.append(picker);
  const builtin=[['tools','遊戲工具'],['hierarchy','Hierarchy'],['assets','資產用途'],['console','Console'],['network','Network'],['profile','Profile'],['memory','Memory'],['journal','操作紀錄']];
  function el(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
  async function send(request){const result=await api.request(request);status.textContent=result.ok?'已完成 · '+request.method:result.diagnostics.map(d=>d.explanation).join('\n');status.dataset.error=String(!result.ok);refresh(true);return result;}
  function json(value){return el('pre',JSON.stringify(value,null,2),'dev-json');}
  function componentContext(row){
    const owner=row?.node.kind==='component'?row:uiNodes.findLast(candidate=>candidate.node.kind==='component'&&candidate.path.every((id,index)=>row?.path[index]===id));
    if(!owner)return null;
    const members=uiNodes.filter(candidate=>owner.path.every((id,index)=>candidate.path[index]===id));
    const actionNode=members.find(candidate=>(candidate.node.kind==='button'||candidate.node.kind==='slider'||candidate.node.kind==='combobox')&&candidate.node.action);
    return {owner,members,label:actionNode?.node.text||members.find(candidate=>candidate.node.kind==='text'&&candidate.node.text)?.node.text||'',action:actionNode?.node.action,assets:[...new Set(members.filter(candidate=>candidate.node.kind==='image'&&candidate.node.asset).map(candidate=>candidate.node.asset))]};
  }
  function uiLocator(row){
    const n=row.node,context=componentContext(row);
    return [`UI 節點路徑：${row.path.join(' > ')}`,`資料位置：${row.sourcePath}`,`節點：${n.kind} #${n.id}`,n.text?`顯示文字：${n.text}`:null,n.action?`動作：${n.action}`:null,n.asset?`圖片資產：${n.asset}`:null,context?`所屬元件：${context.owner.node.component??'component'} #${context.owner.node.id}`:null,context?.label?`按鈕文字：${context.label}`:null,context?.action?`按鈕動作：${context.action}`:null,context?.assets.length?`元件圖片：${context.assets.join(', ')}`:null].filter(Boolean).join('\n');
  }
  async function copyText(value,label){try{await navigator.clipboard.writeText(value);status.textContent=`已複製 ${label}，可以直接貼給我`;status.dataset.error='false';}catch{status.textContent=`剪貼簿不可用，請手動複製：\n${value}`;status.dataset.error='true';}}
  function empty(message){body.append(el('p',message,'dev-empty'));}
  function card(label,value,note){const card=el('div',null,'dev-card');card.append(el('small',label),el('strong',value));if(note)card.append(el('p',note));body.append(card);}
  const ms=value=>typeof value==='number'?value.toFixed(2)+' ms':'不可取得';
  const bytes=value=>typeof value==='number'?(value/1048576).toFixed(2)+' MiB':'unavailable';
  const nodeLabel=(node,row)=>node.kind==='screen'?`${node.id} · ${node.node??'screen'}`:node.kind==='component'?`${node.component==='ui.button'?'按鈕':node.component==='ui.slider'?'滑桿':node.component==='ui.combobox'?'下拉選單':node.component==='ui.combobox-popup'?'選項列表':node.component??'元件'}${componentContext(row)?.label?' · '+componentContext(row).label:''} · ${node.id}`:node.kind==='button'?`${node.text||'按鈕'}${node.action?' · '+node.action:''} · ${node.id}`:node.kind==='combobox'?`下拉選單 · ${node.text} · ${node.expanded?'展開':'收合'} · ${node.id}`:node.kind==='slider'?`滑桿控制${node.action?' · '+node.action:''} · ${node.id}`:node.kind==='text'&&/_fill$/.test(node.id)?`滑桿填充插槽 · ${node.id}`:node.kind==='image'&&(/_(handler|thumb)$/.test(node.id))?`滑桿把手 · ${node.id}`:node.kind==='image'&&/_track$/.test(node.id)?`滑桿軌道 · ${node.id}`:node.kind==='text'?`${node.text||'文字'} · ${node.id}`:`${node.alt||'圖片'} · ${node.id}`;
  function indexUi(ui){
    const out=[];let order=0;
    function visit(node,depth=0,parent=null,path=[],sourcePath='ui',ancestorRails=[],isLast=true,ancestorSources=[]){
      if(!node||typeof node!=='object')return null;
      const row={node,depth,parent,path:[...path,node.id],sourcePath,ancestorRails:[...ancestorRails],ancestorSources:[...ancestorSources],isLast,order:order++,rect:node.rect?{...node.rect}:null};out.push(row);
      const children=Array.isArray(node.children)?node.children:[];
      row.hasChildren=children.length>0;
      const childRails=depth===0?ancestorRails:[...ancestorRails,isLast];
      const childRows=children.map((child,index)=>visit(child,depth+1,node.id,row.path,`${sourcePath}.children[${index}]`,childRails,index===children.length-1,[...ancestorSources,sourcePath])).filter(Boolean);
      if(!row.rect&&childRows.length){
        const rects=childRows.map(child=>child.rect).filter(Boolean);
        if(rects.length){const left=Math.min(...rects.map(r=>r.x)),bottom=Math.min(...rects.map(r=>r.y)),right=Math.max(...rects.map(r=>r.x+r.width)),top=Math.max(...rects.map(r=>r.y+r.height));row.rect={x:left,y:bottom,width:right-left,height:top-bottom};}
      }
      return row;
    }
    visit(ui);return out;
  }
  function toggleUiRow(row){
    if(!row?.hasChildren)return;
    if(collapsedUi.has(row.sourcePath))collapsedUi.delete(row.sourcePath);else collapsedUi.add(row.sourcePath);
    refresh(true);
  }
  function positionOverlay(row){
    const canvas=document.querySelector('#game'),rect=canvas?.getBoundingClientRect(),box=row?.rect;
    if(!rect||!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)){outline.hidden=true;return;}
    outline.hidden=false;outline.style.left=`${rect.left+rect.width*box.x/100}px`;outline.style.top=`${rect.top+rect.height*(100-box.y-box.height)/100}px`;outline.style.width=`${rect.width*box.width/100}px`;outline.style.height=`${rect.height*box.height/100}px`;
  }
  function positionPicker(){
    const rect=document.querySelector('#game')?.getBoundingClientRect();if(!rect)return;
    picker.style.left=`${rect.left}px`;picker.style.top=`${rect.top}px`;picker.style.width=`${rect.width}px`;picker.style.height=`${rect.height}px`;
  }
  function setPickMode(value){if(!value)lastPick=null;pickMode=value;picker.hidden=!value;positionPicker();if(value&&document.activeElement!==picker)picker.focus();}
  function clearUiSelection(){selectedUi=null;outline.hidden=true;setPickMode(false);}
  function updateReservedSpace(){
    const reserved=open?Math.ceil(panel.getBoundingClientRect().width+24):0;
    if(reserved===reservedWidth)return;
    reservedWidth=reserved;
    document.documentElement.style.setProperty('--unone-dev-reserved-right',`${reserved}px`);
    // The stock player has no fixed #stage; constrain its direct canvas/UI to
    // the same left-side viewport while the right tool column is open.
    if(!document.querySelector('#stage'))for(const element of document.querySelectorAll('body > #game, body > #ui-layer')){
      element.style.right=reserved?`${reserved}px`:'';
      element.style.width=reserved?'auto':'';
    }
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  function selectUiAt(event){
    const rect=document.querySelector('#game')?.getBoundingClientRect();if(!rect)return;
    const x=(event.clientX-rect.left)/rect.width*100,y=(1-(event.clientY-rect.top)/rect.height)*100;
    const priority=row=>row.node.kind==='component'&&row.node.component==='ui.button'?0:(row.node.kind==='button'||row.node.kind==='combobox')?1:row.node.kind==='slider'?2:row.node.kind==='text'?3:row.node.kind==='image'?4:5;
    const hits=uiNodes.filter(row=>row.rect&&row.rect.width>0&&row.rect.height>0&&x>=row.rect.x&&x<=row.rect.x+row.rect.width&&y>=row.rect.y&&y<=row.rect.y+row.rect.height).sort((a,b)=>priority(a)-priority(b)||a.rect.width*a.rect.height-b.rect.width*b.rect.height||b.order-a.order);
    if(!hits.length){lastPick=null;selectedUi=null;outline.hidden=true;status.textContent='這個位置沒有 UI 節點';refresh(true);return;}
    const signature=JSON.stringify(hits.map(row=>[row.sourcePath,row.node.id]));
    // Keep cycling while the user inspects the same point; a time limit would
    // restart the stack before they finish reading the selected node's details.
    const repeat=lastPick&&lastPick.signature===signature&&lastPick.selected===selectedUi&&Math.hypot(event.clientX-lastPick.x,event.clientY-lastPick.y)<=6;
    const index=repeat?(lastPick.index+1)%hits.length:0,hit=hits[index];
    lastPick={x:repeat?lastPick.x:event.clientX,y:repeat?lastPick.y:event.clientY,signature,index,selected:hit.node.id};
    for(const path of hit.ancestorSources)collapsedUi.delete(path);
    selected=null;selectedUi=hit.node.id;active='hierarchy';filter='';positionOverlay(hit);
    status.dataset.error='false';status.textContent=`已選取 ${hit.node.kind} · ${hit.node.id}（${index+1}/${hits.length}）；同處再點選下一個`;
    setPickMode(true);refresh(true);
  }
  function setOpen(value){open=value;panel.hidden=!open;root.querySelector('.dev-launch').setAttribute('aria-expanded',String(open));updateReservedSpace();if(open)setPickMode(active==='hierarchy');else clearUiSelection();if(open)refresh(true);}
  root.querySelector('.dev-launch').onclick=()=>setOpen(!open);root.querySelector('.dev-close').onclick=()=>setOpen(false);
  root.querySelector('[data-method="pause"]').onclick=async event=>{const button=event.currentTarget;if(pausePending)return;pausePending=true;button.disabled=true;try{const result=await api.request({method:'pause',paused:!paused});if(result.ok){paused=result.value.paused;status.textContent=paused?'模擬已暫停':'模擬繼續中';status.dataset.error='false';}else{status.textContent=result.diagnostics.map(d=>d.explanation).join('\n');status.dataset.error='true';}}finally{pausePending=false;button.disabled=false;refresh(true);}};
  root.querySelector('[data-method="step"]').onclick=()=>send({method:'step',count:1});
  root.querySelector('[data-method="bloom"]').onclick=async()=>{const p=await api.request({method:'profile'});if(p.ok)send({method:'bloom',enabled:!p.value.renderer?.bloom});};
  root.querySelector('.dev-copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(lastValue,null,2));status.textContent='已複製目前分頁資料';}catch{status.textContent='此瀏覽器無法使用剪貼簿；AI 可直接讀取同一份 API 資料。';}};
  picker.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();if(event.button===0)selectUiAt(event);});
  picker.addEventListener('pointerup',event=>event.stopPropagation());
  picker.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
  picker.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape')event.preventDefault();});
  for(const type of ['pointerdown','click','keydown'])panel.addEventListener(type,event=>event.stopPropagation());
  window.addEventListener('resize',()=>{lastPick=null;positionOverlay(uiNodes.find(row=>row.node.id===selectedUi));if(pickMode)positionPicker();});
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
  async function showAssetUsages(id){
    const generation=++assetGeneration;assetQuery=id;assetResult=null;assetBusy=true;clearUiSelection();active='assets';filter='';refresh(true);
    const result=await api.request({method:'asset.usages',id});
    if(generation!==assetGeneration)return;
    assetBusy=false;assetResult=result.ok?result.value:null;status.dataset.error=String(!result.ok);status.textContent=result.ok?'已查詢資產用途；來源索引對應匯出版本':result.diagnostics.map(d=>d.explanation).join('\n');refresh(true);
  }
  function renderAssets(value){
    const input=el('input',null,'dev-filter');input.placeholder='搜尋資產 ID 或圖片檔名';input.setAttribute('aria-label','搜尋資產用途');input.value=filter;
    input.oninput=async()=>{filter=input.value;await refresh(true);const next=body.querySelector('.dev-filter');next?.focus();next?.setSelectionRange(filter.length,filter.length);};body.append(input);
    if(value.source_error)empty(value.source_error+' 目前畫面仍可反查。');
    if(assetBusy)empty('正在讀取來源索引與目前畫面…');
    if(assetResult){
      const detail=el('section',null,'dev-asset-detail');detail.append(el('h3',assetQuery));
      const actions=el('div',null,'dev-asset-actions'),again=el('button','重新查詢目前畫面'),copy=el('button','複製完整反查結果');again.onclick=()=>showAssetUsages(assetQuery);copy.onclick=()=>copyText(JSON.stringify(assetResult,null,2),'資產反查結果');actions.append(again,copy);detail.append(actions);
      detail.append(el('p',assetResult.note,'dev-empty'));
      if(assetResult.source_error)detail.append(el('p',assetResult.source_error,'dev-empty'));
      if(assetResult.declared===false)detail.append(el('p','來源索引沒有宣告此 ID／檔案，請確認拼字或重新匯出。','dev-asset-warning'));
      if(assetResult.scope&&!assetResult.scope.scan_complete)detail.append(el('p','來源掃描未完成：'+assetResult.scope.issues.join('；'),'dev-asset-warning'));
      if(assetResult.asset_ids.length>1)detail.append(el('p','同檔案資產：'+assetResult.asset_ids.join('、'),'dev-empty'));
      const live=el('details');live.open=true;live.append(el('summary',`目前畫面 · ${assetResult.live.length} 處 · frame ${assetResult.frame}`));
      for(const reference of assetResult.live){
        const row=el('div',null,'dev-asset-reference'),button=el('button',reference.component_id??reference.node_id);button.title=reference.ui_path;
        button.onclick=()=>{active='hierarchy';filter='';selected=reference.kind==='entity'?reference.node_id:null;selectedUi=reference.kind==='entity'?null:reference.node_id;setPickMode(true);refresh(true);};
        row.append(button,el('small',reference.node_id),el('code',reference.ui_path));live.append(row);
      }
      if(!assetResult.live.length)live.append(el('p','此畫面沒有已發布的引用；不包含未造訪頁面與尚未建立的虛擬列表項目。','dev-empty'));detail.append(live);
      function sourceGroup(label,rows,open=false){
        const group=el('details');group.open=open;group.append(el('summary',`${label} · ${rows.length} 處`));
        const files=new Map();for(const row of rows){if(!files.has(row.path))files.set(row.path,[]);files.get(row.path).push(row);}
        for(const [path,references] of [...files].sort(([a],[b])=>(a===assetResult.source_files.find(file=>file.role==='entry')?.path?1:0)-(b===assetResult.source_files.find(file=>file.role==='entry')?.path?1:0)||a.localeCompare(b))){
          const file=el('details'),meta=assetResult.source_files.find(source=>source.path===path);file.open=meta?.role!=='entry';file.append(el('summary',`${path} · ${references.length} 處${meta?.role==='entry'?'（入口／可能為合併副本）':''}`));
          for(const reference of references){
            const row=el('div',null,'dev-asset-reference'),location=reference.json_pointer?`${path} #${reference.json_pointer}`:`${path}:${reference.line}:${reference.column}`;
            const button=el('button',reference.json_pointer??`第 ${reference.line} 行 · ${reference.via?'經 '+reference.via+'（候選）':reference.kind==='asset_field'?'asset 欄位':'字串候選'}`);button.title='複製來源檔案、位置與程式片段';
            button.onclick=()=>copyText(`${assetResult.project_root}/${location}\n${reference.evidence}`,'來源位置');row.append(button,el('code',reference.evidence));file.append(row);
          }
          group.append(file);
        }
        if(!rows.length)group.append(el('p','沒有找到此類來源證據；不代表資產沒有使用。','dev-empty'));detail.append(group);
      }
      sourceGroup('來源 asset 欄位',assetResult.references.filter(row=>row.kind==='asset_field'),true);
      sourceGroup('字串／共用模板候選',assetResult.references.filter(row=>row.kind!=='asset_field'),true);
      sourceGroup('全專案未解析動態位置（未歸屬此資產）',assetResult.unresolved);
      const scope=el('details');scope.append(el('summary','搜尋範圍、限制與來源版本'),json({scope:assetResult.scope,source_files:assetResult.source_files}));detail.append(scope);body.append(detail);
    }
    const matches=value.assets.filter(asset=>[asset.id,asset.source].filter(Boolean).join(' ').toLowerCase().includes(filter.toLowerCase()));
    body.append(el('h3',`資產庫 · ${matches.length} 個`));
    for(const asset of matches.slice(0,80)){
      const row=el('div',null,'dev-asset-reference'),button=el('button',asset.id);button.disabled=assetBusy;button.onclick=()=>showAssetUsages(asset.id);button.setAttribute('aria-pressed',String(assetQuery===asset.id));row.append(button,el('small',`${asset.source??'來源不明'} · 畫面 ${asset.live_count} 處`));body.append(row);
    }
    if(matches.length>80)empty('先顯示前 80 個，輸入 ID 或檔名可縮小範圍。');
    if(!matches.length)empty('沒有符合的資產。可在 Hierarchy 選取圖片或按鈕後，直接查詢用途。');
  }
  async function refresh(force=false){
    if(!open)return; const generation=++refreshGeneration;
    const [toolResult,profile]=await Promise.all([api.request({method:'tools.list'}),api.request({method:'profile'})]);
    if(generation!==refreshGeneration||!open)return; if(!toolResult.ok||!profile.ok){status.textContent='等待 runtime：'+JSON.stringify((toolResult.ok?profile:toolResult).diagnostics);return;}
    const tools=toolResult.value,p=profile.value;
    supportsAssets=p.host!=='native';
    root.querySelector('header small').textContent=p.host==='native'?'UNONE / NATIVE DEVELOPMENT':'UNONE / WEB DEVELOPMENT';
    root.querySelector('[data-method="bloom"]').disabled=p.host==='native';
    root.querySelector('.dev-frame').textContent='FRAME '+p.frame??p.runtime.frames;
    if(!pausePending)paused=Boolean(p.paused);root.querySelector('[data-method="pause"]').textContent=paused?'繼續模擬':'暫停模擬';root.querySelector('.dev-sim-state').textContent=paused?'模擬已暫停':'模擬運行中';root.querySelector('[data-method="step"]').disabled=!paused;
    root.querySelector('[data-method="bloom"]').textContent=p.renderer?.bloom?'Bloom ON':'Bloom OFF';
    root.querySelector('.dev-summary').textContent=`${p.runtime.counts.entities} entities · Lua ${ms(p.runtime.phases.find(v=>v.name==='script')?.mean_ms)} · `+(p.host==='native'?`render ${ms(p.renderer?.render_ms)}`:`${p.renderer?.draw_calls??'—'} Three draws`);
    const tabs=[...builtin.filter(([id])=>id!=='assets'||supportsAssets),...tools.tabs.map(t=>['game:'+t.id,t.label])],signature=JSON.stringify(tabs);
    if(signature!==tabSignature){tabSignature=signature;nav.replaceChildren();for(const [id,label] of tabs){const button=el('button',label);button.dataset.tab=id;button.onclick=()=>{if(active==='hierarchy'&&id!=='hierarchy')clearUiSelection();active=id;selected=null;filter='';setPickMode(open&&active==='hierarchy');refresh(true);};nav.append(button);}}
    for(const button of nav.children)button.setAttribute('aria-current',String(button.dataset.tab===active));
    const method=active==='tools'||active.startsWith('game:')?'tools.list':active;
    const response=await api.request({method});if(generation!==refreshGeneration||!open)return; if(!response.ok){status.textContent=JSON.stringify(response.diagnostics);return;}
    const value=response.value;lastValue=value;
    // Preserve focus/selection while a human is editing the hierarchy filter.
    if(document.activeElement?.classList.contains('dev-filter')&&!force)return;
    const next=JSON.stringify([active,value,selected,selectedUi,filter]);if(next===lastBodySignature&&!force)return;lastBodySignature=next;
    body.replaceChildren();
    if(method==='tools.list'){renderTools(value);return;}
    if(method==='assets'){renderAssets(value);return;}
    if(method==='hierarchy'){
      const entities=Array.isArray(value.entities)?value.entities:Object.values(value.entities??{});
      const controls=el('div',null,'dev-hierarchy-controls'),input=document.createElement('input');input.placeholder='搜尋 ID、文字、元件、動作或資產';input.className='dev-filter';input.setAttribute('aria-label','搜尋 Hierarchy 節點');input.value=filter;input.oninput=async()=>{filter=input.value;await refresh(true);const next=body.querySelector('.dev-filter');next?.focus();next?.setSelectionRange(filter.length,filter.length);};controls.append(input,el('p','同一位置連點可依序選取重疊元件；換位置重新選取。右鍵樹狀節點可複製 ID。選取不會觸發遊戲操作。','dev-hierarchy-hint'));body.append(controls);
      const hierarchy=el('details',null,'dev-hierarchy-root');hierarchy.open=true;hierarchy.append(el('summary','遊戲場景'));
      for(const entity of entities.filter(e=>String(e.id).toLowerCase().includes(filter.toLowerCase()))){
        const row=el('div',null,'dev-tree-row'),kind=el('span','3D','dev-node-kind'),button=el('button',String(entity.id),'dev-tree-node');row.style.setProperty('--depth','0');row.dataset.depth='0';row.dataset.last='true';button.dataset.nodeId=String(entity.id);button.title='右鍵選取並複製場景物件 ID';button.setAttribute('aria-pressed',String(selected===entity.id));button.onclick=()=>{lastPick=null;selected=entity.id;selectedUi=null;outline.hidden=true;status.textContent=`已選取場景物件 · ${entity.id}`;status.dataset.error='false';refresh(true);};button.oncontextmenu=event=>{event.preventDefault();lastPick=null;selected=entity.id;selectedUi=null;outline.hidden=true;void copyText(String(entity.id),'場景物件 ID');refresh(true);};
        const components=Object.keys(entity).filter(key=>key!=='id');row.append(kind,button,el('small',components.join(' · ')||'無元件'));hierarchy.append(row);
      }
      if(selected){const entity=entities.find(e=>String(e.id)===selected);const detail=el('details',null,'dev-selection-detail');detail.open=true;detail.append(el('summary',`物件詳細 · ${selected}`));if(entity){const facts=el('dl',null,'dev-facts');for(const key of Object.keys(entity).filter(key=>key!=='id')){facts.append(el('dt',key),el('dd',JSON.stringify(entity[key])));}detail.append(facts,json(entity));}else detail.append(el('p','物件已離開場景。'));hierarchy.append(detail);}
      uiNodes=indexUi(value.ui);const visibleNodes=uiNodes.filter(row=>{const n=row.node,context=componentContext(row);const haystack=[n.id,n.kind,n.component,n.text,n.action,n.asset,n.alt,nodeLabel(n,row),context?.label,context?.action,...(context?.assets??[])].filter(Boolean).join(' ').toLowerCase();const matches=haystack.includes(filter.toLowerCase());const hiddenByParent=!filter&&row.ancestorSources.some(path=>collapsedUi.has(path));return matches&&!hiddenByParent;});
      hierarchy.querySelector('summary').textContent=`遊戲場景 · ${entities.length} 個 3D 物件 · ${uiNodes.length} 個介面節點`;
      if(!value.ui)hierarchy.append(el('p','目前畫面沒有 UI 節點。','dev-empty'));
      for(const row of visibleNodes){
        const node=row.node,line=el('div',null,'dev-tree-row');
        line.style.setProperty('--depth',String(Math.min(row.depth,12)));line.dataset.depth=String(Math.min(row.depth,12));line.dataset.last=String(row.isLast);
        for(let level=0;level<row.ancestorRails.length;level++)if(row.ancestorRails[level]){const rail=el('i',null,'dev-tree-rail');rail.setAttribute('aria-hidden','true');rail.style.setProperty('--guide-level',String(level));line.append(rail);}
        if(row.depth>0){const branch=el('i',null,'dev-tree-branch');branch.setAttribute('aria-hidden','true');line.append(branch);}
        if(row.hasChildren){const collapsed=collapsedUi.has(row.sourcePath),toggle=el('button',collapsed?'▸':'▾','dev-tree-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展開子節點':'收合子節點');toggle.title=collapsed?'展開子節點':'收合子節點';toggle.onclick=event=>{event.stopPropagation();toggleUiRow(row);};line.append(toggle);}
        else{const spacer=el('span',' ','dev-tree-toggle dev-tree-toggle-spacer');spacer.setAttribute('aria-hidden','true');line.append(spacer);}
        const kind=el('span',node.kind.toUpperCase(),'dev-node-kind'),button=el('button',nodeLabel(node,row),'dev-tree-node');button.dataset.nodeId=node.id;button.title='右鍵選取並複製元件 ID';button.setAttribute('aria-pressed',String(selectedUi===node.id));button.onclick=()=>{lastPick=null;selectedUi=node.id;selected=null;positionOverlay(row);status.textContent=`已選取 ${node.kind} · ${node.id}；可繼續點畫面選其他元件`;status.dataset.error='false';refresh(true);};button.oncontextmenu=event=>{event.preventDefault();lastPick=null;selectedUi=node.id;selected=null;positionOverlay(row);void copyText(String(node.id),'UI 元件 ID');refresh(true);};line.append(kind,button);hierarchy.append(line);
      }
      if(selectedUi){const row=uiNodes.find(entry=>entry.node.id===selectedUi);positionOverlay(row);const detail=el('details',null,'dev-selection-detail');detail.open=true;detail.append(el('summary',`節點詳細 · ${selectedUi}`));if(row){const n=row.node,context=componentContext(row),facts=el('dl',null,'dev-facts');for(const [label,value] of [['類型',n.kind],['名稱',n.component??n.id],['父節點',row.parent??'screen root'],['階層路徑',row.sourcePath],['位置與尺寸',row.rect?`x ${row.rect.x.toFixed(2)}% · y ${row.rect.y.toFixed(2)}% · 寬 ${row.rect.width.toFixed(2)}% · 高 ${row.rect.height.toFixed(2)}%`:'沒有畫面範圍'],['顯示文字',n.text],['動作',n.action],['展開',n.expanded],['資產',n.asset],['替代文字',n.alt],['所在按鈕',context?.label],['按鈕動作',context?.action],['按鈕底圖',context?.assets.join(', ')]] )if(value!=null&&value!=='')facts.append(el('dt',label),el('dd',String(value)));const copyButton=el('button','複製路徑與用途','dev-copy-path');copyButton.onclick=()=>copyText(uiLocator(row),'UI 元件定位資料');const raw=el('details');raw.append(el('summary','原始節點資料'),json(n));detail.append(facts,copyButton);const usageAssets=[...new Set([n.asset,...(context?.assets??[])].filter(Boolean))];for(const id of supportsAssets?usageAssets:[]){const usage=el('button','反查此圖片用途','dev-copy-path');usage.title=id;usage.onclick=()=>showAssetUsages(id);detail.append(usage);}detail.append(raw);}else detail.append(el('p','節點已從目前畫面移除。'));hierarchy.append(detail);}
      body.append(hierarchy);positionPicker();if(selectedUi)body.querySelectorAll('.dev-tree-node').forEach(button=>{if(button.dataset.nodeId===selectedUi)button.scrollIntoView({block:'nearest'});});return;
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
      const actions=el('div',null,'dev-control');
      for(const [label,request] of [['開始量測',{method:'profile.start',sampling:false}],['取樣 Lua 函式',{method:'profile.start',sampling:true}],['停止量測',{method:'profile.stop'}]]){const button=el('button',label,'dev-action');button.disabled=request.method==='profile.stop'?!value.window?.active:!!value.window?.active;button.onclick=()=>send(request);actions.append(button);}body.append(actions);
      empty(`量測 #${value.window?.id??0} · ${value.window?.active?'進行中':'已停止／尚未開始'} · frame ${value.window?.first_frame??'—'} → ${value.window?.last_frame??'—'}`);
      card('Simulation P50 / P95',ms(value.runtime.median_frame_ms)+' / '+ms(value.runtime.p95_frame_ms),'固定步長模擬耗時，不是螢幕 FPS');
      const gpuSample=value.renderer?.ao?(value.renderer?.bloom?value.renderer?.gpu_bloom_with_ao:value.renderer?.gpu_ao_only):(value.renderer?.bloom?value.renderer?.gpu_on:value.renderer?.gpu_off);
      card('Render CPU / GPU',ms(value.renderer?.render_ms)+' / '+ms(gpuSample?.median_ms),'GPU timer 不支援時顯示不可取得；GPU sample 已依 Bloom/AO 狀態分桶');
      for(const phase of value.runtime.phases){const row=el('div',null,'dev-phase');row.append(el('span',phase.name),el('span',ms(phase.mean_ms)));const bar=el('i');bar.style.width=Math.max(0,Math.min(100,phase.share*100))+'%';row.append(bar);body.append(row);}
      const functions=Object.values(value.window?.functions??{}).sort((a,b)=>b.self_samples-a.self_samples);
      if(functions.length){const table=el('table');const head=el('tr');for(const text of ['Lua 函式','自身樣本','含子呼叫'])head.append(el('th',text));table.append(head);for(const f of functions.slice(0,30)){const row=el('tr');for(const text of [`${f.name} (${f.source}:${f.line??'?'})`,f.self_samples,f.inclusive_samples])row.append(el('td',String(text)));table.append(row);}body.append(table);}
      empty('函式取樣不是精確耗時；原生呼叫內部無法取樣。比較效能時請關閉取樣。');
      body.append(json({counts:value.runtime.counts,host_window:value.host_window,publication:value.publication,jobs:value.jobs,window:value.window,renderer:value.renderer}));return;
    }
    if(method==='memory'){
      card('Luau 使用量',bytes(value.luau_used_bytes));
      if(value.host==='native'){
        card('Native process RSS',bytes(value.native_process_rss_bytes),'目前程序工作集；不是 GPU 記憶體');
        card('WASM 線性記憶體容量',bytes(value.wasm_linear_bytes),'native host 不使用 WASM');
        card('JavaScript heap 使用量',bytes(value.js_heap),'native host 不使用 JavaScript');
        card('GPU memory',bytes(value.gpu_memory_bytes),'目前 wgpu 沒有可攜的 live allocation counter');
        empty(value.note);return;
      }
      card('WASM 線性記憶體容量',bytes(value.wasm_linear_bytes),'容量包含未使用空間，並非活躍配置量');
      card('JavaScript heap 使用量',bytes(value.js_heap?.used_bytes??value.js_heap),'瀏覽器未提供時顯示 unavailable');
      card('Native process RSS',bytes(value.native_process_rss_bytes),'Web host 不適用');
      card('GPU memory',bytes(value.gpu_memory_bytes),'renderer counters 不是 GPU 記憶體位元組數');return;
    }
    if(method==='journal'){if(!value.events.length)empty('操作後會記錄方法、參數、frame 與結果。');for(const event of [...value.events].reverse()){const row=el('div',null,'dev-log');row.dataset.level=event.ok?'info':'error';row.append(el('strong',`#${event.sequence} · frame ${event.frame} · ${event.ok?'成功':'失敗'}`),json(event.request));if(!event.ok)row.append(json(event.diagnostics));body.append(row);}}
  }
  if(typeof ResizeObserver==='function')new ResizeObserver(updateReservedSpace).observe(panel);
  window.addEventListener('resize',updateReservedSpace);
  updateReservedSpace();
  refresh();setInterval(()=>refresh(),500);
}
