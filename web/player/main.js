import {createThreeRenderer,THREE_LIBRARY_URL} from '../renderer/three.js';
import {createPlayerRenderer,createRendererDisposer,rendererModuleUrls} from '../shared/renderer-selection.mjs';
import {createCanvasUi,loadPresentationFonts} from '../shared/canvas-ui.mjs';
import {createUiTextInputHost} from '../shared/ui-text-input.mjs';
import {createUiCursorHost,loadCursorImage} from '../shared/ui-cursor.mjs';
import {createUiScrollHost} from '../shared/ui-scroll.mjs';
import {createHostInput,createRendererHostActions} from '../shared/host-input.js';
import {createLegacyPointerRouting,routeBrowserKey,routeBrowserPointer,createGamepadPolling} from '../shared/player-input.js';
import {createOrderedPhysicalQueue} from '../shared/ordered-physical-queue.mjs';
import {createOrderedPhysicalRouter} from '../shared/ordered-physical-router.mjs';
import {createAsyncScheduler} from '../shared/async-scheduler.mjs';
import {createRuntimeBackend} from '../shared/runtime-backend.mjs';
import {prefetchRuntime} from '../shared/runtime-core.mjs';
import {createSpriteResourceHost} from '../shared/sprite-resource-host.mjs';
import {createImageGroupHost} from '../shared/image-group-host.mjs';
import {fetchProjectData,playerSeed,textureCatalog} from '../shared/load-project.js';
import {createPresentationInterpolator} from '../shared/presentation-interpolation.mjs';
import {createAudioPlayback} from '../shared/audio-playback.js';
import {requireAssetEncoding,createAssetCatalog,createImageAssetBroker,validateImagePreloadPlan,installPlayerAssetGroups,IMAGE_PRELOAD_PLAN_MAX_BYTES} from '../shared/asset-encoding.js';
import {worldFromPointer,projectScreenPointer} from '../shared/webgpu-snapshot.js';
import {createNetworkHost} from '../shared/network-host.mjs';
import {publishRasterState,assertRasterReady,createPlayerProfiler,playerProfileOptions} from '../shared/raster-diagnostics.mjs';
import {adoptStartupRenderer,completeStartupPresentation,startupCancelled} from '../shared/startup-presentation.mjs';
import {createPlayerCompletionMetrics,installPlayerPerformanceAccessor} from '../shared/player-completion.mjs';
import {createPlayerPerformanceFeed} from '../shared/player-performance-feed.mjs';
import {playerMemorySnapshot} from '../shared/player-memory.mjs';
import {serializedSavePayload} from '../shared/save-publication.mjs';
import {playerErrorPolicy,createRecoveryReporter,createPlayerErrorChannel} from '../shared/player-errors.mjs';
import {createStartupScreen} from '../shared/startup-screen.mjs';
/* PROFILE_IMPORT */
/* DEVELOPER_IMPORT */
const canvas=document.querySelector('#game');
// index.html's startup screen: the real startup steps up to the first presented frame, then any fatal error.
const startupScreen=createStartupScreen({root:document.querySelector('#unone-startup'),body:document.body,boot:window.playerBoot});
let uiAssetManifest=null,imageAssets=null,imagePreloadPlan=null,imageGroupHost=null;
const removeAssetGroupsAccessor=installPlayerAssetGroups(window,()=>imageAssets);
const gamepadInput=createGamepadPolling();
// Game UI is drawn by the renderer's ui pass inside the WebGL frame; #ui-layer
// only hosts the cursor overlay and the text-input/scroll DOM hosts.
document.querySelector('#ui-layer').replaceChildren();
const input=createHostInput(),uiRenderer=createCanvasUi(null,{getPresenter:()=>renderer?.ui??null,onAction:({action,phase})=>input.queueActionTransition(action,phase==='down'),onSlider:event=>input.queueSliderInteraction(event),acquireAsset:assetId=>imageAssets.acquire(assetId),resolveAsset:assetId=>{
 const asset=uiAssetManifest?.assets?.find(candidate=>candidate.id===assetId);
 if(!asset)throw Error(`UI asset ${assetId} is not declared in the active asset manifest`);
 requireAssetEncoding(asset,'image');
 return new URL(`content/${asset.source}`,document.baseURI).href;
}});
const uiScroll=createUiScrollHost({canvas,stage:document.querySelector('#ui-layer'),onAction:action=>input.queueAction(action),
 requestWindow:async request=>{acceptSnapshot(await backend.request({kind:'ui',request}));draw();},requestRender:()=>{if(snapshot&&renderer)draw();},onDiagnostic:fail});
const textInputs=createUiTextInputHost({canvas,onInteraction:event=>input.queueTextInputInteraction(event),
 releaseKeyboard:()=>input.releaseKeyboard(),requestRender:()=>{if(snapshot&&renderer)draw();},onDiagnostic:fail});
