// Game-owned human presentation. All battle operations invoke registered Luau tools.
const root=document.createElement('main');root.id='battle-ui';
root.innerHTML=`<header><div class="brand"><span class="sigil">╱╲</span><div><small>UNONE · REAL-TIME BATTLE LAB</small><h1>LEGION <i>FALL</i></h1></div></div><div class="live"><b></b> LIVE SIMULATION <span id="clock">00:00</span></div><button id="tools">開發工具 ↗</button></header>
<section class="score"><div class="army red"><small>CRIMSON LEGION / 赤焰軍團</small><strong id="red">5,000</strong><span>存活兵力</span></div><div class="versus"><small>FIELD 001</small><b>10,000</b><span>七種兵種 · 自主交戰</span></div><div class="army blue"><small>AZURE GUARD / 蒼穹衛隊</small><strong id="blue">5,000</strong><span>存活兵力</span></div><div class="balance"><i id="redbar"></i><i id="bluebar"></i></div></section>
<aside class="legend"><small>ORDER OF BATTLE</small><h2>戰場上的每一個<br>身影，都在戰鬥。</h2><p>步兵推進，騎兵側襲。箭雨越過前線，<br>投石與魔法在密集陣形中爆開。</p><div class="roster">${[['Ⅰ','步兵','盾劍近戰'],['↗','弓兵','拋物線射擊'],['♞','騎兵','快速突擊'],['⊹','弩車','重型直射'],['◒','投石車','範圍轟擊'],['⌁','飛行衛隊','空中襲擊'],['✧','法師','魔法爆破']].map(([i,n,d])=>`<div><b>${i}</b><span>${n}</span><small>${d}</small></div>`).join('')}</div></aside>
<footer><div class="controls"><small>BATTLE SIZE</small><div id="sizes">${[1000,5000,10000].map(n=>`<button data-size="${n}" class="${n===10000?'selected':''}">${n.toLocaleString()}</button>`).join('')}</div><button id="restart">↻ 重新開戰</button><button id="pause">Ⅱ 暫停</button></div><div class="camera"><small>CAMERA</small><button data-camera="wide" class="selected">全景</button><button data-camera="front">前線</button><button data-camera="top">俯瞰</button></div><div class="performance"><strong id="fps">— <small>FPS</small></strong><span id="perf">正在載入戰場…</span><small id="events">20 Hz 戰鬥模擬 · GPU instancing</small></div></footer><div id="toast"></div>`;
document.body.append(root);
let size=10000,paused=false,samples=[],previous=performance.now(),fps=0;
function measure(now){const dt=now-previous;previous=now;samples.push(dt);if(samples.length>180)samples.shift();requestAnimationFrame(measure);}requestAnimationFrame(measure);
const api=()=>window.unoneDeveloper;
async function invoke(id,value){const a=api();if(!a)return;const tools=await a.request({method:'tools.list'});const result=await a.request({method:'tools.invoke',id,revision:tools.value.revision,...(value===undefined?{}:{value})});if(!result.ok){document.querySelector('#toast').textContent=result.diagnostics.map(d=>d.explanation).join(' / ');}}
root.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{size=Number(b.dataset.size);root.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('selected',x===b));invoke('battle.reset'+size);});
root.querySelector('#restart').onclick=()=>invoke('battle.reset'+size);
root.querySelector('#pause').onclick=async()=>{paused=!paused;await api()?.request({method:'pause',paused});root.querySelector('#pause').textContent=paused?'▶ 繼續':'Ⅱ 暫停';};
root.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>{invoke('battle.camera.'+b.dataset.camera);root.querySelectorAll('[data-camera]').forEach(x=>x.classList.toggle('selected',x===b));});
root.querySelector('#tools').onclick=()=>document.querySelector('#unone-developer .dev-launch')?.click();
let initialized=false;
setInterval(async()=>{
 if(!api())return;
 if(!initialized){const close=document.querySelector('#unone-developer .dev-close');if(close)close.click();initialized=true;}
 const r=await api().request({method:'observations'});if(!r.ok)return;
 const b=r.value.observations?.battle;if(!b)return;
 root.querySelector('#red').textContent=b.red.toLocaleString();root.querySelector('#blue').textContent=b.blue.toLocaleString();root.querySelector('.versus b').textContent=b.total.toLocaleString();
 root.querySelector('#redbar').style.flex=Math.max(1,b.red);root.querySelector('#bluebar').style.flex=Math.max(1,b.blue);
 root.querySelector('#clock').textContent=String(Math.floor(b.seconds/60)).padStart(2,'0')+':'+String(Math.floor(b.seconds%60)).padStart(2,'0');
 const avg=samples.reduce((a,b)=>a+b,0)/(samples.length||1);fps=avg?Math.round(1000/avg):0;
 root.querySelector('#fps').innerHTML=fps+' <small>FPS</small>';
 const stats=r.value.renderer??{};
 root.querySelector('#perf').textContent=`${stats.draw_calls??'—'} draws · ${((stats.triangles??0)/1e6).toFixed(2)}M triangles · ${avg.toFixed(1)} ms/frame`;
 root.querySelector('#events').textContent=`${b.stress?'壓測：不計傷亡 · ':''}${b.attacks.toLocaleString()} 次攻擊 · ${b.projectiles} 飛行彈體 · ${b.red_kills+b.blue_kills} 陣亡`;
 document.body.dataset.battlePerformance=JSON.stringify({fps,frame_ms:avg,raf_p95_ms:[...samples].sort((a,b)=>a-b)[Math.floor(samples.length*.95)]??null,simulation:b,renderer:stats});
},500);

window.addEventListener('battle-reset-metrics',()=>{samples=[];previous=performance.now();document.body.dataset.battlePerformance='{}';});
