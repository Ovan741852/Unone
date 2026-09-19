import * as T from 'three';
// Draw already-authorized visual events; this never queries collisions or changes damage.
export function createCombatFX(scene){
 const geometry=new T.BufferGeometry(),material=new T.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.85,side:T.DoubleSide,depthWrite:false});
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 function update(s){const vertices=[],colors=[];
  const line=(x,z,tx,tz,width,color,y=.18)=>{const length=Math.hypot(tx-x,tz-z)||1,dx=-(tz-z)/length*width,dz=(tx-x)/length*width;
   vertices.push(x+dx,y,z+dz,x-dx,y,z-dz,tx+dx,y,tz+dz,tx+dx,y,tz+dz,x-dx,y,z-dz,tx-dx,y,tz-dz);for(let i=0;i<6;i++)colors.push(...color);
  };
  for(const e of Object.values(s?.vfx??{})){const age=s.rewardClock-e.time;if(age<0||age>.32)continue;
   const color=({lightning:[1.3,1.5,1.8],frost:[.3,1.1,1.5],ember:[1.8,.65,.15],leaf:[.4,1.3,.55],cleave:[1.5,1.2,.4],shock:[.3,1.1,.8]})[e.kind]??[1.1,1,.5];
   const width=.065*(1-age/.32);
   if(e.kind==='lightning'){
    let x=e.x,z=e.z;for(let i=1;i<=4;i++){const p=i/4,wiggle=i<4?Math.sin(e.id+i*2.4)*.23:0,tx=e.x+(e.tx-e.x)*p+wiggle,tz=e.z+(e.tz-e.z)*p-wiggle;line(x,z,tx,tz,width,color,.7);x=tx;z=tz;}
   }else{const radius=e.radius*(.3+age*2);for(let i=0;i<12;i++){const a=i/12*Math.PI*2,b=(i+1)/12*Math.PI*2;line(e.x+Math.cos(a)*radius,e.z+Math.sin(a)*radius,e.x+Math.cos(b)*radius,e.z+Math.sin(b)*radius,width,color);}}
  }
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));mesh.visible=vertices.length>0;
 }
 return {update,dispose(){scene.remove(mesh);geometry.dispose();material.dispose()}};
}
