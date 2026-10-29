import * as THREE from '../vendor/three/three.module.js';
import {createVfxPlayer} from '../renderer/vfx-player.js';
import {validateEffect,parametersFor} from '../renderer/vfx-contract.js';
import {loadVfxParticleSampler} from '../renderer/vfx-native.js';
import {loadCatalog,sampleEffect} from '/game/tools/vfx-editor-bridge.mjs';

// Engine-owned editor host. Game-owned declarations and receipt clocks enter
// only through the bridge; the player remains the shared production renderer.
const $=id=>document.getElementById(id),canvas=document.querySelector('canvas');
let catalog,player,nativeSampler,selected,definition,parameters={},textures=[],time=0,playing=true,last=0,loadVersion=0;
const scene=new THREE.Scene();scene.background=new THREE.Color('#0d1722');
const camera=new THREE.PerspectiveCamera(42,1,.05,300);camera.position.set(7,5,10);camera.lookAt(0,2,0);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
scene.add(new THREE.HemisphereLight(0xb8d9ef,0x27323f,2));
const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshBasicMaterial({color:0x172330}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;scene.add(ground);
const grid=new THREE.GridHelper(40,40,0x385367,0x233847);grid.position.y=-.01;scene.add(grid);
const target=new THREE.Vector3(0,2,0),spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
let pointer;
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(pointer?.id!==e.pointerId)return;spherical.theta-=(e.clientX-pointer.x)*.007;spherical.phi=Math.max(.12,Math.min(Math.PI/2-.015,spherical.phi+(e.clientY-pointer.y)*.007));pointer.x=e.clientX;pointer.y=e.clientY;updateCamera();});
canvas.addEventListener('pointerup',()=>{pointer=null;});canvas.addEventListener('pointercancel',()=>{pointer=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();spherical.radius=Math.max(2,Math.min(70,spherical.radius*Math.exp(e.deltaY*.001)));updateCamera();},{passive:false});
function updateCamera(){camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(target));camera.lookAt(target);}
new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();if(rect.width&&rect.height){renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}}).observe($('viewport'));
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function duration(){return Number(catalog?.durationById?.[selected]??definition?.duration??1);}
function controls(){const d=duration();$('time').max=String(d);$('time').value=String(time);$('clock').textContent=`${time.toFixed(3)} 秒`;$('duration').textContent=`${d.toFixed(3)} 秒`;$('play').textContent=playing?'暫停':'播放';}
function discardTextures(list){for(const texture of list)texture.dispose();}
async function build(next,values,id){
  validateEffect(next);parametersFor(next,values);
  const loaded=[],map={};let candidate;
  try{
    for(const [id,source] of Object.entries(next.textures??{})){
      const texture=await new THREE.TextureLoader().loadAsync(source.src);loaded.push(texture);texture.colorSpace=source.colorSpace==='linear'?THREE.LinearSRGBColorSpace:THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=source.wrap==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;map[id]=texture;
    }
    candidate=createVfxPlayer({THREE,scene,camera,capacity:256,nativeSampler});candidate.register(id,next,{textures:map});candidate.preflight(renderer,camera);
    return {candidate,loaded};
  }catch(error){candidate?.dispose();discardTextures(loaded);throw error;}
}
async function install(next,values,id=selected){
  const version=++loadVersion,result=await build(next,values,id);
  if(version!==loadVersion){result.candidate.dispose();discardTextures(result.loaded);return false;}
  player?.dispose();discardTextures(textures);player=result.candidate;textures=result.loaded;selected=id;definition=structuredClone(next);parameters=structuredClone(values);return true;
}
async function select(id){
  playing=false;time=0;controls();status('載入特效…');
  try{
    const next=structuredClone(catalog.assets[id]),values=structuredClone(catalog.defaultParameters?.[id]??{});
    if(!await install(next,values,id))return;
    $('parameters').value=JSON.stringify(values,null,2);$('definition').value=JSON.stringify(next,null,2);$('description').textContent=next.description??'';$('effect-title').textContent=catalog.labels?.[id]??next.name??id;
    const url=new URL(location.href);url.searchParams.set('effect',id);history.replaceState(null,'',url);document.body.dataset.effect=id;playing=true;controls();status('正式來源已載入 · 修改只保留於本頁');
  }catch(error){status(error.message,true);}
}
function draw(){
  if(!player)return;
  player.begin();const samples=sampleEffect(selected,time,parameters);
  for(const sample of (Array.isArray(samples)?samples:samples?[samples]:[]))player.submit(sample.asset??selected,sample);
  const metrics=player.end();renderer.render(scene,camera);$('metrics').textContent=`${metrics.drawCalls} draw calls · ${metrics.copies} copies · ${metrics.nativeParticles} native particles`;
}
function frame(now){
  const dt=Math.min((now-last)/1000,.1);last=now;
  try{if(player){if(playing){time+=dt*Number($('speed').value);const d=duration();if(time>=d){if($('loop').checked)time%=d;else{time=d;playing=false;}}}controls();draw();}}
  catch(error){playing=false;controls();status(error.message,true);}
  requestAnimationFrame(frame);
}
$('effect').addEventListener('change',()=>select($('effect').value));
$('play').addEventListener('click',()=>{if(time>=duration())time=0;playing=!playing;controls();});
$('restart').addEventListener('click',()=>{time=0;playing=true;controls();});
$('time').addEventListener('input',()=>{time=Number($('time').value);playing=false;controls();});
$('apply-parameters').addEventListener('click',()=>{try{const next=JSON.parse($('parameters').value);parametersFor(definition,next);parameters=next;status('參數已套用到預覽');}catch(error){status(error.message,true);}});
$('apply-definition').addEventListener('click',async()=>{try{const next=JSON.parse($('definition').value),values=JSON.parse($('parameters').value);if(await install(next,values)){time=0;controls();status('定義已通過驗證並套用到預覽');}}catch(error){status(error.message,true);}});
$('reset').addEventListener('click',()=>select(selected));
$('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(definition,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${selected}.vfx.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已匯出目前套用的特效定義');});
window.addEventListener('pagehide',()=>{player?.dispose();discardTextures(textures);nativeSampler?.dispose();renderer.dispose();},{once:true});
try{
  catalog=await loadCatalog();
  if(!catalog?.assets||!Object.keys(catalog.assets).length)throw Error('特效來源沒有可預覽的定義');
  nativeSampler=catalog.nativeSampler??await loadVfxParticleSampler(new URL(catalog.runtimeUrl??'/game/dist/player-vfx-runtime/',location.href));
  for(const [id,asset] of Object.entries(catalog.assets)){const option=document.createElement('option');option.value=id;option.textContent=catalog.labels?.[id]??asset.name??id;$('effect').append(option);}
  $('source').textContent=`${Object.keys(catalog.assets).length} 個正式特效 · 共用 VFX player`;
  for(const element of document.querySelectorAll('button,select,input[type=range]'))element.disabled=false;
  const requested=new URL(location.href).searchParams.get('effect'),initial=catalog.assets[requested]?requested:catalog.assets.frost?'frost':Object.keys(catalog.assets)[0];$('effect').value=initial;await select(initial);
  if(player)document.body.dataset.ready='true';
  requestAnimationFrame(frame);
}catch(error){status(error.message,true);document.body.dataset.ready='false';}
