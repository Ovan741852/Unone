import * as T from 'three';
export function createSoldier(){
 // Authoring coordinates are kept in the original T-pose; this shared warp
 // maps both meshes and bind joints into the same chibi proportions.
 const chibiPoint=(v,head=false)=>{
  const ax=Math.abs(v.x);
  v.x=head?v.x*1.8:Math.sign(v.x)*(ax<=.24?ax*1.3:.312+(ax-.24)*.63);
  v.y=v.y<=1.6?v.y*.60:.96+(v.y-1.6)*1.7;
  v.z*=head?1.65:1.25;
  return v;
 };
 const root=new T.Group();root.name='AshenSoldier';const bones=[],map={},rest={};
 function bone(name,parent,p){const b=new T.Bone();b.name='mixamorig'+name;b.position.set(...p);(parent?map[parent]:root).add(b);map[name]=b;bones.push(b);return b;}
 bone('Hips',null,[0,1,0]);bone('Spine','Hips',[0,.14,0]);bone('Spine1','Spine',[0,.15,0]);bone('Spine2','Spine1',[0,.15,0]);bone('Neck','Spine2',[0,.16,0]);bone('Head','Neck',[0,.12,0]);bone('HeadTop_End','Head',[0,.22,0]);
 for(const [s,d] of [['Left',1],['Right',-1]]){bone(s+'Shoulder','Spine2',[d*.12,.055,0]);bone(s+'Arm',s+'Shoulder',[d*.12,0,0]);bone(s+'ForeArm',s+'Arm',[d*.28,0,0]);bone(s+'Hand',s+'ForeArm',[d*.26,0,0]);
 for(const [i,f] of ['Thumb','Index','Middle','Ring','Pinky'].entries()){let parent=s+'Hand';for(let j=1;j<=3;j++){bone(s+'Hand'+f+j,parent,j===1?[d*.065,-.01,(i-2)*.021]:[d*.026,0,0]);parent=s+'Hand'+f+j;}}
 bone(s+'UpLeg','Hips',[d*.105,-.06,0]);bone(s+'Leg',s+'UpLeg',[0,-.43,.015]);bone(s+'Foot',s+'Leg',[0,-.40,-.015]);bone(s+'ToeBase',s+'Foot',[0,-.035,.14]);bone(s+'Toe_End',s+'ToeBase',[0,0,.075]);}
 root.updateMatrixWorld(true);const skeleton=new T.Skeleton(bones);for(const b of bones)rest[b.name]=b.position.clone();const body=new T.Group();body.name='Body';root.add(body);const slots={};
 const mats={skin:new T.MeshStandardMaterial({color:0xbca492,roughness:.85,flatShading:true}),cloth:new T.MeshStandardMaterial({color:0x303641,roughness:.9,flatShading:true}),iron:new T.MeshStandardMaterial({color:0x465b65,metalness:.75,roughness:.35,flatShading:true}),gold:new T.MeshStandardMaterial({color:0xc69a4e,metalness:.7,roughness:.3,flatShading:true}),red:new T.MeshStandardMaterial({color:0x873845,roughness:.8,flatShading:true}),obsidian:new T.MeshStandardMaterial({color:0x18252d,metalness:.65,roughness:.3,flatShading:true}),glow:new T.MeshStandardMaterial({color:0x6cffe1,emissive:0x26be9e,emissiveIntensity:2})};
 function skin(g,material,parent,weights){const ids=[],ws=[];for(let i=0;i<g.attributes.position.count;i++){const v=new T.Vector3().fromBufferAttribute(g.attributes.position,i);const pairs=weights(v);for(let j=0;j<4;j++){ids.push(pairs[j]?bones.indexOf(map[pairs[j][0]]):0);ws.push(pairs[j]?.[1]??0);}}for(let i=0;i<g.attributes.position.count;i++){const v=new T.Vector3().fromBufferAttribute(g.attributes.position,i);const pairs=weights(v);chibiPoint(v,pairs.some(([n,w])=>n==='Head'&&w>.5));g.attributes.position.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();g.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(ws,4));const mesh=new T.SkinnedMesh(g,material);mesh.name=parent.name+'_part';mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);mesh.bind(skeleton,new T.Matrix4());return mesh;}
 const solid=n=>()=>[[n,1]];function box(parent,n,size,pos,mat){const g=new T.BoxGeometry(...size);g.translate(...pos);return skin(g,mat,parent,solid(n));}
 function limb(parent,a,b,r1,r2,mat){const start=map[a].getWorldPosition(new T.Vector3()),end=map[b].getWorldPosition(new T.Vector3()),axis=end.clone().sub(start),len=axis.length(),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.clone().normalize());const g=new T.CylinderGeometry(r2,r1,len,6,6);g.applyQuaternion(q);g.translate(...start.clone().add(end).multiplyScalar(.5).toArray());skin(g,mat,parent,v=>{const t=T.MathUtils.clamp(v.clone().sub(start).dot(axis)/(len*len),0,1);const w=T.MathUtils.smoothstep(t,.65,1)*.5;return [[a,1-w],[b,w]];});}
 const torso=new T.CylinderGeometry(.235,.15,.46,8,8);torso.scale(1,1,.66);torso.translate(0,1.235,0);skin(torso,mats.skin,body,v=>{const t=T.MathUtils.clamp((v.y-1.02)/.42,0,1);return [['Hips',Math.max(0,1-t*2)],['Spine1',1-Math.abs(t*2-1)],['Spine2',Math.max(0,t*2-1)]]});
 box(body,'Hips',[.29,.17,.20],[0,.985,0],mats.cloth);const head=new T.IcosahedronGeometry(.142,1);head.scale(.83,1.25,.86);head.translate(0,1.785,0);skin(head,mats.skin,body,solid('Head'));limb(body,'Spine2','Neck',.12,.063,mats.skin);limb(body,'Neck','Head',.063,.062,mats.skin);
 for(const [s,d] of [['Left',1],['Right',-1]]){limb(body,s+'Arm',s+'ForeArm',.083,.065,mats.skin);limb(body,s+'ForeArm',s+'Hand',.065,.045,mats.skin);box(body,s+'Hand',[.14,.067,.085],[d*.84,1.495,.01],mats.skin);limb(body,s+'UpLeg',s+'Leg',.103,.075,mats.cloth);limb(body,s+'Leg',s+'Foot',.077,.05,mats.skin);box(body,s+'Foot',[.12,.105,.225],[d*.105,.07,.06],mats.skin);}
 function equip(slot,type){if(slots[slot]){const old=slots[slot];root.remove(old);old.traverse(o=>o.geometry?.dispose());}const group=new T.Group();group.name='Equipment_'+slot;root.add(group);slots[slot]=group;if(type==='none')return;const royal=type==='royal',mat=royal?mats.obsidian:mats.iron,trim=royal?mats.gold:mats.red;
 if(slot==='head'){const g=new T.IcosahedronGeometry(.157,1);g.scale(1,1.1,1);g.translate(0,1.82,-.015);skin(g,mat,group,solid('Head'));box(group,'Head',[.26,.032,.06],[0,1.785,.132],mats.gold);box(group,'Head',[.17,.012,.025],[0,1.772,.165],mats.glow);for(const d of [-1,1])box(group,'Head',[.045,.16,.11],[d*.123,1.735,.035],mat);if(royal)box(group,'Head',[.035,.15,.23],[0,1.998,-.035],mats.red);}
 if(slot==='body'){const chest=new T.CylinderGeometry(.258,.205,.30,8);chest.scale(1,1,.72);chest.translate(0,1.35,0);skin(chest,mat,group,solid('Spine2'));box(group,'Spine1',[.39,.16,.28],[0,1.17,0],mat);box(group,'Hips',[.34,.06,.24],[0,1.035,0],mats.gold);box(group,'Spine2',[.055,.18,.02],[0,1.38,.184],mats.gold);for(const d of [-1,1]){box(group,d===1?'LeftArm':'RightArm',[.18,.14,.24],[d*.285,1.50,0],trim);box(group,'Hips',[.13,.20,.27],[d*.125,.91,0],trim);}}
 if(slot==='hands')for(const [s,d] of [['Left',1],['Right',-1]]){box(group,s+'ForeArm',[.16,.145,.145],[d*.65,1.495,0],mat);box(group,s+'Hand',[.14,.10,.11],[d*.84,1.495,.01],mat);box(group,s+'ForeArm',[.035,.155,.155],[d*.72,1.495,0],trim);}
 if(slot==='feet')for(const [s,d] of [['Left',1],['Right',-1]]){box(group,s+'Leg',[.15,.25,.15],[d*.105,.25,.005],mat);box(group,s+'Foot',[.16,.12,.26],[d*.105,.075,.07],mat);box(group,s+'Leg',[.16,.055,.16],[d*.105,.41,.015],trim);}
 if(slot==='weapon'){// Blade points forward in T-pose, then follows the hand bone through every animation.
 box(group,'RightHand',[.045,.045,.22],[-.84,1.495,.02],mats.red);box(group,'RightHand',[.25,.045,.035],[-.84,1.495,.14],mats.gold);const length=type==='spear'?1.22:.66;box(group,'RightHand',[type==='spear'?.04:.085,.028,length],[-.84,1.495,.16+length/2],type==='spear'?mats.gold:mats.iron);const tip=new T.ConeGeometry(.072,.22,4);tip.rotateX(Math.PI/2);tip.translate(-.84,1.495,.25+length);skin(tip,mats.gold,group,solid('RightHand'));if(type==='royal')box(group,'RightHand',[.022,.035,.59],[-.84,1.495,.49],mats.glow);}
 }
 for(const s of ['head','body','feet','hands','weapon'])equip(s,'royal');const targetWorld=new Map(bones.map(b=>[b,chibiPoint(b.getWorldPosition(new T.Vector3()),/Head/.test(b.name))]));for(const b of bones){b.position.copy(targetWorld.get(b));if(b.parent.isBone)b.position.sub(targetWorld.get(b.parent));rest[b.name]=b.position.clone();}root.updateMatrixWorld(true);skeleton.calculateInverses();return {root,bones,map,skeleton,body,slots,equip,mats,rest};
}
// Shared semantic clip IDs; presentation only, gameplay state remains in Luau.
export const motionSpecs={
 idle:{label:'站立',duration:2,loop:true},
 walk:{label:'移動',duration:1.4,loop:true},
 stretch:{label:'伸懶腰',duration:3.6,loop:false},
 attack:{label:'攻擊',duration:1.2,loop:false},
 death:{label:'死亡',duration:1.7,loop:false},
 spawn:{label:'出生',duration:1.8,loop:false},
 run:{label:'奔跑',duration:.85,loop:true},
 tpose:{label:'T-pose',duration:2,loop:true}
};
export function makeClips(rig){
 return Object.fromEntries(Object.entries(motionSpecs).map(([name,spec])=>{
  const {duration}=spec,tracks=[],count=Math.ceil(duration*30)+1,times=Array.from({length:count},(_,i)=>i/(count-1)*duration);
  const ease=(t,a,b)=>T.MathUtils.smoothstep(t,a,b);
  for(const [key,b]of Object.entries(rig.map)){
   const values=[];
   for(let i=0;i<count;i++){
    const t=i/(count-1),wave=Math.sin(t*Math.PI*2),side=key.startsWith('Left')?1:-1;
    let x=0,y=0,z=0;
    if(/(Left|Right)Arm$/.test(key))z=-side*1.30;
    if(name==='walk'||name==='run'){
     const a=name==='run'?1:.55;
     if(/UpLeg$/.test(key))x=wave*side*a;
     if(/(?<!Up)Leg$/.test(key))x=Math.max(0,-wave*side)*a*1.3;
     if(/(Left|Right)Arm$/.test(key))x=-wave*side*a;
     if(/ForeArm$/.test(key))y=-side*(name==='run'?1:.22);
     if(key==='Spine')x=.08;
    }
    if(name==='idle'){
     if(key==='Spine1')x=wave*.025;
     if(/ForeArm$/.test(key))y=-side*.16;
    }
    if(name==='stretch'){
     const lift=ease(t,0,.36)*(1-ease(t,.68,1));
     if(/(Left|Right)Arm$/.test(key))z=side*(-1.3+2.65*lift);
     if(/ForeArm$/.test(key))y=-side*.35*lift;
     if(key==='Spine1')x=-.18*lift;
     if(key==='Head')x=-.15*lift;
    }
    if(name==='attack'){
     const hit=ease(t,0,.30)*(1-ease(t,.48,1));
     if(key==='RightArm'){x=-hit*1.9;z=1.3-hit*.7;}
     if(key==='RightForeArm')y=hit*.9;
     if(key==='Spine1')y=-hit*.5;
    }
    if(name==='death'){
     const fall=ease(t,.18,.9);
     if(key==='Hips')x=fall*Math.PI/2;
     if(/(Left|Right)Arm$/.test(key)){z=-side*(1.3-.55*fall);x=-Math.sin(fall*Math.PI)*.6;}
     if(key==='Head')x=.14*fall;
    }
    if(name==='spawn'){
     const crouch=1-ease(t,.12,.86);
     if(/UpLeg$/.test(key))x=-.85*crouch;
     if(/(?<!Up)Leg$/.test(key))x=1.6*crouch;
     if(/Foot$/.test(key))x=-.75*crouch;
     if(key==='Spine1')x=.25*crouch;
     if(/(Left|Right)Arm$/.test(key))x=-.6*crouch;
     if(key==='Head')x=.2*crouch;
    }
    if(name==='tpose')x=y=z=0;
    values.push(...new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).toArray());
   }
   tracks.push(new T.QuaternionKeyframeTrack(b.name+'.quaternion',times,values));
  }
  const positions=times.flatMap(time=>{
   const t=time/duration;
   const hip=rig.rest.mixamorigHips.y;const height=name==='death'?hip-(hip-.23)*ease(t,.18,.9):name==='spawn'?hip-.28*hip*(1-ease(t,.12,.86)):hip;
   return [0,height,0];
  });
  tracks.push(new T.VectorKeyframeTrack('mixamorigHips.position',times,positions));
  return [name,new T.AnimationClip(name,duration,tracks)];
 }));
}
