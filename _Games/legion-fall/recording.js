// Game-owned capture utility: record the actual canvas at wall-clock speed.
// Only active on the dedicated loopback capture server, via ?capture=1.
if(new URLSearchParams(location.search).get('capture')==='1'){
 document.documentElement.classList.add('capture');
 const button=document.createElement('button');button.id='record-demo';button.textContent='錄製 54 秒展示';document.body.append(button);
 button.onclick=async()=>{
  button.disabled=true;
  try{
   const api=window.unoneDeveloper;if(!api)throw new Error('Developer player not ready');
   async function invoke(id){const t=await api.request({method:'tools.list'});const r=await api.request({method:'tools.invoke',id,revision:t.value.revision});if(!r.ok)throw new Error(JSON.stringify(r.diagnostics));}
   await api.request({method:'pause',paused:true});await invoke('battle.reset10000');await invoke('battle.camera.wide');window.dispatchEvent(new Event('battle-reset-metrics'));
   const source=document.querySelector('#game'),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
   const ctx=canvas.getContext('2d',{alpha:false}),stream=canvas.captureStream(30);
   const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8'].find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw new Error('No WebM recorder');
   const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000}),chunks=[],samples=[];
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   const stopped=new Promise(resolve=>recorder.onstop=resolve);
   let alive=true,label='THE ARMIES / 10,000 INITIAL UNITS',posterSent=false,lastSample=-1;
   const started=performance.now();
   function paint(now){
    if(!alive)return;
    const wall=(now-started)/1000;
    ctx.drawImage(source,0,0,1280,720);
    ctx.fillStyle='rgba(8,17,25,.92)';ctx.fillRect(0,0,1280,86);ctx.fillRect(0,635,1280,85);
    ctx.fillStyle='#d3c5a0';ctx.font='600 24px Segoe UI';ctx.fillText('LEGION FALL',28,37);
    ctx.fillStyle='#899da8';ctx.font='11px Segoe UI';ctx.fillText('UNONE  /  REAL-TIME WEB BATTLE PROTOTYPE',29,60);
    const state=JSON.parse(document.body.dataset.battlePerformance??'{}'),b=api.request({method:'observations'}).value?.observations?.battle??{};state.simulation=b;
    ctx.font='600 25px Segoe UI';ctx.fillStyle='#f69581';ctx.fillText('RED '+Number(b.red??5000).toLocaleString(),635,37);
    ctx.fillStyle='#86bafb';ctx.fillText('BLUE '+Number(b.blue??5000).toLocaleString(),855,37);
    ctx.fillStyle='#d8dbd7';ctx.font='14px Segoe UI';ctx.fillText('ALIVE '+Number((b.red??5000)+(b.blue??5000)).toLocaleString(),1090,37);
    ctx.fillStyle='#a1b0b8';ctx.font='11px Segoe UI';ctx.fillText('INFANTRY  /  ARCHERS  /  CAVALRY  /  BALLISTAE  /  CATAPULTS  /  FLYERS  /  MAGES',635,62);
    ctx.fillStyle='#d3c5a0';ctx.font='600 16px Segoe UI';ctx.fillText(label,28,663);
    ctx.fillStyle='#a9b8bd';ctx.font='12px Segoe UI';ctx.fillText('Static-pose crowd meshes  |  20 Hz Luau combat  |  No per-unit rigid bodies',28,689);
    ctx.fillStyle='#eef0e9';ctx.font='600 20px Segoe UI';ctx.fillText((state.fps??'—')+' FPS',906,664);
    ctx.font='12px Segoe UI';ctx.fillStyle='#a9b8bd';ctx.fillText('SIM '+Number(b.seconds??0).toFixed(1)+'s   /   WALL '+wall.toFixed(1)+'s',1055,662);
    ctx.fillText((b.projectiles??0)+' projectiles  ·  '+(state.renderer?.draw_calls??0)+' draws  ·  real-time capture at 1×',906,689);
    if(Math.floor(wall)>lastSample){lastSample=Math.floor(wall);samples.push({wall_s:wall,...state});}
    if(wall>=20&&!posterSent){posterSent=true;canvas.toBlob(blob=>fetch('/__capture/poster.png',{method:'POST',headers:{'Content-Type':'image/png'},body:blob}));}
    requestAnimationFrame(paint);
   }
   requestAnimationFrame(paint);recorder.start(1000);await api.request({method:'pause',paused:false});
   const cuts=[[9000,'front','THE FRONTLINE / SWORDS, CHARGES AND ARROWS'],[21000,'siege','THE REAR RANKS / BALLISTAE AND CATAPULTS'],[33000,'cinematic','THE CLASH / FLIGHT AND SPELLFIRE'],[45000,'wide','THE BATTLEFIELD / INDIVIDUAL LOSSES']];
   const timers=cuts.map(([time,mode,text])=>setTimeout(()=>{label=text;invoke('battle.camera.'+mode).catch(e=>console.error(e));},time));
   await new Promise(resolve=>setTimeout(resolve,54000));recorder.stop();await stopped;alive=false;timers.forEach(clearTimeout);stream.getTracks().forEach(t=>t.stop());
   await api.request({method:'pause',paused:true});
   const profile=await api.request({method:'profile'});
   for(const [file,type,body] of [['demo.webm',mime,new Blob(chunks,{type:mime})],['telemetry.json','application/json',JSON.stringify({capture:'real-time canvas, no offline frame synthesis',target_resolution:[1280,720],target_video_fps:30,wall_duration_ms:performance.now()-started,samples,profile:profile.value},null,2)]]){
    const response=await fetch('/__capture/'+file,{method:'POST',headers:{'Content-Type':type},body});if(!response.ok)throw new Error('Capture save failed '+response.status);
   }
   button.textContent='影片已儲存';document.body.dataset.recording='complete';
  }catch(error){button.textContent='錄影失敗：'+error.message;button.disabled=false;document.body.dataset.recording='failed';console.error(error);}
 };
}
