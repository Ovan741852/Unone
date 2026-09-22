import {createSceneLighting} from './presentation/scene-lighting.mjs';
import {createArenaWalls} from './presentation/arena-walls.mjs';
import {createCanvasUi} from './web/shared/canvas-ui.mjs';
import {createWorldLabels} from './presentation/world-labels.mjs';
import {createActors,prepareActorAssets} from './presentation/actors.mjs';
import {createFirstScreenAssets} from './presentation/first-screen.mjs';
import {createRewardPresentation} from './presentation/rewards.mjs';
import {fitFormalUI} from './presentation/adaptive-ui.mjs';
import {createUiMotion} from './presentation/ui-motion.mjs';
import {createShopAccessibility} from './presentation/shop-accessibility.mjs';
import {createLoadoutPreview} from './presentation/loadout-preview.mjs';
// Game-owned browser host: input/projection and presentation only.
// Authoritative simulation is the exported Unone Rust/WASM + main.luau.
import {createThreeRenderer} from './web/renderer/three.js';
import {createRuntimeBackend} from './web/shared/runtime-backend.mjs';
import {createHostInput} from './web/shared/host-input.js';
import {createAsyncScheduler} from './web/shared/async-scheduler.mjs';
import {createLandscapeViewport} from './presentation/landscape-host.mjs';
const stage=document.querySelector('#stage'),canvas=document.querySelector('#game'),input=createHostInput();
const viewport=createLandscapeViewport(canvas);
let actors,loadoutPreview,rewardPresentation,formalUi,worldLabels,projection,arenaWalls,sceneLighting;
const formalCanvas=document.querySelector("#formal-ui"),loadoutCanvas=document.querySelector("#loadout-preview");
// The loadout screen always keeps the paper-doll visible. `fit3d` only changes
// its camera framing; the old `2d` preview switch was a QA-only escape hatch.
const loadoutMode=new URLSearchParams(location.search).get('loadout')==='fit3d'?'fit3d':'3d';
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const uiMotion=createUiMotion({reducedMotion:()=>motionPreference.matches});
let safeInsets={};
function measureInsets(){safeInsets=viewport.safeInsets()}
measureInsets();
let backend,renderer,snapshot,scheduler,ready=false,lastFrame=-1,environments,themeId;
const shopAccessibility=createShopAccessibility({canvas:formalCanvas,stage,onAction:action=>{if(ready)input.queueAction(action)},onHold:(action,held)=>{if(ready)input.queueActionTransition(action,held)}});
let appliedQuality='';
function applyPresentationSettings(game){
 const quality=game?.settings?.quality??'high';
 if(quality===appliedQuality||!renderer)return;
 appliedQuality=quality;
 renderer.setBloom(quality!=='low');
 renderer.setAO(quality==='high');
 document.documentElement.dataset.quality=quality;
}
function presentation(){
 const theme=environments?.themes[themeId];if(!theme||!snapshot)return snapshot;
 const entities=Object.fromEntries(Object.entries(snapshot.world.entities).map(([id,e])=>[id,e.mesh3d?.asset.startsWith("mesh://sky_")?{...e,mesh3d:{...e.mesh3d,asset:theme.sky}}:e]));
 // The game VFX adapter replaces legacy debug rings / cube sparks. Coins and aim stay authoritative.
 const instances3d=Object.fromEntries(Object.entries(snapshot.world.instances3d??{}).filter(([id])=>!['sword','spear','cavalry','hound','wraith','minotaur','lord','impact','spark_red','spark_jade','spark_gold'].includes(id)));
 const seat=snapshot.world.observations.game.seat??1;
 const angle=(seat-1)*Math.PI/2,c=snapshot.world.camera3d;
 const rotate=p=>({x:p.x*Math.cos(angle)+p.z*Math.sin(angle),y:p.y,z:p.z*Math.cos(angle)-p.x*Math.sin(angle)});
 const camera3d={...c,position:rotate(c.position),target:rotate(c.target)};
 return {...snapshot,world:{...snapshot.world,entities,instances3d,camera3d}};
}