const renderUi=snapshot=>uiRenderer.draw(textInputs.draw(uiScroll.draw(uiPassHidden(snapshot)?{...snapshot,world:{...snapshot.world,ui:null}}:snapshot)));
const cursorCanvas=document.createElement('canvas');document.querySelector('#ui-layer').append(cursorCanvas);
const cursorHost=createUiCursorHost({target:canvas,layer:cursorCanvas,onError:fail,getImageAssets:()=>imageAssets,loadImage:assetId=>{
 const asset=uiAssetManifest?.assets?.find(candidate=>candidate.id===assetId);
 if(!asset)throw Error(`UI_CURSOR_ASSET_MISSING: ${assetId}`);requireAssetEncoding(asset,'image');
 return loadCursorImage(new URL(`content/${asset.source}`,document.baseURI).href);
}});
let snapshot,renderer,scheduler,audio,backend,interpolator,presentationMemory=null,tickFlight=null,resourceHost=null,networkHost=null;
let bridgeMs=0,renderMs=0,renderCount=0,frozen=false,manualInput=null,lastStats=null,hasWorldPointer=false;
let saved,key,projectPayload;
// What the engine may recover from (presentation error_policy); null is strict.
let errorPolicy=null;
let playerPhase='startup';
const errors=createPlayerErrorChannel({target:window,context:()=>({phase:playerPhase,backend:backend?.kind})});
const recovery=createRecoveryReporter({target:document.body,onError:record=>errors.recovered(record)});
const playerCompletion=createPlayerCompletionMetrics();
// Input-to-presentation timing (unonePlayerPerformance input_latency): only the time of the
// earliest input not yet consumed by a tick. Passive capture listeners never change routing.
for(const type of ['keydown','keyup','pointerdown','pointermove','pointerup','pointercancel','wheel','touchstart','touchmove','touchend'])
 window.addEventListener(type,event=>playerCompletion.noteInput(event.timeStamp,performance.now()),{capture:true,passive:true});
function readPlayerPerformance(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['windowMs','includeRafSamples','includeRafTicks','includeMemory'].includes(key))||Object.hasOwn(options,'includeMemory')&&typeof options.includeMemory!=='boolean')throw Error('PLAYER_PERFORMANCE_OPTIONS_INVALID');
 // Memory owners are read on request only: renderer and UI reports walk their resources.
 const memory=options.includeMemory?{memory:playerMemorySnapshot({backend:backend?.report()??null,images:imageAssets?.report()??null,renderer:renderer?.metrics()??null,ui:uiRenderer.report(),audio:audio?.report()??null,drawingBuffer:[canvas.width,canvas.height]})}:{};
 return Object.freeze({...playerCompletion.snapshot({droppedSteps:scheduler?.totalDroppedSteps??null,paused:frozen,backend:backend?.kind??null,windowMs:Object.hasOwn(options,'windowMs')?options.windowMs:5000,includeRafSamples:Object.hasOwn(options,'includeRafSamples')?options.includeRafSamples:false,includeRafTicks:Object.hasOwn(options,'includeRafTicks')?options.includeRafTicks:false}),image_assets:window.unonePlayerAssets?.snapshot()??null,gamepad_input:gamepadInput.report(),...memory});
}
const removePerformanceAccessor=installPlayerPerformanceAccessor(window,readPlayerPerformance);
let performanceFeed=createPlayerPerformanceFeed({search:location.search,target:document.body,
 read:()=>readPlayerPerformance({windowMs:1500,includeRafSamples:true}),now:()=>performance.now()});
