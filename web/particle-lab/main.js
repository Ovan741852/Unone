import {createThreeRenderer} from '../renderer/three.js';
const canvas=document.querySelector('canvas'),result=document.querySelector('#result');
let renderer;
function read(){const m=window.Module,p=m._unone_web_observation_ptr();return JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(p,p+m._unone_web_observation_len())));}
async function preview(){try{
  const definition=JSON.parse(document.querySelector('#definition').value), seed=Number(document.querySelector('#seed').value),frame=Number(document.querySelector('#frame').value);
  if(!Number.isSafeInteger(seed)||seed<0||!Number.isInteger(frame)||frame<0||frame>7200)throw new Error('Use an integer seed >= 0 and frame 0..7200');
  const payload={project:'Particle preview',script:`return {start=function(api) api.particle.play("preview",{x=0,y=0,z=0},${seed}) end,update=function(api,dt) end}`,scene:{camera3d:{position:{x:0,y:1,z:4},target:{x:0,y:0,z:0}},particle_effects:{preview:definition}}};
  const bytes=new TextEncoder().encode(JSON.stringify(payload)),m=window.Module,p=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,p);
  if(m._unone_web_load_project(p,bytes.length,42n)!==0)throw new Error(JSON.stringify(read()));
  for(let i=0;i<frame;i++)if(m._unone_web_tick()!==0)throw new Error(JSON.stringify(read()));
  const snapshot=read();renderer.draw(snapshot);result.textContent=JSON.stringify({frame,seed,particles:snapshot.world.particles?.length??0,digest:snapshot.observation_digest},null,2);
  document.body.dataset.preview=JSON.stringify(snapshot.world.particles??[]);
}catch(e){result.textContent=e.message;}}
try{await window.runtimeReady;renderer=await createThreeRenderer(canvas,{kind:'three-webgl'});document.querySelector('#definition').value=JSON.stringify(await (await fetch('../../tests/fixtures/spark.particle.json')).json(),null,2);document.querySelector('#preview').addEventListener('click',preview);document.querySelector('#frame').addEventListener('input',preview);document.querySelector('#seed').addEventListener('change',preview);let timer;document.querySelector('#definition').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(preview,250);});await preview();}catch(e){result.textContent=e.message;}
