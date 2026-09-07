import {createThreeRenderer} from '../renderer/three.js';
import {createUiTree} from '../shared/ui-tree.js';
import {createHostInput} from '../shared/host-input.js';
import {createFixedStepScheduler} from '../shared/fixed-step-scheduler.mjs';
import {createAudioPlayback} from '../shared/audio-playback.js';
import {requireAssetEncoding} from '../shared/asset-encoding.js';
import {worldFromPointer} from '../shared/webgpu-snapshot.js';

const canvas=document.querySelector('#game'), status=document.querySelector('#status');
const input=createHostInput(), renderUi=createUiTree(document.querySelector('#ui-layer'));
let snapshot, renderer, scheduler, audio;
let bridgeMs=0,renderMs=0,renderCount=0;
const metrics={};
function fail(error){scheduler?.stop();status.textContent=String(error?.message??error);document.body.dataset.playerError=status.textContent;console.error(error);}
async function json(path){const r=await fetch(path);if(!r.ok)throw new Error(`CONTENT_LOAD_FAILED: ${path} (${r.status})`);return r.json();}
function read(){const m=window.Module;return JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(m._unone_web_observation_ptr(),m._unone_web_observation_ptr()+m._unone_web_observation_len())));}
function send(name,value,...args){const bytes=new TextEncoder().encode(JSON.stringify(value));const m=window.Module,p=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,p);if(m[name](p,bytes.length,...args)!==0)throw new Error(JSON.stringify(read()));}
function draw(){const began=performance.now();const world=snapshot.world??snapshot;if(world.effects?.length)throw new Error("PLAYER_DECODER_UNAVAILABLE: Effekseer effects require the development presentation host");renderer.draw(snapshot);renderUi(snapshot);renderMs=performance.now()-began;if(++renderCount%60===0)document.body.dataset.playerPerformance=JSON.stringify({bridge_ms:bridgeMs,render_ms:renderMs,...renderer.metrics(),dropped_steps:scheduler?.totalDroppedSteps??0});document.body.dataset.playerFrame=String(snapshot.world?.frame??snapshot.frame??0);}
async function start(){
  const [project,assets]=await Promise.all([json('content/project.json'),json('content/assets.json'),window.runtimeReady]);
  metrics.runtime_ready_ms=performance.now()-window.playerBoot;
  document.title=project.project;
  const key=`unone-player:${location.pathname}:${project.project}`;
  try{project.restored_save=JSON.parse(localStorage.getItem(key)??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}
  project.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
  send('_unone_web_load_project',project,42n);snapshot=read();
  renderer=await createThreeRenderer(canvas,{kind:'three-webgl',getAssetManifest:()=>assets,loadAssetUrl:async asset=>{requireAssetEncoding(asset,'image');return new URL('content/'+asset.source,location.href).href;}});
  audio=await createAudioPlayback({assetManifest:assets,config:project.audio,projectRoot:new URL('content/',location.href)});
  if(audio?.report().failures.length)throw new Error(JSON.stringify(audio.report()));
  draw();await renderer.ready();draw();
  await new Promise(requestAnimationFrame);
  metrics.first_presented_ms=performance.now()-window.playerBoot;
  metrics.resources=performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,duration_ms:r.duration}));
  document.body.dataset.playerMetrics=JSON.stringify(metrics);console.info('UNONE_PLAYER_READY '+JSON.stringify(metrics));status.textContent='';
  let saved=JSON.stringify(snapshot.save_payload);
  scheduler=createFixedStepScheduler({tick(){const began=performance.now();send('_unone_web_set_input_frame',input.consumeFrame());if(window.Module._unone_web_tick()!==0)throw new Error(JSON.stringify(read()));snapshot=read();bridgeMs=performance.now()-began;audio?.sync(snapshot);const next=JSON.stringify(snapshot.save_payload);if(next!==saved){localStorage.setItem(key,next);saved=next;}},render(){draw();},onError:fail,onVisibilityChange:visible=>{input.releaseAll();audio?.setVisibility(visible);}});
  scheduler.start();
  window.addEventListener('resize',()=>{const aspect=canvas.clientWidth/canvas.clientHeight;if(window.Module._unone_web_set_viewport_aspect(aspect)!==0)fail(new Error(JSON.stringify(read())));});
}
function pointer(event,down,kind){if(!snapshot)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;const screen={x:x*100,y:(1-y)*100};const normalized={position:worldFromPointer(canvas,event,snapshot),screen_position:screen,down};document.body.dataset.playerPointer=JSON.stringify(normalized);input.updatePointer(normalized,kind);}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);audio?.unlock();pointer(e,true,'edge');});
canvas.addEventListener('pointermove',e=>pointer(e,Boolean(e.buttons),'move'));
canvas.addEventListener('pointerup',e=>pointer(e,false,'edge'));
canvas.addEventListener('pointercancel',()=>input.releaseAll());
document.querySelector('#ui-layer').addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action)input.queueAction(action);audio?.unlock();});
window.addEventListener('keydown',e=>input.setHeld(e.code,true));window.addEventListener('keyup',e=>input.setHeld(e.code,false));window.addEventListener('blur',()=>input.releaseAll());
window.addEventListener('unone-host-pause',()=>{input.releaseAll();scheduler?.pause();audio?.setVisibility(false);});
window.addEventListener('unone-host-resume',()=>{scheduler?.resume();audio?.setVisibility(true);});
start().catch(fail);
