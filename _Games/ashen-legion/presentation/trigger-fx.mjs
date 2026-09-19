// Read-only Luau trigger receipts. Shares the combat renderer's fixed two batches.
export function createTriggerFX({ink,core}){
 const cyan=[.24,1.35,1.5],gold=[1.65,.9,.24],dark=[.13,.25,.32],red=[.62,.14,.15],ice=[.82,1.5,1.65],wraith=[.20,1.05,.72],wraithInk=[.035,.17,.15];
 const clamp=v=>Math.max(0,Math.min(1,v)),tau=Math.PI*2;
 function diamond(x,y,z,r,color,alpha){ink.shard(x,y,z,r,r*1.8,.3,dark,alpha);core.shard(x,y+.025,z,r*.65,r*1.4,.3,color,alpha*.8)}
 return {draw(state,{time,reduced,budget=8}={}){
  let count=0,buffs=0,ghosts=0;const kinds={};
  // Live spirits reuse the existing two GPU batches; no per-ghost meshes or material allocations.
  for(const g of Object.values(state?.wraiths??{})){
   if(count>=budget)break;
   const p=clamp(g.progress??0),x=g.x,z=g.z,dx=g.dx??0,dz=g.dz??1,nx=-dz,nz=dx,fade=reduced?.48:1;
   const tail=.36*(1-p*.35),tx=x-dx*tail,tz=z-dz*tail;
   ink.line(tx,.24,tz,x+dx*.12,.48,z+dz*.12,.13,wraithInk,fade);
   core.line(tx,.28,tz,x+dx*.12,.51,z+dz*.12,.058,wraith,fade*.86,0);
   ink.shard(x-nx*.10,.22,z-nz*.10,.14,.60,Math.atan2(dz,dx),wraithInk,fade);
   core.shard(x,.48,z,.105,.38,Math.atan2(dz,dx),wraith,fade);
   core.arc(x,z,.20,-Math.PI*.15,Math.PI*1.3,.022,ice,fade*.75,.46);
   for(const side of [-1,1])core.shard(x+nx*.075+dx*.035,.61,z+nz*.075+dz*.035,.022,.026,0,ice,fade);
   count++;ghosts++;kinds.soul_wraith=(kinds.soul_wraith??0)+1;
  }
  for(const e of Object.values(state?.events??{}).reverse()){
   const p=(time-e.time)/.65;if(p<0||p>=1||count>=budget)continue;
   const f=(1-p)**1.7,r=e.radius??1,x=e.x,z=e.z,expand=1-(1-p)**3;
   if(e.kind==='necromancer'){
    const dx=e.tx-x,dz=e.tz-z,l=Math.hypot(dx,dz)||1,heading=Math.atan2(dz,dx),angle=(e.id??0)*2.39996,tail=.45+expand*.45;
    ink.arc(x,z,.24+p*.23,angle,Math.PI*1.35,.07,wraithInk,f,.13);
    core.arc(x,z,.28+p*.27,angle,Math.PI*1.25,.025,wraith,f*.82,.16);
    ink.line(x-dx/l*tail,.20,z-dz/l*tail,x+dx/l*.12,.35,z+dz/l*.12,.10,wraithInk,f);
    core.line(x-dx/l*tail,.24,z-dz/l*tail,x+dx/l*.12,.39,z+dz/l*.12,.038,wraith,f);
    diamond(x+Math.cos(heading)*.06,.53,z+Math.sin(heading)*.06,.13,wraith,f);
   }else if(e.kind==='necromancer_burst'){
    const rr=r*(.18+.82*expand),n=reduced?5:8,angle=(e.id??0)*2.39996;
    ink.arc(x,z,rr,angle,Math.PI*1.7,.16*(1-p),wraithInk,f,.14);ink.arc(x,z,rr*.78,angle+.6,Math.PI*1.45,.07*(1-p),wraithInk,f*.8,.16);
    core.arc(x,z,rr*.91,angle,Math.PI*1.65,.036*(1-p),wraith,f,.19);core.arc(x,z,rr*.55,angle+.6,Math.PI*1.4,.023*(1-p),ice,f*.72,.22);
    for(let i=0;i<n;i++){const a=angle+i*tau/n,rad=rr*(.58+.3*((i%3)/2)),sx=x+Math.cos(a)*rad,sz=z+Math.sin(a)*rad;
     ink.shard(sx,.14,sz,.16*(1-p),.48*(1-p),a,wraithInk,f);core.shard(sx,.17,sz,.075*(1-p),.35*(1-p),a,wraith,f*.85);
    }
    diamond(x,.34,z,.17*(1-p),ice,f);core.arc(x,z,rr*.32,angle,Math.PI*1.8,.025*(1-p),gold,f*.72,.16);
   }else if(e.kind==='legacy_gift'){
    // The receipt's fixed endpoints show who received the immediate gameplay buff.
    const q=Math.min(1,p*1.65),dx=e.tx-x,dz=e.tz-z,lift=Math.sin(q*Math.PI)*1.4;
    for(let i=0;i<3;i++){const u=Math.max(0,q-i*.085),sx=x+dx*u,sz=z+dz*u,y=.7+Math.sin(u*Math.PI)*1.4;
     diamond(sx,y,sz,(i===0?.18:.10)*(1-p*.5),i===0?gold:cyan,f*(1-i*.22));
    }
    ink.arc(x,z,.25+p*.45,0,tau,.035,dark,f,.13);
    if(q>=1){core.arc(e.tx,e.tz,.3+(p-.6)*.7,0,tau,.034,gold,f,.3);diamond(e.tx,.8+lift,e.tz,.18*(1-p),gold,f);}
   }else if(e.kind==='guard_bequest'){
    const rr=r*(.15+.85*expand);
    for(let i=0;i<6;i++){const a=i*tau/6,bx=x+Math.cos(a)*rr,bz=z+Math.sin(a)*rr;
     ink.line(x,.13,z,bx,.13,bz,.065,dark,f);core.line(x,.15,z,bx,.15,bz,.023,gold,f*.8);
     ink.shard(bx,.15,bz,.23*(1-p),Math.sin(p*Math.PI)*.8,a,dark,f);
     core.shard(bx,.18,bz,.11*(1-p),Math.sin(p*Math.PI)*.6,a,ice,f*.8);
    }
    core.arc(x,z,rr,0,tau,.022,gold,f*.55,.14,false);
   }else if(e.kind==='firstborn'){
    for(let i=0;i<3;i++)core.arc(x,z,.4+expand*(.55+i*.16),i*tau/3,.85,.035,cyan,f*(reduced?.35:.7),.16);
   }else if(e.kind==='march_capacitor'||e.kind==='battle_elegy'){
    const color=e.kind==='battle_elegy'?gold:cyan;
    for(let i=0;i<3;i++){const a=i*tau/3+.3;diamond(x+Math.cos(a)*(.4+p*.4),.25+p*.65,z+Math.sin(a)*(.4+p*.4),.12*(1-p),color,f)}
   }else{
    const frost=e.kind==='last_echo',shock=e.kind==='third_pulse',color=frost?ice:shock?cyan:gold;
    const tint=frost||shock?dark:red;
    for(let i=0;i<8;i++){
     const a=i*tau/8,rr=r*(.2+.8*expand),sx=x+Math.cos(a)*rr,sz=z+Math.sin(a)*rr;
     ink.arc(x,z,rr,a,.42,.085*(1-p),tint,f*.9,.13);
     core.arc(x,z,rr,a,.4,.025,color,f*(reduced?.4:.85),.16);
     if(!reduced||i%2===0){
      const height=(frost?.9:shock?.25:1.0)*Math.sin(Math.PI*p);
      ink.shard(sx,.14,sz,.23*(1-p),height,a,tint,f);
      core.shard(sx,.16,sz,.13*(1-p),height*.8,a,color,f*.75);
     }
    }
   }
   count++;kinds[e.kind]=(kinds[e.kind]??0)+1;
  }
  for(const b of Object.values(state?.buffs??{}).slice(0,12)){
   if(b.kind==='firstborn')continue; // Its silhouette is the pooled flowing wake.
   if(b.kind==='legacy_gift'){
    for(let i=0;i<Math.min(3,b.stacks);i++){const a=-Math.PI/2+(i-1)*.58;diamond(b.x+Math.cos(a)*.32,1.05,b.z+Math.sin(a)*.32,.075,gold,.85);}
   }else if(b.kind==='march_capacitor')for(let i=0;i<b.stacks;i++)diamond(b.x+(i-(b.stacks-1)/2)*.2,.95,b.z,.07,cyan,.65);
   else if(b.kind==='battle_elegy'){
    ink.arc(b.x,b.z,.48,0,tau,.025,dark,.65,.13,false);
    core.arc(b.x,b.z,.48,-Math.PI/2,tau*clamp(b.remaining/2),.018,gold,.6,.15,false);
   }
   buffs++;
  }
  return {events:count,buffs,ghosts,kinds};
 }};
}
