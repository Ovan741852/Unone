import {createRewardPresentation} from '/game/presentation/rewards.mjs';
import {createActors} from '/game/presentation/actors.mjs';
import {policies,simulate,summarize} from './balance.mjs';
import {createRuntimeBackend} from '/game/web/shared/runtime-backend.mjs';
import {createThreeRenderer} from '/game/web/renderer/three.js';
import {frameInput,checkAssertions,validateReplay} from './replay.mjs';
const $=id=>document.getElementById(id),canvas=$('game');
const json=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);return r.json();};
let backend,renderer,snapshot,payload,catalog,ready=false,busy=false,playing=false,cancel=false,flight=Promise.resolve(),seed=42,history=[],reports=[],events=[],title='',lastTime=0;
let actors,rewards;let choiceSignature='';let balanceRuns=[];const uiHeld={};
addEventListener('pointerup',()=>{for(const key of Object.keys(uiHeld))delete uiHeld[key]});
addEventListener('pointercancel',()=>{for(const key of Object.keys(uiHeld))delete uiHeld[key]});
let pointer={position:{x:0,y:0},down:false},actions={},lastBreaks=0,maxMonsters=0,failedInvariants=new Set();
const game=()=>snapshot?.world?.observations?.game??{},obs=()=>snapshot?.world?.observations??{};
function say(message){$('status').textContent=message;}
function fail(error){playing=false;say('執行失敗：'+error.message);console.error(error);}
function lock(value){busy=value;document.querySelectorAll('#scenarios button,#runSpec,#suite,#step,#seek,#replay,#balance,#batchCount').forEach(b=>b.disabled=value);}
async function stop(){playing=false;pointer.down=false;await flight;}
async function exclusive(fn){if(busy||!ready)return;lock(true);cancel=false;await stop();try{await fn();}catch(e){fail(e);}finally{lock(false);refresh();}}
function refresh(){
  const s=game();$('sceneTitle').textContent=title||'固定種子試玩';$('mode').textContent=busy?'快進／驗證中':playing?'正常速度試玩':'已暫停';$('play').textContent=playing?'Ⅱ 暫停試玩':'▶ 接手試玩';
  const cards=[['回合',s.round??'—'],['剩餘秒數',Math.ceil(s.time??0)],['金幣',s.coins??'—'],['結晶',s.crystals??'—'],['怪物',Object.values(s.monsters??{}).length],['派兵',s.fired??0],['破防抽獎',s.breaks??0],['彈牆',s.bounces??0],['退款',s.refunded??0]];
  $('stats').replaceChildren(...cards.map(([label,value])=>{const d=document.createElement('div');d.className='stat';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;d.append(l,v);return d;}));
  const nextChoices=JSON.stringify([s.phase,s.selected,s.buildIndex,s.stock,s.items,s.cards,s.chestCount,s.autoConfigOpen,s.autoDraft]);
  if(nextChoices!==choiceSignature){choiceSignature=nextChoices;
  $('choices').replaceChildren();
  if(s.autoConfigOpen){
   // Developer harness mirrors the production semantic controls; no second targeting policy.
   for(const n of snapshot.world.ui.children.filter(n=>/^(auto_name_\d+|auto_preset_\w+|auto_cancel|auto_stop|auto_apply)$/.test(n.id))){
    const b=document.createElement('button');b.textContent=n.text;b.disabled=n.kind!=='button';
    if(n.action){b.dataset.action=n.action;b.onclick=()=>actions[n.action]=true;}$('choices').append(b);
   }
  }
  if(s.phase==='shop'){
   Object.values(s.stock??{}).forEach((item,i)=>{const b=document.createElement('button');b.textContent=`${item.name} · ${item.currency==='crystal'?'◆ 結晶':'金幣'} ${item.price}`;b.disabled=item.sold;b.onclick=()=>actions['Buy'+(i+1)]=true;$('choices').append(b)});
   Object.values(s.items??{}).forEach((item,i)=>{const b=document.createElement('button');b.textContent='裝備 '+item.name;b.onclick=()=>actions['Equip'+(i+1)]=true;$('choices').append(b)});
   for(const [label,action]of [['進入戰鬥','LeaveShop'],['附魔 ◆8','Enchant'],['採用附魔','AcceptEnchant'],['保留原詞綴','KeepEnchant']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>actions[action]=true;$('choices').append(b)}
  }
  if(['menu','choice','shop','clear'].includes(s.phase)){
   policies.filter(p=>p.build).forEach(p=>{const b=document.createElement('button');b.textContent=(s.buildIndex===p.buildIndex?'✓ ':'')+p.name;b.onclick=()=>{actions['Build'+p.buildIndex]=true;actions['Unit'+p.unit]=true};$('choices').append(b)});
  }
  if(s.phase==='clear'){for(const [text,key]of [['下一輪','Next'],['按住開箱','OpenChest']]){const b=document.createElement('button');b.textContent=text;b.onpointerdown=()=>uiHeld[key]=true;b.onpointerup=b.onpointercancel=()=>delete uiHeld[key];$('choices').append(b)}}
  if(s.phase==='choice')Object.values(s.cards??{}).forEach((c,i)=>{const b=document.createElement('button');b.textContent=c.name;b.title=c.desc;b.onclick=()=>actions['Choice'+(i+1)]=true;$('choices').append(b);});
  }
}
function presentation(){return actors?{...snapshot,world:{...snapshot.world,instances3d:Object.fromEntries(Object.entries(snapshot.world.instances3d??{}).filter(([id])=>!['sword','spear','cavalry','hound','wraith','minotaur','lord'].includes(id)))}}:snapshot}
function render(){if(snapshot){renderer.draw(presentation());refresh();}}
async function load(nextSeed){
  seed=Number(nextSeed);if(!Number.isSafeInteger(seed)||seed<1||seed>2147483647)throw Error('種子請輸入 1～2147483647');
  history=[];events=[];lastBreaks=0;maxMonsters=0;failedInvariants.clear();actions={};pointer.down=false;
  snapshot=await backend.request({kind:'load',payload,seed:String(seed)});$('seed').value=seed;renderer?.resetMeasurements();render();
}
async function tick(input){
  if(history.length>=120000)throw Error('已達 120,000 幀，請匯出紀錄後重新開局');
  snapshot=await backend.request({kind:'tick',input});history.push(structuredClone(input));
  const s=game();maxMonsters=Math.max(maxMonsters,Object.values(s.monsters??{}).length);
  for(const key of ['economy_conserved','crystal_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds','lock_exclusive'])if(obs()[key]===false)failedInvariants.add(key);
  if((s.breaks??0)>lastBreaks){events.push({frame:history.length,kind:'award',breaks:s.breaks,coins:s.coins,crystals:s.crystals});lastBreaks=s.breaks;$('events').textContent=events.slice(-12).map(e=>`第 ${e.frame} 幀 · 破防抽獎 ${e.breaks} 次 · ${e.coins} 金幣 · ${e.crystals??0} 結晶`).join('\n');}
}
async function advance(frames,inputAt=()=>({actions:{}}),until=()=>false){
  for(let i=0;i<frames;i++){
    if(cancel)throw Error('已停止；保留目前狀態，可接手試玩或匯出');
    await tick(inputAt(i));if(until())break;
    if(i%30===0){$('progress').value=(i+1)/frames;render();say(`正在執行第 ${history.length} 幀 · 不計入正常遊玩效能`);await new Promise(r=>setTimeout(r,0));}
  }
  $('progress').value=1;render();
}
async function startBattle(){await tick({actions:{Start:true}});await advance(120,undefined,()=>game().phase==='choice');if(game().phase!=='choice')throw Error('遠征未抵達景點');await tick({actions:{Choice1:true}});await tick({actions:{}});await tick({actions:{LeaveShop:true}});await tick({actions:{}});}
function addReport(report){reports.push(report);const div=document.createElement('div');div.className=report.pass?'pass':'fail';div.textContent=`${report.pass?'PASS':'FAIL'} · ${report.name} · seed ${report.seed} · ${report.frames} 幀`;$('results').prepend(div);for(const a of report.assertions??[])if(!a.pass){const d=document.createElement('div');d.textContent=`${a.key}: 預期 ${JSON.stringify(a.expected)}，實際 ${JSON.stringify(a.actual)}`;div.append(d);}}
async function runSpec(id){
  const spec=await json('/spec/'+encodeURIComponent(id));title=spec.name;await load(spec.seed??42);await advance(spec.frames,i=>frameInput(spec,i));
  const assertions=checkAssertions(spec,obs());const pass=assertions.length>0&&assertions.every(a=>a.pass)&&failedInvariants.size===0;
  addReport({name:spec.name,seed,frames:history.length,pass,assertions,invariants:[...failedInvariants],maxMonsters});say(`${pass?'通過':'失敗'}：${spec.name}；自動檢查結果不代表遊玩體驗。`);
}
async function scenario(name){
  if(name==='refund')return runSpec('timeout-refunds-survivor-once.test.json');
  if(name==='bounce')return runSpec('corner-reflection-1.test.json');
  title=({start:'進場與派兵',horde:'怪物潮',boss:'最後 30 秒',poor:'低金錢求生'})[name];
  await load(name==='horde'?2:$('seed').value);await startBattle();
  if(name==='boss')await advance(12000,undefined,()=>game().time<=35);
  if(name==='horde'){await advance(3000,undefined,()=>obs().horde_count>=1);if(!(obs().horde_count>=1))throw Error('此版本未在預期幀數觸發怪物潮');}
  if(name==='poor'){await advance(1800,()=>({pointer:{position:{x:7.3,y:7.1},down:true},actions:{}}),()=>game().coins<16||game().phase!=='battle');}
  if(game().phase!=='battle')throw Error('場景已結束，請檢查遊戲版本或種子');
  say('場景已就緒，按「接手試玩」以正常速度操作。快進只送正常輸入。');
}
async function frame(now){
  if(playing&&!busy){
    if(!lastTime)lastTime=now;
    if(now-lastTime>250)lastTime=now-1000/60;
    let steps=0;while(playing&&now-lastTime>=1000/60&&steps++<5){lastTime+=1000/60;const input={actions:{...uiHeld,...actions},pointer:structuredClone(pointer)};actions={};flight=tick(input);try{await flight;render();}catch(e){fail(e);}}
  }else lastTime=0;
  if(renderer&&snapshot&&!busy)renderer.draw(presentation());
  requestAnimationFrame(frame);
}
$('play').onclick=async()=>{if(!ready||busy)return;if(playing){await stop();}else {if(game().paused){await tick({actions:{Pause:true}});await tick({actions:{}});}playing=true;}refresh();};
$('cancel').onclick=()=>{cancel=true;playing=false;pointer.down=false;};
$('step').onclick=()=>exclusive(async()=>{await tick({actions:{...uiHeld,...actions},pointer:structuredClone(pointer)});actions={};render();});
$('seek').onclick=()=>exclusive(()=>advance(600));
document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>exclusive(()=>scenario(b.dataset.scene)));
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{if(!busy)actions[b.dataset.action]=true;});
$('runSpec').onclick=()=>exclusive(()=>runSpec($('spec').value));
$('suite').onclick=()=>exclusive(async()=>{reports=[];$('results').replaceChildren();for(const spec of catalog.specs){if(cancel)break;await runSpec(spec.id);}say(`回歸完成：${reports.filter(r=>r.pass).length}/${reports.length} 通過`);});
$('balance').onclick=()=>exclusive(async()=>{
  const first=Number($('seed').value),count=Number($('batchCount').value);
  if(!Number.isSafeInteger(first)||first<1||first+count-1>2147483647)throw Error('種子範圍無效');
  balanceRuns=[];$('balanceResults').textContent='執行中：不是玩家勝率預測。';$('balanceExport').disabled=true;
  const selection=$('balancePolicy').value;const selected=policies.filter(p=>selection==='builds'?p.build:selection==='baseline'?!p.build:p.id===selection);
  for(let n=0;n<count;n++)for(const policy of selected){
    if(cancel)break;
    title='數值模擬 · '+policy.name;
    const run=await simulate({seed:first+n,policy,load,tick,observe:obs,cancelled:()=>cancel,progress:async info=>{render();say(`${policy.name} · seed ${info.seed} · 第 ${info.round} 輪 · ${info.frames} 幀`);await new Promise(r=>setTimeout(r,0));}});
    balanceRuns.push(run);
    $('balanceResults').textContent=summarize(balanceRuns).map(r=>`${r.name}：完成 ${r.completed} 局，全勝 ${r.victories}，破產 ${r.bankruptcies}，超時 ${r.timeouts}，平均過 ${r.meanRoundsCleared?.toFixed(1)??'—'} 輪`).join('\n');
  }
  $('balanceExport').disabled=false;say(cancel?'批次已停止，已完成結果可匯出。':'數值模擬完成；這是固定操作策略的結果，不能當作真人體驗或玩家勝率。');
});
$('balanceExport').onclick=()=>{
 const data={format:'unone.fishing.balance.v1',scriptHash:catalog.scriptHash,sourceMatchesExport:catalog.sourceMatchesExport,policyVersion:5,scope:'Native-input build shopping, split gold/crystal budgets, gear/tech/enchants, mixed units and final boss lock; no gameplay state injection',policy:'Manual hold; retarget nearest small every 12 frames, rank-5 boss when present; build-directed shops; affordable unit selection; no state edits',runs:balanceRuns,summary:summarize(balanceRuns)};
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fishing-balance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('bloom').onchange=e=>{renderer?.setBloom(e.target.checked);render();};$('ao').onchange=e=>{renderer?.setAO(e.target.checked);render();};
function point(e){const r=canvas.getBoundingClientRect(),nx=(e.clientX-r.left)/r.width*2-1,ny=1-(e.clientY-r.top)/r.height*2,L=Math.hypot(14,20),tan=Math.tan(25*Math.PI/180),vy=-14/L+ny*tan*20/L,vz=-20/L-ny*tan*14/L,d=-14/vy;return {x:Math.max(-7.3,Math.min(7.3,nx*tan*r.width/r.height*d)),y:Math.max(-7.3,Math.min(7.3,20+vz*d))};}
canvas.onpointerdown=e=>{if(e.button!==0||busy)return;pointer={position:point(e),down:true};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>pointer.position=point(e);canvas.onpointerup=canvas.onpointercancel=()=>pointer.down=false;
window.addEventListener('blur',()=>{playing=false;pointer.down=false;});document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;pointer.down=false;}});
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||busy)return;if(['1','2','3'].includes(e.key))actions['Unit'+e.key]=true;});
$('download').onclick=async()=>{await stop();const data={format:'unone.fishing.quicktest.v1',scriptHash:catalog.scriptHash,seed,title,inputs:history,reports,observations:obs(),maxMonsters,invariantFailures:[...failedInvariants],events,experience:Object.fromEntries(['clarity','response','again','note'].map(k=>[k,$(k).value])),note:'Accelerated simulation is not normal-speed performance evidence.'};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`quicktest-${seed}-${history.length}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('replay').onchange=e=>{const file=e.target.files[0];if(file)exclusive(async()=>{if(file.size>50000000)throw Error('重播檔上限 50 MB');const data=validateReplay(JSON.parse(await file.text()),catalog.scriptHash);title='輸入重播';await load(data.seed);await advance(data.inputs.length,i=>data.inputs[i]);say('重播完成，已停在最後一幀。');});};
async function init(){
  const assets=await json('/game/content/assets.json'),runtime=await json('/game/runtime/runtime.json');payload=await json('/game/content/project.json');catalog=await json('/api/catalog');
  $('version').textContent=`已匯出腳本 ${catalog.scriptHash?.slice(0,12)} · ${catalog.sourceMatchesExport?'與 main.luau 一致':'注意：與目前 main.luau 不同，測試針對已匯出版本'}`;
  for(const p of policies){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('balancePolicy').append(option)}
  for(const s of catalog.specs){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$('spec').append(o);}
  backend=await createRuntimeBackend({kind:'main',url:new URL('/game/runtime/'+runtime.javascript,location.href).href});
  payload.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
  snapshot=await backend.request({kind:'load',payload,seed:'42'});
  renderer=await createThreeRenderer(canvas,{kind:'three-webgl',threeModuleUrl:new URL('/game/presentation/vendor/build/three.module.js',location.href).href,onReady:async context=>{actors=await createActors({...context,assetBase:new URL('/game/',location.href)});rewards=await createRewardPresentation({assetBase:'/game/',container:document.querySelector('.stage')});context.attachPresentation({beforeRender:({snapshot,dt})=>{const g=snapshot?.world.observations.game;const view={...g,paused:g?.paused||!playing&&!busy};actors.update(view,dt);rewards.update(view,dt)},onDispose:()=>{actors.dispose();rewards.dispose()}})},bloom:true,ao:true,instanceMemory:()=>backend.memory(),getAssetManifest:()=>assets,loadAssetUrl:async a=>new URL('/game/content/'+a.source,location.href).href});
  renderer.draw(presentation());await renderer.ready();ready=true;render();say('就緒。選擇場景開始，或直接跑回歸案例。');document.body.dataset.ready='true';requestAnimationFrame(frame);
}
init().catch(fail);
