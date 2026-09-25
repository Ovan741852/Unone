import {createThreeRenderer} from '../renderer/three.js?build=particle-vfx-colorbins-v1';

const canvas=document.querySelector('canvas'),result=document.querySelector('#result');
let renderer;
let presets=[];
function read(){const m=window.Module,p=m._unone_web_observation_ptr();return JSON.parse(new TextDecoder().decode(m.HEAPU8.slice(p,p+m._unone_web_observation_len())));}
async function loadPreset(id){
  try{
    const selected=presets.find(preset=>preset.id===id);
    if(!selected)throw new Error(`Unknown particle preset: ${id}`);
    const response=await fetch(`./presets/${selected.file}`);
    if(!response.ok)throw new Error(`Could not load preset: ${selected.file}`);
    document.querySelector('#definition').value=JSON.stringify(await response.json(),null,2);
    await preview();
  }catch(error){result.textContent=error.message;}
}
async function preview(){try{
  const definition=JSON.parse(document.querySelector('#definition').value),seed=Number(document.querySelector('#seed').value),frame=Number(document.querySelector('#frame').value);
  if(!Number.isSafeInteger(seed)||seed<0||!Number.isInteger(frame)||frame<0||frame>7200)throw new Error('Seed 請用非負整數；Frame 範圍是 0–7200');
  const payload={config:{name:'Particle preview',entry_script:'main.luau'},script:`return {start=function(api) api.particle.play("preview",{x=0,y=0,z=0},${seed}) end,update=function(api,dt) end}`,scene:{camera3d:{position:{x:0,y:1,z:4},target:{x:0,y:0,z:0}},particle_effects:{preview:definition}}};
  const bytes=new TextEncoder().encode(JSON.stringify(payload)),m=window.Module,p=m._unone_web_alloc(bytes.length);m.HEAPU8.set(bytes,p);
  if(m._unone_web_load_project(p,bytes.length,42n)!==0)throw new Error(JSON.stringify(read()));
  for(let i=0;i<frame;i++)if(m._unone_web_tick()!==0)throw new Error(JSON.stringify(read()));
  const snapshot=read();renderer.draw(snapshot);result.textContent=JSON.stringify({frame,seed,particles:snapshot.world.particles?.length??0,camera:snapshot.world.camera3d,render:renderer.metrics(),digest:snapshot.observation_digest},null,2);
  document.body.dataset.preview=JSON.stringify(snapshot.world.particles??[]);
}catch(error){result.textContent=error.message;}}

try{
  await window.runtimeReady;
  renderer=await createThreeRenderer(canvas,{kind:'three-webgl',bloom:document.querySelector('#bloom').checked,ao:document.querySelector('#ao').checked});
  const manifest=await (await fetch('./presets/index.json')).json();presets=manifest.presets;
  const select=document.querySelector('#preset');
  for(const preset of presets){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.label;select.append(option);}
  select.addEventListener('change',()=>loadPreset(select.value));
  document.querySelector('#preview').addEventListener('click',preview);
  document.querySelector('#frame').addEventListener('input',preview);
  document.querySelector('#seed').addEventListener('change',preview);
  document.querySelector('#bloom').addEventListener('change',event=>renderer.setBloom?.(event.target.checked));
  document.querySelector('#ao').addEventListener('change',event=>renderer.setAO?.(event.target.checked));
  let timer;document.querySelector('#definition').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(preview,250);});
  select.value=presets[0].id;await loadPreset(select.value);
}catch(error){result.textContent=error.message;}
