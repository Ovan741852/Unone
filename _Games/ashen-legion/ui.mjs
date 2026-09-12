import './rpg-ui.mjs';
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const units=['劍兵','槍兵','騎兵'],descs=['10% 爆擊 · 1.5 倍傷害','落地旋轉 · 再撞擊消失','穿透 20 次 · 壽命 8 秒 · 高速衝鋒'];
const roman=['I','II','III','IV','V','VI','VII'],tiers=['','小獎','中獎','大獎','特獎'];
const runeNames=['空符文槽','燼火 · 傷害 +35%','迴響 · 開獎 +25%','凝霜 · 命中緩速'];
const icons={edge:'⚔',purse:'◈',oath:'♜',fortune:'✧',storm:'✥',march:'♞',sword:'⚔',spear:'↟',cavalry:'♞',ember:'♨',echo:'◎',frost:'❄',pierce:'↠',landing_spin:'✥',critical:'⚡',market:'◈',potion:'✦',tech:'⚙',enchant:'✧',curse:'☽'};
const weaponSVG=[`<path d="M23 3 28 9 24 37 29 42 26 45 20 40 18 53 13 52 16 39 8 42 6 38 17 34Z"/><path d="m7 16-6 7 2 15 8 6 5-7-1-16Z" opacity=".5"/>`,`<path d="m21 1 8 15-6 6-3 33-4-1 3-33-5-7Z"/><path d="M4 34q12-16 27 0M2 36l2-8m27 6-1 8" fill="none" stroke="currentColor" stroke-width="2"/>`,`<path d="m8 46 3-15-6-9 8-3 5-10 7-3 4 9 5 6-7 5-5-3-2 7 9 16Z"/><path d="M6 49h26v5H6Z"/>`];
$('#units').innerHTML=units.map((name,i)=>`<button class="unit" data-action="Unit${i+1}" aria-label="選擇${name}"><span class="key">${i+1}</span><svg viewBox="0 0 38 58" fill="currentColor" aria-hidden="true">${weaponSVG[i]}</svg><span><span class="name">${name}</span><span class="desc">${descs[i]}</span><span class="cost">◈ <b id="cost-${i}"></b><small id="equip-${i}">初始裝備</small></span></span></button>`).join('');
$('#round-track').innerHTML=roman.map(r=>`<span><b>${r}</b></span>`).join('');
let state,phase='',lastEvent=0,lastFired=0,toastTimer,muted=false,audio,uiReady=false,dialogPaused=false,dialogWasPaused=false;
let rewardSeen=0,winUntil=0,winRank=0;
const modes=document.createElement('aside');modes.id='fire-controls';modes.hidden=true;
modes.innerHTML=`<small>FIRE CONTROL</small><div class="mode-buttons"><button data-action="Mode_manual">手動</button><button data-action="Mode_lock">⌖ LOCK</button><button data-action="Mode_auto">↻ AUTO</button></div><small>自動目標</small><div class="filter-buttons"><button data-action="Filter_all">全部</button><button data-action="Filter_small">小怪</button><button data-action="Filter_boss">王</button></div><p id="target-status">按住戰場持續派兵</p><div class="render-buttons"><button id="bloom-toggle" aria-pressed="true">Bloom 開</button><button id="ao-toggle" aria-pressed="true">AO 開</button></div>`;
document.body.append(modes);
const wins=document.createElement('div');wins.id='win-celebration';wins.innerHTML='<div class="win-rays"></div><div class="win-crown">♛</div><small>FORTUNE OF THE FOREST</small><h2></h2><strong></strong><p></p>';document.body.append(wins);
const payoutLayer=document.createElement('div');payoutLayer.id='payout-labels';document.querySelector('#stage').append(payoutLayer);
for(const [id,method]of [['bloom','setBloom'],['ao','setAO']]){let on=true;document.querySelector('#'+id+'-toggle').onclick=()=>{on=!on;window.ashen[method](on);document.querySelector('#'+id+'-toggle').textContent=(id==='ao'?'AO':'Bloom')+(on?' 開':' 關');document.querySelector('#'+id+'-toggle').setAttribute('aria-pressed',String(on))}}
function rewardFX(s){
 if(s.event===0){rewardSeen=0;wins.classList.remove('show');winUntil=0;payoutLayer.replaceChildren()}
 for(const e of Object.values(s.rewards??{})){
  if(e.id<=rewardSeen)continue;rewardSeen=e.id;
  const p=window.ashen.projectPoint(e.x,e.z,1);const label=document.createElement('div');label.className='payout-label tier-'+e.tier;label.style.left=p.x+'px';label.style.top=p.y+'px';label.innerHTML=`<b>×${Number(e.multiplier.toFixed(1)).toLocaleString()}</b><span>+${e.amount.toLocaleString()}</span>`;payoutLayer.append(label);setTimeout(()=>label.remove(),2300);
  if(e.title && (performance.now()>winUntil||e.tier>=winRank)){
   winRank=e.tier;winUntil=performance.now()+2800;wins.querySelector('h2').textContent=e.title;wins.querySelector('strong').textContent='×'+Number(e.multiplier.toFixed(1)).toLocaleString();wins.querySelector('p').textContent=`${e.name}　◈ +${e.amount.toLocaleString()}`;wins.classList.remove('show');void wins.offsetWidth;wins.classList.add('show');
   [660,880,1100,1320].forEach((f,i)=>setTimeout(()=>tone(f,.45,'sine',.045),i*110));
  }
 }
 if(performance.now()>winUntil)wins.classList.remove('show');
}
function tone(freq,duration=.12,type='sine',volume=.025){if(muted)return;try{audio??=new AudioContext();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.5,audio.currentTime+duration);g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration)}catch{}}
document.addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a&&!a.disabled){window.ashen.action(a.dataset.action);tone(420,.07,'triangle',.018)}});
$('.brand').onclick=e=>{e.preventDefault();if(state?.phase==='menu')return;openDialog($('#guide'))};
$('#sound-button').onclick=()=>{muted=!muted;$('#sound-button').textContent='音效 '+(muted?'關':'開');if(!muted)tone(520)};
function skillText(s){if(!s)return '';return [`穿透 ${s.pierce} 次（第 ${s.pierce+1} 撞消失）`,s.critChance>0?`爆擊 ${Math.round(s.critChance*100)}% · ${s.critMultiplier} 倍`:'',s.landingSpin?`落地旋轉斬 · 半徑 ${s.spinRadius.toFixed(1)}`:''].filter(Boolean).join(' ／ ')}
function openDialog(dialog){window.ashen.release();dialogWasPaused=state?.paused;dialogPaused=state?.phase==='battle'&&!state.paused;if(dialogPaused)window.ashen.action('Pause');dialog.showModal()}
$('#guide-button').onclick=()=>openDialog($('#guide'));
$('#loadout-button').onclick=()=>{if(!state)return;$('#equipment-content').innerHTML=units.map((n,i)=>`<div class="equipment-row"><b>${n}</b><span>裝備 ${state.equipment[i]} 階 · 傷害 +${Math.round((state.equipment[i]-1)*30)}%</span><small>${runeNames[state.runes[i]]}<br>${skillText(state.loadouts?.[i])}</small></div>`).join('')+`<p>全軍傷害 +${Math.round((state.damage-1)*100)}%　派兵折扣 ${Math.round(state.discount*100)}%<br>大獎機率加成 +${Math.round(state.luck*100)}%　槍環半徑 ${state.radius.toFixed(1)}</p><p>已獲祝福：${Object.values(state.inventory).map(i=>i.name).join('、')||'尚無'}</p>`;openDialog($('#equipment'))};
$$('dialog .close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>{d.addEventListener('close',()=>{if(dialogPaused&&!dialogWasPaused)window.ashen.action('Pause');dialogPaused=false});d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}})});
function result(s){
 $('#result-tag').textContent=s.phase==='clear'?'THE GATE IS OPEN':s.phase==='victory'?'YOU DEFIED THE FATES':'THE ASHES REMEMBER';
 $('#result-title').textContent=s.phase==='clear'?'森林之門，已破。':s.phase==='victory'?'七輪遠征，盡歸軍團。':'軍團歸於灰燼。';
 $('#result-message').textContent=s.message;
 $('#result-stats').innerHTML=[['累計獎金',s.earned.toLocaleString()],['擊殺怪物',s.kills],['破防抽獎',s.breaks]].map(([n,v])=>`<div><small>${n}</small><b>${v}</b></div>`).join('');
 $('#result-refund').textContent=`倖存部隊 ${s.returnedUnits} 支 · 退回金幣 +${s.roundRefund.toLocaleString()}`;
 const b=$('#result-next');b.textContent=s.phase==='clear'?`前往第 ${s.round+1} 輪遠征 →`:'再度召集軍團 →';b.dataset.action=s.phase==='clear'?'Next':'Start';
}
function choice(s){
 $('#choice-subtitle').textContent=`第 ${s.round} / 7 次抉擇 · ${s.chapter} · 造訪補給地點，準備完成後出戰`;
 $('#cards').innerHTML=Object.values(s.cards).map((c,i)=>`<button class="card" data-action="Choice${i+1}"><span class="type">${c.type} / BLESSING ${roman[i]}</span><span class="card-icon">${({market:"building-market",potion:"building-alchemy",tech:"building-barracks",enchant:"building-forge",curse:"icon-curse-debt"})[c.id]?`<img src="assets/ui/${({market:"building-market",potion:"building-alchemy",tech:"building-barracks",enchant:"building-forge",curse:"icon-curse-debt"})[c.id]}.svg" alt="">`:icons[c.id]}</span><h3>${c.name}</h3><p>${c.desc}</p><span class="choose">前往此處 <b>↗</b></span></button>`).join('');
 $('#choice-target').innerHTML='預備強化兵種'+units.map((n,i)=>`<button data-action="Unit${i+1}" class="${s.selected===i+1?'selected':''}">${n}</button>`).join('');
}
const hordeBanner=document.createElement('div');hordeBanner.id='horde-banner';hordeBanner.hidden=true;hordeBanner.setAttribute('role','status');document.body.append(hordeBanner);
let hordeWasVisible=false;
function update(s){
 const hordeVisible=s.phase==='battle'&&s.hordeNotice>0;
 hordeBanner.hidden=!hordeVisible;
 if(hordeVisible){hordeBanner.textContent=`怪物潮來襲 · +${s.hordeAdded} 隻小怪`;if(!hordeWasVisible)tone(130,.65,'sawtooth',.035)}
 hordeWasVisible=hordeVisible;
 if(!s)return;state=s;document.body.dataset.phase=s.phase;
 const active=['battle','clear','victory','defeat'].includes(s.phase);
 $('#menu').hidden=s.phase!=='menu';$('#menu-footer').hidden=s.phase!=='menu';$('#battle-hud').hidden=!active;$('#command-bar').hidden=!active;
 $('#choice').hidden=s.phase!=='choice';$('#result').hidden=!['clear','victory','defeat'].includes(s.phase)||s.presentationDelay>0;$('#pause').hidden=!(s.phase==='battle'&&s.paused);$('#pause-button').hidden=s.phase!=='battle';
 modes.hidden=s.phase!=='battle';
 modes.querySelectorAll('[data-action^="Mode_"]').forEach(b=>b.classList.toggle('selected',b.dataset.action==='Mode_'+s.fireMode));
 modes.querySelectorAll('[data-action^="Filter_"]').forEach(b=>b.classList.toggle('selected',b.dataset.action==='Filter_'+s.targetFilter));
 $('#target-status').textContent=s.fireMode==='manual'?'按住戰場持續派兵':s.targetName?`⌖ ${s.targetName} · 持續射擊`:s.fireMode==='lock'?'點選一隻怪物來鎖定':'搜尋符合條件的怪物…';
 $('.timer small').textContent=s.bossSpawned?'大王開獎倒數':'大王登場倒數';
 if(phase!==s.phase){if(s.phase==='choice')choice(s);if(['clear','victory','defeat'].includes(s.phase))result(s);phase=s.phase;window.ashen.release()}
 if(s.phase==='choice')$$('#choice-target button').forEach((b,i)=>b.classList.toggle('selected',i===s.selected-1));
 $$('#seats button').forEach((b,i)=>b.classList.toggle('selected',i===s.seat-1));
 $('#coins').textContent=s.coins.toLocaleString();$('#chapter').textContent=s.chapter;$('#round-label').textContent=`第 ${roman[s.round-1]} 輪遠征 / VII`;
 const time=Math.ceil(s.bossSpawned?s.time:Math.max(0,s.time-30));$('#timer').textContent=`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;$('.timer').classList.toggle('danger',s.bossSpawned&&time<=20);
 $$('#round-track span').forEach((b,i)=>{b.classList.toggle('current',i===s.round-1);b.classList.toggle('done',i<s.round-1)});
 $$('.unit').forEach((b,i)=>{b.classList.toggle('selected',s.selected===i+1);b.classList.toggle('unaffordable',s.coins<s.costs[i]);b.setAttribute('aria-pressed',String(s.selected===i+1));$(`#cost-${i}`).textContent=s.costs[i];$(`#equip-${i}`).textContent=`${s.equipment[i]} 階${s.runes[i]?' · 符文':''}`});
 const inventory=Object.values(s.inventory);$('#upgrade-count').textContent=inventory.length+' / 7';$('#upgrade-icons').textContent=inventory.map(i=>i.name).join(' · ')||'尚未獲得祝福';
 const boss=Object.values(s.monsters).find(m=>m.rank===5);
 if(boss){$('#boss-value').textContent=`${boss.damage} / ${boss.guard}`;$('#boss-bar').style.width=(boss.damage/boss.guard*100)+'%';$('#boss-draws').textContent=`破防抽獎 ${boss.breaks} 次 · 可能未中獎`}
 else {$('#boss-value').textContent='尚未登場';$('#boss-bar').style.width='0%';$('#boss-draws').textContent=`小怪 ${Object.values(s.monsters).filter(m=>m.rank<=2).length} · 小王／次王 ${Object.values(s.monsters).filter(m=>m.rank>=3).length}`}
 $$('.payout-note>div b').forEach((b,i)=>b.textContent='+'+Math.floor([80,180,500,1100][i]*(1+(s.round-1)*.08)).toLocaleString());
 if(s.event>lastEvent){lastEvent=s.event;const el=$('#prize-toast');el.innerHTML=`<small>${tiers[s.prizeTier]}${s.prizeTier>=3?' · FORTUNE FAVORS YOU':''}</small><strong>+ ${s.prize.toLocaleString()}</strong><span>${s.lastMonster} · 破防開獎</span>`;el.classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('toast-visible'),s.prizeTier>=3?2400:950);tone(s.prizeTier>=3?880:660,.4,'sine',.06)}
 if(s.event===0)lastEvent=0;
 if(s.fired>lastFired)tone(s.selected===3?120:220,.1,'triangle',.022);lastFired=s.fired;
 renderMarkers(s);rewardFX(s);
}
const monsterNodes=new Map(),seatNodes=[];const cornerPositions=[[0,7.1],[7.1,0],[0,-7.1],[-7.1,0]];
function renderMarkers(s){
 const layer=$('#markers'),seen=new Set();
 if(s.phase!=='battle'){layer.replaceChildren();monsterNodes.clear();seatNodes.length=0;return}
 for(const m of Object.values(s.monsters)){
  seen.add(m.id);let el=monsterNodes.get(m.id);
  if(!el){el=document.createElement('div');el.className='monster-label'+(m.rank>=3?' boss':'');el.innerHTML=`${m.rank>=3?`<span>${m.name}</span>`:''}<div class="meter"><i></i></div><small></small>`;layer.append(el);monsterNodes.set(m.id,el)}
  const pos=window.ashen.projectPoint(m.x,m.z,([1,1.6,3,3.6,5.3])[m.rank-1]);el.style.left=pos.x+'px';el.style.top=pos.y+'px';el.classList.toggle('locked',m.id===s.targetId);el.querySelector('i').style.width=(m.damage/m.guard*100)+'%';el.querySelector('small').textContent=m.special==='beetle'?`共用獎池 ${m.poolGold} · ×${m.poolMultiplier.toFixed(2)}`:m.rank>=3?`${m.damage} / ${m.guard}`:'';
 }
 for(const [id,el]of monsterNodes)if(!seen.has(id)){el.remove();monsterNodes.delete(id)}
 cornerPositions.forEach(([x,z],i)=>{let el=seatNodes[i];if(!el){el=document.createElement('div');el.className='corner-label';layer.append(el);seatNodes[i]=el}const p=window.ashen.projectPoint(x,z-.5,.1);el.style.left=p.x+'px';el.style.top=p.y+'px';el.classList.toggle('active',s.seat===i+1);el.textContent=s.seat===i+1?`P${i+1} · 你的炮台`:`P${i+1} · ${s.playerGold?.[i]??320} 金幣`});
}
window.addEventListener('ashen-ready',()=>{uiReady=true;$('.start').disabled=false;$('.start span').textContent='進入森林';document.body.dataset.ready='true'});
window.addEventListener('ashen-state',e=>update(e.detail));
