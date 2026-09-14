import {createInkStyle} from './ink-style.mjs';
// Game-owned lighting rig. All times and event positions are read-only observations.
export function createSceneLighting({THREE:T,scene,renderer}){
 const ink=createInkStyle(T),key=new T.DirectionalLight(),rim=new T.DirectionalLight(),ambient=new T.HemisphereLight();
 key.position.set(-18,24,12);rim.position.set(18,12,-6);scene.add(key,rim,ambient);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:1,far:85});
 key.shadow.bias=-.0003;key.shadow.normalBias=.035;key.shadow.camera.updateProjectionMatrix();
 const flashes=Array.from({length:4},()=>{const l=new T.PointLight(0xffa344,0,7,2);scene.add(l);return l});
 const day={key:new T.Color(0xffd49a),rim:new T.Color(0xaaa2df),sky:new T.Color(0xe8dec8),ground:new T.Color(0x766071),fog:new T.Color(0xc1c2a0)};
 const night={key:new T.Color(0xdeb795),rim:new T.Color(0x899be1),sky:new T.Color(0x8499b6),ground:new T.Color(0x554455),fog:new T.Color(0x596977)};
 scene.fog=new T.Fog(day.fog,48,108);
 let mode=new URLSearchParams(location.search).get('lighting')??'cycle',side='both',mix=0,last;
 const original=scene.onBeforeRender,styled=new WeakSet();
 scene.onBeforeRender=function(...args){
  original?.apply(this,args);
  // Decoded .mesh.json assets use unlit material in the pinned player. Opt this
  // game's arena into the same lighting model as the actors, after async loading.
  scene.traverse(o=>{
   if(!o.isMesh)return;
   if(o.userData.asset==='mesh://arena'&&!styled.has(o)){
    o.material=ink.paint(o.material);o.castShadow=true;o.receiveShadow=true;styled.add(o);
   }
   if(o.userData.asset?.startsWith('mesh://sky_'))o.material.color.setRGB(1-.57*mix,1-.48*mix,1-.35*mix);
  });
 };
 function update(s){
  const time=s?.rewardClock??0;
  // Two minutes from daylight through night and back; pause also freezes this cycle.
  mix=mode==='day'?0:mode==='night'?1:(1-Math.cos(time/120*Math.PI*2))*.5;
  key.color.copy(day.key).lerp(night.key,mix);key.intensity=2.1-1.2*mix;
  rim.color.copy(day.rim).lerp(night.rim,mix);rim.intensity=1.15-.2*mix;
  ambient.color.copy(day.sky).lerp(night.sky,mix);ambient.groundColor.copy(day.ground).lerp(night.ground,mix);ambient.intensity=.65-.2*mix;
  if(side==='left')rim.intensity=0;if(side==='right')key.intensity=0;
  scene.fog.color.copy(day.fog).lerp(night.fog,mix);
  const events=[...Object.values(s?.vfx??{}),...Object.values(s?.rewards??{})].filter(e=>time-e.time>=0&&time-e.time<.55).sort((a,b)=>b.time-a.time).slice(0,4);
  flashes.forEach((light,i)=>{const e=events[i];light.intensity=e?18*(1-(time-e.time)/.55):0;if(e)light.position.set(e.x,.8,e.z);});
  last={mode,side,nightMix:mix,shadowMap:2048,primaryLights:2,left:{color:'#'+key.color.getHexString(),intensity:key.intensity},right:{color:'#'+rim.color.getHexString(),intensity:rim.intensity},eventLights:events.length,litArena:true};
 }
 return {update,setMode(value){if(!['day','night','cycle'].includes(value))throw Error('Unknown lighting mode');mode=value;},setSide(value){if(!['left','right','both'].includes(value))throw Error('Unknown light side');side=value;},inspect:()=>last,dispose(){scene.onBeforeRender=original;scene.fog=null;scene.remove(key,rim,ambient,...flashes);key.shadow.dispose();ink.dispose();}};
}
