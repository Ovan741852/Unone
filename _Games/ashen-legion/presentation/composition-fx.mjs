// Read-only trigger/payload telegraphs. Shared ink/core pools; no gameplay decisions.
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x));
const P={ink:[.16,.055,.1],gold:[1.7,.9,.25],cream:[2.2,1.7,.8],red:[.8,.17,.09],blue:[.09,.23,.32],cyan:[.25,1.1,1.5],ice:[1.4,1.9,2.1],violet:[.7,.44,1.2],leaf:[.6,1.1,.58]};
export function createCompositionFX({ink,core}){
 function sigil(x,z,r,alpha,color=P.gold,y=.17){
  for(let i=0;i<6;i++){const a=i*TAU/6,b=(i+1)*TAU/6;
   ink.line(x+Math.cos(a)*r,y,z+Math.sin(a)*r,x+Math.cos(b)*r,y,z+Math.sin(b)*r,.046,P.ink,alpha);
   core.line(x+Math.cos(a)*r,y+.02,z+Math.sin(a)*r,x+Math.cos(b)*r,y+.02,z+Math.sin(b)*r,.015,color,alpha*.8);}}
 function spark(x,y,z,r,color,a){ink.shard(x,y,z,r,r*1.8,.4,P.ink,a);core.shard(x,y+.02,z,r*.6,r*1.65,.4,color,a)}
 function orb(x,y,z,p,color,fade){
  const r=.23*(1+.12*Math.sin(p*Math.PI*6)),h=r*1.15;
  // A solid faceted body remains legible without Bloom; only its upper facets glow.
  for(let i=0;i<6;i++){const a=i*TAU/6+p,b=(i+1)*TAU/6+p,ax=x+Math.cos(a)*r,az=z+Math.sin(a)*r,bx=x+Math.cos(b)*r,bz=z+Math.sin(b)*r;
   ink.tri(x,y+h,z,ax,y,az,bx,y,bz,i%2?color:P.cream,.8*fade);
   ink.tri(x,y-h,z,bx,y,bz,ax,y,az,i%2?P.blue:P.ink,.85*fade);
   core.tri(x,y+h+.015,z,ax,y+.015,az,bx,y+.015,bz,color,.35*fade);
  }
 }
 function bolt(x,z,tx,tz,id,fade){const dx=tx-x,dz=tz-z,len=Math.hypot(dx,dz)||1;let ax=x,az=z;
  for(let i=1;i<=5;i++){const q=i/5,w=i===5?0:Math.sin(id+i*4.7)*.16,bx=x+dx*q-dz/len*w,bz=z+dz*q+dx/len*w;
   ink.line(ax,.5,az,bx,.5,bz,.065,P.blue,fade);core.line(ax,.53,az,bx,.53,bz,.025,P.ice,fade);ax=bx;az=bz;}}
 return {draw(state,{time=0,reduced=false,eventBudget=6}={}){
  let nodes=0,marks=0,wells=0,buffs=0,events=0;const kinds={},power=reduced?.5:1;
  const nodeList=Object.values(state?.nodes??{});
  for(const n of nodeList.slice(0,40)){
   nodes++;const c=n.element==='lightning'?P.cyan:P.gold,fade=clamp(n.remaining*6);
   if(n.kind==='contact_mine'){
    sigil(n.x,n.z,.35,fade,n.armed?c:P.red);core.arc(n.x,n.z,n.triggerRadius??.9,0,TAU,.011,c,(n.armed?.35:.15)*fade,.12,false);
    for(let i=0;i<3;i++){const a=i*TAU/3;ink.shard(n.x+Math.cos(a)*.2,.15,n.z+Math.sin(a)*.2,.13,.21,a,P.ink,.9*fade);core.shard(n.x+Math.cos(a)*.2,.17,n.z+Math.sin(a)*.2,.08,.16,a,c,.75*fade);}
    spark(n.x,.22,n.z,n.armed?.1:.06,n.armed?P.cream:P.red,.8*fade*power);
   }else{
    const p=clamp(n.progress),height=.65+Math.sin(p*Math.PI)*.2;
    sigil(n.x,n.z,.36,.6*fade,c);core.arc(n.x,n.z,n.radius,0,TAU,.014,c,.18*fade,.12,false);
    core.arc(n.x,n.z,.52,-Math.PI/2,Math.max(.02,p*TAU),.032,c,.85*fade,.16,false);
    orb(n.x,height,n.z,p,c,fade*power);
    for(let i=0;i<3;i++){const a=i*TAU/3+p*2;core.shard(n.x+Math.cos(a)*(.45-p*.3),height+.15,n.z+Math.sin(a)*(.45-p*.3),.038,.09,a,P.cream,.7*fade);}
   }
  }
  // Farther nodes keep a low-cost visible silhouette; the first 40 carry detailed clocks.
  for(const n of nodeList.slice(40,128)){nodes++;spark(n.x,n.kind==='step_orb'?.65:.2,n.z,.085,n.element==='lightning'?P.cyan:P.gold,.65*clamp(n.remaining*6));}
  for(const m of Object.values(state?.marks??{}).slice(0,12)){
   marks++;for(let i=0;i<5;i++){const a=-Math.PI/2+i*TAU/5,filled=i<m.hits,x=m.x+Math.cos(a)*.38,z=m.z+Math.sin(a)*.38;
    spark(x,1.05,z,filled?.083:.044,filled?P.cream:P.violet,filled?.9:.35);}
  }
  for(const w of Object.values(state?.wells??{}).slice(0,6)){
   wells++;const p=w.progress,alpha=(w.active?.7:.35)*power;
   for(let i=0;i<3;i++){
    const a=i*TAU/3+p*3,rr=w.radius*(w.active?1-((p*2+i/3)%1)*.85:1-p*.5);
    ink.arc(w.x,w.z,rr,a,1.1,.055,P.ink,alpha,.13);core.arc(w.x,w.z,rr,a,1.1,.021,P.violet,alpha,.15);
    spark(w.x+Math.cos(a)*rr,.2,w.z+Math.sin(a)*rr,.055,P.ice,alpha);
   }
   sigil(w.x,w.z,.48,alpha,P.violet);core.arc(w.x,w.z,w.radius,0,TAU,.012,P.violet,.2,.12,false);
  }
  for(const b of Object.values(state?.buffs??{}).slice(0,16)){
   buffs++;const f=clamp(b.remaining*3);core.arc(b.x,b.z,.46,-Math.PI/2,TAU*clamp(b.remaining/2.5),.018,P.leaf,.6*f,.15,false);
   spark(b.x,.85,b.z,.065,P.gold,f*.8);
  }
  for(const e of Object.values(state?.events??{}).reverse()){
   const age=time-e.time,p=age/.65;if(p<0||p>=1||events>=eventBudget)continue;events++;kinds[e.kind]=(kinds[e.kind]??0)+1;
   const fade=(1-p)**1.6*power;
   if(e.kind==='comrade_oath'){
    for(let i=0;i<2;i++){const a=i*Math.PI+p;core.arc(e.x,e.z,.3+p*.8,a,1.7,.037,P.leaf,fade,.3+p*.7);spark(e.x+Math.cos(a)*.3,.5+p,e.z+Math.sin(a)*.3,.11*(1-p),P.cream,fade);}
   }else{
    const r=e.radius*(.15+.85*(1-(1-p)**3)),lightning=e.element==='lightning',c=lightning?P.cyan:e.kind==='contact_mine'?P.red:P.gold;
    sigil(e.x,e.z,r,fade,c);
    for(let i=0;i<(reduced?4:8);i++){const a=i*TAU/(reduced?4:8),x=e.x+Math.cos(a)*r*.65,z=e.z+Math.sin(a)*r*.65,h=Math.sin(p*Math.PI)*(e.power===2?1.65:1.15);
     ink.shard(x,.15,z,.27*(1-p),h,a,P.ink,fade);core.shard(x,.18,z,.15*(1-p),h*.86,a,c,fade);spark(x,.3+h,z,.035,P.cream,fade);
     if(lightning&&i%2===0)bolt(e.x,e.z,x,z,e.id+i,fade*.7);
    }
    core.shard(e.x,.2,e.z,.2*(1-p),1.4*(1-p),0,P.cream,Math.max(0,1-p*5)*power);
   }
  }
  return {nodes,marks,wells,buffs,events,kinds};
 }};
}