function publishPerformanceFeed(){
 try{performanceFeed?.publish();}
 catch(error){disposePerformanceFeed();reportPerformanceFeedError(error);}
}
function reportPerformanceFeedError(error){
 try{document.body.dataset.playerCompletionFeedError=String(error?.message??error);}catch{}
}
function disposePerformanceFeed(){
 const retiring=performanceFeed;performanceFeed=null;
 try{retiring?.dispose();}catch(error){reportPerformanceFeedError(error);}
}
let orderedQueue=null,orderedRouter=null,orderedEpoch=0,physicalProfile;
// Explicit opt-in host profiling (?unone_profile=1). Null when disabled: each site is one branch.
let profiler=null,profileFlight=null,profileLastSource=null;
/* PROFILE_INIT */
function recordSchedulerWake(wake){
 if(!profiler)return;
 const {error,...attrs}=wake;if(error)attrs.error=error;
 try{profiler.record('wake',wake.cancelled?'cancelled':error?'error':'ok',attrs);}
 catch(error){try{document.body.dataset.playerProfileError=String(error?.message??error).slice(0,128);}catch{}}
}
const metrics={};
const startupAbort=new AbortController();
const disposeRenderer=createRendererDisposer();
function fail(error){errors.fatal(error);profiler?.publish();disposePerformanceFeed();startupAbort.abort();cursorHost.dispose();textInputs.dispose();uiScroll.dispose();uiRenderer.dispose?.();if(orderedQueue&&!orderedQueue.report().fault)try{orderedQueue.terminate('PLAYER_FAILED: '+String(error?.message??error));}catch{}orderedRouter?.dispose();publishPhysical();scheduler?.stop();resourceHost?.close();imageGroupHost?.close();try{disposeRenderer(renderer);}catch(cleanupError){console.error(cleanupError);}imageAssets?.dispose();const retiringAudio=audio;audio=null;retiringAudio?.dispose();backend?.close();/* PROFILE_ERROR */const message=String(error?.message??error);document.body.dataset.playerError=message;startupScreen.fail(message);console.error(error);}
function publishPhysical(){if(!orderedRouter)return;metrics.physical_input=orderedRouter.report();document.body.dataset.playerPhysicalInput=JSON.stringify(metrics.physical_input);}
function configurePhysical(){
 textInputs.setExternalInput(Boolean(physicalProfile));
 if(!physicalProfile)return;orderedRouter?.dispose();orderedQueue=createOrderedPhysicalQueue({epoch:++orderedEpoch});
 textInputs.suspend();input.releaseAll();uiRenderer.releaseAll();uiScroll.cancel();
 orderedRouter=createOrderedPhysicalRouter({canvas,queue:orderedQueue,onError:fail,
  routePointer:(e,kind,owner)=>{if(owner==='engine_ui'){routeBrowserPointer(e,kind,{...browserPointer,ui:routeUi,primary(){},secondary(){},middle(){},cancel(){}});return owner;}if(owner==='host_ui')return owner;
   let owned=false;routeBrowserPointer(e,kind,{...browserPointer,ui:owner==='game'?()=>false:(event,phase)=>{owned=routeUi(event,phase);return owned;}});return owned?'engine_ui':'game';},
  routeKey:(e,state,owner)=>{if(owner==='host_ui')return owner;if(owner==='engine_ui'){if(!textInputs.routeKey(e,state==='down')&&state==='down')uiScroll.routeKey(e);return owner;}if(e.target?.dataset?.unoneTextInput===undefined&&e.target?.closest?.('input,textarea,select,[contenteditable=true],#unone-developer'))return 'host_ui';
   if(textInputs.routeKey(e,state==='down'))return 'engine_ui';if(state==='down'&&uiScroll.routeKey(e))return 'engine_ui';routeBrowserKey(input,e,state==='down');return 'game';},
  routeWheel:e=>uiScroll.routeWheel(e)?'engine_ui':'game',routeCapture:e=>routeUi(e,'cancel')});
 uiScroll.setExternalInput(true);publishPhysical();
}
async function json(path){const r=await fetch(new URL(path,document.baseURI),{cache:'no-store'});if(!r.ok)throw Error(`CONTENT_LOAD_FAILED: ${path} (${r.status})`);return r.json();}
// Render pass kinds from presentation render_extensions (ADR 0048): each
// module exports createPass({THREE, renderer, id, params}) -> {draw, dispose?}.
async function renderExtensions(list=[]){const kinds={};for(const {kind,module} of list){const loaded=await import(new URL('content/'+module,document.baseURI).href);if(typeof loaded.createPass!=='function')throw Error(`RENDER_EXTENSION_INVALID: ${module} must export createPass`);kinds[kind]=loaded.createPass;}return kinds;}
// A disabled "ui" pass draws no UI; input routing is unchanged.
function uiPassHidden(snapshot){return Boolean(snapshot.world?.render_pipeline?.passes?.some(pass=>pass.kind==='ui'&&!pass.enabled));}
// Core checks sprite resources against the manifest this player loads anyway.
function withCatalog(project,manifest){const catalog=textureCatalog(manifest);if(catalog.length)project.asset_catalog=catalog;return project;}
// Declared data assets are fetched as bytes for the core's api.assets loaders.
function dataAssets(project,onProgress=null){return fetchProjectData(project,document.baseURI,onProgress);}
// The project's display (project.unone.json): with aspect "keep" the stage is the largest
// rectangle of the design shape that fits the window, centred, the page showing around it;
// otherwise it fills the window and the game takes the device's shape.
let stageDisplay=null;
function fitStage(){const display=stageDisplay,keep=display?.aspect==='keep'&&display.width>0&&display.height>0;
 // Whole CSS pixels: the drawing buffer is sized from the rounded clientWidth/clientHeight, and a
 // fractional stage would scale it by a fraction of a pixel.
 const width=keep?Math.max(1,Math.floor(Math.min(innerWidth,innerHeight*display.width/display.height))):innerWidth,height=keep?Math.max(1,Math.floor(width*display.height/display.width)):innerHeight;
 for(const element of [canvas,document.querySelector('#ui-layer')]){
  if(!keep){for(const property of ['inset','left','top','width','height'])element.style.removeProperty(property);continue;}
  Object.assign(element.style,{inset:'auto',left:`${Math.floor((innerWidth-width)/2)}px`,top:`${Math.floor((innerHeight-height)/2)}px`,width:`${width}px`,height:`${height}px`});
 }
}
// The player's pixel ratio for the drawing buffer: the device's, capped at 2.
function playerPixelRatio(){return Math.min(window.devicePixelRatio||1,2);}
// The renderer's actual ratio once it exists, so the runtime is told the drawing buffer's real size.
function physicalViewport(){const ratio=renderer?.pixelRatio?.()??playerPixelRatio();return [Math.max(1,Math.floor(canvas.clientWidth*ratio)),Math.max(1,Math.floor(canvas.clientHeight*ratio))];}
// A device pixel ratio change (browser zoom, another monitor) moves the drawing buffer with it,
// unless a presentation hook set its own ratio: that one is the game's choice and stays.
let appliedPixelRatio=null;
function followPixelRatio(){const ratio=playerPixelRatio();
 if(appliedPixelRatio===null||ratio===appliedPixelRatio||typeof renderer?.setPixelRatio!=='function'||renderer.pixelRatio?.()!==appliedPixelRatio)return;
 renderer.setPixelRatio(ratio);appliedPixelRatio=ratio;}
// Resize events come in bursts while a window edge is dragged: the stage and pixel ratio follow
// each one, the runtime hears once a frame and only about a size it has not been told.
let sentViewport=null,viewportQueued=false;
function sendViewport(){viewportQueued=false;if(!snapshot||!backend||startupAbort.signal.aborted)return Promise.resolve();const [width,height]=physicalViewport();
 if(sentViewport?.[0]===width&&sentViewport?.[1]===height)return;sentViewport=[width,height];
 return backend.request({kind:'viewport',width,height}).then(value=>acceptSnapshot(value,{reset:true})).catch(fail);}
