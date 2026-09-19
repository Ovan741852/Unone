// Read-only view of Luau surface capsules, status attachments and reaction receipts.
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x));
const P={coal:[.14,.035,.025],red:[.60,.10,.025],fire:[1.65,.63,.10],core:[2.2,1.4,.55],oil:[.035,.042,.065],sheen:[.28,.17,.37],water:[.055,.28,.36],cyan:[.18,.85,1.1],ice:[1.2,1.7,1.85]};
export function createElementFX({ink,core}){
 function polygon(f,color,alpha){for(let i=0;i<8;i++){const a=i*TAU/8,b=(i+1)*TAU/8;
  ink.tri(f.x,.085,f.z,f.x+Math.cos(a)*f.radius,.085,f.z+Math.sin(a)*f.radius,f.x+Math.cos(b)*f.radius,.085,f.z+Math.sin(b)*f.radius,color,alpha);}}
 function spark(x,z,r,age,color){const p=clamp(age/.35),fade=(1-p)**2;for(let i=0;i<5;i++){const a=i*TAU/5,rr=r*(.25+p*.8);core.shard(x+Math.cos(a)*rr,.3+p*.5,z+Math.sin(a)*rr,.09*(1-p),.24,a,color,fade);}}
 function arc(x,z,tx,tz,id,age){const fade=(1-clamp(age/.3))**1.5,dx=tx-x,dz=tz-z,l=Math.hypot(dx,dz)||1;let px=x,pz=z;
  for(let i=1;i<=6;i++){const q=i/6,w=i===6?0:Math.sin(id*.7+i*5)*.18,nx=x+dx*q-dz/l*w,nz=z+dz*q+dx/l*w;
   ink.line(px,.62,pz,nx,.62,nz,.07,P.water,fade);core.line(px,.65,pz,nx,.65,nz,.022,P.ice,fade);px=nx;pz=nz;}}
 function draw(state,{time=0,reduced=false,surfaceBudget=200,eventBudget=8}={}){
  const fields=Object.values(state?.fields??{}).filter(f=>f.phase==='active'||f.age<.32).sort((a,b)=>Number(b.phase==='active')-Number(a.phase==='active')||b.id-a.id);
  let surfaces=0,events=0;const kinds={};
  for(const f of fields.slice(0,surfaceBudget)){
   surfaces++;kinds[f.kind]=(kinds[f.kind]??0)+1;const fade=f.phase==='death'?clamp(1-f.age/.32):clamp(f.remaining*3),detail=surfaces<=32;
   if(f.kind==='fire'){
    const dx=f.tx-f.ox,dz=f.tz-f.oz,l=Math.hypot(dx,dz),ux=l>0?dx/l:1,uz=l>0?dz/l:0;
    if(l>.01){ink.line(f.ox,.085,f.oz,f.tx,.085,f.tz,f.radius,P.coal,.62*fade);ink.line(f.ox,.095,f.oz,f.tx,.095,f.tz,f.radius*.72,P.red,.42*fade);}
    else polygon(f,P.red,.35*fade);
    if(detail){const count=l>.01?Math.min(6,Math.max(2,Math.ceil(l/.65))):6;for(let i=0;i<count;i++){
     const q=(i+.5)/count,p=(time*1.7+i*.27+f.id*.13)%1,side=Math.sin(i*5+f.id)*f.radius*.42;
     const x=f.ox+dx*q-uz*side+(l<.01?Math.cos(i*2.39996)*f.radius*.58:0),z=f.oz+dz*q+ux*side+(l<.01?Math.sin(i*2.39996)*f.radius*.58:0),height=.38+Math.sin(p*Math.PI)*.58;
     ink.shard(x,.1,z,.24,height,i,P.red,.9*fade);core.shard(x,.13,z,.085,height*.73,i,P.fire,.60*fade*(reduced?.55:1));
     core.shard(x,.14+p*.5,z,.025,.04,i,P.core,(1-p)*.4*fade);
    }}
   }else{
    const oil=f.kind==='oil',charged=f.kind==='charged_water';polygon(f,oil?P.oil:P.water,(oil?.7:.26)*fade);
    if(detail){ink.arc(f.x,f.z,f.radius*.65,f.id*.3,Math.PI*1.3,.04,oil?P.sheen:P.cyan,.4*fade,.11);
     core.arc(f.x,f.z,f.radius*.90,f.id*.3+.6,Math.PI*.65,.018,oil?P.sheen:P.ice,.28*fade,.12);
     if(charged){const a=f.id*.5,p=f.radius*.75;arc(f.x-Math.cos(a)*p,f.z-Math.sin(a)*p,f.x+Math.cos(a)*p,f.z+Math.sin(a)*p,f.id,.09+(.10*Math.sin(time*4))**2);}
    }
   }
  }
  for(const b of Object.values(state?.statuses??{}).slice(0,24)){
   const oil=b.kind==='oil',fade=clamp(b.remaining*4),a=b.id*.4;
   ink.arc(b.x,b.z,.38,a,Math.PI*1.4,.07,oil?P.oil:P.water,.7*fade,.12);
   for(let i=0;i<2;i++){const th=a+i*Math.PI;core.shard(b.x+Math.cos(th)*.35,.35,b.z+Math.sin(th)*.35,.055,.17,th,oil?P.sheen:P.cyan,.45*fade);}
  }
  for(const e of Object.values(state?.events??{}).reverse()){
   const age=time-e.time;if(age<0||age>=.35||events>=eventBudget||!['ignite','surface_ignite','conduct','charged','oil_spill','lightning','surface_charge'].includes(e.kind))continue;
   events++;
   if(e.kind==='conduct'||e.kind==='lightning')arc(e.x,e.z,e.tx,e.tz,e.id,age);
   else if(e.kind==='ignite'||e.kind==='surface_ignite'){spark(e.x,e.z,.7,age,P.fire);core.arc(e.x,e.z,.25+age*2,0,TAU,.035,P.fire,clamp(1-age/.35)*(reduced?.35:.7),.16);}
   else spark(e.x,e.z,.6,age,e.kind==='oil_spill'?P.sheen:P.cyan);
  }
  return {surfaces,events,kinds,skippedSurfaces:Math.max(0,fields.length-surfaceBudget)};
 }
 return {draw};
}
