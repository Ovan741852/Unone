import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAnimator} from './.unone/staging/unone-animator/runtime/index.mjs';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createSoldier,makeClips,motionSpecs} from './rig.mjs';
import {applyStorybook} from './storybook.mjs';
import {retargetFBX} from './retarget.mjs';
const $=id=>document.getElementById(id),scene=new T.Scene();scene.background=new T.Color('#d8d5c9');scene.fog=new T.Fog('#d8d5c9',5,18);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;$('stage').append(renderer.domElement);
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.35;room.dispose();pmrem.dispose();
const camera=new T.PerspectiveCamera(35,innerWidth/innerHeight,.01,100);camera.position.set(2.5,1.9,4.5);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.85,0);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=9;
scene.add(new T.HemisphereLight(0xfff1d4,0x766a61,1.4));function light(color,power,pos){const l=new T.DirectionalLight(color,power);l.position.set(...pos);scene.add(l);return l;}const key=light(0xffedce,2,[3,6,4]);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=4;key.shadow.camera.bottom=-3;key.shadow.normalBias=.025;light(0xbbd5df,1,[-3,3,-2]);light(0xd8dce7,.5,[1,2,-4]);
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xc6c6b8,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.position.y=-.13;floor.receiveShadow=true;scene.add(floor);
const base=new T.Mesh(new T.CylinderGeometry(1.18,1.28,.12,64),new T.MeshStandardMaterial({color:0xacb5af,metalness:0,roughness:.45}));base.position.y=-.065;base.receiveShadow=true;scene.add(base);const ring=new T.Mesh(new T.TorusGeometry(1.16,.008,6,96),new T.MeshBasicMaterial({color:0xeae4ca}));ring.rotation.x=Math.PI/2;ring.position.y=.003;scene.add(ring);const grid=new T.GridHelper(20,40,0x293a43,0x17262f);grid.position.y=-.12;grid.visible=false;scene.add(grid);
const vinylData=await (await fetch('./assets/vinyl/soldier.mesh.json')).json();const vinylTexture=await new T.TextureLoader().loadAsync('./assets/'+vinylData.texture);vinylTexture.colorSpace=T.SRGBColorSpace;vinylTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();const rig=applyStorybook(createSoldier(),vinylData,vinylTexture);scene.add(rig.root);const helper=new T.SkeletonHelper(rig.root);helper.material.depthTest=false;helper.material.transparent=true;helper.material.opacity=.65;helper.renderOrder=10;helper.visible=false;scene.add(helper);const clips=makeClips(rig);let playing=true;
const controller=await (await fetch('./animator-controller.json')).json();
let animator=createAnimator({THREE:T,root:rig.root,clips,controller});
function play(name){
 if(!controller.states[name]){
  controller.states[name]={clip:name,loop:true,transition:.2};animator.dispose();animator=createAnimator({THREE:T,root:rig.root,clips,controller});
 }
 animator.transition(name);animator.resume();playing=true;$('play').textContent='暫停';
 $('timeline').max=clips[name].duration;
 $('clipTitle').textContent=(name==='imported'?clips[name].name:$('motion').selectedOptions[0].text)+' · Unone Animator';
}