function viewportChanged(){fitStage();followPixelRatio();if(!snapshot||!backend||startupAbort.signal.aborted)return;if(!viewportQueued){viewportQueued=true;requestAnimationFrame(sendViewport);}}
function resizeStageViewport(){fitStage();followPixelRatio();return sendViewport();}
function acceptSnapshot(value,{reset=false,newSession=false}={}){if(!value?.world)throw Error('HOST_SNAPSHOT_INVALID');snapshot=value;recovery.accept(value.world);if(newSession){resourceHost?.reset();imageGroupHost?.reset();}resourceHost?.acceptSnapshot(snapshot);imageGroupHost?.acceptSnapshot(snapshot);playerCompletion.accept(snapshot,newSession,scheduler?.totalDroppedSteps??0);if(reset)interpolator?.reset();interpolator?.accept(snapshot,b=>backend.memory(b));}
// Each load or restart starts a new session seed; ?seed= reproduces a reported one.
function sessionSeed(){const {seed,source}=playerSeed(location.search);metrics.seed=seed;metrics.seed_source=source;document.body.dataset.playerSeed=seed;return seed;}
function persistSave(){const next=serializedSavePayload(snapshot);if(next!==saved){localStorage.setItem(key,next);saved=next;}}
function draw(rafTime=null,rafStart=null,inFlight=false,drawSource='manual',budgetMs=1000/60){
 if(!profiler)return drawFrame(null,rafTime,rafStart,inFlight,drawSource,budgetMs);
 const source=profiler.sourceOf(snapshot),pd=profiler.begin('draw',{source_command:source,snapshot_frame:snapshot?.world?.frame??null,redraw:source!==null&&source===profileLastSource,paused:frozen});
 profileLastSource=source;
 let outcome;try{outcome=drawFrame(pd,rafTime,rafStart,inFlight,drawSource,budgetMs);}catch(error){profiler.end(pd,'error',{error});throw error;}
 profiler.end(pd,profiler.outcomeOf(pd)??'returned');
 return outcome;
}
function drawFrame(pd,rafTime,rafStart,inFlight,drawSource,budgetMs){
 const startedAt=Number.isFinite(rafStart)?rafStart:performance.now();
 playerCompletion.attempt();
 try{return submitDrawFrame(pd,rafTime,startedAt,inFlight,drawSource,budgetMs);}catch(error){playerCompletion.error(drawSource,rafTime,startedAt,inFlight,performance.now(),snapshot?.world?.frame,budgetMs);throw error;}
}
function submitDrawFrame(pd,rafTime,startedAt,inFlight,drawSource,budgetMs){
 const began=performance.now(),display=interpolator?.sample({snap:frozen})??{snapshot};presentationMemory=display.memory;
 if(pd)profiler.mark(pd,'interpolation_sample');
 const outcome=pd?profiler.within(pd,'renderer_draw',()=>renderer.draw(display.snapshot)):renderer.draw(display.snapshot);
 resourceHost?.collect();
  const uiOutcome=renderUi(snapshot);if(pd){profiler.set(pd,uiRenderer.assetDiagnostics());profiler.mark(pd,'ui_draw');}const submittedAt=performance.now();renderMs=submittedAt-began;
 const cursorOutcome=cursorHost.update(snapshot.world.ui_cursor);const cursorReport=JSON.stringify(cursorHost.report());if(document.body.dataset.playerCursor!==cursorReport)document.body.dataset.playerCursor=cursorReport;
 const combined=playerCompletion.finish(outcome,uiOutcome,cursorOutcome,display.snapshot?.world?.frame,performance.now(),drawSource,rafTime,startedAt,inFlight,budgetMs);
 if(++renderCount%30===0){lastStats={bridge_ms:bridgeMs,render_ms:renderMs,...renderer.metrics(),ui:uiRenderer.report(),decoded_images:imageAssets?.report()??null,drawing_buffer:[canvas.width,canvas.height],frozen,dropped_steps:scheduler?.totalDroppedSteps??0,backend:backend.report(),interpolation:interpolator.report(),completion:playerCompletion.snapshot({droppedSteps:scheduler?.totalDroppedSteps??null,paused:frozen,backend:backend.kind})};document.body.dataset.playerPerformance=JSON.stringify(lastStats);}
 // Diagnostics attributes are rewritten only when they change: a write is a DOM mutation.
 const frameText=String(snapshot.world.frame);if(document.body.dataset.playerFrame!==frameText)document.body.dataset.playerFrame=frameText;
 orderedRouter?.syncViewport();publishPhysical();
 if(pd)profiler.mark(pd,'host_publish');
 /* PROFILE_FRAME */
 return combined;
}
async function advance(presenting){
 if(!profiler)return advanceFrame(null,presenting);
 const pu=profiler.begin('update');profileFlight=pu.id;
 try{await advanceFrame(pu,presenting);}catch(error){profiler.end(pu,'error',{error});throw error;}
 profiler.end(pu,'ok');
}
async function advanceFrame(pu,presenting){
 const began=performance.now(),browserInput=manualInput==null;
 // Gamepads are polled once per tick (docs/input-gamepad.md).
 if(browserInput)input.setGamepads(gamepadInput.poll());
 let frame=manualInput??input.consumeFrame();manualInput=null;
 // The earliest browser input this tick consumes; later events wait for the next tick.
 const consumedInput=browserInput?playerCompletion.takeInput?.()??null:null;
 // The camera may follow a moving entity while the physical mouse stays still.
 // Reproject the consumed screen sample, preserving queued down/up edges and
 // leaving developer-supplied world coordinates untouched.
 if(browserInput&&hasWorldPointer)frame.pointer={...frame.pointer,position:projectScreenPointer(canvas,frame.pointer.screen_position,snapshot)};
 if(orderedQueue){if(!browserInput)throw Error('INPUT_PHYSICAL_MANUAL_UNSUPPORTED: ordered ingress owns the tick batch');frame.physical=orderedQueue.lease();}
 const resourceInput=resourceHost?.leaseInput(frame,{live:browserInput});if(resourceInput)frame=resourceInput.frame;
 const groupInput=imageGroupHost?.leaseInput(frame,{live:browserInput});if(groupInput)frame=groupInput.frame;
 if(pu)profiler.mark(pu,'input_consume');
 /* PROFILE_INPUT */
 let nextSnapshot;
 try{nextSnapshot=await backend.request({kind:'tick',input:frame,presenting:presenting!==false},pu?.id);if(orderedQueue)orderedQueue.commit(nextSnapshot.world.physical_input_receipt);resourceHost?.commitInput(resourceInput?.token);imageGroupHost?.commitInput(groupInput?.token);}
 catch(error){if(orderedQueue)try{orderedQueue.terminate(String(error.message??error));}catch{}publishPhysical();throw error;}
 if(pu){profiler.mark(pu,'backend_request');profiler.set(pu,{command:profiler.sourceOf(nextSnapshot),snapshot_frame:nextSnapshot?.world?.frame??null});}
 /* PROFILE_TICK_END */
 acceptSnapshot(nextSnapshot);const decodeEnd=performance.now();bridgeMs=decodeEnd-began;
 if(consumedInput)playerCompletion.acceptInput?.(consumedInput.at,nextSnapshot?.world?.frame,consumedInput.delivered);
 if(pu)profiler.mark(pu,'accept_snapshot');
 /* PROFILE_TICK */
 audio?.sync(snapshot.world);
 if(pu)profiler.mark(pu,'audio_sync');
 if(orderedRouter){networkHost??=createNetworkHost({row:(state,peer,data)=>orderedRouter.network(state,peer,data)});networkHost.sync(snapshot.world);}
 persistSave();
 if(pu)profiler.mark(pu,'save_persist');
 /* PROFILE_POST_TICK */
}
// A tick request while one is in flight shares it; profiling records that request as coalesced.
function tickOnce(presenting){if(tickFlight){if(profiler)profiler.record('update_request','coalesced',{joined:profileFlight});return tickFlight;}tickFlight=advance(presenting).finally(()=>{tickFlight=null;});return tickFlight;}
async function setPaused(value){frozen=value;orderedRouter?.setPaused(value);publishPhysical();manualInput=null;textInputs.suspend();uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();releaseLegacyPointer();if(value){scheduler?.pause();await tickFlight;interpolator.reset();interpolator.accept(snapshot,b=>backend.memory(b));}else scheduler?.resume();}
async function coreRequest(request){const value=await backend.request({kind:'developer',request});if(value.observation)acceptSnapshot(value.observation,{reset:request.method==='invoke'});return value;}
async function setTransport(mode){const value=await backend.request({kind:'transport',mode});acceptSnapshot(value,{reset:true});}
async function restart(){errors.reset();const wasPaused=frozen;await setPaused(true);projectPayload=withCatalog(await json('content/project.json'),uiAssetManifest);stageDisplay=projectPayload.config?.display??null;fitStage();projectPayload.viewport_aspect=canvas.clientWidth/canvas.clientHeight;projectPayload.viewport_size=physicalViewport();sentViewport=projectPayload.viewport_size;projectPayload.restored_save=JSON.parse(saved??'null');if(errorPolicy)projectPayload.error_policy=errorPolicy;if(imageGroupHost)projectPayload.image_group_host=true;const preparation=await imageAssets.prepareScene(projectPayload.scene);if(startupAbort.signal.aborted)throw startupCancelled();assertRequiredImagePreparation(imagePreloadPlan,preparation);acceptSnapshot(await backend.request({kind:'load',payload:projectPayload,contentBaseURL:new URL('content/',document.baseURI).href,seed:sessionSeed(),data:await dataAssets(projectPayload)}),{reset:true,newSession:true});await resizeStageViewport();configurePhysical();orderedRouter?.activate();orderedRouter?.setPaused(wasPaused);audio?.reset();audio?.sync(snapshot.world);scheduler.resetClock();draw();persistSave();await setPaused(wasPaused);}
async function finishStartup(presentation,kind){
 if(startupAbort.signal.aborted)throw startupCancelled();
 startupScreen.start('present');
 const checked=(presentation.renderer_mode??'official')==='official'&&presentation.projected_raster==='upper_left_checked';
 const gate=checked?renderer.startupPresentation:null;
 if(checked&&!gate)throw Error('PLAYER_STARTUP_PRESENTATION_CONTRACT_MISSING');
 let contextLost=false;const listeners=new Set();
 const notify=()=>{for(const listener of listeners)listener();},lost=()=>{contextLost=true;notify();},restored=()=>{contextLost=false;notify();};
 const sample=()=>{
  const world=gate?gate.sample():{state:contextLost||renderer.isPresentationAvailable?.()===false?'lost':'presented'};
  if(world.state!=='presented')return world;
  const combined=playerCompletion.outcome();
  if(combined.status==='unknown')throw Error('PLAYER_COMPLETION_CONTRACT_MISSING: world, UI and cursor must report explicit completion');
  return combined.status==='completed'?world:{state:'needs_draw'};
 };
 // Without the checked gate, the renderer still reports a link-loss wait opening or closing (no context event).
 const subscribe=listener=>{listeners.add(listener);const unsubscribe=gate?gate.subscribe(listener):renderer.subscribePresentation?.(listener);return()=>{listeners.delete(listener);unsubscribe?.();};};
 const commit=()=>{
 draw(null,null,false,'startup');
 metrics.raster=renderer.metrics().raster;
 if(startupAbort.signal.aborted)throw startupCancelled();
 if(sample().state!=='presented')return false;
 assertRasterReady(metrics.raster,renderCount);persistSave();orderedRouter?.activate();publishPhysical();metrics.first_presented_ms=performance.now()-window.playerBoot;metrics.backend=kind;metrics.resources=performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,duration_ms:r.duration}));document.body.dataset.playerMetrics=JSON.stringify(metrics);console.info('UNONE_PLAYER_READY '+JSON.stringify(metrics));startupScreen.ready();
 scheduler=createAsyncScheduler({/* PROFILE_WAKE */tick:presenting=>frozen?undefined:tickOnce(presenting),render:draw,onError:fail,
  onWakeDiagnostic:profiler?recordSchedulerWake:null,
  onRafEnd:(at,start,end,flight,budget,wake)=>{playerCompletion.rafEnd(at,start,end,flight,budget,wake);if(performanceFeed)publishPerformanceFeed();},onPreparationStart:()=>playerCompletion.epoch(),
  onPreparationEnd:(tag,at,start,end,steps,cancelled,budget,ticks)=>playerCompletion.preparationEnd(tag,at,start,end,steps,cancelled,budget,ticks),
  onVisibilityChange:({visible})=>{textInputs.suspend();uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();releaseLegacyPointer();audio?.setVisibility(visible);}});
 /* DEVELOPER_CONNECT */
 if(performanceFeed)publishPerformanceFeed();
 playerPhase='runtime';scheduler.start();

 // A pixel ratio change with no new window size (another monitor) fires no resize event: watch the
 // current resolution, and watch again for the next one after each change.
 const watchRatio=()=>window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`)?.addEventListener?.('change',()=>{viewportChanged();watchRatio();},{once:true});watchRatio();
 };
 canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
 try{
  await completeStartupPresentation({draw:()=>draw(null,null,false,'startup'),waitForAssets:()=>Promise.all([renderer.ready(),uiRenderer.ready(),cursorHost.ready()]),sample,subscribe,
   commit,signal:startupAbort.signal,onState:state=>{metrics.startup_presentation=state;metrics.raster=renderer.metrics().raster;
    document.body.dataset.playerMetrics=JSON.stringify(metrics);document.body.dataset.playerStartupPresentation=JSON.stringify(state);}});
 }finally{canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);listeners.clear();}
}
function assertRequiredImagePreparation(plan,result){
 if(result?.cancelled)throw startupCancelled();
 if(!plan)return;
 const required=new Set(plan.startup.flatMap(group=>plan.groups[group]));
 if(required.size===0)return;
 if(result?.required_entries===required.size&&result?.required_ready_entries===required.size)return;
 const failed=[...(result?.unsupported??[]),...(result?.budget_skipped??[]),...(result?.errors??[])].filter(row=>required.has(row.id));
 const examples=failed.slice(0,8).map(row=>String(row.id).slice(0,256)).join(', ');
 throw Error(`IMAGE_PRELOAD_REQUIRED_NOT_READY: prepared ${result?.required_ready_entries??0}/${required.size} required images${examples?'; '+examples:''}`);
}
async function readImagePreloadPlan(catalog){
 const declarations=document.querySelectorAll('meta[name="unone-image-assets"]');
 if(declarations.length===0)return null;
 if(declarations.length!==1||declarations[0].getAttribute('content')!=='content/image-assets.json')throw Error('IMAGE_PRELOAD_PLAN_META_INVALID');
 if(startupAbort.signal.aborted)throw startupCancelled();
 const response=await fetch(new URL('content/image-assets.json',document.baseURI),{cache:'no-store',signal:startupAbort.signal});
 if(!response.ok)throw Error(`IMAGE_PRELOAD_PLAN_LOAD_FAILED: ${response.status}`);
 if(!response.body?.getReader)throw Error('IMAGE_PRELOAD_PLAN_STREAM_REQUIRED');
 const reader=response.body.getReader(),bytes=new Uint8Array(IMAGE_PRELOAD_PLAN_MAX_BYTES);let size=0,complete=false;
 try{
  for(;;){const next=await reader.read();if(next.done){complete=true;break;}
   const nextSize=size+next.value.byteLength;if(nextSize>IMAGE_PRELOAD_PLAN_MAX_BYTES)throw Error('IMAGE_PRELOAD_PLAN_TOO_LARGE');
   // One bounded buffer also bounds metadata when a stream uses tiny chunks.
   bytes.set(next.value,size);size=nextSize;}
 }finally{if(!complete)try{await reader.cancel();}catch{}reader.releaseLock?.();}
 if(startupAbort.signal.aborted)throw startupCancelled();
 let plan;try{plan=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));}catch(error){throw Error(`IMAGE_PRELOAD_PLAN_JSON_INVALID: ${String(error.message??error)}`);}
 return validateImagePreloadPlan(plan,catalog);
}
// Start fetching what later startup steps need but that does not depend on images or fonts: the runtime script and
// its WebAssembly (downloaded and compiled, not instantiated), the renderer's modules and the WebGL library (fetched and
// parsed by modulepreload, not evaluated). Over a slow link these used to wait for image preparation one after another.
// Order and failure behaviour do not change: Core is still constructed only after images, and a failed fetch here is
// reported by the step that needs it.
function warmStartup(presentation){
 const kind=new URLSearchParams(location.search).get('backend')??presentation.runtime_backend??'main';
 if(kind==='main')prefetchRuntime(new URL(document.querySelector('meta[name="unone-runtime"]').content,document.baseURI).href);
 const probe=document.createElement('link');if(!probe.relList?.supports?.('modulepreload'))return;
 for(const href of new Set([THREE_LIBRARY_URL,...rendererModuleUrls(presentation)])){const link=document.createElement('link');link.rel='modulepreload';link.href=href;document.head.append(link);}
}
async function start(){
 startupScreen.start('content');
 const profileOptions=playerProfileOptions(location.search);
 if(profileOptions){profiler=createPlayerProfiler({limit:profileOptions.limit,publishTarget:document.body});document.body.dataset.playerProfileEnabled='1';
  uiRenderer.setAssetObserver(attrs=>profiler.record('ui_asset','ok',attrs));
  window.unonePlayerProfile=Object.freeze({report:()=>profiler.report(),clear:()=>profiler.clear(),publish:()=>profiler.publish()});}
 const [project,assets,presentation]=await Promise.all([json('content/project.json'),json('content/assets.json'),json('content/presentation.json')]);
 if(startupAbort.signal.aborted)throw startupCancelled();
 startupScreen.complete('content');withCatalog(project,assets);projectPayload=project;uiAssetManifest=assets;
 warmStartup(presentation);
 // Data assets load beside image preparation, fonts and the runtime; Game.start waits for them.
 startupScreen.start('images');startupScreen.start('data');
 const dataLoad=dataAssets(project,(loaded,total)=>startupScreen.progress('data',loaded,total));dataLoad.then(()=>startupScreen.complete('data'),()=>{});
 // One immutable presentation index per fetched manifest. The player owns this JSON and adopts it,
 // so the renderer never rebuilds the asset index per draw and in-place edits fail instead of drifting.
 const assetCatalog=createAssetCatalog(assets,{adopt:true});
 const preloadPlan=await readImagePreloadPlan(assetCatalog);
 if(startupAbort.signal.aborted)throw startupCancelled();
 imagePreloadPlan=preloadPlan;
 imageAssets=createImageAssetBroker(assetCatalog,{resolveAssetUrl:asset=>new URL('content/'+asset.source,document.baseURI).href,preloadPlan});
 // Game requests (api.assets.imageGroups) need a published plan; without one Core reports unsupported.
 if(preloadPlan)imageGroupHost=createImageGroupHost({getGroups:()=>imageAssets?.groups,streamable:preloadPlan.streamable});
 // Scene declarations own future render dependencies, including hidden sprites.
 // Prepare an explicitly bounded plan before simulation and the READY barrier.
 const preparation=await imageAssets.prepareScene(project.scene,{onProgress:({done,total})=>startupScreen.progress('images',done,total)});
 if(startupAbort.signal.aborted)throw startupCancelled();
 assertRequiredImagePreparation(preloadPlan,preparation);startupScreen.complete('images');
 errorPolicy=playerErrorPolicy(presentation,location.search);
 physicalProfile=presentation.physical_input;
 if(physicalProfile!==undefined&&(physicalProfile!=='ordered_physical_v1'||(presentation.renderer_mode??'official')!=='official'))throw Error('INPUT_PHYSICAL_PROFILE_UNSUPPORTED: official Web ordered_physical_v1 only');
 configurePhysical();
 startupScreen.start('fonts');
 await loadPresentationFonts(presentation.ui,source=>new URL('content/'+source,document.baseURI),(loaded,total)=>startupScreen.progress('fonts',loaded,total));
 uiRenderer.setDeferredFonts(presentation.ui?.fonts??[],()=>{if(snapshot&&renderer)draw();},fail);
 if(startupAbort.signal.aborted)throw startupCancelled();
 startupScreen.complete('fonts');
 if(presentation.ui?.font_family??presentation.ui?.fonts?.[0]?.family)uiRenderer.setFont(presentation.ui.font_family??presentation.ui.fonts[0].family);
 const runtimeURL=new URL(document.querySelector('meta[name="unone-runtime"]').content,document.baseURI).href;
 const kind=new URLSearchParams(location.search).get('backend')??presentation.runtime_backend??'main';
 const requirePhysicalViewport=presentation.physical_input!==undefined||presentation.projected_raster==='upper_left_checked'||presentation.projected_material_profile!==undefined;
 startupScreen.start('runtime');
 backend=await createRuntimeBackend({kind,url:runtimeURL,jobPolicy:presentation.job_policy,spatialBackend:presentation.spatial_backend??'cpu',requirePhysicalViewport,
  // The player only presents: it skips the per-tick observation digest (?digest=1 keeps it for comparisons).
  observationDigest:new URLSearchParams(location.search).get('digest')==='1',...(profiler?{profiler}:{})});
 if(startupAbort.signal.aborted){backend.close();throw startupCancelled();}
 startupScreen.complete('runtime');
 metrics.runtime_ready_ms=performance.now()-window.playerBoot;metrics.error_policy=errorPolicy??'strict';
 document.title=project.config.name;key=`unone-player:${location.pathname}:${project.config.name}`;
 try{saved=localStorage.getItem(key);project.restored_save=JSON.parse(saved??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}
 stageDisplay=project.config.display??null;fitStage();
 project.viewport_aspect=canvas.clientWidth/canvas.clientHeight;
 project.viewport_size=physicalViewport();sentViewport=project.viewport_size;
 if(errorPolicy)project.error_policy=errorPolicy;
 if(imageGroupHost)project.image_group_host=true;
 interpolator=createPresentationInterpolator({enabled:presentation.interpolation??false,instanceBatches:presentation.interpolate_instances??[]});
 const data=await dataLoad;if(startupAbort.signal.aborted){backend.close();throw startupCancelled();}
 startupScreen.start('game');
 acceptSnapshot(await backend.request({kind:'load',payload:project,contentBaseURL:new URL('content/',document.baseURI).href,seed:sessionSeed(),data}),{reset:true,newSession:true});
 await resizeStageViewport();
 startupScreen.complete('game');startupScreen.start('renderer');
 const renderPasses=await renderExtensions(presentation.render_extensions);
 renderer=await adoptStartupRenderer(()=>createPlayerRenderer(canvas,{hostActions:createRendererHostActions(input,{isActive:()=>!startupAbort.signal.aborted}),kind:'three-webgl',bloom:presentation.bloom,renderPasses,spriteResourceBudget:imagePreloadPlan?.budget,...(profiler?{profiler}:{}),onRasterState:raster=>publishRasterState(metrics,document.body,raster,message=>console.info(message)),instanceMemory:batch=>presentationMemory?.(batch)??backend.memory(batch),getAssetManifest:()=>assets,getAssetCatalog:()=>assetCatalog,getImageAssets:()=>imageAssets,loadDataAssetUrl:asset=>new URL("content/"+asset.source,document.baseURI).href,loadAssetUrl:async asset=>{requireAssetEncoding(asset,asset.kind==='mesh3d'?'mesh':asset.kind==='effekseer'?'effekseer':'image');return new URL('content/'+asset.source,document.baseURI).href;}},presentation,{createOfficial:createThreeRenderer}),{signal:startupAbort.signal,dispose:disposeRenderer});
 appliedPixelRatio=renderer.pixelRatio?.()??null;
 resourceHost=createSpriteResourceHost(renderer);resourceHost.acceptSnapshot(snapshot);
 metrics.renderer_mode=presentation.renderer_mode??'official';metrics.renderer=metrics.renderer_mode==='official'?'three-webgl':'custom-module';metrics.renderer_module=presentation.renderer_module??null;document.body.dataset.playerRenderer=metrics.renderer_mode;
 startupScreen.complete('renderer');startupScreen.start('audio');
 audio=await createAudioPlayback({assetManifest:assets,config:project.config.audio,projectRoot:new URL('content/',document.baseURI)});if(audio?.report().failures.length)throw Error(JSON.stringify(audio.report()));
 if(startupAbort.signal.aborted){const retiringAudio=audio;audio=null;retiringAudio?.dispose();throw startupCancelled();}
 startupScreen.complete('audio');
 await finishStartup(presentation,kind);
}
// A canvas whose box has no size (collapsed mid-gesture, a pane still opening) maps pointers through the last box it
// had, kept on the canvas (these functions also run on their own), so a release still lands as a release where the
// gesture was; before any box there is no position to give.
function pointer(event,down,kind){const sample=pointerSample(event,down);if(!sample)return;input.updatePointer(sample,kind);hasWorldPointer=true;}
function pointerSample(event,down){if(!snapshot)return null;const now=canvas.getBoundingClientRect(),sized=now.width>0&&now.height>0,rect=sized?(canvas.unoneSizedBox=now):canvas.unoneSizedBox;if(!rect)return null;const x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height,screen={x:x*100,y:(1-y)*100};return {position:sized?worldFromPointer(canvas,event,snapshot):projectScreenPointer(canvas,screen,snapshot),screen_position:screen,down};}
function secondaryPointer(event,down){const sample=pointerSample(event,input.pointer.down);if(!sample)return;input.queueScreenAction('MouseRight',down,sample);hasWorldPointer=true;}
function middlePointer(event,down){const sample=pointerSample(event,input.pointer.down);if(!sample)return;input.queueScreenAction('MouseMiddle',down,sample);input.updatePointer(sample,'move');hasWorldPointer=true;}
function routeUi(e,kind){const now=canvas.getBoundingClientRect(),r=now.width>0&&now.height>0?(canvas.unoneSizedBox=now):canvas.unoneSizedBox;if(!r)return false;const x=(e.clientX-r.left)/r.width*100,y=100-(e.clientY-r.top)/r.height*100,hit=uiRenderer.hitTest(x,y);return textInputs.pointer(e,kind,hit)||uiScroll.pointer(e,kind,hit)||uiRenderer.pointer({kind,pointerId:e.pointerId,x,y});}
const browserPointer={capture:id=>canvas.setPointerCapture(id),unlock:()=>audio?.unlock(),ui:routeUi,primary:pointer,secondary:secondaryPointer,middle:middlePointer,cancel(){input.releasePointer();input.releaseScreenActions();}};
// Without the ordered router a primary button held across input.releaseAll() needs a fresh pointerdown.
const legacyPointer=createLegacyPointerRouting(canvas,browserPointer);
function releaseLegacyPointer(){if(!orderedRouter)legacyPointer.release();}
canvas.addEventListener('pointerdown',e=>{if(!orderedRouter)legacyPointer.route(e,'down');});
canvas.addEventListener('pointermove',e=>{if(!orderedRouter)legacyPointer.route(e,'move');});canvas.addEventListener('pointerup',e=>{if(!orderedRouter)legacyPointer.route(e,'up');});canvas.addEventListener('pointercancel',e=>{if(!orderedRouter)legacyPointer.route(e,'cancel');});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{if(!orderedRouter&&!textInputs.routeKey(e,true))routeBrowserKey(input,e,true);});window.addEventListener('keyup',e=>{if(!orderedRouter&&!textInputs.routeKey(e,false))routeBrowserKey(input,e,false);});window.addEventListener('blur',()=>{textInputs.suspend();uiRenderer.releaseAll();input.releaseAll();releaseLegacyPointer();});
window.addEventListener('unone-host-pause',()=>{textInputs.suspend();uiScroll.cancel();uiRenderer.releaseAll();input.releaseAll();releaseLegacyPointer();scheduler?.pause();audio?.setVisibility(false);});window.addEventListener('unone-host-resume',()=>{if(!frozen)scheduler?.resume();audio?.setVisibility(true);});
window.addEventListener('resize',()=>viewportChanged());
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
window.addEventListener('pagehide',()=>{removeAssetGroupsAccessor();removePerformanceAccessor();disposePerformanceFeed();recovery.dispose();errors.dispose();startupAbort.abort();orderedRouter?.dispose();textInputs.dispose();uiScroll.dispose();cursorHost.dispose();uiRenderer.dispose?.();scheduler?.stop();resourceHost?.close();imageGroupHost?.close();try{disposeRenderer(renderer);}catch(error){console.error(error);}imageAssets?.dispose();const retiringAudio=audio;audio=null;retiringAudio?.dispose();backend?.close();});
canvas.addEventListener('lostpointercapture',e=>{legacyPointer.lostCapture(e.pointerId);if(!orderedRouter)routeUi(e,'cancel');});
start().catch(error=>{if(error?.name!=='AbortError')fail(error);});
