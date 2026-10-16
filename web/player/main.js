import {createThreeRenderer} from '../renderer/three.js';
import {createPlayerRenderer,createRendererDisposer} from '../shared/renderer-selection.mjs';
import {createCanvasUi,loadPresentationFonts} from '../shared/canvas-ui.mjs';
import {createUiScrollHost} from '../shared/ui-scroll.mjs';
import {createHostInput} from '../shared/host-input.js';
import {createAsyncScheduler} from '../shared/async-scheduler.mjs';
import {createRuntimeBackend} from '../shared/runtime-backend.mjs';
import {createPresentationInterpolator} from '../shared/presentation-interpolation.mjs';
import {createAudioPlayback} from '../shared/audio-playback.js';
import {requireAssetEncoding} from '../shared/asset-encoding.js';
import {worldFromPointer,projectScreenPointer} from '../shared/webgpu-snapshot.js';
/* PROFILE_IMPORT */
/* DEVELOPER_IMPORT */
const canvas=document.querySelector('#game'),status=document.querySelector('#status');
let uiAssetManifest=null;
const uiCanvas=document.createElement('canvas');Object.assign(uiCanvas.style,{width:'100%',height:'100%',pointerEvents:'none'});document.querySelector('#ui-layer').replaceChildren(uiCanvas);
const input=createHostInput(),uiRenderer=createCanvasUi(uiCanvas,{onAction:({action,phase})=>input.queueActionTransition(action,phase==='down'),resolveAsset:assetId=>{
 const asset=uiAssetManifest?.assets?.find(candidate=>candidate.id===assetId);
 if(!asset)throw Error(`UI asset ${assetId} is not declared in the active asset manifest`);
 requireAssetEncoding(asset,'image');
 return new URL(`content/${asset.source}`,document.baseURI).href;
}});
const uiScroll=createUiScrollHost({canvas,stage:document.querySelector('#ui-layer'),onAction:action=>input.queueAction(action),
 requestWindow:async request=>{acceptSnapshot(await backend.request({kind:'ui',request}));draw();},requestRender:()=>{if(snapshot&&renderer)draw();},onDiagnostic:fail});
