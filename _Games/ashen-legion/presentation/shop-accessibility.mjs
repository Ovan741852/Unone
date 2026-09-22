// Standard Canvas fallback controls project the very same rendered action tree.
// No second renderer, purchase rules, prices or RNG live in this adapter.
// https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element
export function createShopAccessibility({canvas,stage,onAction,onHold=()=>{}}){
 const root=document.createElement('div');root.dataset.shopSemantics='';root.hidden=true;
 const status=document.createElement('p');status.id='shop-accessible-status';status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
 const description=document.createElement('p');description.id='shop-accessible-description';
 root.append(status,description);canvas.append(root);
 const ring=document.createElement('div');ring.dataset.shopFocus='';ring.hidden=true;
 Object.assign(ring.style,{position:'absolute',pointerEvents:'none',zIndex:'5',outline:'3px solid #ffe197',outlineOffset:'3px',boxShadow:'0 0 0 3px #192219',borderRadius:'4px'});stage.append(ring);
 const buttons=new Map();let rects=new Map(),wasModal=false,returnId='',active=false,keyboard=false,closeAction='',heldAction='';
 const releaseHold=()=>{if(heldAction){onHold(heldAction,false);heldAction=''}};
 const assign=(el,key,value)=>{if(el.getAttribute(key)!==value)el.setAttribute(key,value)};
 const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value};
 function focusRing(){
  const target=document.activeElement,r=rects.get(target?.dataset.shopControl);
  ring.hidden=!keyboard||!active||!root.contains(target)||!r;
  if(!ring.hidden)Object.assign(ring.style,{left:r.x+'%',top:(100-r.y-r.height)+'%',width:r.width+'%',height:r.height+'%'});
 }
 root.addEventListener('focusin',focusRing);root.addEventListener('focusout',()=>{ring.hidden=true;releaseHold()});
 const onKeyboard=()=>{keyboard=true;focusRing()},onPointer=()=>{keyboard=false;focusRing()};
 document.addEventListener('keydown',onKeyboard,true);document.addEventListener('pointerdown',onPointer,true);
 window.addEventListener('blur',releaseHold);
 root.addEventListener('keydown',event=>{
  if(['Space','Enter'].includes(event.code)&&event.target.dataset.action==='OpenChest'){
   event.preventDefault();if(!heldAction){heldAction='OpenChest';onHold(heldAction,true)}return;
  }
  if(event.code==='Escape'){event.preventDefault();onAction(closeAction||'Escape');}
  if(event.key==='Tab'&&wasModal){
   const targets=[...buttons.values()].filter(b=>!b.disabled),index=targets.indexOf(document.activeElement);
   if(targets.length&&(event.shiftKey&&index<=0||!event.shiftKey&&index===targets.length-1)){
    event.preventDefault();targets[event.shiftKey?targets.length-1:0].focus();
   }
  }
 });
 root.addEventListener('keyup',event=>{if(['Space','Enter'].includes(event.code)&&heldAction){event.preventDefault();releaseHold()}});
 function sync(tree,game){
  const nodes=tree?.children??[],by=new Map(nodes.map(n=>[n.id,n]));
  active=nodes.length>0;root.hidden=!active;
  if(!active){buttons.forEach(b=>b.remove());buttons.clear();rects.clear();wasModal=false;focusRing();return;}
  const kind=by.has('shop_detail_title')?'shop':by.has('town_upgrade_title')?'town':by.has('gear_detail_title')?'gear':by.has('delete_warning')?'delete':by.has('enchant_reveal_name')?'enchant':by.has('abandon_warning')?'abandon':game.autoConfigOpen?'auto':'';
  const modal=!!kind,title=by.get(kind+'_detail_title')?.text??by.get('town_upgrade_title')?.text;
  closeAction=({shop:'ShopDetailClose',gear:'GearDetailClose',town:'TownUpgradeCancel',delete:'CancelDelete',enchant:'KeepEnchant',abandon:'UI_home',auto:'Auto_cancel'})[kind]??'';
  const modalIds={shop:['shop_detail_close','shop_detail_buy'],gear:['gear_detail_close','gear_detail_equip'],town:['town_upgrade_cancel','town_upgrade_confirm'],delete:['delete_cancel','delete_confirm'],enchant:['enchant_keep','enchant_accept'],abandon:['abandon_cancel','abandon_confirm']};
  const first=modalIds[kind]?.[0]??(kind==='auto'?'auto_cancel':'');
  assign(root,'role',modal?'dialog':'group');assign(root,'aria-label',kind==='shop'?`裝備詳情：${title}`:title??by.get('screen_title')?.text??by.get('title')?.text??'森林領主');
  if(modal)assign(root,'aria-modal','true');else root.removeAttribute('aria-modal');
  assign(root,'aria-describedby',description.id);
  setText(status,['menu','battle','choice'].includes(game.phase)?'':`金幣 ${Math.floor(game.coins??0)}，強化結晶 ${game.crystals??0}。${game.phase==='shop'&&game.location==='market'?`下次重骰需要 ${game.refreshCost??2} 結晶。`:''}`);
  setText(description,kind==='shop'?['shop_detail_kicker','shop_detail_story','shop_detail_deploy','shop_detail_trigger','shop_detail_effect'].map(id=>by.get(id)?.text??'').join('。').replaceAll('\n',''):by.has('shop_window_title')?'點選商品卡查看完整技能。每個部位只裝一件。金色硬幣是派兵費變化，紫色結晶是商品售價。重骰不限次數，每次成功後加價。':nodes.filter(n=>n.kind==='text'&&(!modal||n.id.startsWith(kind+'_')||n.id===kind+'_warning')).map(n=>n.text).join('。'));
  if(game.phase==='map'){
   setText(status,`${by.get('map_stage')?.text??''}。${by.get('map_current_title')?.text??''}。${game.mapMoving?'行軍中，抵達後自動展開景點。':'已抵達，可以選擇景點。'}`);
   setText(description,`旅程依序前進，地圖編號不是可選路線。${by.get('map_next')?.text??''}。`);
  }
  const seen=new Set(),generic=nodes.filter(n=>{if(n.kind!=='button'||/_hit_(top|bottom)$/.test(n.id)||seen.has(n.action))return false;seen.add(n.action);return true}).sort((a,b)=>(b.rect.y+b.rect.height)-(a.rect.y+a.rect.height)||a.rect.x-b.rect.x).map(n=>n.id);
  const ids=modalIds[kind]??(by.has('shop_window_title')?['tab_home','tab_sell',...Array.from({length:4},(_,i)=>'stock_hit_'+(i+1)),'refresh','ready','quick_deploy']:generic);
  const focusedId=document.activeElement?.dataset.shopControl;
  if(kind==='shop'&&!wasModal){
   const index=Object.values(game.stock??{}).findIndex(item=>item.name===title);
   returnId=by.has('shop_window_title')?'stock_hit_'+(index+1):focusedId??'buy_'+(index%2+1);
  }else if(modal&&!wasModal)returnId=focusedId??'';
  const nextRects=new Map();
  for(const id of ids){
   const node=by.get(id);if(!node)continue;
   let button=buttons.get(id);
   if(!button){button=document.createElement('button');button.type='button';button.dataset.shopControl=id;button.addEventListener('click',()=>{if(!button.disabled&&button.dataset.action!=='OpenChest')onAction(button.dataset.action)});buttons.set(id,button);root.append(button);}
   const action=node.action??(id==='refresh'?by.get('refresh_content_hit')?.action:undefined);
   button.disabled=!action;button.dataset.action=action??'';
   let label=node.text;
   if(id==='tab_gear')label='裝備分頁';
   if(id==='tab_runes')label='符文分頁';
   if(/^roster_unit_\d+$/.test(id)||/^unit_\d+$/.test(id))label=`${['劍兵','槍兵','騎兵'][Number(id.split('_').at(-1))-1]??'兵種'}，派兵費 ${game.costs?.[Number(id.split('_').at(-1))-1]??''} 金`;
   if(id==='gear_scroll_up')label='裝備列表向上滾動';
   if(id==='gear_scroll_down')label='裝備列表向下滾動';
   if(id==='rune_scroll_up')label='符文列表向上滾動';
   if(id==='rune_scroll_down')label='符文列表向下滾動';
   if(/^slot_\d+$/.test(id))label=`${['頭','身','腳','手','武器'][Number(id.split('_')[1])-1]??'裝備'}裝備槽，點擊開啟裝備列表`;
   if(/^choice_\d+$/.test(id)){const i=id.split('_')[1];label=`${by.get('choice_name_'+i)?.text}，${by.get('choice_desc_'+i)?.text.replaceAll('\n','')}。拜訪此處`;}
   if(/^town_\d+$/.test(id)){const i=id.split('_')[1];label=`${by.get('town_name_'+i)?.text}，${by.get('town_effect_'+i)?.text}，建材 ${by.get('town_cost_'+i)?.text}。查看研究條件`;}
   if(/^profile_(create|load|delete)_\d+$/.test(id))label=`札記 ${id.split('_').at(-1)}，${node.text}`;
   if(/^settings_(quality|language)$/.test(id))label=`${by.get(id+'_label')?.text}，目前 ${by.get(id+'_value')?.text}，${node.text}`;
   if(/^inspect_\d+$/.test(id))label=`${by.get('gear_name_'+id.split('_')[1])?.text}，查看裝備詳情`;
   if(/^equip_\d+$/.test(id))label=`${by.get('gear_name_'+id.split('_')[1])?.text}，${node.text}`;
   if(id.startsWith('stock_hit_')){const i=id.split('_').at(-1),item=Object.values(game.stock??{})[Number(i)-1];label=item?`${item.name}，${by.get('stock_desc_'+i)?.text.replaceAll('\n','')??''}，售價 ${item.price} 結晶，派兵費增加 ${item.deployExtra??0} 金幣${item.sold?'，已取得':''}。查看詳情`:'查看商品詳情';}
   if(id==='quick_deploy')label='直接出戰，使用目前配裝；新買裝備需先穿戴';
   if(id==='refresh')label=`重骰商品，消耗 ${game.refreshCost??2} 結晶${action?'':'，結晶不足'}`;
   if(id==='shop_detail_buy')label=`${node.text}，售價 ${by.get('shop_detail_price')?.text??''} ${by.get('shop_detail_price_icon')?.asset==='texture://ui_icon-coin'?'金幣':'結晶'}`;
   if(/^sale_\d+$/.test(id))label=`${by.get('sale_name_'+id.split('_')[1])?.text??''}，${node.text}`;
   if(/^auto_pick_/.test(id))label=by.get(id.replace('pick','name'))?.text;
   if(/^hud_unit_\d+$/.test(id))label=by.get(id.replace('unit_','unit_caption_'))?.text;
   if(id==='pause')label='暫停戰鬥';
   if(/^mode_(lock|auto)$/.test(id))label=by.get(id.replace('mode_','mode_label_'))?.text;
   if(/^settings_.*_(down|up)$/.test(id))label=(by.get(id.replace(/_(down|up)$/,'_label'))?.text??'音量')+(id.endsWith('_down')?'減少':'增加');
   setText(button,label??action??'');
   const parts=nodes.filter(n=>n.id===id||n.action&&n.action===action||n.id===id+'_plate'||n.id.startsWith(id+'_plate_')).map(n=>n.rect);
   const x=Math.min(...parts.map(r=>r.x)),y=Math.min(...parts.map(r=>r.y));
   nextRects.set(id,{x,y,width:Math.max(...parts.map(r=>r.x+r.width))-x,height:Math.max(...parts.map(r=>r.y+r.height))-y});
  }
  for(const [id,button]of buttons)if(!ids.includes(id)||!by.has(id)){button.remove();buttons.delete(id);}
  rects=nextRects;
  if(heldAction&&![...buttons.values()].some(b=>b.dataset.action===heldAction))releaseHold();
  if(modal&&!wasModal)buttons.get(first)?.focus();
  else if(!modal&&wasModal)(buttons.get(returnId)??[...buttons.values()].find(b=>!b.disabled))?.focus();
  else if(focusedId&&buttons.get(focusedId)?.disabled)buttons.get(first)?.focus();
  else if(focusedId&&!buttons.has(focusedId))([...buttons.values()].find(b=>!b.disabled))?.focus();
  wasModal=modal;focusRing();
 }
 return {sync,dispose(){releaseHold();window.removeEventListener('blur',releaseHold);document.removeEventListener('keydown',onKeyboard,true);document.removeEventListener('pointerdown',onPointer,true);root.remove();ring.remove()}};
}
