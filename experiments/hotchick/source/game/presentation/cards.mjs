const values=value=>Array.isArray(value)?value:Object.values(value||{});
const num=value=>Number(value)||0;
const format=value=>num(value).toLocaleString('en-US',{maximumFractionDigits:0});
const rarityRank={SR:0,R:1,N:2};
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function button(text,code){const node=element('button',null,text);node.type='button';node.dataset.cardAction=code;return node;}

// Cards are observations from Luau. This module never rolls, awards or spends.
export function createCards({asset,action,onOpenPack,onOpenCollection,viewerRoot,onViewerChange,onViewerPose}) {
  let host=null,cards=null,characterId=null,viewerId=null,waiting=false,lastSerial=null,lastBatchSerial=null;
  let batchItems=[],openingCount=0,releaseViewer=()=>{},cancelViewerDrag=()=>{},viewerSuspended=false,pendingTimer=null,packPhase='idle',packMode=false,drawStartedAt=0,viewerReturnFocus=null,viewerElement=null,sequenceReduced=false,revealedCount=0;
  const sequenceTimers=new Set(),sequenceAnimations=new Set();let sequenceToken=0,viewerPoseReader=()=>null,shaderReady=false;
  const cardById=id=>values(cards?.catalog).find(card=>String(card.id)===String(id));
  const busy=()=>waiting||!['idle','results'].includes(packPhase);
  const sortedItems=()=>batchItems.map((item,index)=>({item,index})).sort((a,b)=>(rarityRank[cardById(a.item.cardId)?.rarity]??3)-(rarityRank[cardById(b.item.cardId)?.rarity]??3)||a.index-b.index).map(entry=>entry.item);
  function clearAnimations(){for(const animation of sequenceAnimations)animation.cancel();sequenceAnimations.clear();}
  const stopTimers=()=>{sequenceToken++;clearTimeout(pendingTimer);pendingTimer=null;for(const timer of sequenceTimers)clearTimeout(timer);sequenceTimers.clear();clearAnimations();};
  function later(callback,delay){const token=sequenceToken,timer=setTimeout(()=>{sequenceTimers.delete(timer);if(token===sequenceToken&&host)callback();},Math.max(0,delay));sequenceTimers.add(timer);return timer;}
  function animate(node,keyframes,options={}){if(!node)return;const animation=node.animate(keyframes,{fill:'forwards',easing:'ease-in-out',...options});sequenceAnimations.add(animation);return animation;}
  function image(card,className='hc-card-art'){
    const img=element('img',className);img.src=asset(card.imageAsset||`cards/${card.id}.webp`);img.alt=card.name||'收藏卡';img.draggable=false;img.loading='lazy';img.decoding='async';return img;
  }
  function surface(card){
    const frame=element('div','hc-collectible');frame.dataset.rarity=card.rarity||'N';
    const front=element('div','hc-card-face hc-card-front');front.append(image(card));
    const stamp=element('div','hc-card-stamp');stamp.append(element('span',null,card.rarity||'N'),element('strong',null,card.name||''));front.append(stamp);
    const sheen=element('div','hc-card-sheen');sheen.setAttribute('aria-hidden','true');front.append(sheen);
    const back=element('div','hc-card-face hc-card-back');back.setAttribute('aria-hidden','true');back.append(element('span','hc-card-back-crown','♛'),element('strong',null,'海 王'),element('small',null,'心 動 典 藏'),element('span','hc-card-back-heart','♥'));
    frame.append(front,back);return frame;
  }
  function draw(){
    if(busy()||cards?.ready===false||cards?.canDraw===false||num(cards?.drawsAvailable)<1)return;
    closeViewer(false);stopTimers();waiting=true;batchItems=[];revealedCount=0;openingCount=Math.min(num(cards.drawsAvailable),num(cards.capacity)||10);packPhase='charge';sequenceReduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;drawStartedAt=performance.now();render();animateCharge();
    action('CardDrawAll');
    pendingTimer=setTimeout(()=>{if(waiting){waiting=false;packPhase='idle';stopTimers();render();}},8000);
  }
  function closeViewer(restoreFocus=true){
    const wasOpen=Boolean(viewerId);releaseViewer();viewerId=null;viewerElement=null;shaderReady=false;viewerPoseReader=()=>null;
    if(viewerRoot){viewerRoot.replaceChildren();viewerRoot.hidden=true;}
    if(wasOpen){onViewerChange?.(false);onViewerPose?.(null);}
    if(restoreFocus&&viewerReturnFocus?.isConnected)viewerReturnFocus.focus({preventScroll:true});
    viewerReturnFocus=null;
  }
  function openViewer(id){
    const card=cardById(id);if(!card||num(card.count)<1)return;
    if(viewerId===card.id&&viewerElement?.isConnected)return;
    closeViewer(false);viewerReturnFocus=document.activeElement;viewerId=card.id;
    const target=viewerRoot||host;if(!target)return;
    target.replaceChildren();if(viewerRoot)viewerRoot.hidden=false;
    viewerElement=renderViewer(card);target.append(viewerElement);onViewerChange?.(true);onViewerPose?.(viewerPoseReader());
    viewerElement.querySelector('.hc-card-stage')?.focus({preventScroll:true});
  }
  function closeOverlay(){
    closeViewer(false);batchItems=[];openingCount=0;waiting=false;packPhase='idle';stopTimers();render();
    host?.querySelector('[data-card-action="draw"]')?.focus({preventScroll:true});
  }
  function animateCharge(){
    const duration=sequenceReduced?200:950;
    animate(host?.querySelector('.hc-pack-charge-halo'),sequenceReduced?[{opacity:.2},{opacity:.6}]:[{opacity:.12,transform:'translate(-50%,-50%) scale(.55)'},{opacity:.85,transform:'translate(-50%,-50%) scale(1.15)'}],{duration});
    if(!sequenceReduced)for(const pack of host?.querySelectorAll('.hc-sealed-pack')||[]){const initial=getComputedStyle(pack).transform;animate(pack,[{transform:initial,filter:'brightness(1)'},{transform:initial,filter:'brightness(1.5)',offset:.75},{transform:initial,filter:'brightness(1.25)'}],{duration});}
  }
  function beginTear(){
    packPhase='tear';render();
    const duration=sequenceReduced?180:650;
    for(const half of host.querySelectorAll('.hc-pack-half')){const direction=half.classList.contains('hc-pack-left')?-1:1;animate(half,sequenceReduced?[{opacity:1},{opacity:0}]:[{transform:'translateX(0) rotate(0deg)',opacity:1},{transform:`translateX(${direction*95}%) rotate(${direction*18}deg)`,opacity:0}],{duration});}
    for(const label of host.querySelectorAll('.hc-sealed-pack>span,.hc-sealed-pack>strong,.hc-sealed-pack>small'))animate(label,[{opacity:1},{opacity:0}],{duration:duration*.75});
    animate(host.querySelector('.hc-pack-charge-halo'),sequenceReduced?[{opacity:.55},{opacity:0}]:[{opacity:.9,transform:'translate(-50%,-50%) scale(.8)'},{opacity:0,transform:'translate(-50%,-50%) scale(2.4)'}],{duration});
    if(!sequenceReduced){const area=host.querySelector('.hc-pack-fan').getBoundingClientRect();host.querySelectorAll('.hc-pack-burst i').forEach((spark,index)=>{const angle=index*Math.PI/6,distance=Math.min(area.width,area.height)*.85;animate(spark,[{opacity:0,transform:'translate(-50%,-50%) scale(.2)'},{opacity:.9,offset:.2},{opacity:0,transform:`translate(calc(-50% + ${Math.cos(angle)*distance}px),calc(-50% + ${Math.sin(angle)*distance}px)) scale(.2)`}],{duration:650});});}
    later(beginBacks,duration);
  }
  function beginBacks(){
    packPhase='backs';render();
    const deck=host.querySelector('.hc-opening-deck'),deckWidth=deck.getBoundingClientRect().width,count=batchItems.length;
    deck.querySelectorAll('.hc-opening-card').forEach((node,index)=>{
      const width=node.getBoundingClientRect().width,offset=index-(count-1)/2,step=Math.min(deckWidth*.74/Math.max(1,count-1),width*.72),target=`translate(-50%,-50%) translateX(${offset*step}px) rotate(${offset*2}deg)`;
      node.style.transform=target;
      animate(node,sequenceReduced?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translate(-50%,-30%) scale(.65)'},{opacity:1,transform:target}],{duration:sequenceReduced?160:430,delay:sequenceReduced?0:index*15,easing:'cubic-bezier(.18,.8,.2,1)'});
    });
    later(beginReveal,sequenceReduced?220:650);
  }
  function beginReveal(){
    packPhase='reveal';const overlay=host.querySelector('.hc-card-pack-overlay');overlay.dataset.phase=packPhase;overlay.querySelector('h3').textContent='為你，逐張揭曉';
    const nodes=[...host.querySelectorAll('.hc-opening-card')],stagger=sequenceReduced?8:140,duration=sequenceReduced?200:620;
    nodes.forEach((node,index)=>later(()=>{
      const frame=node.querySelector('.hc-collectible');node.classList.add('is-revealing');
      if(sequenceReduced){animate(frame,[{opacity:1},{opacity:0}],{duration:70});later(()=>{frame.style.transform='rotateY(0deg)';animate(frame,[{opacity:0},{opacity:1}],{duration:110});},75);}
      else{animate(frame,[{transform:'rotateY(180deg)'},{transform:'rotateY(0deg)'}],{duration,easing:'cubic-bezier(.18,.75,.25,1)'});const rest=node.style.transform;animate(node,[{transform:rest},{transform:`${rest} translateY(-12px) scale(1.1)`,offset:.45},{transform:rest}],{duration});}
      later(()=>{frame.style.transform='rotateY(0deg)';revealedCount++;node.dataset.revealed='true';const progress=host.querySelector('.hc-opening-progress');if(progress)progress.textContent=`${format(revealedCount)} / ${format(batchItems.length)}`;},duration);
    },index*stagger));
    later(()=>{packPhase='results';render();animate(host.querySelector('.hc-batch-result-grid'),[{opacity:0},{opacity:1}],{duration:sequenceReduced?80:220});},Math.max(0,nodes.length-1)*stagger+duration+(sequenceReduced?100:220));
  }
  function cinematicDeck(){
    const deck=element('div','hc-opening-deck');
    batchItems.forEach(item=>{const card=cardById(item.cardId);if(!card)return;const node=element('div','hc-opening-card');node.dataset.rarity=card.rarity;node.dataset.drawSerial=String(item.serial);node.dataset.cardId=card.id;node.dataset.revealed='false';const frame=surface(card);frame.style.transform='rotateY(180deg)';frame.querySelector('img').loading='eager';node.append(frame);deck.append(node);});
    return deck;
  }
  function renderPack(){
    const overlay=element('section','hc-card-overlay hc-card-pack-overlay');overlay.setAttribute('aria-label',busy()?'正在開啟所有卡包':'卡包結果');
    overlay.dataset.phase=packPhase;overlay.setAttribute('aria-live','polite');
    const headings={charge:`${format(openingCount)} 份心動，正在凝聚`,tear:'心意，為你盛放',backs:'你的專屬收藏，即將揭曉',reveal:'為你，逐張揭曉',results:`獲得 ${format(batchItems.length)} 張心動卡片`};
    const copy=element('div','hc-pack-heading');copy.append(element('small',null,'HEART COLLECTION'),element('h3',null,headings[packPhase]||'開啟心動卡包'));
    overlay.append(copy);
    if(packPhase==='results'&&batchItems.length){
      const grid=element('div','hc-batch-result-grid');grid.style.setProperty('--batch-columns',String(Math.min(5,batchItems.length)));grid.style.setProperty('--batch-small-columns',String(Math.min(3,batchItems.length)));
      sortedItems().forEach(item=>{
        const card=cardById(item.cardId);if(!card)return;
        const result=button('','inspect-result');result.className='hc-batch-result';result.dataset.cardId=card.id;result.dataset.drawSerial=String(item.serial);result.dataset.rarity=card.rarity;result.setAttribute('aria-label',`${card.name}，${card.rarity}，${item.isNew?'首次獲得':`重複收藏第 ${format(item.count)} 張`}`);
        const art=element('div','hc-batch-result-art');art.append(surface(card));result.append(art,element('strong',null,`${card.rarity} · ${card.name}`),element('span',item.isNew?'is-new':null,item.isNew?'NEW · 首次獲得':`重複收藏 · 第 ${format(item.count)} 張`));grid.append(result);
      });overlay.append(grid);
      const controls=element('div','hc-pack-actions');controls.append(button('全部收進收藏','dismiss'));overlay.append(controls);
    }else if(packPhase==='backs'||packPhase==='reveal'){
      overlay.append(cinematicDeck(),element('p','hc-opening-progress',`${format(revealedCount)} / ${format(batchItems.length)}`));
    }else{
      const available=num(cards?.drawsAvailable),capacity=num(cards?.capacity)||10;
      const count=busy()?openingCount:Math.max(1,Math.min(available,capacity));const fan=element('div','hc-pack-fan');fan.dataset.count=String(count);fan.append(element('i','hc-pack-charge-halo'));
      for(let index=0;index<count;index++){
        const pack=element('div','hc-sealed-pack');const offset=index-(count-1)/2;pack.style.setProperty('--pack-offset',String(offset));pack.style.setProperty('--pack-rise',String(Math.abs(offset)));for(const side of ['left','right'])pack.append(element('i',`hc-pack-half hc-pack-${side}`));pack.append(element('span',null,'♛'),element('strong',null,'心 動 卡 包'),element('small',null,'你的專屬收藏'));fan.append(pack);
      }const burst=element('div','hc-pack-burst');for(let index=0;index<12;index++)burst.append(element('i',null,index%2?'✧':'✦'));fan.append(burst);overlay.append(fan);
      if(!busy()){const status=element('p','hc-pack-stock',`可開啟 ${format(available)} / ${format(capacity)} 包`);overlay.append(status);
      const open=button(`全部開啟 ${format(available)} 包`,'open-pack');open.className='hc-open-pack';open.disabled=cards?.ready===false||cards?.canDraw===false||available<1;overlay.append(open);}
    }
    if(packMode&&!busy()){const back=button('返回心動時分','collection');back.className='hc-pack-back';overlay.append(back);}
    return overlay;
  }
  function renderViewer(card){
    const viewer=element('section','hc-card-viewer');viewer.setAttribute('aria-label',`${card.name}，${card.rarity}，持有 ${format(card.count)} 張，卡片檢視`);viewer.dataset.cardId=card.id;
    const title=element('div','hc-card-viewer-heading');title.append(element('h3',null,card.name),button(batchItems.length?'返回本次結果':'返回卡片','viewer-back'));viewer.append(title);
    const stage=element('div','hc-card-stage');stage.tabIndex=0;stage.setAttribute('role','application');stage.setAttribute('aria-label','拖曳旋轉卡片，滾輪縮放，雙擊翻面；方向鍵旋轉，F 翻面，加減鍵縮放，0 重設');
    const zoom=element('div','hc-card-zoom');const cardSurface=surface(card);zoom.append(cardSurface);stage.append(zoom);viewer.append(stage);
    let rotationX=0,rotationY=0,scale=1,drag=null,pointerX=.5,pointerY=.5;
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    viewerPoseReader=()=>stage.isConnected?{cardId:card.id,rarity:card.rarity,rotationX,rotationY,rx:rotationX,ry:rotationY,zoom:scale,pointer:{x:pointerX,y:pointerY},pointerX,pointerY,rect:rect(zoom),stageRect:rect(stage)}:null;
    const emitPose=()=>{if(onViewerPose&&stage.isConnected)onViewerPose(viewerPoseReader());};
    const update=()=>{
      cardSurface.style.transform=`rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;zoom.style.transform=`scale(${scale})`;stage.dataset.rotationX=String(rotationX);stage.dataset.rotationY=String(rotationY);stage.dataset.zoom=String(scale);
      const rx=rotationX*Math.PI/180,ry=rotationY*Math.PI/180,normalX=Math.sin(ry),normalY=-Math.sin(rx)*Math.cos(ry),normalZ=Math.cos(rx)*Math.cos(ry);
      cardSurface.style.setProperty('--reflect-x',`${50+normalX*43}%`);cardSurface.style.setProperty('--reflect-y',`${50-normalY*43}%`);
      cardSurface.style.setProperty('--reflect-angle',`${110+rotationY*.7-rotationX*.4}deg`);cardSurface.style.setProperty('--reflect-hue',`${(rotationY*.85+rotationX*.5)%360}deg`);
      cardSurface.style.setProperty('--reflect-strength',String(.16+(1-Math.abs(normalZ))*.34));cardSurface.style.setProperty('--reflect-tilt',`${normalX*9-normalY*6}deg`);
      emitPose();
    };
    const changeZoom=delta=>{scale=Math.max(.65,Math.min(2.1,scale+delta));update();};
    function control(code){if(code==='zoom-in')changeZoom(.15);if(code==='zoom-out')changeZoom(-.15);if(code==='flip'){rotationY+=180;update();}if(code==='reset'){rotationX=0;rotationY=0;scale=1;update();}}
    const down=event=>{if(viewerSuspended||event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,rx:rotationX,ry:rotationY};stage.setPointerCapture(event.pointerId);stage.classList.add('is-dragging');stage.focus({preventScroll:true});event.preventDefault();};
    const move=event=>{if(viewerSuspended)return;const bounds=stage.getBoundingClientRect();pointerX=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));pointerY=Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height));cardSurface.style.setProperty('--shine-x',`${pointerX*100}%`);cardSurface.style.setProperty('--shine-y',`${pointerY*100}%`);if(drag&&event.pointerId===drag.id){rotationY=drag.ry+(event.clientX-drag.x)*.65;rotationX=drag.rx-(event.clientY-drag.y)*.65;update();}else emitPose();};
    const up=event=>{if(!drag||event.pointerId!==drag.id)return;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);drag=null;stage.classList.remove('is-dragging');};
    const wheel=event=>{if(viewerSuspended)return;event.preventDefault();event.stopPropagation();changeZoom(event.deltaY<0?.1:-.1);};
    const key=event=>{const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyF','Equal','NumpadAdd','Minus','NumpadSubtract','Digit0'];if(viewerSuspended||!keys.includes(event.code))return;event.preventDefault();event.stopPropagation();if(event.code==='ArrowLeft')rotationY-=15;if(event.code==='ArrowRight')rotationY+=15;if(event.code==='ArrowUp')rotationX+=15;if(event.code==='ArrowDown')rotationX-=15;if(event.code==='KeyF')control('flip');if(['Equal','NumpadAdd'].includes(event.code))control('zoom-in');if(['Minus','NumpadSubtract'].includes(event.code))control('zoom-out');if(event.code==='Digit0')control('reset');update();};
    const flip=event=>{if(viewerSuspended)return;event.preventDefault();control('flip');};
    stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,up);stage.addEventListener('wheel',wheel,{passive:false});stage.addEventListener('keydown',key);stage.addEventListener('dblclick',flip);update();
    if(onViewerPose)window.addEventListener('resize',emitPose);
    cancelViewerDrag=()=>{const pointerId=drag?.id;drag=null;stage.classList.remove('is-dragging');if(pointerId!==undefined&&stage.hasPointerCapture(pointerId))stage.releasePointerCapture(pointerId);};
    releaseViewer=()=>{cancelViewerDrag();stage.removeEventListener('pointerdown',down);stage.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.removeEventListener(type,up);stage.removeEventListener('wheel',wheel);stage.removeEventListener('keydown',key);stage.removeEventListener('dblclick',flip);window.removeEventListener('resize',emitPose);cancelViewerDrag=()=>{};releaseViewer=()=>{};};
    return viewer;
  }
  function render(){
    if(!host)return;clearAnimations();host.replaceChildren();host.classList.add('hc-cards-host');
    if(viewerId&&!viewerRoot){const viewer=cardById(viewerId);if(viewer&&num(viewer.count)>0){viewerElement=renderViewer(viewer);host.append(viewerElement);return;}}
    if(packMode){host.append(renderPack());return;}
    const collection=element('section','hc-card-collection');const header=element('div','hc-card-collection-heading');header.append(element('h3',null,'心動收藏'));
    const open=button(`開卡包 · ${format(cards?.drawsAvailable)} / ${format(cards?.capacity||10)}`,'draw');open.className='hc-open-pack';header.append(open);collection.append(header);
    const grid=element('div','hc-card-grid');
    const collectionCards=values(cards?.catalog).map((card,index)=>({card,index})).filter(entry=>entry.card.characterId===characterId).sort((a,b)=>(rarityRank[a.card.rarity]??3)-(rarityRank[b.card.rarity]??3)||a.index-b.index).map(entry=>entry.card);
    for(const card of collectionCards){
      const owned=num(card.count)>0,tile=button('','view');tile.className='hc-card-tile';tile.dataset.cardId=card.id;tile.dataset.rarity=card.rarity||'N';tile.classList.toggle('is-locked',!owned);tile.setAttribute('aria-label',owned?`${card.name}，${card.rarity}，持有 ${format(card.count)} 張`:`${card.name}，尚未收藏`);
      const art=element('div','hc-card-tile-art');art.append(image(card));art.append(element('span','hc-card-rarity',card.rarity||'N'));if(!owned)art.append(element('span','hc-card-lock','♡ 尚未收藏'));
      tile.append(art,element('strong',null,card.name),element('small',null,owned?`持有 ${format(card.count)} 張`:'開啟卡包，有機會收藏'));grid.append(tile);
    }
    if(!grid.children.length)grid.append(element('p','hc-gallery-empty','她的卡片即將登場。'));collection.append(grid);
    const odds=values(Object.entries(cards?.rarityOdds||{})).map(([rarity,chance])=>`${rarity} ${Math.round(num(chance)*100)}%`).join(' · ');collection.append(element('p','hc-card-odds',odds||'每包隨機獲得 1 張卡片'));
    host.append(collection);if(busy()||batchItems.length)host.append(renderPack());
  }
  function onClick(event){
    const target=event.target.closest('[data-card-action]');if(!target||(!host?.contains(target)&&!viewerRoot?.contains(target)))return;
    if(viewerSuspended&&viewerRoot?.contains(target))return;
    const code=target.dataset.cardAction;
    if(code==='draw'){if(onOpenPack)onOpenPack();else draw();}
    if(code==='open-pack')draw();
    if(code==='collection')onOpenCollection?.();
    if(code==='dismiss')closeOverlay();
    if(code==='viewer-back'){closeViewer();if(!viewerRoot)render();}
    if(code==='view'){
      const card=cardById(target.dataset.cardId);if(!card)return;
      if(num(card.count)>0)openViewer(card.id);
      else{let hint=host.querySelector('.hc-card-locked-hint');if(!hint){hint=element('p','hc-card-locked-hint');hint.setAttribute('role','status');host.querySelector('.hc-card-collection')?.append(hint);}hint.textContent=`${card.name}尚未收藏，開啟卡包有機會獲得。`;}
    }
    if(code==='inspect-result'&&packPhase==='results')openViewer(target.dataset.cardId);
  }
  function release(){if(host){host.removeEventListener('click',onClick);host.classList.remove('hc-cards-host');}viewerRoot?.removeEventListener('click',onClick);closeViewer(false);host=null;batchItems=[];openingCount=0;waiting=false;packPhase='idle';stopTimers();}
  return {
    mount(target,observed,selectedCharacter){release();packMode=false;host=target;cards=observed||{};characterId=selectedCharacter;lastSerial=cards.lastDraw?.serial??null;lastBatchSerial=cards.lastBatch?.serial??null;host.addEventListener('click',onClick);viewerRoot?.addEventListener('click',onClick);render();},
    mountPack(target,observed){release();packMode=true;host=target;cards=observed||{};lastSerial=cards.lastDraw?.serial??null;lastBatchSerial=cards.lastBatch?.serial??null;host.addEventListener('click',onClick);viewerRoot?.addEventListener('click',onClick);render();},
    update(observed){
      if(!observed)return;
      const previous=cards;cards=observed;const serial=cards.lastDraw?.serial??null,batchSerial=cards.lastBatch?.serial??null;
      if(host&&viewerId&&num(cardById(viewerId)?.count)<1){closeViewer();render();}
      if(host&&batchSerial!==null&&batchSerial!==lastBatchSerial&&waiting){
        clearTimeout(pendingTimer);pendingTimer=null;waiting=false;batchItems=values(cards.lastBatch.items).map(item=>({...item}));
        later(beginTear,(sequenceReduced?200:950)-(performance.now()-drawStartedAt));
      }
      else if(host&&!waiting&&!viewerId&&!batchItems.length&&JSON.stringify(previous)!==JSON.stringify(cards))render();
      lastSerial=serial;lastBatchSerial=batchSerial;
    },
    release,
    escape(){if(viewerId){closeViewer();if(!viewerRoot)render();return true;}if(!batchItems.length&&!waiting)return false;closeOverlay();return true;},
    getViewerElement(){return viewerElement;},
    getViewerPose(){return viewerPoseReader();},
    setShaderReady(cardId,ready){if(String(cardId)!==String(viewerId)||!viewerElement)return;const card=cardById(viewerId);shaderReady=Boolean(ready)&&['R','SR'].includes(card?.rarity);viewerElement.querySelector('.hc-collectible')?.classList.toggle('is-engine-shader-ready',shaderReady);},
    setSuspended(value){viewerSuspended=Boolean(value);if(viewerSuspended)cancelViewerDrag();},
    metadata(){return {mounted:Boolean(host),packMode,viewerId,viewerSuspended,shaderReady,resultId:null,resultItems:batchItems.map(item=>({...item})),sortedResults:sortedItems().map(item=>({...item})),batchSize:batchItems.length,openingCount,waiting,packPhase,revealedCount,sequenceReduced,lastSerial,lastBatchSerial};}
  };
}
