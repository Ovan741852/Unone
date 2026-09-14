import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createAnimator} from './animator/index.mjs';
import {createStorybookActors} from './storybook-actors.mjs';
import {createInkStyle} from './ink-style.mjs';
import {createSceneLighting} from './scene-lighting.mjs';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#4a4651');
const lighting=createSceneLighting({THREE:T,scene,renderer}),ink=createInkStyle(T);lighting.setMode('day');
const camera=new T.PerspectiveCamera(33,innerWidth/innerHeight,.05,80);camera.position.set(4,3.7,9.3);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.15,0);controls.enableDamping=true;
for(const x of [-1.7,1.7]){const m=new T.Mesh(new T.CylinderGeometry(1.27,1.33,.14,48),new T.MeshStandardMaterial({color:'#35515b',roughness:1}));m.position.set(x,-.12,0);scene.add(m);const shadow=new T.Mesh(new T.CircleGeometry(.89,32),new T.MeshBasicMaterial({color:'#0d252e',transparent:true,opacity:.32,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(x,-.045,0);scene.add(shadow);}
const loader=new GLTFLoader(),roster=await(await fetch('../assets/creatures/manifest.json')).json(),$=id=>document.getElementById(id),art=createStorybookActors(T,scene);
for(const e of [{id:'soldier',name:'劍盾步兵'},{id:'spear',name:'長槍兵'},{id:'cavalry',name:'騎士'},...roster])$('species').add(new Option(e.name,e.id));
let entries=[],playing=true,ticket=0;
async function select(){
 if(window.artLab)window.artLab.ready=false;
 const token=++ticket,kind=$('species').value,soldier=['soldier','spear','cavalry'].includes(kind),k=kind==='cavalry'?3:kind==='spear'?2:1,info=roster.find(r=>r.id===kind);
 const paths=soldier?['soldier.glb','soldier-v2.glb']:['../assets/creatures/'+kind+'.glb','../assets/creatures/'+info.model];
 const assets=await Promise.all(paths.map(p=>loader.loadAsync(p)));if(token!==ticket)return;
 for(const e of entries){e.player.dispose();e.mountPlayer?.dispose();art.release(e.root);e.wrapper.removeFromParent();}entries=[];
 for(const [i,asset]of assets.entries()){
  const wrapper=new T.Group(),root=asset.scene;wrapper.position.x=i===0?-1.7:1.7;wrapper.add(root);scene.add(wrapper);
  if(soldier){
   root.scale.setScalar(1.12);
   if(i===0)for(const slot of ['head','body','hands','feet']){const g=root.getObjectByName('Equipment_'+slot);if(g)g.visible=false;}
   art.decorate(root,{k,equipment:[0,0,0,0,0],artLegacy:i===0});
  }
  const clips=asset.animations,player=createAnimator({THREE:T,root,clips,controller:{initial:$('motion').value,states:Object.fromEntries(clips.map(c=>[c.name,{clip:c.name,loop:['idle','walk','run'].includes(c.name),transition:.14,clamp:true}]))}});
  const e={root,wrapper,asset,player};entries.push(e);
  if(kind==='cavalry'){
   const mountAsset=await loader.loadAsync('../assets/creatures/'+(i===0?'horse.glb':'art-v2/horse.glb'));if(token!==ticket)return;root.position.y=.70;const mount=mountAsset.scene;wrapper.add(mount);
   e.mountPlayer=createAnimator({THREE:T,root:mount,clips:mountAsset.animations,controller:{initial:'run',states:Object.fromEntries(mountAsset.animations.map(c=>[c.name,{clip:c.name,loop:true,transition:.1}]))}});
  }
  if(i===1)ink.apply(wrapper);
 }
 const tris=root=>{let n=0;root.traverse(o=>{if(o.isMesh&&!o.userData.inkOutline)n+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});return n;};
 $('status').textContent=`原版 ${Math.round(tris(entries[0].root))} 三角面 → 新版 ${Math.round(tris(entries[1].root))} 三角面 · ${assets[1].animations.length} 組動畫`;
 window.artLab={entries,kind,ready:true,scene,camera,renderer,lighting};
}
$('species').value=new URLSearchParams(location.search).get('kind')??'beetle';$('species').onchange=select;$('motion').onchange=()=>{for(const e of entries){e.player.transition($('motion').value);e.player.resume();}playing=true;$('play').textContent='暫停';};$('play').onclick=()=>{playing=!playing;for(const e of entries)playing?e.player.resume():e.player.pause();$('play').textContent=playing?'暫停':'播放';};
$('lighting').onchange=()=>lighting.setMode($('lighting').value);$('light-side').onchange=()=>lighting.setSide($('light-side').value);
await select();const clock=new T.Clock();let elapsed=0;renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());elapsed+=dt;lighting.update({rewardClock:elapsed});if(playing)for(const e of entries){e.player.update(dt);e.mountPlayer?.update(dt);}controls.update();renderer.render(scene,camera);});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
