import * as T from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createInkStyle} from './ink-style.mjs';

// A small, isolated Three.js paper-doll preview. It reads only the published
// game observation; the Luau state remains the sole owner of equipment rules.
const SLOTS=['head','body','feet','hands','weapon'];
const BONES={head:['mixamorigHead'],body:['mixamorigSpine1'],feet:['mixamorigLeftFoot','mixamorigRightFoot'],hands:['mixamorigLeftHand','mixamorigRightHand'],weapon:['mixamorigRightHand']};

export async function createLoadoutPreview({canvas,preparedAssets,mode='3d'}){
 const selectedMode=['2d','3d','fit3d'].includes(mode)?mode:'3d';
 if(selectedMode==='2d'){
  canvas.style.display='none';
  return {update(){},inspect:()=>({visible:false,mode:'2d',asset:null,slots:0,animated:false,meshes:0,bounds:null,drawCalls:0}),dispose(){}};
 }
 const {assets,equipmentAssets}=await preparedAssets;
 const source=assets.get('soldier');
 if(!source)throw Error('Loadout preview soldier asset missing');
 const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:false});
 renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.setClearColor(0,0);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(22,1,.01,100);
 if(selectedMode==='fit3d'){camera.position.set(1.95,1.24,5.5);camera.lookAt(0,1.0,0)}
 else{camera.position.set(2.2,1.35,4.6);camera.lookAt(0,1.03,0)}
 scene.add(new T.HemisphereLight(0xffe9c5,0x32403d,1.55));
 const key=new T.DirectionalLight(0xffd9a0,2.15);key.position.set(-2.8,4.8,3.4);scene.add(key);
 const rim=new T.DirectionalLight(0x9fced0,.8);rim.position.set(2.5,2.4,-3);scene.add(rim);
 const ink=createInkStyle(T);
 let root=null,actor=null,mixer=null,gearObjects={};let visible=false,lastSignature='';let elapsed=0;
 function clearGear(){for(const list of Object.values(gearObjects))for(const object of list){object.removeFromParent();object.traverse(o=>o.geometry?.dispose?.());}gearObjects={};}
 function applyEquipment(game){
  if(!actor)return;clearGear();
  const items=new Map(Object.values(game.items??{}).map(item=>[item.id,item]));
  const worn=game.worn?.[Math.max(0,(game.selected??1)-1)]??game.worn?.[game.selected??1]??[];
  for(let index=0;index<SLOTS.length;index++){
   const slot=SLOTS[index],group=actor.getObjectByName('Equipment_'+slot);if(group)group.visible=true;
   const item=items.get(worn[index]??0),model=item&&equipmentAssets.get(item.skill);if(!model)continue;gearObjects[slot]=[];
   const bones={head:['mixamorigHead'],body:['mixamorigSpine1'],feet:['mixamorigLeftFoot','mixamorigRightFoot'],hands:['mixamorigLeftHand','mixamorigRightHand'],weapon:['mixamorigRightHand']}[slot];
   for(const boneName of bones){const bone=actor.getObjectByName(boneName);if(!bone)continue;const ornament=clone(model.scene);ornament.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=true;o.userData.fanRigid=true;}});if(slot==='head')ornament.position.y=.35;bone.add(ornament);ink.apply(ornament);gearObjects[slot].push(ornament);}
   if(slot==='weapon'&&group)group.visible=false;
  }
 }
 function makeActor(game){
  if(actor){clearGear();actor.removeFromParent();}
  root=new T.Group();root.name='LoadoutPreviewRoot';actor=clone(source.scene);actor.rotation.y=selectedMode==='fit3d'?-0.12:-.18;actor.position.y=selectedMode==='fit3d'?.08:.12;actor.scale.setScalar(selectedMode==='fit3d'?.62:.78);
  actor.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=true;o.receiveShadow=true;o.userData.fanRigid=true;}});root.add(actor);scene.add(root);ink.apply(actor);
  mixer=new T.AnimationMixer(actor);const clip=source.animations.find(item=>item.name==='idle')??source.animations[0];if(clip)mixer.clipAction(clip).play();applyEquipment(game);
 }
 function resize(){const width=Math.max(1,canvas.clientWidth||1),height=Math.max(1,canvas.clientHeight||1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
 addEventListener('resize',resize);resize();canvas.style.display='none';
 function update(game,dt=0){
  const route=game?.uiRoute??'',nextVisible=game?.phase==='loadout'&&(route==='gear'||route==='runes')&&!game?.uiGearDetail;
  if(nextVisible!==visible){visible=nextVisible;canvas.style.display=visible?'block':'none';if(visible)resize();}
  if(!visible)return;
  const selected=game.selected??1,worn=game.worn?.[Math.max(0,selected-1)]??game.worn?.[selected]??[],signature=selected+':'+worn.join(',')+':'+Object.values(game.items??{}).length;
  if(signature!==lastSignature){lastSignature=signature;makeActor(game);}
  const delta=Math.min(Math.max(Number(dt)||0,0),.08);elapsed+=delta;mixer?.update(delta);if(root)root.rotation.y=-.18+Math.sin(elapsed*.35)*.035;renderer.render(scene,camera);
 }
 return {update,inspect:()=>{const box=root?new T.Box3().setFromObject(root):null;return {visible,mode:selectedMode,asset:'presentation/soldier-v2.glb',slots:SLOTS.length,animated:Boolean(mixer),outfitSignature:lastSignature,meshes:root?[...(()=>{const list=[];root.traverse(o=>{if(o.isMesh)list.push(o)});return list})()].length:0,bounds:box?{min:box.min.toArray(),max:box.max.toArray()}:null,drawCalls:renderer.info.render.calls};},dispose(){removeEventListener('resize',resize);clearGear();root?.removeFromParent();ink.dispose();renderer.dispose();}};
}