function status(s){$('status').textContent=s;}
const gearDefinitions=await (await fetch('./assets/equipment/manifest.json')).json();
const gearLoader=new GLTFLoader(),gearModels=new Map(await Promise.all(gearDefinitions.map(async d=>[d.id,(await gearLoader.loadAsync('./assets/equipment/'+d.id+'.glb')).scene])));
const originalEquip=rig.equip,ornaments={};
rig.equip=(slot,variant)=>{
 for(const object of ornaments[slot]??[])object.removeFromParent();ornaments[slot]=[];
 originalEquip(slot,variant==='none'?'none':'storybook');
 const model=gearModels.get(variant);if(!model)return;
 const names={head:['Head'],body:['Spine1'],feet:['LeftFoot','RightFoot'],hands:['LeftHand','RightHand'],weapon:['RightHand']}[slot];
 for(const name of names){const object=model.clone(true);if(slot==='head')object.position.y=.35;rig.map[name].add(object);ornaments[slot].push(object)}
 if(slot==='weapon')rig.slots[slot].visible=false;
};
const slotNames={head:'頭部',body:'身體',feet:'腳部',hands:'手部',weapon:'武器'};for(const [slot,label]of Object.entries(slotNames)){const row=document.createElement('label');row.className='slot';row.textContent=label;const select=document.createElement('select');select.id='slot-'+slot;select.innerHTML='<option value="none">無裝備</option><option value="storybook" selected>貼圖公仔</option>';for(const d of gearDefinitions.filter(d=>d.slot===Object.keys(slotNames).indexOf(slot)+1))select.add(new Option(d.name,d.id));select.onchange=()=>{rig.equip(slot,select.value);updateStats();};row.append(select);$('slots').append(row);}
function updateStats(){let verts=0,meshes=0;rig.root.traverse(o=>{if(o.isMesh){verts+=o.geometry.attributes.position.count;meshes++;}});$('stats').textContent=`${rig.bones.length} 根骨骼 · ${meshes} 個蒙皮部件 · ${verts.toLocaleString()} 頂點`;}
for(const [id,type]of [['naked','none'],['knight','storybook']])$(id).onclick=()=>{for(const s of Object.keys(slotNames)){rig.equip(s,type);$('slot-'+s).value=type;}updateStats();};
$('skeleton').onchange=e=>helper.visible=e.target.checked;$('wire').onchange=e=>Object.values(rig.mats).forEach(m=>m.wireframe=e.target.checked);$('motion').onchange=e=>play(e.target.value);$('play').onclick=()=>{if(animator.getState().finished){animator.restart();playing=true}else{playing=!playing;if(playing)animator.resume();else animator.pause()}$('play').textContent=playing?'暫停':'播放';};
$('reset').onclick=()=>{animator.restart();animator.resume();playing=true;$('play').textContent='暫停';};
$('timeline').oninput=e=>animator.seek(+e.target.value);

$('file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{status('正在轉換 FBX…');if(file.size>60*1024*1024)throw Error('FBX 請小於 60 MB');const source=new FBXLoader().parse(await file.arrayBuffer(),'');const result=retargetFBX(source,rig,source.animations[0]);clips.imported=result.clip;if(controller.states.imported){animator.dispose();animator=createAnimator({THREE:T,root:rig.root,clips,controller})}if(!$('motion').querySelector('[value=imported]'))$('motion').add(new Option('Mixamo 匯入','imported'));$('motion').value='imported';play('imported');status(`已映射 ${result.mapped}/${rig.bones.length} 根骨骼 · 原地播放`);}catch(err){status('匯入失敗：'+err.message);}e.target.value='';};
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('glb').onclick=async()=>{const snapshot=rig.bones.map(b=>({b,p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));const oldRotation=rig.root.rotation.y,wasPlaying=playing;playing=false;try{rig.root.rotation.y=0;rig.skeleton.pose();rig.root.updateMatrixWorld(true);const data=await new GLTFExporter().parseAsync(rig.root,{binary:true,animations:Object.values(clips)});download(data,'vinyl-soldier-animated.glb','model/gltf-binary');status('GLB 已匯出：骨架、裝備、動作');}catch(e){status('匯出失敗：'+e.message);}finally{for(const {b,p,q,s}of snapshot){b.position.copy(p);b.quaternion.copy(q);b.scale.copy(s);}rig.root.rotation.y=oldRotation;playing=wasPlaying;rig.root.updateMatrixWorld(true);}};
$('obj').onclick=()=>{const neutral=new T.Group();rig.body.traverse(o=>{if(o.isSkinnedMesh)neutral.add(new T.Mesh(o.geometry,o.material));});neutral.updateMatrixWorld(true);download(new OBJExporter().parse(neutral),'ashen-body-tpose.obj','text/plain');status('已匯出 T-pose 素體 OBJ');};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.setViewOffset(innerWidth,innerHeight,Math.min(150,innerWidth*.14),100,innerWidth,innerHeight);camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();play('idle');updateStats();status('骨架與五槽裝備已就緒');const clock=new T.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);if(playing){animator.setSpeed(+$('speed').value);animator.update(dt);if(animator.getState().finished){playing=false;$('play').textContent='播放';}}if($('rotate').checked)rig.root.rotation.y+=dt*.3;controls.update();renderer.render(scene,camera);const playback=animator.getState();$('timeline').value=playback.time;$('time').textContent=playback.time.toFixed(2)+' / '+playback.duration.toFixed(2);});
// Read-only diagnostics for integration verification, no game rules live here.
window.wardrobe={rig,clips,get mixer(){return animator.mixer},get animator(){return animator},gearDefinitions,renderer,scene,retargetFBX};
