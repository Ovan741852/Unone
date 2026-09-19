// Read-only delayed-skill telegraphs and receipts, drawn in the existing two pools.
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x));
const C={ink:[.17,.04,.06],red:[.8,.12,.09],gold:[1.75,.75,.19],white:[2.0,1.65,.95],navy:[.055,.16,.25],cyan:[.28,1.1,1.45],ice:[1.35,1.8,2.1],violet:[.68,.3,1.1]};
export function createResonanceFX({ink,core}){
 function line(ax,az,bx,bz,w,c,a,y=.2){ink.line(ax,y,az,bx,y,bz,w*2,C.navy,a);core.line(ax,y+.02,az,bx,y+.02,bz,w,c,a)}
 function bolt(x,z,tx,tz,id,fade){const dx=tx-x,dz=tz-z,len=Math.hypot(dx,dz)||1;let ax=x,az=z;
  for(let i=1;i<=7;i++){const q=i/7,side=i===7?0:Math.sin(i*9.7+id)*.22,bx=x+dx*q-dz/len*side,bz=z+dz*q+dx/len*side;
   line(ax,az,bx,bz,.055,C.cyan,fade,.65);core.line(ax,.68,az,bx,.68,bz,.018,C.ice,fade);ax=bx;az=bz;}}
 function ring(j,r,a,color,alpha){ink.arc(j.x,j.z,r,a,TAU*.88,.045,C.ink,alpha,.13);core.arc(j.x,j.z,r,a,TAU*.88,.019,color,alpha,.15)}
 function seal(j){const p=clamp(j.progress),c=j.kind==='chain_fuse'?C.red:C.gold;
  // Ground outline is the actual damage radius. The inner broken ring is the clock.
  for(let i=0;i<4;i++)core.arc(j.x,j.z,j.radius,i*TAU/4,.42,.013,c,.3,.12);
  ring(j,.34+(1-p)*.3,-Math.PI/2,c,.8);
  core.arc(j.x,j.z,.38,-Math.PI/2,Math.max(.02,TAU*p),.034,C.white,.7,.18,false);
  const y=.8+p*.25;ink.shard(j.x,y,j.z,.14,.34,0,C.ink,.95);core.shard(j.x,y+.025,j.z,.085,.27,0,c,.9);
  if(j.linked)line(j.x-.2,j.z,j.x+.2,j.z,.025,C.white,.9,y);
 }
 function blade(g,alpha=1){const dx=g.dx??1,dz=g.dz??0,x=g.x,z=g.z;
  for(let i=2;i>=0;i--){const q=i*.32;line(x-dx*(.75+q),z-dz*(.75+q),x+dx*(.45-q),z+dz*(.45-q),.09-i*.02,C.cyan,alpha*(i===0?.8:.22),.5);}
  line(x-dx*.45-dz*.28,z-dz*.45+dx*.28,x-dx*.45+dz*.28,z-dz*.45-dx*.28,.035,C.white,alpha,.51);
 }
 return {draw(state,{time=0,reduced=false,eventBudget=6,markerBudget=24}={}){
  let events=0,markers=0,ghosts=0;const kinds={};const power=reduced?.55:1;
  const jobs=Object.values(state?.jobs??{}).sort((a,b)=>a.remaining-b.remaining||a.id-b.id);
  for(const j of jobs.slice(0,markerBudget)){markers++;const p=clamp(j.progress);
   if(j.kind==='cinder_seal'||j.kind==='chain_fuse')seal(j);
   else if(j.kind==='thunder_fan'){
    const a=Math.atan2(j.dz,j.dx),half=(j.angle??Math.PI*100/180)/2,r=j.range??4.8;
    core.arc(j.x,j.z,r,a-half,half*2,.022,C.cyan,.45,.13,false);
    for(let i=0;i<5;i++){const th=a+(i-2)*half*2/5,rr=r*(.2+.8*p);line(j.x,j.z,j.x+Math.cos(th)*rr,j.z+Math.sin(th)*rr,.012,C.cyan,.35,.14);}
   }else if(j.kind==='echo_blade'){
    line(j.ax,j.az,j.bx,j.bz,j.radius,C.violet,.11,.12);
    line(j.ax,j.az,j.bx,j.bz,.018,C.ice,.35+p*.4,.15);
    const x=j.ax+(j.bx-j.ax)*p,z=j.az+(j.bz-j.az)*p;core.shard(x,.18,z,.08,.5,.3,C.ice,.65);
   }else if(j.kind==='starfall'){
    ring(j,j.radius,0,C.gold,.55);const height=(1-p)*6;
    ink.shard(j.x-.65*(1-p),.2+height,j.z,.23,.48,0,C.red,.85);
    core.shard(j.x-.65*(1-p),.24+height,j.z,.13,.4,0,C.white,.85*power);
    core.line(j.x-.65*(1-p),.3+height,j.z,j.x-.65*(1-p)-.3,1.9+height,j.z,.09,C.gold,.5*power,0);
   }
  }
  for(const g of Object.values(state?.ghosts??{}).slice(0,16)){blade(g,.8);ghosts++;}
  for(const e of Object.values(state?.events??{}).reverse()){
   const age=time-e.time,life=e.kind==='fuse_link'?.2:.6,p=clamp(age/life);if(age<0||p>=1||events>=eventBudget)continue;
   events++;kinds[e.kind]=(kinds[e.kind]??0)+1;const fade=(1-p)**1.4*power;
   if(e.kind==='fuse_link'){const q=Math.min(1,p*1.6);line(e.x,e.z,e.tx,e.tz,.014,C.red,fade,.8);core.shard(e.x+(e.tx-e.x)*q,.82,e.z+(e.tz-e.z)*q,.09,.2,0,C.white,fade);}
   else if(e.kind==='thunder_fan')for(const r of Object.values(e.rays??{}))bolt(r.x,r.z,r.tx,r.tz,e.id,fade*(r.hit?1:.65));
   else if(e.kind==='echo_blade'){
    line(e.ax,e.az,e.bx,e.bz,e.radius*(1-p),C.violet,fade*.7,.25);
    line(e.ax,e.az,e.bx,e.bz,.08*(1-p),C.ice,fade,.28);
    for(let i=0;i<3;i++){const q=(i+.5)/3,x=e.ax+(e.bx-e.ax)*q,z=e.az+(e.bz-e.az)*q;core.shard(x,.3,z,.12*(1-p),1.1*Math.sin(p*Math.PI),0,C.ice,fade*.65);}
   }else if(e.kind==='soul_spawn'||e.kind==='soul_end')ring(e,.3+p*.4,0,C.cyan,fade*.65);
   else{
    const expand=1-(1-p)**3,r=e.radius*(.12+.88*expand),color=e.kind==='chain_fuse'?C.red:C.gold;
    ring(e,r,e.id*.7,color,fade);
    // Petal blades open from the mark; the peak occupies its true hit footprint.
    for(let i=0;i<(reduced?4:8);i++){const a=i*TAU/(reduced?4:8)+e.id*.3,x=e.x+Math.cos(a)*r*.65,z=e.z+Math.sin(a)*r*.65,h=Math.sin(Math.PI*p)*1.2;
     ink.shard(x,.15,z,.32*(1-p),h,a,C.ink,fade);core.shard(x,.17,z,.18*(1-p),h*.85,a,color,fade);core.shard(x,.23+h,z,.035,.09,a,C.white,fade*.8);}
    core.shard(e.x,.16,e.z,.18*(1-p),1.2*(1-p),0,C.white,Math.max(0,1-p*4)*power);
   }
  }
  return {events,markers,ghosts,kinds,skippedMarkers:Math.max(0,jobs.length-markerBudget)};
 }};
}
