import * as T from 'three';import {OrbitControls} from 'three/addons/controls/OrbitControls.js';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {createAnimator} from './animator/index.mjs';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#d3d9cd');scene.add(new T.HemisphereLight(0xfff2d6,0x557165,2));const light=new T.DirectionalLight(0xffe4b8,2.5);light.position.set(2,5,4);scene.add(light);
const camera=new T.PerspectiveCamera(35,innerWidth/innerHeight,.05,50);camera.position.set(3.6,2.8,5.8);const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.enableDamping=true;
const floor=new T.Mesh(new T.CylinderGeometry(1.4,1.55,.12,12),new T.MeshStandardMaterial({color:'#9fac91',roughness:.9}));floor.position.y=-.13;scene.add(floor);
const $=id=>document.getElementById(id),roster=await (await fetch('../assets/creatures/manifest.json')).json();
for(const entry of roster)$('species').add(new Option(entry.name,entry.id));for(const [id,name]of Object.entries({idle:'站立',walk:'移動',run:'奔跑',attack:'攻擊／示威',hit:'受擊',death:'死亡',spawn:'出生',stretch:'舒展'}))$('motion').add(new Option(name,id));
let root,player,helper,playing=true;const loader=new GLTFLoader();
async function select(){
 const id=$('species').value,asset=await loader.loadAsync('../assets/creatures/'+roster.find(e=>e.id===id).model);if(player)player.dispose();if(root)scene.remove(root);if(helper)scene.remove(helper);
 root=asset.scene;scene.add(root);helper=new T.SkeletonHelper(root);helper.visible=$('bones').checked;scene.add(helper);
 player=createAnimator({THREE:T,root,clips:asset.animations,controller:{initial:$('motion').value,states:Object.fromEntries(asset.animations.map(c=>[c.name,{clip:c.name,loop:['idle','walk','run'].includes(c.name),transition:.18,clamp:true}]))}});
 $('info').textContent=roster.find(x=>x.id===id).name+' · '+asset.animations.length+' 動作 · Blender 原創貼圖模型';playing=true;$('play').textContent='暫停';window.creatureLab={root,player,asset};
}
$('species').value=new URLSearchParams(location.search).get('kind')??'beetle';$('species').onchange=select;$('motion').onchange=()=>{player.transition($('motion').value);player.resume();playing=true};$('play').onclick=()=>{playing=!playing;playing?player.resume():player.pause();$('play').textContent=playing?'暫停':'播放'};$('bones').onchange=()=>helper.visible=$('bones').checked;
await select();const clock=new T.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());if(playing)player.update(dt);controls.update();renderer.render(scene,camera)});
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
