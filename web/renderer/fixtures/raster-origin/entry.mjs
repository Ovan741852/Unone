import {createThreeRenderer} from '../../../renderer/three.js';
import {createRasterProbe} from '../../../renderer/projected-raster-probe.mjs';
import {saveProbeState} from '../../../renderer/projected-raster-probe-target.mjs';
import {configureTexture} from '../../../renderer/presentation3d.js';
import {installContextClearRecovery} from '../../../renderer/renderer-context-clear-recovery.mjs';
import {authoredCases,packCase} from './registry.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),cases=authoredCases();
const expected=await (await fetch('./expected.json')).json(),manifest=await (await fetch('./manifest.json')).json();
let selected=cases.find(c=>c.id===params.get('case'))??cases[0],strategy=params.get('strategy')??'A';
let ratio=Number(params.get('dpr')??1),width=Number(params.get('width')??1280),height=Number(params.get('height')??720);
if(![1,2].includes(ratio)||![1280,800].includes(width)||![720,600].includes(height))throw Error('Unsupported probe size/DPR');
const canvas=$('screen'),capture=document.createElement('canvas'),read=capture.getContext('2d',{willReadFrequently:true});
const records=new Map(),specs=new Map(Object.keys(manifest.images).map(id=>[id,{kind:'texture2d',id}]));
let context,probe,clearRecovery,drawn=null,zoomPoint=selected.points[0],lost=false,frame=0;
const host=await createThreeRenderer(canvas,{kind:'three-webgl',antialias:false,bloom:false,ao:false,
 threeModuleUrl:new URL('../../../vendor/three/three.player.min.js',import.meta.url).href,
 getAssetManifest:()=>({assets:[...specs.values()].map(spec=>({...spec,source:manifest.images[spec.id]}))}),
 loadAssetUrl:async spec=>new URL(spec.source,import.meta.url).href,
 onReady(value){context=value;clearRecovery=installContextClearRecovery(value.THREE,value.renderer,canvas);
  return ()=>{probe?.dispose();clearRecovery.dispose();};}});
