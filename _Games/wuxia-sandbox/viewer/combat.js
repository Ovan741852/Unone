// Presentation of Luau evidence only: no hits, damage or intentions are decided here.
export function freshCombatEvents(feed,lastId){
 const events=Array.isArray(feed?.events)?feed.events:[];
 return events.filter(e=>e.id>lastId&&feed.clock-e.time<2);
}
export class CombatView {
 constructor(context,layer){
  this.context=context;this.layer=layer;this.lastId=0;this.clock=0;this.effects=[];this.lastTime=null;
  const T=context.THREE;
  this.arc=new T.RingGeometry(.95,1.15,24,1,0,Math.PI*1.1);
  this.ring=new T.RingGeometry(.18,.26,16);
  this.sword=new T.BoxGeometry(1.7,.08,.18);
 }
 ingest(feed){
  if(!feed)return;
  if(feed.clock<this.clock){this.clear();this.lastId=0;}
  this.clock=feed.clock;
  for(const e of freshCombatEvents(feed,this.lastId)){
   const T=this.context.THREE,group=new T.Group(),text=document.createElement('span');
   text.className='combat-float '+e.kind;const flying=e.weapon==='flying_sword';text.textContent=e.kind==='miss'?'MISS':e.kind==='hit'?(flying?'飛劍命中 −':'−')+e.damage:e.kind==='critical'?(flying?'飛劍重擊 −':'重擊 −')+e.damage:e.kind==='swing'&&flying?'飛劍':e.kind==='finish'?e.text:'';
   this.layer.append(text);
   const material=new T.MeshBasicMaterial({color:flying?0x8fd3ff:e.mode==='duel'?0xffd580:0xff9d78,transparent:true,depthWrite:false,side:T.DoubleSide});
   if(e.kind==='swing'){
    const mesh=new T.Mesh(this.arc,material);mesh.rotation.x=-Math.PI/2;group.add(mesh);group.position.set(e.from.x,1.1,e.from.z);
    if(flying){const sword=new T.Mesh(this.sword,material);sword.rotation.y=Math.atan2(e.to.x-e.from.x,e.to.z-e.from.z);sword.position.set(0,1.45,0);group.add(sword);}
   }else if(e.kind==='hit'||e.kind==='critical'){
    for(let i=0;i<6;i++){const mesh=new T.Mesh(this.ring,material);mesh.position.set(Math.cos(i*Math.PI/3)*.5,Math.sin(i*Math.PI/3)*.5,0);group.add(mesh);}
    group.position.set(e.to.x,1.3,e.to.z);
   }
   this.context.scene.add(group);this.effects.push({e,group,material,text,age:Math.max(0,feed.clock-e.time)});
  }
  this.lastId=feed.sequence||this.lastId;
  while(this.effects.length>24)this.remove(this.effects.shift());
 }
 remove(fx){this.context.scene.remove(fx.group);fx.material.dispose();fx.text.remove();}
 clear(){for(const fx of this.effects)this.remove(fx);this.effects=[];}
 draw(now,project,paused,speed,reduced,entities){
  const dt=this.lastTime===null?0:Math.min(.1,(now-this.lastTime)/1000);this.lastTime=now;
  for(let i=this.effects.length-1;i>=0;i--){
   const fx=this.effects[i],e=fx.e;fx.age+=paused?0:dt*speed;
   const duration=e.kind==='finish'?2:e.kind==='swing'?.4:1.1;
   if(fx.age>duration){this.remove(fx);this.effects.splice(i,1);continue;}
   const t=fx.age/duration,where=e.kind==='swing'?e.from:e.to;
   const p=project(where.x,2.4+(reduced?0:t*1.5),where.z);
   fx.text.hidden=p.z>1||p.z< -1;fx.text.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
   fx.text.style.opacity=String(Math.min(1,(1-t)*3));
   fx.group.visible=!reduced;fx.material.opacity=Math.max(0,1-t);
   if(e.kind==='swing'){
    fx.group.rotation.y=Math.atan2(e.to.x-e.from.x,e.to.z-e.from.z)-1.1+t*2;
   }else{fx.group.quaternion.copy(this.context.camera3d.quaternion);fx.group.scale.setScalar(1+t*2);}
   // Transform offset is visual only; authoritative grid cells stay unchanged.
   if(!reduced&&fx.age<.28&&['swing','hit','critical'].includes(e.kind)){
    const id=e.kind==='swing'?e.actor_id:e.target_id,entity=entities[id];
    if(entity){const dx=e.to.x-e.from.x,dz=e.to.z-e.from.z,length=Math.hypot(dx,dz)||1;
     const offset=Math.sin(fx.age/.28*Math.PI)*.2;
     entity.transform3d={...entity.transform3d,position:{...entity.transform3d.position,x:entity.transform3d.position.x+dx/length*offset,z:entity.transform3d.position.z+dz/length*offset}};
    }
   }
  }
 }
}
