import {createCombatFX} from './combat-fx.mjs';
import {createStorybookActors} from './storybook-actors.mjs';
import {createInkStyle} from './ink-style.mjs';
import {mapDownloads,retryDownload} from './asset-loading.mjs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createAnimatorHost} from './animator/index.mjs';

const slots=['head','body','feet','hands','weapon'];
function mergeParts(root){
 root.updateMatrixWorld(true);
 for(const name of ['Body',...slots.map(s=>'Equipment_'+s)]){
  const group=root.getObjectByName(name);if(!group)continue;
  const meshes=[];group.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});if(meshes.length<2)continue;
  const geometries=meshes.map(o=>o.geometry.clone().applyMatrix4(new T.Matrix4().copy(group.matrixWorld).invert().multiply(o.matrixWorld)));
  const merged=mergeGeometries(geometries);if(!merged)throw Error('Cannot merge painted equipment '+name);
  const skin=new T.SkinnedMesh(merged,meshes[0].material);skin.name=name+'_skin';skin.bind(meshes[0].skeleton,meshes[0].bindMatrix);
  for(const mesh of meshes)mesh.removeFromParent();group.add(skin);for(const geometry of geometries)geometry.dispose();
 }
}
function troopClips(clips,rider=false){
 const map=Object.fromEntries(clips.map(c=>[c.name,rider?c.clone():c]));
 for(const [name,base,duration] of [['launch','attack',.24],['airborne','idle',.8],['landing','spawn',.2],['spin','attack',.55],['pierce','attack',.18],['terminal','attack',.24],['bounce','stretch',.18],['recall','spawn',.45],['expire','death',.5],['victory','stretch',1.6]]){
  const clip=map[base].clone();clip.name=name;const ratio=duration/clip.duration;for(const track of clip.tracks)for(let i=0;i<track.times.length;i++)track.times[i]*=ratio;clip.duration=duration;map[name]=clip;
 }
 if(rider)for(const clip of Object.values(map))for(const track of clip.tracks){
  if(/(UpLeg|LeftLeg|RightLeg)\.quaternion$/.test(track.name)){
   const q=new T.Quaternion().setFromEuler(new T.Euler(track.name.includes('UpLeg')?-1.15:1.1,0,track.name.includes('UpLeg')?(track.name.includes('Left')?.22:-.22):0)).toArray();
   for(let i=0;i<track.values.length;i+=4)track.values.set(q,i);
  }
 }
 return map;
}
function controller(clips,initial='idle'){
 return {initial,states:Object.fromEntries(Object.keys(clips).map(id=>[id,{clip:id,loop:['idle','walk','run','airborne','spin'].includes(id),transition:['hit','bounce','pierce'].includes(id)?.05:.12,clamp:true}]))};
}
export async function createActors({THREE,scene,assetBase=new URL('.',location.href)}){
 if(THREE.AnimationMixer!==T.AnimationMixer)throw Error('Actors require the same Three namespace as Unone renderer');
 const loader=new GLTFLoader();const roster=await (await fetch(new URL('assets/creatures/manifest.json',assetBase))).json();
 const loadModel=path=>retryDownload(()=>loader.loadAsync(new URL(path,assetBase).href),{onRetry:info=>console.warn('Retrying model download',path,info)});
 const assets=new Map(await mapDownloads(roster,async entry=>[entry.id,await loadModel('assets/creatures/'+entry.model)]));
 const equipment=await (await fetch(new URL('assets/equipment/manifest.json',assetBase))).json();
 const equipmentAssets=new Map(await mapDownloads(equipment,async e=>[e.id,await loadModel('assets/equipment/'+e.id+'.glb')]));
 const soldier=await loadModel('presentation/soldier-v2.glb');mergeParts(soldier.scene);assets.set('soldier',soldier);
 // The v2 cast shares one authored atlas. Reuse its GPU texture rather than
 // retaining twelve identical embedded 2048px images after glTF decoding.
 let castAtlas;const redundant=new Set();
 for(const asset of assets.values())asset.scene.traverse(o=>{if(!o.isMesh||!o.material.map)return;const map=o.material.map;if(!castAtlas)castAtlas=map;else if(map!==castAtlas){redundant.add(map);o.material.map=castAtlas;}});
 for(const map of redundant)map.dispose();
 const combatFX=createCombatFX(scene);
 const art=createStorybookActors(T,scene);
 const ink=createInkStyle(T);
 const entries=new Map();let itemMap=new Map();let clock=0,lastRound=0;
 const animator=createAnimatorHost({THREE:T,budgetHz:2400,onEquipment:({id,slots:equipped})=>{
  const entry=entries.get(id);if(!entry)return;
  for(const slot of slots){const group=entry.actor.getObjectByName('Equipment_'+slot);if(!group)continue;
   // Issued uniform has no gameplay bonus; paid equipment decorates this kit.
   const item=equipped[slot];group.visible=true;
   for(const old of entry.gearObjects?.[slot]??[])old.removeFromParent();entry.gearObjects??={};entry.gearObjects[slot]=[];
   const skill=itemMap.get(item)?.skill,asset=equipmentAssets.get(skill);
   if(asset){
    const bones={head:['mixamorigHead'],body:['mixamorigSpine1'],feet:['mixamorigLeftFoot','mixamorigRightFoot'],hands:['mixamorigLeftHand','mixamorigRightHand'],weapon:['mixamorigRightHand']}[slot];
    for(const name of bones){const bone=entry.actor.getObjectByName(name);if(bone){const ornament=asset.scene.clone(true);ornament.traverse(o=>{if(o.isMesh)o.userData.fanRigid=true});ink.apply(ornament);if(slot==='head')ornament.position.y=.35;bone.add(ornament);entry.gearObjects[slot].push(ornament)}}
    if(slot==='weapon')group.visible=false;
   }
  }
 }});
 function create(id,skin,data){
  const asset=assets.get(skin);if(!asset)throw Error('Missing actor '+skin);
  const actor=clone(asset.scene),root=new T.Group();root.add(actor);scene.add(root);
  actor.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=true;o.receiveShadow=true;o.userData.fanRigid=true}});
  const clips=skin==='soldier'?troopClips(asset.animations,data.k===3):Object.fromEntries(asset.animations.map(c=>[c.name,c]));
  const entry={id,root,actor,skin,born:clock,clips,state:'spawn',last:data,death:null};entries.set(id,entry);
  entry.handle=animator.attach({id,root:actor,clips,controller:controller(clips,'spawn'),distance:skin==='soldier'?2:14,maxHz:skin==='soldier'?30:15});
  if(skin==='soldier')entry.handle.setEquipment(Object.fromEntries(slots.map((s,i)=>[s,data.equipment?.[i]??0])));
  if(skin==='soldier')art.decorate(actor,data);
  if(data.k===3){
   const horse=clone(assets.get('horse').scene);root.add(horse);actor.position.y=.70;horse.scale.setScalar(.9);
   horse.traverse(o=>{if(o.isMesh)o.userData.fanRigid=true});
   const hclips=Object.fromEntries(assets.get('horse').animations.map(c=>[c.name,c]));
   entry.horse=animator.attach({id:id+'-horse',root:horse,clips:hclips,controller:controller(hclips,'run'),distance:2,maxHz:30});
  }
  ink.apply(root);
  return entry;
 }
 function remove(id){const e=entries.get(id);if(!e)return;animator.remove(id);if(e.horse)animator.remove(id+'-horse');e.root.removeFromParent();art.release(e.actor);e.actor.traverse(o=>{if(o.userData.ownMaterial)o.material.dispose()});entries.delete(id)}
 function update(s,dt){
  if(!s)return;itemMap=new Map(Object.values(s.items??{}).map(i=>[i.id,i]));const delta=s.paused?0:Math.min(dt,.1);clock+=delta;
  if(s.phase==='menu'&&lastRound!==0){for(const id of [...entries.keys()])remove(id)}lastRound=s.phase==='menu'?0:s.round;
  const soldiers=s.phase==='menu'?[1,2,3].map(k=>({id:'menu'+k,k,x:(k-2)*4,z:3,y:0,yaw:-.25,state:'idle',equipment:[1,1,1,1,1],age:1})):Object.values(s.visualTroops??{});
  const records=[...soldiers.map(t=>({...t,key:'t'+t.id,skin:'soldier'})),...Object.values(s.monsters??{}).map(m=>({...m,key:'m'+m.id,state:m.animation}))];
  const live=new Set();
  for(const data of records){live.add(data.key);let entry=entries.get(data.key);if(!entry)entry=create(data.key,data.skin,data);
   entry.root.position.set(data.x,data.y??0,data.z);entry.root.rotation.y=data.yaw??0;
   const scale=data.skin==='soldier'?(s.phase==='menu'?1.15:.82):data.scale*.9;entry.root.scale.setScalar(scale);
   let state=data.state==='run'?'run':data.state==='spin'?'spin':data.state==='airborne'?'airborne':data.state??'walk';
   if(clock-entry.born<.25)state='spawn';
   if(data.bounces>entry.last.bounces){entry.flashUntil=clock+.18;entry.flashState='bounce'}
   if(data.pierce<entry.last.pierce){entry.flashUntil=clock+.18;entry.flashState='pierce'}
   if(clock<(entry.flashUntil??0))state=entry.flashState;
   if(!entry.clips[state])state='walk';
   if(state!==entry.state){entry.handle.transition(state);entry.state=state}
   entry.last=data;
  }
  for(const [id,entry]of entries)if(!live.has(id)){
   if(entry.death===null){entry.death=clock;entry.handle.transition(['celebration','clear','victory'].includes(s.phase)&&entry.clips.recall?'recall':'death');if(entry.horse)entry.horse.transition('death')}
   if(clock-entry.death>.65)remove(id);
  }
  animator.update(delta);combatFX.update(s);art.update(entries);
  // Rider and mount share normalized presentation phase; neither controls game movement.
  for(const entry of entries.values())if(entry.horse&&!entry.death){const phase=entry.handle.player.getState().normalizedTime;entry.horse.player.seekNormalized(phase)}
 }
 return {update,inspect:()=>({actors:entries.size,animator:animator.snapshot(),creatures:roster.length,equipment:equipmentAssets.size,livery:'sculpted-storybook-v2',art:ink.inspect()}),dispose(){for(const id of [...entries.keys()])remove(id);animator.dispose();combatFX.dispose();art.dispose();ink.dispose();}};
}
