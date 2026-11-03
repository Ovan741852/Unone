import {createThreeRenderer} from '../../web/renderer/three.js';

const allowedCounts=[1,8,16,32,64,96,128,256,512];
const params=new URLSearchParams(location.search);
const mode=params.get('mode')||'webm-shared';
if(!['static','webm-shared','webm-independent','atlas'].includes(mode))throw Error('Invalid benchmark mode');
const requestedCount=Number(params.get('count')||16);
if(!allowedCounts.includes(requestedCount))throw Error('Invalid benchmark count');
const phase=params.get('phase')==='stagger'?'stagger':'sync';
const asset=name=>new URL('./assets/'+name,import.meta.url).href;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.floor(q*(a.length-1)))]:null;};
const summary=values=>({samples:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p50:quantile(values,.5),p95:quantile(values,.95),p99:quantile(values,.99),max:values.length?Math.max(...values):null});

export async function createRenderer(canvas,options){
  const manifest=await fetch(asset('spritesheet.json')).then(r=>r.json());
  const mediaManifest=await fetch(asset('asset-manifest.json')).then(r=>r.json());
  let context,initialized=false,countReady=false,renderFrames=0,lastSnapshot=null,activeMeasurement=null;
  let countRequestAt=-Infinity,disposed=false;
  const videos=[],textures=[],geometries=[],materials=[],meshes=[],videoStats=[];
  const renderSamples=[];
  const visibilityEvents=[];
  document.addEventListener('visibilitychange',()=>visibilityEvents.push({at:performance.now(),state:document.visibilityState}));
  const boot=performance.now();
  const hud=document.createElement('div');
  hud.style.cssText='position:fixed;z-index:10;left:14px;top:12px;pointer-events:none;color:#e5eefb;background:#07111ed9;border:1px solid #304361;border-radius:8px;padding:10px 14px;font:13px system-ui;line-height:1.6;max-width:95vw';
  hud.textContent='Unone media benchmark: preparing '+mode+' × '+requestedCount;
  document.body.append(hud);

  function quality(){return videos.map((video,i)=>{const q=video.getVideoPlaybackQuality?.();return {index:i,currentTime:video.currentTime,total:q?.totalVideoFrames??0,dropped:q?.droppedVideoFrames??0,rvfc:videoStats[i]?.callbacks??0,mediaTime:videoStats[i]?.mediaTime??0,processingDuration:videoStats[i]?.processingDuration??null};});}
  function gpuInfo(){const gl=context?.renderer.getContext();const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl?.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),version:gl?.getParameter(gl.VERSION),shadingLanguage:gl?.getParameter(gl.SHADING_LANGUAGE_VERSION)};}
  const api={
    get ready(){return initialized&&countReady&&renderFrames>=3&&!disposed;},
    metadata(){return {mode,count:requestedCount,phase,gpu:gpuInfo(),rendererImplementation:'SDK official createThreeRenderer + presentation hook',selectedRendererMode:'custom',sdk:'UnoneFreshUi-20261016/final-sdk',runtimeId:'web-production-0',gameSource:'HotChick/benchmark-game/scripts/main.luau',presentationSource:'HotChick/benchmark-game/presentation/bench-renderer.mjs',actualVideoPlayers:videos.length,atlasTextureCount:mode==='atlas'?2:mode==='static'?1:0,viewport:[canvas.clientWidth,canvas.clientHeight],drawingBuffer:[canvas.width,canvas.height],devicePixelRatio:devicePixelRatio,visibility:document.visibilityState,luaCount:lastSnapshot?.world?.observations?.benchmark?.count,luaFrame:lastSnapshot?.world?.frame,luaTime:lastSnapshot?.world?.observations?.benchmark?.time,worldEntityCount:Object.keys(lastSnapshot?.world?.entities??{}).length,matchedAssetSpecs:{width:manifest.frameWidth,height:manifest.frameHeight,fps:manifest.fps,frames:manifest.frame_count,duration:manifest.duration},mediaManifest,rendererMetrics:renderer.metrics(),bootToReadyMs:performance.now()-boot};},
    async measure({warmupMs=5000,durationMs=15000}={}){
      const timeout=performance.now()+60000;while(!api.ready){if(performance.now()>timeout)throw Error('Benchmark readiness timeout');await sleep(50);}
      await sleep(warmupMs);
      const began=performance.now(),q0=quality(),official0=parsePlayerStats(),heap0=performance.memory?.usedJSHeapSize??null,luaTimeStart=lastSnapshot?.world?.observations?.benchmark?.time,luaFrameStart=lastSnapshot?.world?.frame;
      const intervals=[],visibilityStart=document.visibilityState;let previous=null;
      activeMeasurement={began};
      await new Promise(resolve=>{function sample(now){if(previous!==null)intervals.push(now-previous);previous=now;if(now-began>=durationMs)resolve();else requestAnimationFrame(sample);}requestAnimationFrame(sample);});
      const ended=performance.now(),q1=quality(),official1=parsePlayerStats(),luaTimeEnd=lastSnapshot?.world?.observations?.benchmark?.time,luaFrameEnd=lastSnapshot?.world?.frame;activeMeasurement=null;
      const draws=renderSamples.filter(x=>x.at>=began&&x.at<=ended);
      const renderIntervals=draws.slice(1).map((x,i)=>x.at-draws[i].at);
      const deltas=q1.map((q,i)=>({index:i,total:q.total-q0[i].total,dropped:q.dropped-q0[i].dropped,rvfc:q.rvfc-q0[i].rvfc,mediaTimeProgress:q.mediaTime-q0[i].mediaTime,processingDuration:q.processingDuration}));
      const totalVideoFrames=deltas.reduce((n,x)=>n+x.total,0),droppedVideoFrames=deltas.reduce((n,x)=>n+x.dropped,0);
      const result={mode,count:requestedCount,phase,warmupMs,durationMs:ended-began,luaTimeStart,luaTimeEnd,luaFrameStart,luaFrameEnd,luaSecondsPerWallSecond:(luaTimeEnd-luaTimeStart)/((ended-began)/1000),worldEntityCount:Object.keys(lastSnapshot?.world?.entities??{}).length,visibilityStart,visibilityEnd:document.visibilityState,visibilityEvents:visibilityEvents.filter(x=>x.at>=began&&x.at<=ended),raf:summary(intervals),rafIntervalsMs:intervals,rafFps:intervals.length/((intervals.reduce((a,b)=>a+b,0))/1000),rafOver33_3:intervals.filter(x=>x>33.333).length/Math.max(1,intervals.length),rafOver50:intervals.filter(x=>x>50).length/Math.max(1,intervals.length),renderFrameCount:draws.length,renderFps:draws.length/((ended-began)/1000),renderIntervals:summary(renderIntervals),renderCpuSubmitMs:summary(draws.map(x=>x.ms)),officialStart:official0,officialEnd:official1,rendererMetrics:renderer.metrics(),videos:{players:videos.length,totalVideoFrames,droppedVideoFrames,droppedRatio:totalVideoFrames?droppedVideoFrames/totalVideoFrames:null,nonAdvancing:deltas.filter(x=>x.rvfc===0).length,perPlayer:deltas},jsHeapStart:heap0,jsHeapEnd:performance.memory?.usedJSHeapSize??null,wasmLinearBytes:official1?.backend?.wasm_linear_bytes??null};
      api.lastResult=result;hud.textContent=`${mode} × ${requestedCount} | render ${result.renderFps.toFixed(1)} fps | rAF p95 ${result.raf.p95?.toFixed(2)}ms | video drop ${(100*(result.videos.droppedRatio??0)).toFixed(2)}%`;return result;
    },
  };
  window.benchmark=api;
  function parsePlayerStats(){try{return JSON.parse(document.body.dataset.playerPerformance||'null');}catch{return null;}}
  function requestCount(){const now=performance.now();if(now-countRequestAt<250)return;countRequestAt=now;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Count'+requestedCount,bubbles:true}));setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'Count'+requestedCount,bubbles:true})),100);}
  async function newVideo(index,THREE){
    const video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;video.preload='auto';video.src=asset('girl-alpha-144x256-12fps.webm');
    const stat={callbacks:0,mediaTime:0,processingDuration:null};videoStats[index]=stat;
    if(video.requestVideoFrameCallback){const callback=(_,meta)=>{stat.callbacks++;stat.mediaTime=meta.mediaTime;stat.processingDuration=meta.processingDuration??null;if(!disposed)video.requestVideoFrameCallback(callback);};video.requestVideoFrameCallback(callback);}
    await new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('Video failed '+index)),{once:true});video.load();});
    if(phase==='stagger')video.currentTime=(index%60)/12;
    videos.push(video);const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;textures.push(texture);return texture;
  }
  function setFrame(mesh,index){const frame=manifest.frames[index],page=manifest.pages[frame.page];mesh.material=materials[frame.page];const u0=frame.x/page.width,u1=(frame.x+frame.w)/page.width,v0=1-(frame.y+frame.h)/page.height,v1=1-frame.y/page.height;const uv=mesh.geometry.attributes.uv;uv.setXY(0,u0,v1);uv.setXY(1,u1,v1);uv.setXY(2,u0,v0);uv.setXY(3,u1,v0);uv.needsUpdate=true;mesh.userData.frame=index;}
  let renderer;
  renderer=await createThreeRenderer(canvas,{...options,bloom:false,ao:false,threeModuleUrl:new URL('./three/three.module.js',import.meta.url).href,
    async onReady(ctx){context=ctx;const {THREE}=ctx;ctx.renderer.setPixelRatio(1);ctx.renderer.setClearColor(0x10304a,1);
      const mkMaterial=map=>{const value=new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide});materials.push(value);return value;};
      if(mode==='webm-shared')mkMaterial(await newVideo(0,THREE));
      else if(mode==='webm-independent'){for(let i=0;i<requestedCount;i++)mkMaterial(await newVideo(i,THREE));}
      else{for(const page of manifest.pages.slice(0,mode==='static'?1:2)){const texture=await new THREE.TextureLoader().loadAsync(asset(page.file));texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;textures.push(texture);mkMaterial(texture);}}
      for(let i=0;i<requestedCount;i++){const geometry=new THREE.PlaneGeometry(1,1);geometries.push(geometry);const mesh=new THREE.Mesh(geometry,materials[mode==='webm-independent'?i:0]);mesh.frustumCulled=false;mesh.renderOrder=i;mesh.visible=false;meshes.push(mesh);ctx.scene.add(mesh);if(mode==='static')setFrame(mesh,0);}
      // Start all players after preparation so synchronous cases share a start boundary.
      await Promise.all(videos.map(video=>video.play()));
      if(videos.length){const waitUntil=performance.now()+15000;while(videoStats.some(x=>x.callbacks===0)&&performance.now()<waitUntil)await sleep(20);if(videoStats.some(x=>x.callbacks===0))throw Error('Video did not produce first frame');}
      ctx.attachPresentation({beforeRender({snapshot}){lastSnapshot=snapshot;const state=snapshot?.world?.observations?.benchmark;if(!state)return;countReady=Number(state.count)===requestedCount;if(!countReady)requestCount();
        const now=Number(state.time)||0;
        for(let i=0;i<meshes.length;i++){const mesh=meshes[i],symbol=state.symbols?.[i];mesh.visible=Boolean(symbol);if(!symbol)continue;const entity=snapshot.world.entities?.[symbol.id];mesh.position.set(entity?.transform?.x??symbol.x,entity?.transform?.y??symbol.y,i*0.0001);const h=state.height||2.0833333333333335;mesh.scale.set(h*144/256,h,1);
          if(mode==='atlas'){const frame=Math.floor((now+(phase==='stagger'?(i%60)/12:0))*12)%60;if(mesh.userData.frame!==frame)setFrame(mesh,frame);}}
        renderFrames++;if(renderFrames%60===0&&!activeMeasurement)hud.textContent=`Unone · ${mode} × ${requestedCount} · ${phase} · ${videos.length} video player(s) · Lua frame ${snapshot.world.frame}`;
      },onDispose(){disposed=true;for(const video of videos){video.pause();video.removeAttribute('src');video.load();}for(const texture of textures)texture.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();hud.remove();}});
      initialized=true;
    }
  });
  const officialDraw=renderer.draw.bind(renderer);renderer.draw=(snapshot,opts)=>{const start=performance.now();officialDraw(snapshot,opts);renderSamples.push({at:start,ms:performance.now()-start});if(renderSamples.length>60000)renderSamples.splice(0,30000);};
  return renderer;
}
