// Presentation only: native Unone executes every decision, route and relationship in Luau.
import {createThreeRenderer} from '/web/renderer/three.js?build=smart-camera-v1';
import {TownCamera} from './camera.js';
import {CombatView} from './combat.js';
import {createTombstone,deadResidents,portraitAsset,presentationCopy,tombstonePosition} from './tombstone.js';
import {residentStatus} from './status.js';
import {residentBiography} from './biography.js';
import {buildingCatalog,buildingInfo,buildingPosition} from './buildings.js';
import {createRouteManager} from './routes.js';
const $=id=>document.getElementById(id);
// Luau's empty table can be encoded as {} instead of [] by the host.
const list=value=>Array.isArray(value)?value:[];
const canvas=$('world'), plates=new Map(), monsterPlates=new Map(), treasurePlates=new Map(), landmarks=[];
let latest, previous, receivedAt=0, sampleMs=100, selected='npc_1', detailOpen=false, context, world, routeManager, selectedRing;
let smartCamera=true, smartTarget=null, smartCandidate=null, smartCandidateSince=0, smartLastSwitch=0;
const SMART_HOLD_MS=9000,SMART_CANDIDATE_MS=900,SMART_EVENT_WINDOW=14,SMART_MISSING_GRACE=2800;
const camera=new TownCamera(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let paused=false, currentSpeed=1, lastUi=-1, connected=false, averageFps=60, lastRender=performance.now();
const shadows=new Map(),realmRings=new Map();
const REALM_COLORS={練氣:0x75c9ff,築基:0x8cff9b,金丹:0xffd45c,元嬰:0xe9a0ff};
let combatView;
let townLayout={},selectedBuilding=null,lastBuildingKey='';
const api=async command=>{const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const value=await response.json();if(!response.ok||value.error)throw Error(value.error||'Native unavailable');return value;};
const action=async name=>{try{await api({method:'input',frame:{actions:{[name]:true}}});}catch(e){$('connection').textContent=e.message;}};
const portrait=npc=>'/assets/external/kenney-characters/Previews/'+(portraitAsset(world,npc).split('://')[1]||'character-male-a')+'.png';
const shortAction=npc=>(npc.alive!==false?(npc.monster_combat?'斬妖 · '+npc.monster_combat.monster_name+' '+npc.monster_combat.monster_hp+'/'+npc.monster_combat.monster_max_hp:(npc.combat?(npc.combat.phase==='aftermath'?(npc.combat.winner_id===npc.id?'勝負已定 · 選擇殺死／掠奪／打暈／放過':'落敗 · 可逃離／反抗／停手'):(npc.combat.mode==='duel'?'切磋':'交戰')+' · '+({approach:'接近',ready:'對峙',windup:'出招'}[npc.combat.phase]||'交鋒'))+(npc.interaction?.counterpart_name?' · '+npc.interaction.counterpart_name:''):npc.interaction?.head_label||(npc.traveling?'前往 · ':'')+npc.action)): '已故');
const SMART_PAIR_ACTIONS={attack:94,duel:92,rob:86,steal:84,resist:82,propose:76,flirt:70,treat:66,help:62,cooperate:54};
const SMART_EVENT_SCORE={critical:122,hit:112,finish:104,start:100,miss:96,swing:88};
// ponytail: bounded 40-resident/32-event scan; add spatial indexing only if the town grows materially.
function smartCandidates(snapshot){
 const o=snapshot?.observations||{},vm=o.view_model||{},people=new Map(list(vm.npc).map(n=>[n.id,n])),candidates=[];
 const add=(ids,score,reason,distance=34)=>{
  const unique=[...new Set(ids)].filter(id=>people.get(id)?.alive!==false&&snapshot.entities?.[id]?.transform3d?.position);
  if(!unique.length)return;
  const positions=unique.map(id=>snapshot.entities[id].transform3d.position),position={x:0,z:0};
  positions.forEach(p=>{position.x+=p.x/positions.length;position.z+=p.z/positions.length;});
  const key=unique.slice().sort().join('|'),old=candidates.find(item=>item.key===key),item={key,ids:unique,score,reason,position,distance};
  if(old){if(score>old.score)Object.assign(old,item);}else candidates.push(item);
 };
 for(const npc of people.values()){
  const opponent=npc.combat?.opponent_id;
  if(opponent)add([npc.id,opponent],140,'戰鬥進行中',30);
  if(npc.monster_combat)add([npc.id],136,'斬妖戰鬥 · '+npc.monster_combat.monster_name,30);
 }
 const clock=Number(o.combat?.clock);
 for(const event of list(o.combat?.events).slice(-32)){
  const age=clock-Number(event.time);if(!Number.isFinite(age)||age<0||age>SMART_EVENT_WINDOW)continue;
  add([event.actor_id,event.target_id],(SMART_EVENT_SCORE[event.kind]||86)-Math.min(age,SMART_EVENT_WINDOW)*1.5,'戰鬥 · '+(event.kind==='critical'?'重擊':event.kind==='miss'?'MISS':event.kind==='finish'?'收招':'交鋒'),30);
 }
 for(const npc of people.values()){
  const score=SMART_PAIR_ACTIONS[npc.action_id],target=npc.interaction_target_id;
  if(npc.alive!==false&&score&&target&&npc.task?.complete!==true&&!npc.traveling)add([npc.id,target],score,npc.action||npc.action_id,36);
 }
 return candidates.sort((a,b)=>b.score-a.score);
}
function setSmartCamera(enabled){
 smartCamera=enabled;smartCandidate=null;smartCandidateSince=0;
 if(!enabled){smartTarget=null;camera.clearSmartTarget();}else smartLastSwitch=0;
 updateCameraUi();
}
function updateSmartCamera(now){
 if(!smartCamera||!world)return;
 const candidates=smartCandidates(world),best=candidates[0],existing=smartTarget&&candidates.find(item=>item.key===smartTarget.key);
 if(existing){smartTarget={...smartTarget,...existing,lastSeen:now};camera.setSmartTarget(existing.position,existing.distance);}
 else if(smartTarget&&now-smartTarget.lastSeen>SMART_MISSING_GRACE){smartTarget=null;camera.clearSmartTarget();}
 if(!best){updateCameraUi();return;}
 if(!smartCandidate||smartCandidate.key!==best.key){smartCandidate=best;smartCandidateSince=now;}else smartCandidate=best;
 const stable=now-smartCandidateSince>=SMART_CANDIDATE_MS,canSwitch=!smartTarget||now-smartTarget.startedAt>=SMART_HOLD_MS;
 if(stable&&canSwitch&&now-smartLastSwitch>=SMART_CANDIDATE_MS&&(!smartTarget||best.key!==smartTarget.key)){
  smartTarget={...best,startedAt:now,lastSeen:now};smartLastSwitch=now;camera.setSmartTarget(best.position,best.distance);
 }
 if(smartTarget){const current=candidates.find(item=>item.key===smartTarget.key);if(current)camera.setSmartTarget(current.position,current.distance);}
 updateCameraUi();
}
let lastIdentityKey='';
function identityRows(npc){
 const profile=npc.identity,key=JSON.stringify([npc.id,profile]);
 if(key===lastIdentityKey)return;lastIdentityKey=key;
 $('person-values').textContent=profile?'重視順序：'+profile.values:'人物設定尚未載入';
 $('person-love').textContent=profile?'感情態度：'+profile.love_style:'請確認 native 已更新並重新載入遊戲。';
 for(const [id,field]of [['red-line','red_line'],['love-boundary','love_boundary'],['tension','tension']])$('person-'+id).textContent=profile?.[field]||'—';
 const fragment=document.createDocumentFragment();
 for(const trait of list(profile?.traits)){
  const row=document.createElement('div'),label=document.createElement('label'),score=document.createElement('span'),meter=document.createElement('meter'),ends=document.createElement('p');
  meter.id='trait-'+trait.id;meter.min=0;meter.max=100;meter.value=trait.value;
  label.htmlFor=meter.id;label.textContent=trait.name;score.textContent=trait.value+'/100';label.append(score);
  ends.textContent='0 '+trait.low+' — 100 '+trait.high;ends.id=meter.id+'-ends';meter.setAttribute('aria-describedby',ends.id);
  row.append(label,meter,ends);fragment.append(row);
 }
 $('person-traits').replaceChildren(fragment);
}
function inventoryRows(npc){
 const fragment=document.createDocumentFragment();
 for(const item of list(npc.inventory)){
  const row=document.createElement('li'),name=document.createElement('strong'),count=document.createElement('span'),note=document.createElement('small');
  name.textContent=item.name;count.textContent='×'+item.quantity;note.textContent=item.kind+' · '+item.description;
  row.append(name,count,note);fragment.append(row);
 }
 if(!fragment.childNodes.length){const empty=document.createElement('li');empty.textContent='沒有攜帶物品';fragment.append(empty);}
 $('person-inventory').replaceChildren(fragment);
 $('person-item-event').textContent=(npc.alive?'':'遺物保留。')+(npc.item_event||'');
}
function biographyRows(npc,people){
 const bio=residentBiography(npc,people);
 for(const key of ['bio','background','preferences','martial','relations','career'])$('person-'+key).textContent=bio[key];
 $('person-career-row').hidden=!bio.dead;
 $('person-career').hidden=!bio.dead;
 for(const [id,home]of [['person-biography',bio.dead?'memorial-life':'biography-home'],['person-finance',bio.dead?'memorial-records':'finance-home']]){
  const element=$(id),target=$(home);
  if(element.parentElement!==target){target.append(element);if(id==='person-finance')$('person-ledger-details').open=bio.dead;}
 }
 $('person-ledger-heading').textContent=bio.dead?'最近留存紀錄（非完整生平）':'個人最近收支';
 return bio;
}
function chronicleRows(npc){
 const mentor=npc.mentor_name?`師承：${npc.mentor_name}（第 ${npc.mentor_since_day||'—'} 日起）`:'師承：尚未拜師';
 const disciples=list(npc.disciples).map(item=>item.name).join('、');
 $('person-mentor').textContent=mentor+(disciples?' · 門下：'+disciples:'');
 const fragment=document.createDocumentFragment();
 for(const entry of list(npc.chronicle).slice(0,28)){
  const row=document.createElement('li'),head=document.createElement('strong'),body=document.createElement('span'),note=document.createElement('small');
  head.textContent=`第 ${entry.day||'—'} 日 ${entry.time||''} · ${entry.kind||'事件'}`;
  body.textContent=entry.text||'';
  note.textContent=entry.perspective==='actor'?(entry.target_name?'主動對象：'+entry.target_name:'主動行動'):(entry.actor_name?'涉及：'+entry.actor_name:'涉及事件');
  row.append(head,body,note);fragment.append(row);
 }
 if(!fragment.childNodes.length){const empty=document.createElement('li');empty.textContent='尚無編年紀錄；重要行動、互動與衝突會在發生後留下。';fragment.append(empty);}
 $('person-chronicle').replaceChildren(fragment);
}
function select(id){setSmartCamera(false);selectedBuilding=null;$('building-details').hidden=true;selected=id;detailOpen=true;$('details').hidden=false;if(innerWidth<=850){showEconomy(false);$('roster').hidden=true;}const npc=world?.observations?.view_model?.npc.find(item=>item.id===id);if(camera.followId){if(npc?.alive)camera.follow(id,world.entities[id]?.transform3d.position);else camera.stopFollowing();}action('inspect_'+id);updateUi(true);updateCameraUi();}
function selectBuilding(id){
 setSmartCamera(false);selectedBuilding=id;detailOpen=false;$('details').hidden=true;camera.stopFollowing();
 if(innerWidth<=850){showEconomy(false);$('roster').hidden=true;}
 lastBuildingKey='';updateUi(true);updateCameraUi();$('building-title').focus({preventScroll:true});
}
function closeBuilding(){
 const label=landmarks.find(item=>item.building.id===selectedBuilding)?.element;
 selectedBuilding=null;$('building-details').hidden=true;updateUi(true);label?.focus({preventScroll:true});
}
function focusBuilding(){
 const building=landmarks.find(item=>item.building.id===selectedBuilding)?.building;
 if(building)camera.focus(buildingPosition(world,building));updateCameraUi();
}
function updateBuildingUi(){
 const catalog=buildingCatalog(townLayout,world);
 for(let i=landmarks.length-1;i>=0;i--)if(!catalog.some(b=>b.id===landmarks[i].building.id)){landmarks[i].element.remove();landmarks.splice(i,1);}
 for(const building of catalog){
  let item=landmarks.find(item=>item.building.id===building.id);
  if(!item){const element=document.createElement('button');element.type='button';element.className='landmark';element.dataset.id=building.id;element.hidden=true;
   element.setAttribute('aria-controls','building-details');element.onclick=()=>selectBuilding(building.id);
   $('landmarks').append(element);item={element,building};landmarks.push(item);
  }
  const info=buildingInfo(world,building);item.element.textContent=info.name;item.element.setAttribute('aria-expanded',String(selectedBuilding===building.id));
  item.element.setAttribute('aria-label',info.name+'，查看'+(building.kind==='home'?'住戶登記':'建築資料'));
 }
 const building=catalog.find(b=>b.id===selectedBuilding);$('building-details').hidden=!building;
 if(!building){selectedBuilding=null;lastBuildingKey='';return;}
 $('building-focus').disabled=!buildingPosition(world,building);
 const info=buildingInfo(world,building),key=JSON.stringify(info);if(lastBuildingKey===key)return;lastBuildingKey=key;
 $('building-title').textContent=info.name;$('building-purpose').textContent=info.purpose;$('building-note').textContent=info.note;
 $('building-occupancy').hidden=info.kind!=='facility';$('building-occupants').textContent=info.occupants;
 $('building-household').hidden=info.kind!=='home';
 $('building-residents').replaceChildren(...info.residents.map(n=>{
  const button=document.createElement('button'),name=document.createElement('strong'),note=document.createElement('small');
  button.type='button';button.className='resident';name.textContent=n.name;note.textContent=n.role+' · '+n.status;
  button.onclick=()=>{select(n.id);$('detail-close').focus({preventScroll:true});};button.append(name,note);return button;
 }));
 $('building-empty').hidden=info.residents.length>0;
}
const money=n=>Number(n||0).toLocaleString('zh-TW')+' 文';
function receipts(target,entries,npcId,memorial=false){
 const fragment=document.createDocumentFragment();
 for(const item of list(entries)){
  const row=document.createElement('li'),line=document.createElement('span'),reason=document.createElement('small');
  line.textContent=memorial?item.line:npcId?(item.to_id===npcId?'+':'−')+money(item.amount)+' · '+(item.to_id===npcId?item.from:item.to):item.from+' → '+item.to+' · '+money(item.amount);
  reason.textContent=memorial?item.reason:'第 '+item.day+' 日 · '+item.reason;row.append(line,reason);fragment.append(row);
 }
 if(!fragment.childNodes.length){const empty=document.createElement('li');empty.textContent=memorial?'未記錄':'尚無交易；居民到工作地點或商店後才會結算。';fragment.append(empty);}
 $(target).replaceChildren(fragment);
}
function economyRows(target,rows){
 const fragment=document.createDocumentFragment();
 for(const cells of rows){const tr=document.createElement('tr');cells.forEach((text,index)=>{const cell=document.createElement(index?'td':'th');if(!index)cell.scope='row';cell.textContent=text;tr.append(cell);});fragment.append(tr);}
 $(target).replaceChildren(fragment);
}
function updateEconomy(e){
 if(!e||$('economy').hidden)return;
 $('economy-summary').textContent='第 '+e.day+' 日 · 居民現金 '+money(e.resident_cash)+' · '+e.transactions+' 筆交易';
 $('economy-health').textContent='不足三餐預算：'+e.poor_residents+' 人　公庫：'+money(e.treasury);
 economyRows('goods',list(e.goods).map(g=>[g.name,g.price+' 文',g.stock+' / '+(g.carried||0),g.produced+' / '+g.consumed]));
 economyRows('businesses',list(e.businesses).map(b=>[b.name,money(b.balance),b.employees+' 人']));
 receipts('town-ledger',list(e.ledger).slice(0,12));
 $('economy-audit').textContent='資金核對：'+money(e.total_money)+'，差額 '+money(e.money_delta)+'（含遺產 '+money(e.estate_cash)+'）。累計工錢 '+money(e.totals.wage)+'／消費 '+money(e.totals.purchase)+'／稅收 '+money(e.totals.tax)+'。';
}
function showEconomy(open){
 $('economy').hidden=!open;$('economy-toggle').setAttribute('aria-expanded',String(open));
 if(open){$('roster').hidden=true;if(innerWidth<=850){detailOpen=false;$('details').hidden=true;selectedBuilding=null;$('building-details').hidden=true;camera.stopFollowing();}updateUi(true);updateCameraUi();}
}
function updateUi(force=false){
 if(!world)return;const o=world.observations,vm=o.view_model;
 const uiKey=[o.simulation_tick_count,vm.paused,vm.speed,world.decision_evidence?.updated_at].join(':');
 if(!force&&lastUi===uiKey)return;lastUi=uiKey;
 $('clock').textContent=vm.clock;paused=vm.paused;currentSpeed=vm.speed;$('pause').textContent=paused?'▷ 繼續':'Ⅱ 暫停';$('speed').textContent=currentSpeed+'×';
 const cycle=vm.day_cycle;
 $('day-phase').textContent=cycle?.phase||'時辰';$('day-time').textContent=vm.clock;
 $('day-progress').value=cycle?.cycle_fraction||0;
 $('day-progress').setAttribute('aria-valuetext',vm.clock+' · '+(cycle?.phase||''));
 $('event').textContent=vm.event_log[0]||'居民正從各自家門出發…';
 updateEconomy(vm.economy);
 updateBuildingUi();
 const ai=world.decision_evidence;
 const online=ai?.ready&&ai.phase==='running'&&Date.now()/1000-(ai.updated_at||0)<15;
 $('ai-status').textContent=paused?'人物決策：已暫停 · 保留 NanoJev 已採用指令':online?'人物決策：NanoJev · 已採用 '+ai.applied+' 次 · '+Math.round(ai.latency_ms||0)+' ms／批':'NanoJev '+(ai?.phase==='loading'?'載入中':ai?.phase==='error'?'推論異常':'未連線')+' · 不使用規則替代';
 for(const npc of vm.npc){
  let button=plates.get(npc.id);
  if(!button){button=document.createElement('button');button.className='nameplate';button.innerHTML='<strong></strong><small></small><span class="npc-status"></span><span class="npc-hp" aria-hidden="true"><i></i></span><span class="npc-hp-value"></span>';button.onpointerdown=e=>{e.preventDefault();e.stopPropagation();select(npc.id);};button.onclick=e=>{if(e.detail===0)select(npc.id);};$('nameplates').append(button);plates.set(npc.id,button);
   const row=document.createElement('button');row.className='resident';row.dataset.id=npc.id;row.innerHTML='<img alt=""><span><b></b><small></small></span>';row.querySelector('img').src=portrait(npc);row.querySelector('b').textContent=npc.name;row.onclick=()=>{const following=Boolean(camera.followId);select(npc.id);if(!following)focusResident();};$('residents').append(row);
  }
  const dead=npc.alive===false;button.querySelector('strong').textContent=dead?npc.name:npc.name+' · '+npc.emotion;button.querySelector('small').textContent=dead?'已故':npc.intent_icon+' '+shortAction(npc);button.setAttribute('aria-label',dead?npc.name+'，'+npc.role+'，已故，查看墓誌':npc.name+'，'+npc.role+'，'+npc.emotion+'，'+shortAction(npc)+'，查看詳情');button.classList.toggle('selected',detailOpen&&npc.id===selected);
  button.classList.toggle('memorial',dead);
  const status=residentStatus(npc),hp=status.hp;
  button.querySelector('.npc-status').textContent=status.compact;button.querySelector('.npc-status').hidden=dead;
  button.querySelector('.npc-hp i').style.transform=`scaleX(${(hp??0)/100})`;
  button.querySelector('.npc-hp-value').textContent=hp===null?'HP 未提供':hp+'/100 HP';button.querySelector('.npc-hp').hidden=dead||hp===null;button.querySelector('.npc-hp-value').hidden=dead;
  button.classList.toggle('fighting',!dead&&Boolean(npc.combat));button.classList.toggle('wounded',!dead&&hp!==null&&hp<=25);
  if(!dead)button.setAttribute('aria-label',button.getAttribute('aria-label')+'，目前狀態：'+status.full);
  button.title=npc.name+'：'+status.full;
 const row=$('residents').querySelector(`[data-id="${npc.id}"]`);row.querySelector('small').textContent=npc.role+' · '+(dead?'已故':npc.emotion);row.classList.toggle('active',npc.id===selected);row.hidden=!(npc.name+npc.role).includes($('search').value.trim());
 }
 for(const monster of list(o.monsters?.entities)){
  let label=monsterPlates.get(monster.id);
  if(!label){label=document.createElement('div');label.className='nameplate monster-plate';label.innerHTML='<strong></strong><small></small>';$('nameplates').append(label);monsterPlates.set(monster.id,label);}
  label.hidden=!monster.alive;label.querySelector('strong').textContent=monster.name;label.querySelector('small').textContent=monster.alive?'👹 HP '+monster.hp+'/'+monster.max_hp:'已退場';label.classList.toggle('fighting',Boolean(list(o.monsters?.active).find(fight=>fight.monster_id===monster.id)));
 }
 const treasure=o.treasure?.active;
 let treasureLabel=treasurePlates.get('rare_treasure');
 if(!treasureLabel){treasureLabel=document.createElement('div');treasureLabel.className='nameplate treasure-plate';treasureLabel.style.background='#204c55ed';treasureLabel.style.borderColor='#ffe58a';treasureLabel.style.color='#fff6c9';treasureLabel.innerHTML='<strong></strong><small></small>';$('nameplates').append(treasureLabel);treasurePlates.set('rare_treasure',treasureLabel);}
 treasureLabel.hidden=!treasure;
 if(treasure){treasureLabel.querySelector('strong').textContent='💎 '+treasure.name;treasureLabel.querySelector('small').textContent=treasure.claimed_name?'持有：'+treasure.claimed_name+' · '+treasure.remaining_minutes+' 分鐘':'稀世珍寶 · 競逐中 · '+treasure.remaining_minutes+' 分鐘';}
 const npc=vm.npc.find(n=>n.id===selected);
 const fighting=vm.npc.find(n=>n.combat||n.monster_combat);
 $('watch-fight').disabled=!fighting;
 $('combat-status').textContent=fighting?(fighting.monster_combat?fighting.name+' 正在斬妖：'+fighting.monster_combat.monster_name+' HP '+fighting.monster_combat.monster_hp+'/'+fighting.monster_combat.monster_max_hp:fighting.combat.phase==='aftermath'?fighting.name+' 已擊敗對手 · 等待 NanoJev 選擇處置':fighting.name+' 正在'+(fighting.combat.mode==='duel'?'切磋':'交戰')):'尚無交鋒 · 等待 NanoJev 決策';
 if(npc&&detailOpen){
  const dead=npc.alive===false;$('person-name').textContent=npc.name;$('person-role').textContent=npc.role+' · '+(dead?'已故':npc.personality);$('person-emotion').textContent='心情 · '+npc.emotion;
  const status=residentStatus(npc);
  const bio=biographyRows(npc,vm.npc);
  chronicleRows(npc);
  $('person-status-list').replaceChildren(...status.labels.map(label=>{const item=document.createElement('li');item.textContent=label;return item;}));
   const priority=(npc.needs_priority?.priority_items||[]).slice(0,3).map(item=>item.label+item.value+'['+item.level+']').join(' > ');
   $('person-status-values').textContent=status.metrics.join(' · ')+(priority?' · 需求排序：'+priority:'');$('person-status-values').hidden=dead;
  identityRows(npc);
  $('person-cultivation').textContent=(npc.realm||'凡人')+' · '+(npc.technique||'基礎吐納')+' · 修為 '+(npc.cultivation??0)+'/100 · 靈氣 '+(npc.qi??0)+'/100 · 法寶 '+(npc.artifacts??0)+'（飛劍威力 '+(npc.artifact_power??0)+'）';
  $('person-emotion-cause').textContent=npc.emotion_cause||'';
  $('person-combat').hidden=dead;$('person-combat').textContent=dead?'':status.hpText+' · '+(npc.monster_combat?shortAction(npc)+' · 公會委託進行中':npc.combat?shortAction(npc)+' → '+(vm.npc.find(n=>n.id===npc.combat.opponent_id)?.name||'對手'):(npc.combat_result||'未在戰鬥中'));
  $('person-memorial').hidden=!dead;$('person-death-cause').textContent=dead?bio.deathCause:'未記錄';$('person-estate').textContent=dead?'遺產：'+bio.estate+'；保留行囊見下方「隨身行囊」。':'';
  $('person-mind').hidden=dead;
  $('person-intent').textContent=npc.intent+' → '+npc.target;$('person-reason').textContent=npc.motive;
  $('person-interaction').textContent=npc.interaction?.summary?'互動中：'+npc.interaction.summary:npc.interaction_result?'執行結果：'+npc.interaction_result:npc.last_interaction?.summary?'最近互動：'+npc.last_interaction.summary:'';$('person-interaction').hidden=dead||!$('person-interaction').textContent;$('person-interaction').title=$('person-interaction').textContent;
  const plan=npc.next_plan;
  $('person-next-plan').textContent=!npc.alive?'已故，不再規劃':plan?plan.action_label+(plan.target_name?' → '+plan.target_name:''):(npc.decision_pending?'NanoJev 正在思考下一步；目前行動繼續。':'尚未排定下一步');
  $('person-plan-status').textContent=plan?(plan.timing==='after_current'?'先做完這一段，再接續預定行動。':'NanoJev 決定立刻改變；先走完正在踏的格子。'):(npc.plan_status||'');
  $('person-progress').textContent=npc.alive===false?'生命已結束，行動停止。':!npc.task?'等待第一個行動':npc.task.failed===true?'本段未完成；原因見互動紀錄／執行結果。':npc.task.complete?'本段已完成；下一個計畫可接續執行。':npc.traveling?'正在前往目的地；也能提前規劃下一步。':Number.isFinite(npc.task.duration_minutes)&&npc.task.duration_minutes>0&&Number.isFinite(npc.task.minutes)&&npc.task.minutes>=0?'本段已進行 '+Math.floor(npc.task.minutes)+'／'+Math.floor(npc.task.duration_minutes)+' '+(npc.task.duration_estimated===true?'預估':'預計')+'遊戲分鐘'+(Number.isFinite(npc.task.remaining_minutes)&&npc.task.remaining_minutes>=0?'，剩餘約 '+Math.floor(npc.task.remaining_minutes)+' 分鐘。':'，剩餘時間未提供。'):Number.isFinite(npc.task.minutes)&&npc.task.minutes>=0?'本段已進行 '+Math.floor(npc.task.minutes)+' 遊戲分鐘／'+(npc.task.ticks??0)+' 次執行。':'本段已開始執行。';
  $('person-rest').textContent=dead?'':(npc.sleeping===true?'正在睡覺，疲勞恢復中':npc.resting===true?'正在歇息，疲勞恢復中':npc.action_id==='rest'?'返家途中，抵達後才恢復疲勞':'尚未休息，由 NanoJev 決定作息')+' · 累計休息 '+(npc.rest_minutes||0)+' 分鐘（睡眠 '+(npc.sleep_minutes||0)+' 分鐘）';
  inventoryRows(npc);
  const src=portrait(npc);if($('portrait').getAttribute('src')!==src)$('portrait').src=src;
  for(const k of ['hunger','fatigue','morale','injury','loneliness','fear']){const known=Number.isFinite(npc[k])&&npc[k]>=0&&npc[k]<=100;$(k).hidden=!known;if(known)$(k).value=npc[k];$(k+'-value').textContent=known?npc[k]+'/100':'未提供';}$('person-stats').hidden=dead;
  const f=npc.finance;
  $('person-cash').textContent=dead?bio.estate+'（遺產）':money(npc.wealth);
  $('person-income').textContent=dead?bio.totals:f?'今日收入 '+money(f.today_income)+' ／支出 '+money(f.today_spent):'等候 Luau 收支資料…';
  $('person-employer').hidden=dead;$('person-employer').textContent=dead?'':f?f.employer+' · '+(f.contract_status==='active'?'契約中':f.contract_status==='suspended'?'契約暫停':'待找工作')+' · 每班 '+money(f.wage)+' · 已完成 '+f.shifts+' 班':'';
  $('person-finance-status').textContent=dead?(bio.records.length?'僅列最近留存的 '+bio.records.length+' 筆交易，按留存先後排列；交易日期不是死亡日期。':'最近交易未記錄；本輪紀錄不完整。'):f?.status||'';receipts('person-ledger',dead?bio.records:f?.receipts,npc.id,dead);
  const receipt=ai?.active_receipts?.[npc.id]||ai?.receipts?.[npc.id],verified=receipt?.request_id===npc.decision_request_id;
  const plannedReceipt=ai?.receipts?.[npc.id],planVerified=plan&&plannedReceipt?.request_id===plan.request_id;
  const distribution=verified?Object.entries(receipt.probabilities).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,p])=>id+': '+(p*100).toFixed(1)+'%').join('\n'):'尚無與目前已採用決策相符的機率紀錄';
  $('decision-details').hidden=dead;$('thinking').textContent='來源：'+npc.decision_source+'\n'+(ai?.selection==='sample'?'依模型機率抽樣 · T=1':'採用最高機率')+'\n'+distribution+'\n正在執行：'+(verified?receipt.action:'—')+'；目標：'+(verified?receipt.target:'—')+'\n預定證據：'+(planVerified?plannedReceipt.action+' / '+plannedReceipt.timing+'\n時機機率：'+Object.entries(plannedReceipt.timing_probabilities||{}).map(([k,p])=>k+' '+(p*100).toFixed(1)+'%').join('，'):'尚無相符的預定紀錄')+'\n'+(npc.interaction_result||'')+'\n开始 f'+npc.thinking_updated_frame+'；下一輪 f'+npc.next_decision_frame+'\n'+(npc.decision_pending?'模型提前規劃中；目前行動繼續。':'')+'\n120 frames 錯開提交；推論非同步，超時不改用規則。\n這是機率與執行紀錄，不是模型生成的內心獨白。';
 }
}
function focusResident(){setSmartCamera(false);const npc=world?.observations?.view_model?.npc.find(item=>item.id===selected);const p=npc?tombstonePosition(world,npc):world?.entities[selected]?.transform3d?.position;if(p)camera.focus(p);updateCameraUi();}
function toggleFollow(){
 setSmartCamera(false);
 if(camera.followId)camera.stopFollowing();
 else if(detailOpen&&world?.observations.view_model.npc.find(n=>n.id===selected)?.alive)camera.follow(selected,world.entities[selected]?.transform3d.position);
 updateCameraUi();
}
function updateCameraUi(){
 const npc=world?.observations.view_model.npc.find(n=>n.id===selected);
 const following=Boolean(camera.followId),canFollow=Boolean(detailOpen&&npc?.alive);
 const label=smartCamera?'智慧鏡頭'+(smartTarget?' · '+smartTarget.reason:' · 搜尋事件'):following?'跟隨中 · '+npc.name:'自由鏡頭';
 if($('camera-status').textContent!==label)$('camera-status').textContent=label;
 const smartButton=$('smart-camera');if(smartButton){smartButton.setAttribute('aria-pressed',String(smartCamera));smartButton.textContent=smartCamera?'智慧鏡頭：開':'智慧鏡頭：關';}
 for(const id of ['follow','follow-selected']){const b=$(id);b.disabled=!canFollow;b.setAttribute('aria-pressed',String(following));b.textContent=following?'停止跟隨':id==='follow'?'跟隨這位居民':'跟隨選取角色';}
}
$('pause').onclick=()=>action('toggle_pause');$('speed').onclick=()=>action(currentSpeed>=4?'speed_down':'speed_up');
$('overview').onclick=()=>{setSmartCamera(false);camera.reset();updateCameraUi();};$('focus').onclick=focusResident;$('follow').onclick=toggleFollow;$('follow-selected').onclick=toggleFollow;$('smart-camera').onclick=()=>setSmartCamera(!smartCamera);
 $('watch-fight').onclick=()=>{setSmartCamera(false);const n=world?.observations.view_model.npc.find(n=>n.combat||n.monster_combat);if(n){select(n.id);camera.follow(n.id,world.entities[n.id].transform3d.position);camera.distance=28;updateCameraUi();}};