if(!(context.renderer.getContext() instanceof WebGL2RenderingContext))throw Error('WebGL2 is required');
if(host.metrics().raster.context_antialias!==false)throw Error('Effective AA must be false for this probe');
for(const [id,source] of Object.entries(manifest.images)){
 const texture=await new context.THREE.TextureLoader().loadAsync(source);
 records.set(id,{state:'ready',texture:configureTexture(context.THREE,texture)});
}
probe=createRasterProbe({...context,strategy,antialias:false,textureFor:spec=>records.get(spec.id)});
const empty={projected_world_visible:false,projected_geometry:{}};
function state(){const s=saveProbeState(context.THREE,context.renderer);return JSON.stringify({...s,target:s.target?.uuid??null});}
function image(){capture.width=canvas.width;capture.height=canvas.height;read.drawImage(canvas,0,0);return read.getImageData(0,0,capture.width,capture.height);}
function zoom(){
 if(!drawn)return;const [x,y]=zoomPoint,region=selected.region[2]<=16?selected.region:[Math.max(0,x-3),Math.max(0,y-3),7,7];
 const z=$('zoom');z.width=region[2];z.height=region[3];z.style.width=`${z.width*16}px`;z.style.height=`${z.height*16}px`;
 const c=z.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(capture,...region,0,0,z.width,z.height);
 z.title=`Physical region ${region.join(',')} at CSS16× nearest; original buffer ${canvas.width}×${canvas.height}`;
}
function showPixels(data,input){
 const rows=expected.cases[input.id].pixels;let passes=0;$('pixels').replaceChildren();
 for(const record of rows){
  const [x,y]=record.point,index=(y*data.width+x)*4,actual=[...data.data.slice(index,index+3)];
  const pass=actual.length===3&&actual.every((n,i)=>Math.abs(n-record.rgb[i])<=expected.tolerance);if(pass)passes++;
  const tr=document.createElement('tr'),button=document.createElement('button');button.textContent=`${x},${y}`;
  button.onclick=()=>{zoomPoint=record.point;zoom();};const first=document.createElement('td');first.append(button);tr.append(first);
  for(const text of [record.rgb.join(','),actual.join(','),pass?'PASS':'FAIL']){const td=document.createElement('td');td.textContent=text;tr.append(td);}
  tr.className=pass?'pass':'fail';$('pixels').append(tr);
 }
 $('summary').textContent=`Actual GPU canvas readback: ${passes}/${rows.length} within ±${expected.tolerance}. A/B/C are candidates; no automatic parity claim.`;
}
function render(input=selected){
 if(lost)return;
 canvas.style.width=`${width/ratio}px`;canvas.style.height=`${height/ratio}px`;context.renderer.setPixelRatio(ratio);
 host.draw(empty,{dt:0});const snapshot=packCase(input,canvas.width,canvas.height,++frame),before=state();
 probe.draw(snapshot,specs);const restored=before===state();drawn=image();showPixels(drawn,input);zoom();
 const metrics={strategy,ordinary_vs_probe:'probe_'+strategy,case:selected.id,displaying:input.id,physical_size:[canvas.width,canvas.height],dpr:ratio,
  state_restored:restored,...probe.metrics(),raster:host.metrics().raster,stage:manifest.stage_id,clear_state_recovery:clearRecovery.metrics(),
  depth_clear:'official normal 1; no reverse depth; no shared world depth',expected_registry:'independent fixed TL; no GPU-derived expectations'};
 // A has no offscreen target; always report actual default-buffer physical dimensions too.
 metrics.physical_size=[canvas.width,canvas.height];$('status').textContent=JSON.stringify(metrics,null,2);
 console.info('UNONE_RASTER_PROBE_FRAME',metrics);
 if(!restored)throw Error('RASTER_PROBE_STATE_RESTORE_FAILED');
}
async function ordinary(id){
 if(lost)return;const input=cases.find(c=>c.id===id);$('status').textContent=`Loading ordinary host ${id} (same WebGL context; no probe draw)`;
 canvas.style.width=`${width/ratio}px`;canvas.style.height=`${height/ratio}px`;context.renderer.setPixelRatio(ratio);
 const snapshot=packCase(input,width,height,++frame);
 // This path calls only the unmodified official host. Its own declared asset loader
 // and projected component prepare the nonempty snapshot; no C helper draws here.
 host.draw(snapshot,{dt:0});await host.ready();host.draw(snapshot,{dt:0});
 drawn=image();selected=input;zoomPoint=input.points[0];$('case').value=input.id;showPixels(drawn,input);zoom();
 const metrics={ordinary_vs_probe:'ordinary_host_nonempty',displaying:id,strategy_last_probe:strategy,physical_size:[canvas.width,canvas.height],
  dpr:ratio,stage:manifest.stage_id,raster:host.metrics().raster,ordinary_projected:host.metrics().projected_batches,
  probe_metrics_after_ordinary:probe.metrics(),clear_state_recovery:clearRecovery.metrics(),
  scissor_fixture:id==='scissor'?'quad98..106, physicalscissor100,100:1x1 fully interior; no A boundary ownership assumption':null,
  scope:'Same context after candidate; unmodified host.draw nonempty projected only, no world3d shared-depth claim'};
 $('status').textContent=JSON.stringify(metrics,null,2);console.info('UNONE_RASTER_PROBE_ORDINARY',metrics);
}
function schedule(input){requestAnimationFrame(()=>{try{render(input);}catch(error){$('status').textContent=String(error);console.error(error);}});}
for(const c of cases){const option=document.createElement('option');option.value=c.id;option.textContent=c.id;$('case').append(option);}
$('case').value=selected.id;$('strategy').value=strategy;$('dpr').value=String(ratio);
$('case').onchange=()=>{selected=cases.find(c=>c.id===$('case').value);zoomPoint=selected.points[0];schedule();};
$('strategy').onchange=()=>{params.set('strategy',$('strategy').value);params.set('case',selected.id);location.search=params;};
$('dpr').onchange=()=>{ratio=Number($('dpr').value);schedule();};
$('resize').onclick=()=>{[width,height]=width===1280?[800,600]:[1280,720];schedule();};
$('empty').onclick=()=>schedule(cases.find(c=>c.id==='empty'));$('readd').onclick=()=>schedule();
for(const [button,id] of [['ordinary-material','material11'],['ordinary-depth','depth'],['ordinary-scissor','scissor']])
 $(button).onclick=()=>ordinary(id).catch(error=>{$('status').textContent=String(error);console.error(error);});
const extension=context.renderer.getContext().getExtension('WEBGL_lose_context');
$('loss').disabled=$('restore').disabled=!extension;$('loss').onclick=()=>extension.loseContext();$('restore').onclick=()=>extension.restoreContext();
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;probe.invalidate();$('status').textContent=JSON.stringify(probe.metrics(),null,2);});
canvas.addEventListener('webglcontextrestored',()=>{lost=false;probe.restore();schedule();});
schedule();
