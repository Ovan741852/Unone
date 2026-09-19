// Game presentation only. Purchases, dice, modifiers and gold are handled by Luau.
const panel=document.createElement('section');panel.id='rpg-panel';panel.hidden=true;document.body.append(panel);
const bar=document.createElement('aside');bar.id='rpg-bar';document.body.append(bar);
const style=document.createElement('style');style.textContent=`
:root{--rpg-ink:#eef2df;--rpg-muted:#b8c8b7;--rpg-bg:#0a1717eF;--rpg-panel:#122525F2;--rpg-card:#193432;--rpg-card-hover:#244943;--rpg-line:#4b7263;--rpg-gold:#eac36e;--rpg-mint:#92d3b0;--rpg-danger:#ef9271;--rpg-shadow:0 24px 70px rgba(0,0,0,.42)}
#rpg-panel{position:fixed;inset:clamp(18px,5vh,54px) clamp(18px,7vw,110px);z-index:55;overflow:auto;overscroll-behavior:contain;background:linear-gradient(145deg,rgba(19,42,40,.98),rgba(9,24,27,.97));color:var(--rpg-ink);padding:clamp(22px,3vw,40px);border:1px solid rgba(234,195,110,.7);border-radius:24px;box-shadow:var(--rpg-shadow),inset 0 1px rgba(255,255,255,.08);scrollbar-color:var(--rpg-line) transparent;scrollbar-width:thin}
#rpg-panel[hidden]{display:none}
#rpg-panel:before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:radial-gradient(circle at 14% 0%,rgba(146,211,176,.12),transparent 34%),linear-gradient(110deg,transparent 0 72%,rgba(234,195,110,.06));}
#rpg-panel>*{position:relative}
#rpg-panel h2{font-size:clamp(24px,2.6vw,36px);line-height:1.1;letter-spacing:.02em;margin:0 0 9px;color:#fff3c8}
#rpg-panel h3{font-size:16px;line-height:1.35;margin:22px 0 9px;color:#f1d991}
#rpg-panel p{max-width:72ch;line-height:1.65;color:var(--rpg-muted);margin:9px 0}
#rpg-panel .rpg-row{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:16px 0}
#rpg-panel button,#rpg-bar button{appearance:none;background:linear-gradient(180deg,#285248,#1d3c39);color:var(--rpg-ink);border:1px solid #638d78;border-radius:11px;padding:10px 13px;min-height:42px;cursor:pointer;font:inherit;line-height:1.2;transition:background-color .18s ease,border-color .18s ease,transform .18s ease,box-shadow .18s ease}
#rpg-panel button:hover,#rpg-bar button:hover{background:linear-gradient(180deg,#356558,#254a45);border-color:#b4d3a9;transform:translateY(-1px);box-shadow:0 8px 20px rgba(0,0,0,.2)}
#rpg-panel button:active,#rpg-bar button:active{transform:translateY(0)}
#rpg-panel button:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}
#rpg-panel button:focus-visible,#rpg-bar button:focus-visible,#rpg-panel summary:focus-visible{outline:3px solid #f3dfa3;outline-offset:3px}
#rpg-panel .rpg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;margin-top:14px}
#rpg-panel article{display:flex;flex-direction:column;align-items:flex-start;min-height:128px;background:linear-gradient(160deg,rgba(32,66,61,.92),rgba(21,47,46,.96));border:1px solid rgba(132,179,148,.28);border-top:3px solid var(--rpg-gold);border-radius:14px;padding:16px;box-shadow:0 10px 24px rgba(0,0,0,.16)}
#rpg-panel article>b{color:#fff3c8;font-size:15px;line-height:1.35}
#rpg-panel article small{display:block;color:var(--rpg-muted);margin:9px 0 13px;line-height:1.55}
#rpg-panel article img{object-fit:contain;align-self:flex-start;max-width:100%;filter:drop-shadow(0 5px 10px rgba(0,0,0,.35))}
#rpg-panel article button{margin-top:auto}
#rpg-panel .primary{background:linear-gradient(180deg,#e8c56f,#be8d45);color:#192a29;border-color:#f7e0a2;font-weight:750;box-shadow:0 8px 20px rgba(209,157,73,.22)}
#rpg-panel .primary:hover{background:linear-gradient(180deg,#f2d788,#ce9b4d)}
#rpg-panel details{border:1px solid rgba(132,179,148,.25);border-radius:14px;background:rgba(10,28,29,.32);margin:14px 0;padding:0 15px}
#rpg-panel details[open]{background:rgba(10,28,29,.5)}
#rpg-panel summary{cursor:pointer;list-style:none;padding:15px 2px;color:#f1d991;font-weight:700}
#rpg-panel summary::-webkit-details-marker{display:none}
#rpg-panel summary:before{content:'▸';display:inline-block;width:20px;color:var(--rpg-mint);transition:transform .18s ease}
#rpg-panel details[open] summary:before{transform:rotate(90deg)}
#rpg-panel progress{width:min(260px,100%);accent-color:var(--rpg-mint)}
#rpg-bar{position:fixed;left:clamp(14px,2.5vw,42px);top:clamp(14px,4vh,38px);width:min(224px,24vw);max-height:min(60vh,470px);overflow:auto;overscroll-behavior:contain;z-index:45;background:linear-gradient(160deg,rgba(13,37,37,.94),rgba(8,24,27,.9));border:1px solid rgba(132,179,148,.38);border-radius:16px;padding:12px;color:var(--rpg-ink);font-size:12px;box-shadow:0 16px 34px rgba(0,0,0,.26);scrollbar-color:var(--rpg-line) transparent;scrollbar-width:thin}
#rpg-bar p{margin:7px 2px;line-height:1.5;color:var(--rpg-muted)}
#rpg-bar p:first-child{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#f1d991}
#rpg-bar button{font-size:12px;padding:8px 10px;min-height:34px;margin:3px 2px}
@media(max-width:1000px){#rpg-panel{inset:3vh 3vw;padding:24px}#rpg-bar{width:min(205px,30vw)}}
@media(max-width:720px){#rpg-panel{inset:12px 10px;padding:18px;border-radius:18px}#rpg-bar{left:10px;right:10px;top:10px;width:auto;max-width:none;max-height:25vh;display:flex;align-items:center;flex-wrap:wrap;gap:2px 4px;padding:8px}#rpg-bar p{margin:4px 6px}#rpg-bar p:first-child{flex-basis:100%}}
@media(prefers-reduced-motion:reduce){#rpg-panel button,#rpg-bar button,#rpg-panel summary:before{transition:none}}
`;
document.head.append(style);
const units=['劍兵','槍兵','騎兵'],slots=['頭','身','腳','手','武器'],locations={market:'買賣商店',potion:'藥水攤',tech:'科技研究',enchant:'裝備附魔',curse:'詛咒契約'};
const skillNames={pierce:'穿透 +1',critical:'爆擊率 +10%',landing_spin:'落地旋轉斬',longlife:'壽命 +15%',haste:'移速 +15%',heavy:'移速 -20%／傷害 +35%',bounce_power:'反彈增傷',bounce_life:'反彈延命',momentum:'速度轉穿透傷害',shock:'命中震盪',crit_power:'爆擊倍率 +0.25',finisher:'穿透蓄終結',ember_burst:'終結爆炸',king_hunter:'對王傷害 +20%',frost_touch:'命中緩速',frenzy:'連殺增傷',last_stand:'最後一搏',heat:'熱機',distance:'遠征',lightning:'爆擊雷鏈',third_crit:'第三擊必爆',expire_burst:'到期衝擊',rebound_charge:'反彈蓄下次命中'};
let state,inventoryOpen=false,lastSignature='',lastBar='';
const values=x=>Object.values(x??{}),btn=(label,action,disabled=false)=>`<button data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
const name=id=>skillNames[id]??state?.skillBook?.[id]?.name??id;
const detail=id=>(state?.skillBook?.[id]?.desc??name(id)).split('；每支派兵')[0];
function runes(s){return `<h3>符文 · ${units[s.selected-1]}獨立一槽</h3><p>燼火：主要傷害 +35%；迴響：一般獎金 +25%；凝霜：緩速兩秒。裝入後每次派兵 +2，聚寶甲蟲始終只領取實際共享池。</p><div class="rpg-row">${['燼火','迴響','凝霜'].map((n,i)=>btn(`${s.runes?.[s.selected-1]===i+1?'✓ ':''}${n} · ${s.runeOwned?.[s.selected-1]?.[i]?'已擁有':[48,72,56][i]+' 金幣'}`,`Rune${i+1}`,!s.runeOwned?.[s.selected-1]?.[i]&&s.location!=='market')).join('')}${btn('卸下符文','RuneOff')}</div>`}
function builds(s){return `<details id="build-guide"><summary style="cursor:pointer;font-size:20px;padding:16px 0">流派指南 · ${units[s.selected-1]}的搭配進度</summary><p>這些是技能組合建議，沒有隱藏套裝加成。指定方向後，下次商店第一格提供一項尚未擁有的核心裝備，其餘仍隨機。✓ 代表目前兵種已有能力。裝備與附魔提高派兵費；科技只付研究費，本局生效。劍兵起手可先選穿透 +1 增加接觸次數，再補本流派能力；不必一次穿滿。</p><div class="rpg-grid">${values(s.buildGuide).map((b,i)=>`<article><b>${b.name}</b>${btn(s.buildIndex===i+1?'已指定採購方向':'指定採購方向',`Build${i+1}`)}<small>${values(b.core).map(id=>`${s.activeSkills?.[id]?'✓':'○'} ${name(id)}`).join(' ／ ')}</small><p>${b.desc}</p><small>取捨：${b.tradeoff}</small></article>`).join('')}</div><h3>目前生效的技能</h3><div class="rpg-grid">${Object.entries(s.activeSkills??{}).map(([id,n])=>`<article><b>${name(id)} ×${n}</b><p>${detail(id)}</p></article>`).join('')}</div></details>`}
function inventory(s){const worn=values(s.worn?.[s.selected-1]);return `<h3>部隊配裝 · 裝上能力後派兵會更貴</h3><div class="rpg-row">${units.map((n,i)=>btn(`${n} · 每支 ${s.costs[i]}`,`Unit${i+1}`)).join('')}</div><div class="rpg-row">${slots.map((n,i)=>btn(`${n}${s.equipSlot===i+1?' ✓':''}`,`Slot${i+1}`)).join('')}${btn('卸下選定部位','Unequip')}</div><div class="rpg-grid">${values(s.items).map((item,i)=>`<article><img style="height:80px" src="assets/ui/gear-${item.skill}.svg" alt="${item.name}"><b>${item.name}</b><small>${slots[item.slot-1]} · ${detail(item.skill)}${item.enchant?' ／ 附魔 '+detail(item.enchant):''}</small><small>${worn.includes(item.id)?'此兵種已穿戴':'未穿戴於此兵種'}</small>${btn('穿戴／移交',`Equip${i+1}`)}${s.location==='market'?btn(`出售 ${Math.floor(item.paid/2)}`,`Sell${i+1}`):''}</article>`).join('')||'<p>沒有額外裝備，基礎部隊仍可派遣。</p>'}</div>`}
function render(s){state=s;
 const safe=['menu','shop','clear','victory'].includes(s.phase);
 const barHTML=`<p>切換領主 · 本機四席</p>${[1,2,3,4].map(i=>btn(`P${i}${s.seat===i?' ✓':''}`,`Player${i}`)).join('')}<p>破防抽獎 ${s.breaks} · 未中 ${s.lotteryMisses??0}</p>${s.phase==='battle'?`<p>連殺 ${s.streaks?.[s.seat-1]?.count??0}</p>${values(s.potions).map((p,i)=>btn(`${i===0?'Q':'E'} ${['疾風','續命','召回'][p.kind-1]}`,`Potion${i+1}`)).join('')}`:''}${safe?'<button id="rpg-inventory">領地／裝備</button>':''}${['clear','victory'].includes(s.phase)&&s.chestCount>0?`<p style="color:${['#d7b482','#92d3a7','#ffdd78'][s.chests?.[0]?.tier-1]??'#fff'}">${['木製','翠綠','金冠'][s.chests?.[0]?.tier-1]??''}寶箱 ×${s.chestCount} · P${s.chests?.[0]?.playerId}</p><button id="rpg-chest">按住一秒開箱</button>`:''}${s.chestResult?`<p>獲得：${s.chestResult}</p>${btn('收下','ChestDone')}`:''}${s.roulette?`<p>輪盤：${s.rewardClock-s.roulette.time<2.6?'转動中…':s.roulette.label}</p>`:''}`;
 if(barHTML!==lastBar){lastBar=barHTML;bar.innerHTML=barHTML;
 bar.querySelector('#rpg-inventory')?.addEventListener('click',()=>{inventoryOpen=!inventoryOpen;lastSignature='';render(state)});
 const chest=bar.querySelector('#rpg-chest');if(chest){chest.onpointerdown=e=>{e.preventDefault();window.ashen.hold('OpenChest',true)};chest.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();window.ashen.hold('OpenChest',true)}}}
 }
 const show=s.phase==='shop'||safe&&inventoryOpen;panel.hidden=!show;if(!show)return;
 const sig=JSON.stringify([s.phase,s.location,s.coins,s.selected,s.equipSlot,s.items,s.worn,s.stock,s.enchantPending,s.message,s.town,s.costs,s.activeSkills,s.runes,s.runeOwned,s.buildIndex]);if(sig===lastSignature)return;lastSignature=sig;
 const openArmory=[...panel.querySelectorAll('.armory-section')].map(x=>x.open);
 const guideOpen=panel.querySelector('#build-guide')?.open;
 panel.innerHTML=`<h2>${s.phase==='shop'?locations[s.location]:'領地與軍備'}　◈ ${s.coins}</h2><p>保留足夠金幣派兵；裝備可選擇穿戴或先放背包。${s.message??''}</p>${s.phase==='shop'?`<div class="rpg-grid">${values(s.stock).map((x,i)=>`<article><img style="height:75px;display:block;margin:auto" alt="" src="assets/ui/${x.kind==='gear'?'gear-'+x.skill:'icon-'+(x.kind==='potion'?['potion-haste','potion-life','potion-recall'][x.value-1]:x.kind==='curse'?'curse-debt':'rune')}.svg"><b>${x.kind==='tech'?units[x.unit-1]+' · '+name(x.value):x.name}</b><small>${x.skill?`${detail(x.skill)} · 每次派兵 +${x.deployExtra}<br>`:''}${x.kind==='tech'?detail(x.value)+' · 研究不加派兵費<br>':''}${x.kind==='curse'?['兩輪派兵費 +15% → 全軍穿透 +1','兩輪壽命 -15% → 全軍傷害 +25%','兩輪速度 -15% → 全軍爆擊率 +10%'][x.value-1]:`花費 ${x.price} 金幣`}</small>${btn(x.sold?'已取得':'取得',`Buy${i+1}`,x.sold||s.coins<x.price||x.kind==='tech'&&s.researchUsed)}</article>`).join('')}</div><div class="rpg-row">${s.location==='market'?btn('刷新 15','RefreshShop',s.refreshUsed||s.coins<15):''}${s.location==='enchant'?btn(`附魔 60 · 已用 ${s.enchantUses}/2`,'Enchant',s.enchantUses>=2||s.coins<60||Boolean(s.enchantPending)):''}${btn('準備完成，進入戰鬥','LeaveShop',Boolean(s.enchantPending))}</div>${s.enchantPending?`<article><h3>新詞綴：${name(s.enchantPending.skill)}</h3><p>品質 ${s.enchantPending.tier} · 已付費，可保留舊詞綴。採用後也會改變每次派兵費。</p>${btn('採用','AcceptEnchant')}${btn('保留原詞綴','KeepEnchant')}</article>`:''}`:''}${builds(s)}<details class="armory-section"><summary>符文祭壇</summary>${runes(s)}</details><details class="armory-section"><summary>部隊武庫 · 五部位配裝</summary>${inventory(s)}</details>${s.phase==='menu'?`<h3>城鎮金庫 ${s.town.gold}</h3><p>兵營每級：傷害 +10%、壽命 +2%。鐵匠：稀有附魔 +1百分點。煉金：藥水時間 +2%。市集：購入價 -2%，三級多一商品。敗北依實際戰鬥時間帶回最多20建設金。</p><div class="rpg-row">${['兵營','鐵匠舖','煉金房','市集'].map((n,i)=>btn(`${n} Lv.${s.town.levels[i]} · ${[60,100,160,240,360][s.town.levels[i]]??'已滿級'}`,`Town${i+1}`)).join('')}</div>`:''}<button id="rpg-close">關閉配裝</button>`;
 if(guideOpen)panel.querySelector('#build-guide').open=true;
 panel.querySelectorAll('.armory-section').forEach((x,i)=>x.open=Boolean(openArmory[i]));
 panel.querySelector('#rpg-close').onclick=()=>{if(s.phase==='shop'){window.ashen.action('LeaveShop')}else{inventoryOpen=false;panel.hidden=true}};
}
document.addEventListener('pointerup',()=>window.ashen?.hold('OpenChest',false));document.addEventListener('pointercancel',()=>window.ashen?.hold('OpenChest',false));document.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')window.ashen?.hold('OpenChest',false)});
document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,dialog')||e.repeat)return;if(e.code==='KeyQ'||e.code==='KeyE')window.ashen?.action(e.code==='KeyQ'?'Potion1':'Potion2')});
window.addEventListener('ashen-state',e=>render(e.detail));