$('detail-close').onclick=()=>{camera.stopFollowing();detailOpen=false;$('details').hidden=true;updateUi(true);updateCameraUi();};
$('building-close').onclick=closeBuilding;$('building-focus').onclick=focusBuilding;
$('roster-toggle').onclick=()=>{showEconomy(false);$('roster').hidden=!$('roster').hidden;};$('roster-close').onclick=()=>{$('roster').hidden=true;};$('search').oninput=()=>updateUi(true);
$('economy-toggle').onclick=()=>showEconomy($('economy').hidden);$('economy-close').onclick=()=>{showEconomy(false);$('economy-toggle').focus();};
window.addEventListener('resize',()=>{if(innerWidth<=850&&!$('economy').hidden)showEconomy(true);});
let drag=null,dragMode='pan';const keys=new Set();
for(const mode of ['pan','rotate'])$('camera-'+mode).onclick=()=>{dragMode=mode;for(const m of ['pan','rotate'])$('camera-'+m).setAttribute('aria-pressed',String(mode===m));};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=e=>{if(drag||![0,1,2].includes(e.button))return;canvas.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,button:e.button,mode:e.button===2||e.shiftKey?'rotate':e.button===1?'pan':dragMode};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4)return;
 drag.moved=true;if(smartCamera)setSmartCamera(false);if(drag.mode==='rotate')camera.rotate(dx,dy);else camera.pan(dx,dy,canvas.clientHeight);drag.x=e.clientX;drag.y=e.clientY;updateCameraUi();};
