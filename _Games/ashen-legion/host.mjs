import {createSceneLighting} from './presentation/scene-lighting.mjs';
import {createArenaWalls} from './presentation/arena-walls.mjs';
import {createCanvasUi} from './web/shared/canvas-ui.mjs';
import {createWorldLabels} from './presentation/world-labels.mjs';
import {createActors} from './presentation/actors.mjs';
import {createRewardPresentation} from './presentation/rewards.mjs';
import {fitFormalUI} from './presentation/adaptive-ui.mjs';
import {createUiMotion} from './presentation/ui-motion.mjs';
// Game-owned browser host: input/projection and presentation only.
// Authoritative simulation is the exported Unone Rust/WASM + main.luau.
import {createThreeRenderer} from './web/renderer/three.js';
import {createRuntimeBackend} from './web/shared/runtime-backend.mjs';
import {createHostInput} from './web/shared/host-input.js';
import {createAsyncScheduler} from './web/shared/async-scheduler.mjs';
const canvas=document.querySelector('#game'),input=createHostInput();
let actors,rewardPresentation,formalUi,worldLabels,projection,arenaWalls,sceneLighting;
const formalCanvas=document.querySelector("#formal-ui");
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const uiMotion=createUiMotion({reducedMotion:()=>motionPreference.matches});
let safeInsets={};
function measureInsets(){const s=getComputedStyle(document.documentElement);safeInsets=Object.fromEntries(['left','right','top','bottom'].map(k=>[k,parseFloat(s.getPropertyValue('--safe-'+k))||0]));}
measureInsets();
let backend,renderer,snapshot,scheduler,ready=false,lastFrame=-1,environments,themeId;
function presentation(){
 const theme=environments?.themes[themeId];if(!theme||!snapshot)return snapshot;
 const entities=Object.fromEntries(Object.entries(snapshot.world.entities).map(([id,e])=>[id,e.mesh3d?.asset.startsWith("mesh://sky_")?{...e,mesh3d:{...e.mesh3d,asset:theme.sky}}:e]));
 const instances3d=Object.fromEntries(Object.entries(snapshot.world.instances3d??{}).filter(([id])=>!actors||!['sword','spear','cavalry','hound','wraith','minotaur','lord'].includes(id)));
 const seat=snapshot.world.observations.game.seat??1;
 const angle=(seat-1)*Math.PI/2,c=snapshot.world.camera3d;
 const rotate=p=>({x:p.x*Math.cos(angle)+p.z*Math.sin(angle),y:p.y,z:p.z*Math.cos(angle)-p.x*Math.sin(angle)});
 const aspect=canvas.clientWidth/canvas.clientHeight;
 const position=rotate(aspect<1.05?{x:0,y:32,z:20}:c.position);
 const fov_degrees=aspect<1.05?2*Math.atan(Math.tan(c.fov_degrees*Math.PI/360)*1.65/aspect)*180/Math.PI:c.fov_degrees;
 const camera3d={...c,position,target:rotate(c.target),fov_degrees};
 return {...snapshot,world:{...snapshot.world,entities,instances3d,camera3d}};
}