const renderUi=snapshot=>uiRenderer.draw(uiScroll.draw(snapshot));
let snapshot,renderer,scheduler,audio,backend,interpolator,presentationMemory=null,tickFlight=null;
let bridgeMs=0,renderMs=0,renderCount=0,frozen=false,manualInput=null,lastStats=null,hasWorldPointer=false;
let saved,key,projectPayload;
/* PROFILE_INIT */
const metrics={};
const disposeRenderer=createRendererDisposer();
function fail(error){scheduler?.stop();try{disposeRenderer(renderer);}catch(cleanupError){console.error(cleanupError);}/* PROFILE_ERROR */status.textContent=String(error?.message??error);document.body.dataset.playerError=status.textContent;console.error(error);}
async function json(path){const r=await fetch(new URL(path,document.baseURI),{cache:'no-store'});if(!r.ok)throw Error(`CONTENT_LOAD_FAILED: ${path} (${r.status})`);return r.json();}
function acceptSnapshot(value,{reset=false}={}){if(!value?.world)throw Error('HOST_SNAPSHOT_INVALID');snapshot=value;if(reset)interpolator?.reset();interpolator?.accept(snapshot,b=>backend.memory(b));}
function draw(){
 const began=performance.now(),display=interpolator?.sample({snap:frozen})??{snapshot};presentationMemory=display.memory;
 renderer.draw(display.snapshot);renderUi(snapshot);renderMs=performance.now()-began;
 if(++renderCount%30===0){lastStats={bridge_ms:bridgeMs,render_ms:renderMs,...renderer.metrics(),drawing_buffer:[canvas.width,canvas.height],frozen,dropped_steps:scheduler?.totalDroppedSteps??0,backend:backend.report(),interpolation:interpolator.report()};document.body.dataset.playerPerformance=JSON.stringify(lastStats);}
 document.body.dataset.playerFrame=String(snapshot.world.frame);
 /* PROFILE_FRAME */
}
async function advance(){
 const began=performance.now(),browserInput=manualInput==null,frame=manualInput??input.consumeFrame();manualInput=null;
 // The camera may follow a moving entity while the physical mouse stays still.
 // Reproject the consumed screen sample, preserving queued down/up edges and
 // leaving developer-supplied world coordinates untouched.
 if(browserInput&&hasWorldPointer)frame.pointer={...frame.pointer,position:projectScreenPointer(canvas,frame.pointer.screen_position,snapshot)};
 /* PROFILE_INPUT */
 const nextSnapshot=await backend.request({kind:'tick',input:frame});
 /* PROFILE_TICK_END */
 acceptSnapshot(nextSnapshot);const decodeEnd=performance.now();bridgeMs=decodeEnd-began;
 /* PROFILE_TICK */
 audio?.sync(snapshot.world);
 const next=JSON.stringify(snapshot.save_payload);if(next!==saved){localStorage.setItem(key,next);saved=next;}
 /* PROFILE_POST_TICK */
}
function tickOnce(){if(tickFlight)return tickFlight;tickFlight=advance().finally(()=>{tickFlight=null;});return tickFlight;}
async function setPaused(value){frozen=value;manualInput=null;uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();if(value){scheduler?.pause();await tickFlight;interpolator.reset();interpolator.accept(snapshot,b=>backend.memory(b));}else scheduler?.resume();}
async function coreRequest(request){const value=await backend.request({kind:'developer',request});if(value.observation)acceptSnapshot(value.observation,{reset:request.method==='invoke'});return value;}
async function setTransport(mode){const value=await backend.request({kind:'transport',mode});acceptSnapshot(value,{reset:true});}
async function restart(){const wasPaused=frozen;await setPaused(true);projectPayload=await json('content/project.json');projectPayload.viewport_aspect=canvas.clientWidth/canvas.clientHeight;projectPayload.restored_save=JSON.parse(saved??'null');acceptSnapshot(await backend.request({kind:'load',payload:projectPayload,seed:'42'}),{reset:true});audio?.reset();audio?.sync(snapshot.world);scheduler.resetClock();draw();await setPaused(wasPaused);}
async function start(){
 const [project,assets,presentation]=await Promise.all([json('content/project.json'),json('content/assets.json'),json('content/presentation.json')]);projectPayload=project;uiAssetManifest=assets;
 await loadPresentationFonts(presentation.ui,source=>new URL('content/'+source,document.baseURI));
 if(presentation.ui?.font_family??presentation.ui?.fonts?.[0]?.family)uiRenderer.setFont(presentation.ui.font_family??presentation.ui.fonts[0].family);
 const runtimeURL=new URL(document.querySelector('meta[name="unone-runtime"]').content,document.baseURI).href;
 const kind=new URLSearchParams(location.search).get('backend')??presentation.runtime_backend??'main';
 backend=await createRuntimeBackend({kind,url:runtimeURL,jobPolicy:presentation.job_policy});metrics.runtime_ready_ms=performance.now()-window.playerBoot;
 document.title=project.config.name;key=`unone-player:${location.pathname}:${project.config.name}`;
 try{project.restored_save=JSON.parse(localStorage.getItem(key)??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}
 project.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
 interpolator=createPresentationInterpolator({enabled:presentation.interpolation??false,instanceBatches:presentation.interpolate_instances??[]});
 acceptSnapshot(await backend.request({kind:'load',payload:project,seed:'42'}),{reset:true});
 renderer=await createPlayerRenderer(canvas,{kind:'three-webgl',bloom:presentation.bloom,instanceMemory:batch=>presentationMemory?.(batch)??backend.memory(batch),getAssetManifest:()=>assets,loadAssetUrl:async asset=>{requireAssetEncoding(asset,asset.kind==='mesh3d'?'mesh':asset.kind==='effekseer'?'effekseer':'image');return new URL('content/'+asset.source,document.baseURI).href;}},presentation,{createOfficial:createThreeRenderer});
 metrics.renderer_mode=presentation.renderer_mode??'official';metrics.renderer=metrics.renderer_mode==='official'?'three-webgl':'custom-module';metrics.renderer_module=presentation.renderer_module??null;document.body.dataset.playerRenderer=metrics.renderer_mode;
 audio=await createAudioPlayback({assetManifest:assets,config:project.config.audio,projectRoot:new URL('content/',document.baseURI)});if(audio?.report().failures.length)throw Error(JSON.stringify(audio.report()));
 draw();await renderer.ready();draw();await new Promise(requestAnimationFrame);
 metrics.first_presented_ms=performance.now()-window.playerBoot;metrics.backend=kind;metrics.resources=performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,duration_ms:r.duration}));document.body.dataset.playerMetrics=JSON.stringify(metrics);console.info('UNONE_PLAYER_READY '+JSON.stringify(metrics));status.textContent='';saved=JSON.stringify(snapshot.save_payload);
 scheduler=createAsyncScheduler({/* PROFILE_WAKE */tick:()=>frozen?undefined:tickOnce(),render:draw,onError:fail,onVisibilityChange:({visible})=>{uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();audio?.setVisibility(visible);}});
 /* DEVELOPER_CONNECT */
 scheduler.start();
 window.addEventListener('resize',()=>{backend.request({kind:'aspect',value:canvas.clientWidth/canvas.clientHeight}).then(value=>acceptSnapshot(value,{reset:true})).catch(fail);});
}
function pointer(event,down,kind){if(!snapshot)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;const normalized={position:worldFromPointer(canvas,event,snapshot),screen_position:{x:x*100,y:(1-y)*100},down};input.updatePointer(normalized,kind);hasWorldPointer=true;}
function routeUi(e,kind){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=100-(e.clientY-r.top)/r.height*100;return uiScroll.pointer(e,kind,uiRenderer.hitTest(x,y))||uiRenderer.pointer({kind,pointerId:e.pointerId,x,y});}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);audio?.unlock();if(!routeUi(e,'down'))pointer(e,true,'edge');});
canvas.addEventListener('pointermove',e=>{if(!routeUi(e,'move'))pointer(e,Boolean(e.buttons),'move');});canvas.addEventListener('pointerup',e=>{if(!routeUi(e,'up'))pointer(e,false,'edge');});canvas.addEventListener('pointercancel',e=>{routeUi(e,'cancel');uiRenderer.releaseAll();input.releaseAll();});
window.addEventListener('keydown',e=>input.setHeld(e.code,true));window.addEventListener('keyup',e=>input.setHeld(e.code,false));window.addEventListener('blur',()=>{uiRenderer.releaseAll();input.releaseAll();});
window.addEventListener('unone-host-pause',()=>{uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();scheduler?.pause();audio?.setVisibility(false);});window.addEventListener('unone-host-resume',()=>{if(!frozen)scheduler?.resume();audio?.setVisibility(true);});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
window.addEventListener('pagehide',()=>{uiScroll.dispose();uiRenderer.dispose?.();scheduler?.stop();try{disposeRenderer(renderer);}catch(error){console.error(error);}backend?.close();});
canvas.addEventListener('lostpointercapture',e=>uiScroll.pointer(e,'cancel'));
start().catch(fail);