canvas.onpointerup=e=>{if(!drag||drag.id!==e.pointerId)return;if(!drag.moved&&drag.button===0&&world&&context){let best=null,dist=24;for(const npc of world.observations.view_model.npc){const p=tombstonePosition(world,npc);if(!p)continue;const v=project(p.x,npc.alive?.95:.8,p.z);const d=Math.hypot(v.x-e.clientX,v.y-e.clientY);if(v.z<1&&v.z>-1&&d<dist){best=npc.id;dist=d;}}if(best)select(best);}drag=null;canvas.releasePointerCapture(e.pointerId);};
canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;};
canvas.addEventListener('wheel',e=>{e.preventDefault();if(smartCamera)setSmartCamera(false);camera.zoom(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1));},{passive:false});
const cameraKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE']);
window.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='Escape'){setSmartCamera(false);camera.stopFollowing();keys.clear();updateCameraUi();return;}
 if(e.code==='KeyF'&&!e.repeat){e.preventDefault();toggleFollow();return;}
 if(cameraKeys.has(e.code)){e.preventDefault();keys.add(e.code);}
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();drag=null;});document.addEventListener('visibilitychange',()=>{if(document.hidden)keys.clear();});
function updateCamera(dt){
 const key=(a,b)=>Number(keys.has(a)||keys.has(b));
 const x=key('KeyA','ArrowLeft')-key('KeyD','ArrowRight'),y=key('KeyW','ArrowUp')-key('KeyS','ArrowDown');
 if(smartCamera&&(x||y||keys.has('KeyQ')||keys.has('KeyE')))setSmartCamera(false);
 if(x||y)camera.pan(x*500*dt,y*500*dt,canvas.clientHeight);
 if(keys.has('KeyQ')||keys.has('KeyE'))camera.rotate((Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*200*dt,0);
 updateSmartCamera(performance.now());
 const tracked=world.observations.view_model.npc.find(n=>n.id===camera.followId);
 camera.update(tracked?.alive?world.entities[tracked.id]?.transform3d.position:null,dt,reducedMotion.matches);
 world.camera3d=camera.view();updateCameraUi();
}
function project(x,y,z){const v=new context.THREE.Vector3(x,y,z).project(context.camera3d);return{x:(v.x+1)*.5*canvas.clientWidth,y:(1-v.y)*.5*canvas.clientHeight,z:v.z};}
function positionLabels(){
 for(const npc of world.observations.view_model.npc){
  const button=plates.get(npc.id);if(!button)continue;
  const position=tombstonePosition(world,npc);if(!position){button.hidden=true;continue;}
  const p=project(position.x,npc.alive===false?.9:2.4,position.z);
  button.hidden=!(p.z>=-1&&p.z<=1&&p.x>=0&&p.x<=canvas.clientWidth&&p.y>=0&&p.y<=canvas.clientHeight);
  button.style.translate=`${p.x}px ${p.y}px`;
 }
 for(const monster of list(world.observations.monsters?.entities)){
  const label=monsterPlates.get(monster.id);if(!label||!monster.position){continue;}
  const p=project(monster.position.x,1.9,monster.position.z);
  label.hidden=!monster.alive||!(p.z>=-1&&p.z<=1&&p.x>=0&&p.x<=canvas.clientWidth&&p.y>=0&&p.y<=canvas.clientHeight);
  label.style.translate=`${p.x}px ${p.y}px`;
 }
 const treasure=world.observations.treasure?.active,treasureLabel=treasurePlates.get('rare_treasure');
 if(treasureLabel&&treasure){const p=project(treasure.position.x,2.4,treasure.position.z);treasureLabel.hidden=!(p.z>=-1&&p.z<=1&&p.x>=0&&p.x<=canvas.clientWidth&&p.y>=0&&p.y<=canvas.clientHeight);treasureLabel.style.translate=p.x+'px '+p.y+'px';}
 for(const{element,building}of landmarks){
  const position=buildingPosition(world,building);if(!position){element.hidden=true;continue;}
  const p=project(position.x,position.y+(building.clearanceX?4:1),position.z);
  element.hidden=!(p.z>=-1&&p.z<=1&&p.x>=0&&p.x<=canvas.clientWidth&&p.y>=0&&p.y<=canvas.clientHeight);
  element.style.left=p.x+'px';element.style.top=p.y+'px';
 }
}
async function poll(){
 const start=performance.now();
 try{const value=await api({method:'snapshot'});previous=latest;latest=value.world;sampleMs=Math.max(70,Math.min(300,start-receivedAt));receivedAt=start;connected=true;
  if(!world)world=structuredClone(latest);
  combatView?.ingest(latest.observations.combat);
 }catch(error){connected=false;$('connection').textContent='連線中斷 · '+error.message;}
 setTimeout(poll,Math.max(10,100-(performance.now()-start)));
}
async function boot(){
 const[manifest,layout]=await Promise.all([fetch('/assets/manifest.json').then(r=>r.json()),fetch('/assets/town-layout.json').then(r=>r.json())]);
 townLayout=layout;
 const renderer=await createThreeRenderer(canvas,{kind:'three-webgl',bloom:false,ao:false,getAssetManifest:()=>manifest,loadAssetUrl:async asset=>'/'+asset.source,onReady(c){context=c;c.renderer.setClearColor(0x88a591);c.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));const{THREE,scene}=c;routeManager=createRouteManager(THREE,scene);
   const ambient=new THREE.HemisphereLight(0xfff6df,0x68886c,2);scene.add(ambient);
   const light=new THREE.DirectionalLight(0xffe3b7,2.3);light.position.set(-25,60,20);scene.add(light);
   const skyNight=new THREE.Color(0x15283e),skyDay=new THREE.Color(0x88a591),skyDusk=new THREE.Color(0x9a8277),sky=new THREE.Color();
   const moon=new THREE.Color(0xa9c9ff),sun=new THREE.Color(0xfff0cf),dusk=new THREE.Color(0xffb96c);
   // Selection is presentation-only, but must participate in depth testing so the resident occludes the rear arc.
   const ring=new THREE.Mesh(new THREE.RingGeometry(.8,1,32),new THREE.MeshBasicMaterial({color:0xf9d472,side:THREE.DoubleSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));ring.rotation.x=-Math.PI/2;ring.renderOrder=10;scene.add(ring);selectedRing=ring;
   const shadowGeometry=new THREE.CircleGeometry(1,24),shadowMaterial=new THREE.MeshBasicMaterial({color:0x17382a,transparent:true,opacity:.16,depthWrite:false});
   for(const b of [...layout.buildings,...layout.homes]){const mesh=new THREE.Mesh(shadowGeometry,shadowMaterial);mesh.rotation.x=-Math.PI/2;mesh.position.set(b.x+.4,.04,b.z+.6);mesh.scale.set((b.clearanceX||1)*1.15,(b.clearanceZ||1)*1.05,1);scene.add(mesh);}
   combatView=new CombatView(c,$('combat-effects'));
 const materials=new Map(),tombstones=new Map();let treasureMarker=null;
   const tombstonePalette={baseGeometry:new THREE.BoxGeometry(1.45,.2,1.05),stoneGeometry:new THREE.BoxGeometry(.92,1.3,.22),baseMaterial:new THREE.MeshLambertMaterial({color:0x4d5753}),stoneMaterial:new THREE.MeshLambertMaterial({color:0x7b817d})};
   c.attachPresentation({beforeRender({scene,snapshot}){
    const cycle=snapshot?.observations?.day_cycle;
    if(cycle){const d=cycle.daylight,t=cycle.twilight;
     sky.copy(skyNight).lerp(skyDay,d).lerp(skyDusk,t*.4);c.renderer.setClearColor(sky);
     ambient.intensity=.65+1.35*d;ambient.color.copy(moon).lerp(sun,d);
     light.intensity=.45+1.85*d;light.color.copy(moon).lerp(sun,d).lerp(dusk,t*.6);
     light.position.set(Math.cos(cycle.cycle_fraction*Math.PI*2)*45,25+35*d,20);
     shadowMaterial.opacity=.07+.09*d;
    }
    for(const mesh of scene.children){if(mesh.userData.asset&&mesh.material?.isMeshBasicMaterial){let mat=materials.get(mesh.material);if(!mat){mat=new THREE.MeshLambertMaterial({map:mesh.material.map,side:THREE.DoubleSide,alphaTest:.05});materials.set(mesh.material,mat);}mesh.material=mat;}}
    const deadIds=new Set();
    for(const npc of deadResidents(snapshot)){
     const p=tombstonePosition(snapshot,npc);if(!p)continue;
     let tombstone=tombstones.get(npc.id);
     if(!tombstone){tombstone=createTombstone(THREE,p,tombstonePalette);scene.add(tombstone);tombstones.set(npc.id,tombstone);}
     tombstone.position.set(p.x,.04,p.z);tombstone.visible=true;deadIds.add(npc.id);
    }
    for(const [id,tombstone] of tombstones){if(deadIds.has(id))continue;scene.remove(tombstone);tombstones.delete(id);}
    const treasure=snapshot?.observations?.treasure?.active;
    if(treasure){
     if(!treasureMarker){
      const group=new THREE.Group(),ringGeometry=new THREE.TorusGeometry(1.35,.09,8,32),gemGeometry=new THREE.OctahedronGeometry(.75,0);
      const ringMaterial=new THREE.MeshBasicMaterial({color:0xffe58a,transparent:true,opacity:.9}),gemMaterial=new THREE.MeshLambertMaterial({color:0x9de9ff,emissive:0x164c58});
      const ring=new THREE.Mesh(ringGeometry,ringMaterial),gem=new THREE.Mesh(gemGeometry,gemMaterial);ring.rotation.x=-Math.PI/2;gem.position.y=1.1;group.add(ring,gem);scene.add(group);
      treasureMarker={group,ring,gem,ringGeometry,gemGeometry,ringMaterial,gemMaterial};
     }
     treasureMarker.group.visible=true;treasureMarker.group.position.set(treasure.position.x,.06,treasure.position.z);treasureMarker.ring.rotation.z+=.018;treasureMarker.gem.rotation.y+=.025;
    }else if(treasureMarker) treasureMarker.group.visible=false;
    for(const npc of snapshot?.observations?.view_model?.npc||[]){let shadow=shadows.get(npc.id);if(!shadow){shadow=new THREE.Mesh(shadowGeometry,shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.scale.set(.65,.5,1);scene.add(shadow);shadows.set(npc.id,shadow);}const entity=snapshot.entities[npc.id];shadow.visible=Boolean(npc.alive&&entity?.transform3d);if(entity?.transform3d){const p=entity.transform3d.position;shadow.position.set(p.x,.05,p.z);}}
    for(const npc of snapshot?.observations?.view_model?.npc||[]){
     let ring=realmRings.get(npc.id);
     if(!ring){ring=new THREE.Mesh(new THREE.RingGeometry(.78,1.08,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.72,side:THREE.DoubleSide,depthTest:true,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.renderOrder=8;scene.add(ring);realmRings.set(npc.id,ring);}
     const entity=snapshot.entities[npc.id],p=entity?.transform3d?.position,realm=npc.realm||'凡人';
     ring.visible=Boolean(npc.alive&&p&&REALM_COLORS[realm]);if(p)ring.position.set(p.x,.075,p.z);if(REALM_COLORS[realm])ring.material.color.setHex(REALM_COLORS[realm]);
    }
   },onDispose(){routeManager?.dispose();routeManager=null;for(const tombstone of tombstones.values())scene.remove(tombstone);tombstones.clear();for(const ring of realmRings.values()){scene.remove(ring);ring.geometry.dispose();ring.material.dispose();}realmRings.clear();if(treasureMarker){scene.remove(treasureMarker.group);treasureMarker.ringGeometry.dispose();treasureMarker.gemGeometry.dispose();treasureMarker.ringMaterial.dispose();treasureMarker.gemMaterial.dispose();treasureMarker=null;}tombstonePalette.baseGeometry.dispose();tombstonePalette.stoneGeometry.dispose();tombstonePalette.baseMaterial.dispose();tombstonePalette.stoneMaterial.dispose();}});
 }});
 await poll();if(!world)throw Error('無法連接 Luau runtime，請啟動 native preview。');
 renderer.draw(presentationCopy(world));$('loading').hidden=true;
 renderer.ready().catch(error=>{console.error('Renderer asset readiness:',error);$('connection').textContent='模型載入部分失敗 · '+error.message;});
 function render(now){
  if(now-lastRender<1000/60-1){requestAnimationFrame(render);return;}
  if(latest){const alpha=Math.min(1,(now-receivedAt)/sampleMs);world={...latest,entities:{...latest.entities}};
   for(const npc of latest.observations.view_model.npc){const e=latest.entities[npc.id],a=previous?.entities[npc.id]?.transform3d.position,b=e.transform3d.position;if(a)world.entities[npc.id]={...e,transform3d:{...e.transform3d,position:{x:a.x+(b.x-a.x)*alpha,y:b.y,z:a.z+(b.z-a.z)*alpha}}};}
   updateCamera(Math.min(.05,(now-lastRender)/1000));
   combatView.draw(now,project,latest.observations.view_model.paused,latest.observations.view_model.speed,reducedMotion.matches,world.entities);
   const selectedNpc=world.observations.view_model.npc.find(npc=>npc.id===selected);const pos=selectedNpc?tombstonePosition(world,selectedNpc):world.entities[selected]?.transform3d.position;selectedRing.visible=detailOpen;if(pos)selectedRing.position.set(pos.x,.1,pos.z);
   routeManager?.sync(world.observations.view_model.npc,world.entities,selected);renderer.draw(presentationCopy(world));updateUi();positionLabels();
   averageFps=.97*averageFps+.03*(1000/Math.max(1,now-lastRender));
   if(connected&&Math.floor(now/500)!==Math.floor(lastRender/500))$('connection').textContent=`Unone · Luau native / Three.js · ${Math.round(averageFps)} FPS · f${latest.frame}`;
  }lastRender=now;requestAnimationFrame(render);
 }requestAnimationFrame(render);
 // Read-only diagnostics for automated asset/renderer verification, never simulation authority.
 window.townDebug={getState:()=>({frame:latest?.frame,residents:plates.size,models:context.scene.children.filter(x=>x.userData.asset).length,selected,labels:[...plates.values()].filter(b=>!b.hidden).length,routes:routeManager?.diagnostics()||{count:0,ids:[]},smart_camera:{enabled:smartCamera,target:smartTarget?.key||null,reason:smartTarget?.reason||'searching'},metrics:renderer.metrics(),nativeSelected:latest?.observations.selected_npc_id})};
}
boot().catch(error=>{$('load-message').textContent=error.message;$('loading').hidden=false;console.error(error);});