let down=false;let savedFingerprint="";
function releaseInput(){uiMotion.pointer("cancel");formalUi?.releaseAll();down=false;input.releaseAll()}
function fail(e){console.error(e);ready=false;document.body.dataset.ready='false';window.ashenLoading.fail(e);scheduler?.stop()}
const json=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json()};
export function projectPoint(x,z,height=0){
 const p=new projection.THREE.Vector3(x,height,z).project(projection.camera3d);
 const y=(1-p.y)/2;
 return {x:(p.x+1)*canvas.clientWidth/2,y:y*canvas.clientHeight};
}
function worldPoint(event){
 const p=viewport.toLocal(event),T=projection.THREE;
 const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(p.x/canvas.clientWidth*2-1,1-p.y/canvas.clientHeight*2),projection.camera3d);
 const hit=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),0),new T.Vector3());
 if(!hit)return {x:snapshot.world.observations.game.aimX??0,y:snapshot.world.observations.game.aimZ??0};
 const limit=snapshot.world.observations.game.arenaHalfExtent-.1;
 return {x:Math.max(-limit,Math.min(limit,hit.x)),y:Math.max(-limit,Math.min(limit,hit.z))};
}
function updatePointer(e,edge=false){
 if(snapshot?.world.observations.game.autoConfigOpen)return;
 if(!projection||!ready)return;const p=viewport.toLocal(e);let point=worldPoint(e);
 if(edge&&down&&snapshot?.world.observations.game.lockEnabled){
  let best=null,distance=Infinity;
  for(const m of Object.values(snapshot.world.observations.game.monsters)){const q=projectPoint(m.x,m.z,[.65,1.1,1.6,2,3][m.rank-1]);const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<Math.max(24,canvas.clientHeight*.08)&&d<distance){best=m;distance=d}}
  if(best)point={x:best.x,y:best.z};
 }
 input.updatePointer({position:point,screen_position:{x:p.x/canvas.clientWidth*100,y:(1-p.y/canvas.clientHeight)*100},down},edge?'edge':'move');
}
function routeUi(e,kind){
 const p=viewport.toLocal(e),x=p.x/canvas.clientWidth*100,y=(1-p.y/canvas.clientHeight)*100,hit=formalUi?.hitTest(x,y),id=hit?.nodeId??'';
 const game=snapshot?.world.observations.game,fee=game?.refreshCost??2;
 if(kind==='move')canvas.title=/^screen_gold/.test(id)?'金幣':/^screen_crystals/.test(id)?'強化結晶':/^stock_hit_/.test(id)?'查看裝備詳情：紫結晶是售價，金幣是派兵費變化':/^(stock_cost_|shop_detail_price)/.test(id)?'售價：消耗強化結晶':/^refresh(?:_|$)/.test(id)?`${game?.crystals<fee?'結晶不足：':''}重骰需要 ${fee} 結晶，不限次數，成功後加價`:'';
 uiMotion.pointer(kind,hit?.action?hit.nodeId:null);return formalUi?.pointer({kind,pointerId:e.pointerId,x,y})??false;
}
canvas.addEventListener('pointerleave',()=>{canvas.title='';uiMotion.pointer('move',null)});
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;if(routeUi(e,'down')||snapshot?.world.observations.game.autoConfigOpen){canvas.setPointerCapture(e.pointerId);e.preventDefault();return}down=true;canvas.setPointerCapture(e.pointerId);updatePointer(e,true)});
canvas.addEventListener('pointermove',e=>{if(!routeUi(e,'move'))updatePointer(e)});
canvas.addEventListener('pointerup',e=>{const handled=routeUi(e,'up');down=false;if(!handled)updatePointer(e,true)});
canvas.addEventListener('pointercancel',()=>{uiMotion.pointer('cancel');releaseInput()});
window.addEventListener('keydown',e=>{if(!ready||e.defaultPrevented||e.target.closest('dialog,[data-shop-semantics]'))return;if(['Space','Digit1','Digit2','Digit3','Escape'].includes(e.code)){e.preventDefault();if(!snapshot?.world.observations.game.autoConfigOpen||e.code==='Escape'){if(e.code==='Space')input.setHeld(e.code,true);else if(!e.repeat)input.queueAction(e.code)}}});
window.addEventListener('keyup',e=>input.setHeld(e.code,false));
window.addEventListener('blur',()=>{releaseInput();if(['battle','celebration'].includes(snapshot?.world.observations.game.phase)&&!snapshot.world.observations.game.paused)input.queueAction('Pause')});
document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseInput();if(['battle','celebration'].includes(snapshot?.world.observations.game.phase)&&!snapshot.world.observations.game.paused)input.queueAction('Pause')}});
window.ashen={hold(action,value){if(ready)input.setHeld(action,value)},action(action){if(ready)input.queueAction(action)},release(){releaseInput()},state:()=>snapshot?.world.observations.game,uiTree:()=>uiMotion.tree(),projectPoint,projectClientPoint:(x,z,h=0)=>viewport.toClient(projectPoint(x,z,h)),setLighting:value=>sceneLighting?.setMode(value),setBloom:value=>renderer?.setBloom(value),setAO:value=>renderer?.setAO(value),metrics:()=>({...renderer?.metrics(),walls:arenaWalls?.inspect(),lighting:sceneLighting?.inspect(),camera:{projection:"perspective",fan:false},actors:actors?.inspect(),loadoutPreview:{mode:loadoutMode,...loadoutPreview?.inspect()},lottie:rewardPresentation?.inspect(),labels:worldLabels?.inspect(),ui:formalUi?.report(),motion:uiMotion.inspect(),viewport:{...viewport.inspect(),safeInsets}}),setSceneTheme:id=>{if(!environments?.themes[id])throw Error("Unknown scene theme");themeId=id}};
async function start(){
 const loading=window.ashenLoading;loading.mark('host');loading.phase('正在準備遠征…');
 const preparedActors=prepareActorAssets({onProgress:(done,total)=>loading.progress(done,total)});
 preparedActors.catch(()=>{}); // Observed below; don't report a parallel rejection twice.
 const [payload,assets,runtime,themes]=await Promise.all([json('content/project.json'),json('content/assets.json'),json('runtime/runtime.json'),json('environments.json')]);
 environments=themes;themeId=themes.default;const themeSelect=document.querySelector('#scene-theme');if(themeSelect)themeSelect.onchange=e=>window.ashen.setSceneTheme(e.target.value);
 // Keep JS and its relative WASM fetch in the same content-versioned directory.
 const runtimeVersion=runtime.wasm_sha256+'-'+runtime.javascript_sha256;
 backend=await createRuntimeBackend({kind:'main',url:new URL('runtime/'+runtimeVersion+'/'+runtime.javascript,location.href).href});
 payload.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
 try{const saved=localStorage.getItem('forest-lord-town-v1');if(saved)payload.restored_save=JSON.parse(saved)}catch(e){console.warn('Town save not restored:',e.message)}
 const seed=new URLSearchParams(location.search).get('seed')??String(Date.now()%2147483647);
 snapshot=await backend.request({kind:'load',payload,seed});
 loading.mark('runtime');loading.phase('正在整理遠征之書…');
 // Count the displayed tree, including presentation-only fireflies. A separate
 // composer leaves the actual entry animation's start time untouched.
 const firstTree=createUiMotion({reducedMotion:()=>motionPreference.matches}).draw(fitFormalUI(snapshot,{width:canvas.clientWidth,height:canvas.clientHeight,insets:safeInsets})).world.ui;
 const firstScreen=createFirstScreenAssets(assets,{onProgress:(done,total)=>loading.progress(done,total,'首屏圖片')}),firstScreenReady=firstScreen.prepare(firstTree).then(()=>loading.mark('firstImages'));
 firstScreenReady.catch(()=>{});
 let presentationsReady;
 const preparePresentations=context=>{
  projection=context;sceneLighting=createSceneLighting(context);arenaWalls=createArenaWalls(context);
  presentationsReady=Promise.all([
   createActors({...context,preparedAssets:preparedActors}).then(value=>{loading.mark('actorsReady');return value}),
   createLoadoutPreview({canvas:loadoutCanvas,preparedAssets:preparedActors,mode:loadoutMode}).then(value=>{loading.mark('loadoutPreviewReady');return value}),
   createRewardPresentation({container:stage,getInsets:()=>safeInsets}).then(value=>{loading.mark('rewardsReady');return value}),
  ]).then(([readyActors,readyLoadoutPreview,readyRewards])=>{
   actors=readyActors;loadoutPreview=readyLoadoutPreview;rewardPresentation=readyRewards;loading.mark('models');
   context.attachPresentation({beforeRender:({snapshot,dt})=>{const game=snapshot?.world.observations.game;sceneLighting.update(game);arenaWalls.update(game);actors.update(game,dt);loadoutPreview.update(game,dt);rewardPresentation.update(game,dt);rewardPresentation.applyCamera(snapshot?.world.camera3d)},onDispose:()=>{sceneLighting.dispose();arenaWalls.dispose();actors.dispose();loadoutPreview.dispose();rewardPresentation.dispose()}});
  });
  presentationsReady.catch(()=>{}); // Joined before the loading cover can open.
 };
 renderer=await createThreeRenderer(canvas,{kind:'three-webgl',threeModuleUrl:new URL('presentation/vendor/build/three.module.js',location.href).href,onReady:preparePresentations,bloom:true,ao:true,instanceMemory:()=>backend.memory(),getAssetManifest:()=>assets,loadAssetUrl:async asset=>new URL('content/'+asset.source,location.href).href});
 renderer.setAO(true);
 measureInsets();await backend.request({kind:'aspect',value:canvas.clientWidth/canvas.clientHeight});
 // This hidden scene draw starts mesh -> texture decoding while the full actor
 // roster is still downloading. Legacy presentation prototypes are always
 // excluded above, including before createActors has finished.
 loading.phase('正在載入森林場景與天空…');loading.mark('sceneStart');
 renderer.draw(presentation());
 const sceneReady=renderer.ready().then(()=>{loading.mark('sceneReady');loading.phase('正在整備部隊與遠征演出…')});
 await Promise.all([sceneReady,presentationsReady,firstScreenReady]);
 if(formalCanvas)formalUi=createCanvasUi(formalCanvas,{resolveAsset:firstScreen.resolve,onAction:({action,phase})=>input.queueActionTransition(action,phase==='down'),fontFamily:'"Microsoft JhengHei",sans-serif',textColor:'#f4e4b8',onDiagnostic:d=>console.error(d)});
 if(formalCanvas)worldLabels=createWorldLabels({before:formalCanvas,projectPoint,getInsets:()=>safeInsets});
 loading.phase('正在繪製第一幀…');
 let firstVisualDraw=true;
 const draw=()=>{
  // Download time must not advance actor/VFX entry animation on the first frame.
  applyPresentationSettings(snapshot?.world?.observations?.game);
  renderer.draw(presentation(),firstVisualDraw?{dt:0}:undefined);firstVisualDraw=false;worldLabels?.draw(snapshot.world.observations.game);formalUi?.draw(uiMotion.draw(fitFormalUI(snapshot,{width:canvas.clientWidth,height:canvas.clientHeight,insets:safeInsets})));document.body.dataset.phase=snapshot.world.observations.game.phase;
  const game=snapshot.world.observations.game;
  formalCanvas?.setAttribute('aria-label',game.phase==='shop'&&game.location==='market'?'榛姨商店':'Unone 遊戲介面');
  shopAccessibility.sync(uiMotion.tree(),game);
  if(snapshot.save_payload){const serialized=JSON.stringify(snapshot.save_payload);if(serialized!==savedFingerprint){try{localStorage.setItem('forest-lord-town-v1',serialized);savedFingerprint=serialized}catch(e){console.warn('Town save not persisted:',e.message)}}}
  if(snapshot.world.frame!==lastFrame){lastFrame=snapshot.world.frame;window.dispatchEvent(new CustomEvent('ashen-state',{detail:snapshot.world.observations.game}));}
 };
 scheduler=createAsyncScheduler({tick:async()=>{const before=snapshot?.world.observations.game;snapshot=await backend.request({kind:'tick',input:input.consumeFrame()});const after=snapshot.world.observations.game;if(before.phase!==after.phase||before.autoConfigOpen!==after.autoConfigOpen||before.lockEnabled!==after.lockEnabled||before.autoEnabled!==after.autoEnabled)releaseInput()},render:draw,onError:fail});
 // The official UI resolves assets asynchronously even when supplied decoded
 // images. Keep the loading cover until its first complete frame is drawn.
 loading.mark('firstDrawStart');draw();loading.mark('firstDraw');
 while(formalUi?.report().assets.some(a=>a.state==='loading')){await new Promise(requestAnimationFrame);draw()}
 if(formalUi?.report().diagnostics.length)throw Error('首屏介面載入失敗');
 await new Promise(requestAnimationFrame);draw();loading.mark('firstFrame');
 ready=true;document.body.dataset.ready='true';loading.finish();window.dispatchEvent(new CustomEvent('ashen-ready'));scheduler.start();
 window.addEventListener('resize',()=>{measureInsets();releaseInput();backend.request({kind:'aspect',value:canvas.clientWidth/canvas.clientHeight}).catch(fail)});
 window.addEventListener('pagehide',()=>{scheduler.stop();shopAccessibility.dispose();worldLabels?.dispose();formalUi?.dispose();renderer.dispose?.();backend.close()});
}
start().catch(fail);