let down=false;let savedFingerprint="";
function releaseInput(){uiMotion.pointer("cancel");formalUi?.releaseAll();down=false;input.releaseAll()}
function fail(e){console.error(e);document.querySelector('#error').hidden=false;document.querySelector('#error').textContent='遊戲載入失敗：'+e.message;document.body.dataset.error=e.message;scheduler?.stop()}
const json=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json()};
export function projectPoint(x,z,height=0){
 const rect=canvas.getBoundingClientRect();
 const p=new projection.THREE.Vector3(x,height,z).project(projection.camera3d);
 const y=(1-p.y)/2;
 return {x:(p.x+1)*rect.width/2,y:y*rect.height};
}
function worldPoint(event){
 const r=canvas.getBoundingClientRect(),T=projection.THREE;
 const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),projection.camera3d);
 const hit=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),0),new T.Vector3());
 if(!hit)return {x:snapshot.world.observations.game.aimX??0,y:snapshot.world.observations.game.aimZ??0};
 const limit=snapshot.world.observations.game.arenaHalfExtent-.1;
 return {x:Math.max(-limit,Math.min(limit,hit.x)),y:Math.max(-limit,Math.min(limit,hit.z))};
}
function updatePointer(e,edge=false){
 if(snapshot?.world.observations.game.autoConfigOpen)return;
 const rect=canvas.getBoundingClientRect();if(!projection||!ready)return;let point=worldPoint(e);
 if(edge&&down&&snapshot?.world.observations.game.lockEnabled){
  let best=null,distance=Infinity;
  for(const m of Object.values(snapshot.world.observations.game.monsters)){const q=projectPoint(m.x,m.z,[.65,1.1,1.6,2,3][m.rank-1]);const d=Math.hypot(e.clientX-rect.left-q.x,e.clientY-rect.top-q.y);if(d<Math.max(24,rect.height*.08)&&d<distance){best=m;distance=d}}
  if(best)point={x:best.x,y:best.z};
 }
 input.updatePointer({position:point,screen_position:{x:(e.clientX-rect.left)/rect.width*100,y:(1-(e.clientY-rect.top)/rect.height)*100},down},edge?'edge':'move');
}
function routeUi(e,kind){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(1-(e.clientY-r.top)/r.height)*100;const hit=formalUi?.hitTest(x,y);uiMotion.pointer(kind,hit?.action?hit.nodeId:null);return formalUi?.pointer({kind,pointerId:e.pointerId,x,y})??false}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;if(routeUi(e,'down')||snapshot?.world.observations.game.autoConfigOpen){canvas.setPointerCapture(e.pointerId);e.preventDefault();return}down=true;canvas.setPointerCapture(e.pointerId);updatePointer(e,true)});
canvas.addEventListener('pointermove',e=>{if(!routeUi(e,'move'))updatePointer(e)});
canvas.addEventListener('pointerup',e=>{const handled=routeUi(e,'up');down=false;if(!handled)updatePointer(e,true)});
canvas.addEventListener('pointercancel',()=>{uiMotion.pointer('cancel');releaseInput()});
window.addEventListener('keydown',e=>{if(e.target.closest('dialog'))return;if(['Space','Digit1','Digit2','Digit3','Escape'].includes(e.code)){e.preventDefault();if(!snapshot?.world.observations.game.autoConfigOpen||e.code==='Escape'){if(e.code==='Space')input.setHeld(e.code,true);else if(!e.repeat)input.queueAction(e.code)}}});
window.addEventListener('keyup',e=>input.setHeld(e.code,false));
window.addEventListener('blur',()=>{releaseInput();if(['battle','celebration'].includes(snapshot?.world.observations.game.phase)&&!snapshot.world.observations.game.paused)input.queueAction('Pause')});
document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseInput();if(['battle','celebration'].includes(snapshot?.world.observations.game.phase)&&!snapshot.world.observations.game.paused)input.queueAction('Pause')}});
window.ashen={hold(action,value){if(ready)input.setHeld(action,value)},action(action){if(ready)input.queueAction(action)},release(){releaseInput()},state:()=>snapshot?.world.observations.game,uiTree:()=>uiMotion.tree(),projectPoint,setLighting:value=>sceneLighting?.setMode(value),setBloom:value=>renderer?.setBloom(value),setAO:value=>renderer?.setAO(value),metrics:()=>({...renderer?.metrics(),walls:arenaWalls?.inspect(),lighting:sceneLighting?.inspect(),camera:{projection:"perspective",fan:false},actors:actors?.inspect(),lottie:rewardPresentation?.inspect(),labels:worldLabels?.inspect(),ui:formalUi?.report(),motion:uiMotion.inspect(),viewport:{width:canvas.clientWidth,height:canvas.clientHeight,portrait:canvas.clientWidth/canvas.clientHeight<1.05,safeInsets}}),setSceneTheme:id=>{if(!environments?.themes[id])throw Error("Unknown scene theme");themeId=id}};
async function start(){
 const [payload,assets,runtime,themes]=await Promise.all([json('content/project.json'),json('content/assets.json'),json('runtime/runtime.json'),json('environments.json')]);
 environments=themes;themeId=themes.default;const themeSelect=document.querySelector('#scene-theme');if(themeSelect)themeSelect.onchange=e=>window.ashen.setSceneTheme(e.target.value);
 // Keep JS and its relative WASM fetch in the same content-versioned directory.
 const runtimeVersion=runtime.wasm_sha256+'-'+runtime.javascript_sha256;
 backend=await createRuntimeBackend({kind:'main',url:new URL('runtime/'+runtimeVersion+'/'+runtime.javascript,location.href).href});
 payload.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
 try{const saved=localStorage.getItem('forest-lord-town-v1');if(saved)payload.restored_save=JSON.parse(saved)}catch(e){console.warn('Town save not restored:',e.message)}
 const seed=new URLSearchParams(location.search).get('seed')??String(Date.now()%2147483647);
 snapshot=await backend.request({kind:'load',payload,seed});
 renderer=await createThreeRenderer(canvas,{kind:'three-webgl',threeModuleUrl:new URL('presentation/vendor/build/three.module.js',location.href).href,onReady:async context=>{projection=context;sceneLighting=createSceneLighting(context);arenaWalls=createArenaWalls(context);actors=await createActors(context);rewardPresentation=await createRewardPresentation({getInsets:()=>safeInsets});context.attachPresentation({beforeRender:({snapshot,dt})=>{const game=snapshot?.world.observations.game;sceneLighting.update(game);arenaWalls.update(game);actors.update(game,dt);rewardPresentation.update(game,dt);rewardPresentation.applyCamera(snapshot?.world.camera3d)},onDispose:()=>{sceneLighting.dispose();arenaWalls.dispose();actors.dispose();rewardPresentation.dispose()}})},bloom:true,ao:true,instanceMemory:()=>backend.memory(),getAssetManifest:()=>assets,loadAssetUrl:async asset=>new URL('content/'+asset.source,location.href).href});
 if(formalCanvas)formalUi=createCanvasUi(formalCanvas,{resolveAsset:async id=>{const a=assets.assets.find(a=>a.id===id);if(!a)throw Error('Missing UI asset '+id);return new URL('content/'+a.source,location.href).href},onAction:({action,phase})=>input.queueActionTransition(action,phase==='down'),fontFamily:'"Microsoft JhengHei",sans-serif',textColor:'#f4e4b8',onDiagnostic:d=>console.error(d)});
 if(formalCanvas)worldLabels=createWorldLabels({before:formalCanvas,projectPoint,getInsets:()=>safeInsets});
 renderer.setAO(true);
 renderer.draw(presentation());await renderer.ready();ready=true;document.body.dataset.ready='true';
 const draw=()=>{
  renderer.draw(presentation());worldLabels?.draw(snapshot.world.observations.game);formalUi?.draw(uiMotion.draw(fitFormalUI(snapshot,{width:canvas.clientWidth,height:canvas.clientHeight,insets:safeInsets})));document.body.dataset.phase=snapshot.world.observations.game.phase;
  if(snapshot.save_payload){const serialized=JSON.stringify(snapshot.save_payload);if(serialized!==savedFingerprint){try{localStorage.setItem('forest-lord-town-v1',serialized);savedFingerprint=serialized}catch(e){console.warn('Town save not persisted:',e.message)}}}
  if(snapshot.world.frame!==lastFrame){lastFrame=snapshot.world.frame;window.dispatchEvent(new CustomEvent('ashen-state',{detail:snapshot.world.observations.game}));}
 };
 scheduler=createAsyncScheduler({tick:async()=>{const before=snapshot?.world.observations.game;snapshot=await backend.request({kind:'tick',input:input.consumeFrame()});const after=snapshot.world.observations.game;if(before.phase!==after.phase||before.autoConfigOpen!==after.autoConfigOpen||before.lockEnabled!==after.lockEnabled||before.autoEnabled!==after.autoEnabled)releaseInput()},render:draw,onError:fail});
 window.dispatchEvent(new CustomEvent('ashen-ready'));draw();scheduler.start();
 window.addEventListener('resize',()=>{measureInsets();releaseInput();backend.request({kind:'aspect',value:canvas.clientWidth/canvas.clientHeight}).catch(fail)});
 window.addEventListener('pagehide',()=>{scheduler.stop();worldLabels?.dispose();formalUi?.dispose();renderer.dispose?.();backend.close()});
}
start().catch(fail);
