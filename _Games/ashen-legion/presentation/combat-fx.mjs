import {createCompositionFX} from './composition-fx.mjs';
import {createResonanceFX} from './resonance-fx.mjs';
import {createTriggerFX} from './trigger-fx.mjs';
import * as T from 'three';
import {createElementFX} from './element-fx.mjs';
import {skillVfxFamily} from './skill-vfx.mjs';
// Game-owned, read-only rendering of Luau receipts. Ink silhouette → bright core → sparse residue.
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>1-(1-clamp(x))**3;
const rand=(id,n)=>{const v=Math.sin(id*12.9898+n*78.233)*43758.5453;return v-Math.floor(v)};
const P={gold:[1.3,.72,.16],cream:[2.5,1.9,.95],ink:[.19,.055,.045],red:[.85,.13,.035],cyan:[.14,.86,1.15],ice:[1.4,2.1,2.4],blue:[.045,.20,.30],jade:[.23,.73,.37],leaf:[.64,1.15,.33]};
export const VFX_STYLE=Object.freeze({lightning:{life:.36},frost:{life:.82},ember:{life:.65},leaf:{life:.8},cleave:{life:.42},shock:{life:.52},hit:{life:.26},critical:{life:.42},wall_charge:{life:.55},wall_surge:{life:.42}});

function batch(scene,capacity,additive){
 const positions=new Float32Array(capacity*3),colors=new Float32Array(capacity*4),geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
 geometry.setAttribute('fxColor',new T.BufferAttribute(colors,4).setUsage(T.DynamicDrawUsage));
 const material=new T.ShaderMaterial({transparent:true,side:T.DoubleSide,depthWrite:false,depthTest:true,blending:additive?T.AdditiveBlending:T.NormalBlending,uniforms:{debugMode:{value:0}},
  vertexShader:'attribute vec4 fxColor; varying vec4 vColor; void main(){vColor=fxColor;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec4 vColor; uniform int debugMode; void main(){
   vec3 c=vColor.rgb; float a=vColor.a;
   if(debugMode==1){c=vec3(.12,.5,.8);a=.12;}
   if(debugMode==2)c=vec3(dot(c,vec3(.2126,.7152,.0722)));
   gl_FragColor=vec4(c,a);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`});
 const mesh=new T.Mesh(geometry,material);mesh.name=additive?'skill-vfx-core':'skill-vfx-silhouette';mesh.frustumCulled=false;mesh.renderOrder=additive?7:6;scene.add(mesh);
 let count=0,dropped=0;
 function vertex(x,y,z,c,a){const p=count*3,q=count*4;positions[p]=x;positions[p+1]=y;positions[p+2]=z;colors[q]=c[0];colors[q+1]=c[1];colors[q+2]=c[2];colors[q+3]=a;count++;}
 function tri(ax,ay,az,bx,by,bz,cx,cy,cz,c,a=1,tipAlpha=a){if(a<=.001)return;if(count+3>capacity){dropped++;return;}vertex(ax,ay,az,c,a);vertex(bx,by,bz,c,a);vertex(cx,cy,cz,c,tipAlpha);}
 function line(x,y,z,tx,ty,tz,w,c,a=1,endW=w){const l=Math.hypot(tx-x,tz-z)||1,nx=-(tz-z)/l,nz=(tx-x)/l;
  tri(x+nx*w,y,z+nz*w,x-nx*w,y,z-nz*w,tx+nx*endW,ty,tz+nz*endW,c,a);
  tri(tx+nx*endW,ty,tz+nz*endW,x-nx*w,y,z-nz*w,tx-nx*endW,ty,tz-nz*endW,c,a);}
 function arc(x,z,r,start,sweep,w,c,a=1,y=.12,taper=true){const steps=Math.max(6,Math.ceil(Math.abs(sweep)*8));
  for(let i=0;i<steps;i++){const u=i/steps,v=(i+1)/steps,aa=start+u*sweep,bb=start+v*sweep;
   line(x+Math.cos(aa)*r,y,z+Math.sin(aa)*r,x+Math.cos(bb)*r,y,z+Math.sin(bb)*r,w*(taper?Math.sin(Math.PI*u)*.85+.05:1),c,a,w*(taper?Math.sin(Math.PI*v)*.85+.05:1));}}
 function shard(x,y,z,r,h,angle,c,a=1){const dx=Math.cos(angle)*r,dz=Math.sin(angle)*r,px=-dz*.48,pz=dx*.48;
  tri(x-dx,y,z-dz,x+px,y+h*.3,z+pz,x+dx,y+h,z+dz,c,a);tri(x-dx,y,z-dz,x+dx,y+h,z+dz,x-px,y+h*.15,z-pz,c,a*.55);}
 return {tri,line,arc,shard,geometry,material,begin(){count=0;dropped=0},end(){geometry.setDrawRange(0,count);mesh.visible=count>0;
  for(const name of ['position','fxColor']){const a=geometry.attributes[name];a.clearUpdateRanges();a.addUpdateRange(0,count*a.itemSize);a.needsUpdate=true;}},
  inspect:()=>({vertices:count,capacity,droppedTriangles:dropped}),dispose(){scene.remove(mesh);geometry.dispose();material.dispose()}};
}

export function createCombatFX(scene,{reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false,compact=()=>(globalThis.document?.querySelector('#game')?.clientWidth??globalThis.innerWidth)<700,maxEvents=36}={}){
 // Fixed combined budget for fields, delayed telegraphs and 48 boosted trails.
 // Capacity is shared across skill families; spawning never allocates another mesh.
 const ink=batch(scene,54000,false),core=batch(scene,96000,true);
 const elementFX=createElementFX({ink,core}),triggerFX=createTriggerFX({ink,core}),resonanceFX=createResonanceFX({ink,core}),compositionFX=createCompositionFX({ink,core});let boostedTrailCount=0;
 const slots=Array.from({length:64},()=>({id:null,points:new Float32Array(48),head:0,count:0,last:-1,bounce:0}));
 let clock=-1,lastRound=-1,stats={},disposed=false,debug='final';
 const residuals=new Map();
 function flare(x,z,r,a,c=P.cream,y=.6,angle=0){for(let i=0;i<4;i++){const th=angle+i*Math.PI/2,l=r*(i%2?.55:1),dx=Math.cos(th),dz=Math.sin(th);core.tri(x-dz*r*.13,y,z+dx*r*.13,x+dz*r*.13,y,z-dx*r*.13,x+dx*l,y,z+dz*l,c,a,0);}}
 function debris(e,p,c,n=9,lift=1){const reach=e.radius*(.25+.75*ease(p)),fade=(1-p)**1.5;
  for(let i=0;i<n;i++){const a=rand(e.id,i)*TAU,d=reach*(.4+.6*rand(e.id,i+17)),y=.13+Math.sin(p*Math.PI)*lift*(.4+rand(e.id,i+31));
   ink.shard(e.x+Math.cos(a)*d,y,e.z+Math.sin(a)*d,(.07+rand(e.id,i+7)*.1)*(1-p),.10,a+p,c,fade);}}
 const skillColors={gold:P.gold,cream:P.cream,red:P.red,cyan:P.cyan,ice:P.ice,ember:[1.45,.28,.06],jade:P.jade,violet:[.82,.42,1.35],water:[.18,.72,1.2],poison:[.36,1.05,.22],soul:[.24,1.15,.72]};
 function skillAttunements(s,now,reduced){
  const limit=compact()?18:42;let drawn=0;
  for(const t of Object.values(s?.visualTroops??{})){
   if(drawn>=limit)break;
   const ids=Array.isArray(t.skillFx)?t.skillFx:[];
   if(!ids.length)continue;
   // Show at most four marks per troop. Trigger skills still get their larger
   // event VFX; this quiet mark tells the player the item is currently armed.
   const shown=ids.slice(0,4),count=shown.length;
   for(let i=0;i<count&&drawn<limit;i++){
    const meta=skillVfxFamily(shown[i]),c=skillColors[meta.color]??P.violet;
    const phase=(now*(.44+(meta.pulse??1)*.08)+(t.id??0)*.173+i*.71)%1;
    const angle=phase*TAU+i*.6,r=.28+.055*i,fade=reduced?.24:.52;
    const sweep=meta.group==='passive'?.72:meta.group==='motion'?1.15:.9;
    ink.arc(t.x,t.z,r,angle,sweep,.024,P.ink,fade,.18);
    core.arc(t.x,t.z,r,angle,sweep,.012,c,fade*(meta.group==='passive'?.7:1),.20);
    const sx=t.x+Math.cos(angle+sweep)*r,sz=t.z+Math.sin(angle+sweep)*r;
    core.shard(sx,.34+(i%2)*.08,sz,.035+(meta.group==='crit'?.018:0),.10,angle,c,fade*.95);
    if(meta.group==='lightning'){
     core.line(sx,.35,sz,sx+Math.cos(angle+.8)*.16,.48,sz+Math.sin(angle+.8)*.16,.014,P.ice,fade*.9,0);
    }else if(meta.group==='fire'||meta.group==='poison'||meta.group==='soul'){
     core.shard(sx,.40,sz,.022,.13,angle+.5,c,fade*.6);
    }
    drawn++;
   }
  }
  return drawn;
 }
 function draw(e,age,reduced){
  const life=VFX_STYLE[e.kind]?.life??.55,p=clamp(age/life);if(age<0||p>=1)return false;
  const r=e.radius??1,fade=(1-p)**1.5,flash=clamp(1-p*5)*(reduced?.35:1),x=e.x,z=e.z,angle=rand(e.id,3)*TAU;
  if(e.kind==='lightning'){
   const dx=e.tx-x,dz=e.tz-z,d=Math.hypot(dx,dz)||1,nx=-dz/d,nz=dx/d;let px=x,pz=z;
   // Lightning owns a readable caster tell as well as the target strike. The
   // source receipt is supplied by Luau; this never guesses a target in JS.
   const sx=e.sx,sz=e.sz;
   if(Number.isFinite(sx)&&Number.isFinite(sz)&&Math.hypot(sx-x,sz-z)>.18){
    const charge=.28+.16*(1-p),ca=angle+p*2.4;
    ink.arc(sx,sz,charge,ca,Math.PI*1.65,.06,P.blue,fade*.8,.22);
    core.arc(sx,sz,charge*.86,ca+.1,Math.PI*1.45,.028,P.cyan,fade,.26);
    for(let i=0;i<3;i++){const aa=ca+i*TAU/3;core.shard(sx+Math.cos(aa)*charge,.55,sz+Math.sin(aa)*charge,.045,.16,aa,P.ice,fade*.9);}
   }
   // Stable event path, including both ends. No frame-random flickering or target guessing.
   for(let i=1;i<=9;i++){const q=i/9,o=i===9?0:(rand(e.id,i)-.5)*.6,tx=x+dx*q+nx*o,tz=z+dz*q+nz*o;
    ink.line(px,.65,pz,tx,.65,tz,.105,P.blue,fade*.75);core.line(px,.68,pz,tx,.68,tz,.055,P.cyan,fade);core.line(px,.70,pz,tx,.70,tz,.019,P.ice,fade);
    if(i===3||i===6){const side=i===3?1:-1;core.line(tx,.66,tz,tx+nx*.45*side-dx*.08,.4,tz+nz*.45*side-dz*.08,.025,P.cyan,fade*.5,0);}px=tx;pz=tz;}
   flare(e.tx,e.tz,.55,fade,P.ice,.7,angle);
  }else if(e.kind==='cleave'){
   const rr=r*(.65+.35*ease(p)),a=angle+p*.6;
   ink.arc(x,z,rr,a,Math.PI*1.45,.20*(1-p),P.ink,fade,.18);ink.arc(x,z,rr*.97,a,Math.PI*1.45,.115*(1-p),P.red,fade,.20);
   core.arc(x,z,rr,a,Math.PI*1.45,.055*(1-p),P.cream,fade,.23);core.arc(x,z,rr*.72,a+.4,Math.PI*.8,.022,P.gold,fade*.7,.19);debris(e,p,P.gold,reduced?3:7,.35);
  }else if(e.kind==='frost'){
   // Luau owns and simulates the 40 persistent low-poly ice shards. Keep only
   // the pooled renderer's ground ring and release flash here, avoiding doubles.
   const expand=ease(p),ring=r*(.12+.88*expand);
   ink.arc(x,z,ring,angle,TAU,.10*(1-p),P.blue,fade,.10,false);
   core.arc(x,z,ring*.94,angle+.08,TAU,.038*(1-p),P.ice,fade*.9,.13,false);
   if(p<.16)flare(x,z,.62*(1-p/.16),clamp(1-p/.16)*fade,P.cream,.46,angle);
  }else if(e.kind==='ember'){
   const expand=ease(p*2),rr=r*(.28+.65*expand);
   // Faceted flame tongues, with a burgundy silhouette and short amber core.
   for(let i=0;i<7;i++){const a=angle+i*TAU/7,d=rr*(.35+rand(e.id,i)*.4),sx=x+Math.cos(a)*d,sz=z+Math.sin(a)*d,h=(1.2+rand(e.id,i+6))*(1-p)*expand;
    ink.shard(sx,.10,sz,.50*(1-p),h,a,P.ink,fade*.8);ink.shard(sx,.13,sz,.43*(1-p),h,a,P.red,fade);core.shard(sx,.16,sz,.28*(1-p),h*.8,a,P.gold,fade);}
   core.arc(x,z,r*ease(p*2),angle,TAU,.065*(1-p),P.gold,fade*.65,.12,false);flare(x,z,r*.65,flash,P.cream,.55,angle);debris(e,p,P.red,reduced?4:12,1.3);
  }else if(e.kind==='leaf'){
   for(let i=0;i<(reduced?5:12);i++){const a=angle+i*2.39996+p*(reduced?.2:1.7),d=r*(.2+.8*ease(p))*(.5+rand(e.id,i)*.5),sx=x+Math.cos(a)*d,sz=z+Math.sin(a)*d,y=.14+Math.sin(p*Math.PI)*.9;
    ink.shard(sx,y,sz,.21*(1-p),.14,a+.7,P.jade,fade);core.line(sx,y+.01,sz,sx+Math.cos(a+.7)*.17*(1-p),y+.04,sz+Math.sin(a+.7)*.17*(1-p),.013,P.leaf,fade*.6,0);}
   core.arc(x,z,r*(.25+.75*ease(p)),angle+p,Math.PI*1.3,.045,P.leaf,fade*.5);
  }else if(e.kind==='shock'){
   const rr=r*(.15+.85*ease(p*1.4));
   for(let i=0;i<8;i++){const a=angle+i*TAU/8;ink.arc(x,z,rr,a,.49,.10*(1-p),P.blue,fade,.11);core.arc(x,z,rr,a,.49,.04*(1-p),P.cyan,fade,.14);}
   core.arc(x,z,rr*.66,angle-.3,Math.PI*1.2,.025,P.ice,fade*.5);debris(e,p,P.jade,reduced?3:8,.5);
  }else if(e.kind==='hit'||e.kind==='critical'){
   const crit=e.kind==='critical',rr=crit?1:.42,reach=rr*(.45+.55*ease(p)),dx=Math.cos(angle)*reach,dz=Math.sin(angle)*reach;
   ink.line(x-dx,.65,z-dz,x+dx,.75,z+dz,crit?.1:.055,P.ink,fade);core.line(x-dx,.68,z-dz,x+dx,.78,z+dz,crit?.035:.018,crit?P.cream:P.gold,fade,0);
   flare(x,z,rr,fade*(reduced?.45:1),crit?P.cream:P.gold,.72,angle);debris({...e,radius:rr},p,crit?P.gold:P.red,crit?(reduced?3:9):3,.5);
  }else if(e.kind==='wall_charge'){
   const pulse=.5+.5*Math.sin(p*TAU*1.5),rr=.42+.32*ease(p);
   ink.arc(x,z,rr,angle,TAU*.88,.11,P.ink,fade,.13,false);core.arc(x,z,rr,angle,TAU*.88,.045,P.gold,fade*(.5+pulse*.5),.18,false);
   for(let i=0;i<5;i++){const a=angle+i*TAU/5+p*.55,rx=x+Math.cos(a)*rr,rz=z+Math.sin(a)*rr;core.line(rx,.18,rz,rx-Math.cos(a)*.14,.3+pulse*.08,rz-Math.sin(a)*.14,.025,P.cream,fade*.7,0);}
   flare(x,z,.38+pulse*.12,fade*.7,P.gold,.24,angle);
  }else if(e.kind==='wall_surge'){
   const dx=Math.cos(e.direction??angle),dz=Math.sin(e.direction??angle),nx=-dz,nz=dx,reach=r*(.9+.75*ease(p)),tailX=x-dx*reach,tailZ=z-dz*reach;
   ink.line(tailX,.24,tailZ,x+dx*.3,.28,z+dz*.3,.20*(1-p),P.ink,fade);
   core.line(tailX,.29,tailZ,x+dx*.25,.34,z+dz*.25,.105*(1-p),P.gold,fade,0);
   for(const side of [-1,1]){const s=.24*side;core.line(tailX+nx*s,.21,tailZ+nz*s,x+dx*.18+nx*s*.12,.25,z+dz*.18+nz*s*.12,.035*(1-p),P.cream,fade,0);}
   flare(x+dx*.22,z+dz*.22,.55*(1-p*.45),fade,P.cream,.36,angle);debris(e,p,P.gold,reduced?3:7,.34);
  }else{
   const c=e.kind==='renew'?P.leaf:e.kind==='spawn'?P.red:P.gold;debris(e,p,c,reduced?4:e.kind==='jackpot'?18:7,e.kind==='spawn'?1.6:.55);
   if(e.kind==='spawn'||e.kind==='jackpot')core.arc(x,z,r*ease(p),angle,TAU,.07,c,fade*.65,.12,false);
   if(e.kind==='wall')flare(x,z,.42,fade,P.gold,.23,angle);
  }
  return true;
 }
 function trails(s,now,reduced){
  const limit=compact()?24:48;let active=0,segments=0;boostedTrailCount=0;
  for(const t of Object.values(s.visualTroops??{})){if(t.state==='spin'||active++>=limit)continue;
   let slot=slots.find(v=>v.id===t.id);if(!slot){slot=slots.find(v=>v.id===null||now-v.last>.25);if(!slot)continue;slot.id=t.id;slot.count=0;slot.head=0;slot.last=-1;slot.bounce=t.bounces;}
   // Cut the history at a bounce rather than drawing across a wall corner.
   if(slot.bounce!==t.bounces){slot.count=0;slot.bounce=t.bounces;}
   if(now>slot.last){const k=slot.head*4;slot.points[k]=t.x;slot.points[k+1]=(t.y??0)+.22;slot.points[k+2]=t.z;slot.points[k+3]=now;slot.head=(slot.head+1)%12;slot.count=Math.min(12,slot.count+1);slot.last=now;}slot.kind=t.k;slot.rush=Math.min(1,t.birthRush/1.8||0);slot.surge=t.wallSurge??0;
  }
  for(const slot of slots){if(slot.id===null)continue;if(now-slot.last>.24){slot.id=null;slot.count=0;continue;}const base=slot.kind===1?P.red:slot.kind===2?P.cyan:P.gold,rush=Math.max(slot.rush??0,slot.surge??0),surge=slot.surge??0,c=base.map((v,i)=>v+(P.cyan[i]-v)*rush+(P.cream[i]-v)*surge*.42);if(rush>0)boostedTrailCount++;
   for(let i=1;i<slot.count;i++){const a=((slot.head-slot.count+i-1+12)%12)*4,b=((slot.head-slot.count+i+12)%12)*4,v=slot.points,life=reduced?.09:.22,age=now-v[a+3];if(age>life)continue;
    const d=Math.hypot(v[b]-v[a],v[b+2]-v[a+2]);if(d<.01||d>4)continue;const taper=clamp(1-age/life),w=((slot.kind===3?.11:.065)+rush*.065+surge*.10)*taper;
    core.line(v[a],v[a+1],v[a+2],v[b],v[b+1],v[b+2],w,c,(.38+rush*.4+surge*.35)*taper,w*1.1);
    if(rush>.05){const nx=-(v[b+2]-v[a+2])/d,nz=(v[b]-v[a])/d;for(const side of [-1,1]){const off=.13*side;ink.line(v[a]+nx*off,v[a+1]+.03,v[a+2]+nz*off,v[b]+nx*off,v[b+1]+.03,v[b+2]+nz*off,.025*taper,P.blue,.55*taper*rush,0);core.line(v[a]+nx*off,v[a+1]+.06,v[a+2]+nz*off,v[b]+nx*off,v[b+1]+.06,v[b+2]+nz*off,.012*taper,P.ice,.75*taper*rush,0);}}segments++;}
  }return segments;
 }
 // Lifecycle geometry consumes Luau phase/progress, including pause and cancellation.
 function lifecycle(e,domain,reduced){
  const x=e.x,z=e.z,r=e.radius??.7,a=e.age??0,phase=e.phase,poison=e.kind==='plague_vial'||e.kind==='poison',color=poison?P.leaf:P.gold,dark=poison?P.jade:P.red;
  const end=phase==='end'||phase==='death'||phase==='expire',fade=end?clamp(1-a/.32):Math.min(1,.3+a*6),power=reduced?.55:1;
  if(fade<=0)return;
  if(domain==='cast'){
   if(phase==='channel'&&e.kind==='flame_cloak'){
    // True gameplay radius, with broken outlines and open centres for readability.
    for(let i=0;i<6;i++){const th=i*TAU/6+a*.45,sx=x+Math.cos(th)*r,sz=z+Math.sin(th)*r;
     ink.arc(x,z,r,th,.48,.045,P.red,fade*.65,.11);
     ink.shard(sx,.1,sz,.23,.45+Math.sin(a*6+i)*.14,th,P.red,fade*.8);
     core.shard(sx,.12,sz,.10,.32,th,P.gold,fade*.65*power);}
    return;
   }
   if(phase==='channel'&&e.kind==='phoenix_fire')return;
   const p=phase==='windup'?clamp(e.progress??0):1,rr=.38+p*.35;
   ink.arc(x,z,rr,-Math.PI/2,TAU*p,.09,poison?P.blue:P.ink,fade,.14,false);
   core.arc(x,z,rr,-Math.PI/2,TAU*p,.035,color,fade*.65*power,.16,false);
   for(let i=0;i<3;i++){const th=i*TAU/3;ink.shard(x+Math.cos(th)*rr,.16,z+Math.sin(th)*rr,.07,.2,th,dark,fade);}
   if(phase==='release')flare(x,z,.8,clamp(1-a/.12)*power,poison?P.leaf:P.cream,.8);
  }else if(domain==='effect'){
   if(phase==='spawn'||phase==='flight'){
    const y=e.y??.7,dx=e.tx-x,dz=e.tz-z,l=Math.hypot(dx,dz)||1,ux=dx/l,uz=dz/l,nx=-uz,nz=ux;
    if(poison){
     ink.shard(x,y,z,.23,.30,a*8,P.blue,1);core.shard(x,y+.03,z,.14,.20,a*8,P.leaf,.65*power);
     ink.line(x,y+.23,z,x+ux*.04,y+.36,z+uz*.04,.07,P.gold,1);
     core.line(x-ux*.55,y-.08,z-uz*.55,x,y,z,.028,P.leaf,.5*power,0);
    }else{
     // Recognisable swept phoenix wings, split tail, amber body and ivory beak.
     const wing=.50+Math.sin(a*16)*.14;
     for(const s of [-1,1]){
      ink.tri(x+ux*.35,y,z+uz*.35,x+nx*wing*s-ux*.20,y+.12,z+nz*wing*s-uz*.20,x-ux*.5,y-.1,z-uz*.5,P.red,.95);
      core.tri(x+ux*.2,y+.04,z+uz*.2,x+nx*wing*.85*s-ux*.12,y+.14,z+nz*wing*.85*s-uz*.12,x-ux*.28,y,z-uz*.28,P.gold,.85*power);
      core.line(x-ux*.15,y,z-uz*.15,x-ux*.8+nx*.15*s,y-.06,z-uz*.8+nz*.15*s,.07,P.gold,.6*power,0);
     }
     core.line(x,y+.06,z,x+ux*.5,y+.06,z+uz*.5,.065,P.cream,.9*power,0);
    }
   }else if(poison){
    // Detailed vapour is optional; every active cloud gets a cheap footprint below.
    for(let i=0;i<(reduced?3:6);i++){const th=i*2.39996,p=(a*.5+i*.17)%1,d=r*(.2+rand(e.id,i)*.5);
     ink.shard(x+Math.cos(th)*d,.12+p*.65,z+Math.sin(th)*d,.16*(1-p),.28,th,P.jade,(1-p)*.5*fade);
     core.shard(x+Math.cos(th)*d,.13+p*.65,z+Math.sin(th)*d,.06*(1-p),.14,th,P.leaf,(1-p)*.35*fade*power);}
   }else{
    flare(x,z,.9,fade*.7*power,P.cream,.6);debris({...e,radius:.7},clamp(a/.32),P.red,reduced?3:7,.65);
   }
  }else{
   const c=e.kind==='frost'||e.kind==='electrified'?P.cyan:e.kind==='haste'?P.cyan:e.kind==='rally'||e.kind==='critical'||e.kind==='pierce'?P.gold:color;
   if(e.kind==='frost'){
    // Existing frost slow becomes a readable low-poly crystal prison; shatter
    // gear then releases the 40-shard burst above. Gameplay duration stays Luau-owned.
    const rise=phase==='apply'?ease(a/.15):1,shrink=phase==='expire'?1-clamp(a/.32)*.12:1;
    const spin=e.id*.013+(reduced?0:a*.28),radius=.48*shrink,height=1.22*rise*shrink,pulse=reduced?1:.92+.08*Math.sin(a*8+e.id);
    ink.arc(x,z,radius,spin,TAU,.055,P.blue,fade*.75,.09,false);
    core.arc(x,z,radius,spin+.04,TAU,.022,P.cyan,fade*.74*power,.12,false);
    for(let i=0;i<6;i++){
     const a0=spin+i*TAU/6,a1=spin+(i+1)*TAU/6,r0=radius,r1=radius*.86;
     const bx=x+Math.cos(a0)*r0,bz=z+Math.sin(a0)*r0,ex=x+Math.cos(a1)*r0,ez=z+Math.sin(a1)*r0;
     const tx=x+Math.cos(a0+.12)*r1,tz=z+Math.sin(a0+.12)*r1,ux=x+Math.cos(a1-.12)*r1,uz=z+Math.sin(a1-.12)*r1;
     const low=.12,high=.12+height;
     ink.tri(bx,low,bz,ex,low,ez,ux,high,uz,P.blue,fade*.30*pulse);
     ink.tri(bx,low,bz,ux,high,uz,tx,high,tz,P.cyan,fade*.14*pulse);
     core.line(bx,low,bz,tx,high,tz,.018,P.ice,fade*.68*power);
     core.line(ex,low,ez,ux,high,uz,.018,P.cyan,fade*.50*power);
     const mid=(a0+a1)*.5,px=x+Math.cos(mid)*radius*.92,pz=z+Math.sin(mid)*radius*.92;
     ink.shard(px,.18,pz,.10,.25*pulse,mid,P.blue,fade*.70);
     core.shard(px,.20,pz,.058,.20*pulse,mid,P.ice,fade*.85*power);
    }
    core.arc(x,z,radius*.46,-spin,Math.PI*1.15,.022,P.ice,fade*.43*power,.42,false);
    return;
   }
   const burning=e.kind==='burn',count=burning||poison?3:2;
   for(let i=0;i<count;i++){const th=i*TAU/count+a*.7,rr=.35;
    const sx=x+Math.cos(th)*rr,sz=z+Math.sin(th)*rr;
    if(burning||poison){ink.shard(sx,.35,sz,.15,burning?.52:.23,th,dark,.75*fade);core.shard(sx,.4,sz,.065,burning?.36:.16,th,c,.6*fade*power);}
    else core.arc(x,z,.55,th,.75,.024,c,.45*fade*power,.11);
   }
   if(phase==='apply')core.arc(x,z,.3+a*2,0,TAU,.026,c,fade*.4*power,.2,false);
  }
 }
 function reset(){for(const v of slots){v.id=null;v.count=0;v.last=-1;}residuals.clear();}
 function update(s){
  if(disposed)return;ink.begin();core.begin();const now=s?.rewardClock??0,reduced=reducedMotion();
  if(now<clock||s?.round!==lastRound||s?.phase==='menu')reset();clock=now;lastRound=s?.round;
  let active=0,skipped=0;const kinds={},events=Object.values(s?.vfx??{});
  let compositionStats={events:0},resonanceStats={events:0,markers:0,ghosts:0,kinds:{}},triggerStats={events:0,buffs:0,kinds:{}};let fieldFootprints=0,elementStats={surfaces:0,events:0,kinds:{},skippedSurfaces:0};
  const states=s?.skillRuntime??{},take=(e,domain)=>{if(active>=maxEvents){skipped++;return;}lifecycle(e,domain,reduced);active++;const k=domain+':'+e.kind;kinds[k]=(kinds[k]??0)+1;};
  if(s?.phase==='battle'){
   compositionStats=compositionFX.draw(states.composition,{time:states.clock??now,reduced,eventBudget:Math.min(6,maxEvents-active)});active+=compositionStats.events;
   resonanceStats=resonanceFX.draw(states.resonance,{time:states.clock??now,reduced,eventBudget:Math.min(6,maxEvents-active)});active+=resonanceStats.events;
   // Death-summoned wraiths are gameplay-important tells; keep room for a short burst of them in a horde.
   triggerStats=triggerFX.draw(states.triggers,{time:states.clock??now,reduced,budget:8});active+=triggerStats.events;
   const entities=Object.values(states.entities??{}).sort((a,b)=>(a.phase==='flight'?-1:0)-(b.phase==='flight'?-1:0)||b.id-a.id);
   const clouds=entities.filter(e=>e.kind==='plague_vial'&&e.phase==='active');
   const hasElements=Object.values(states.elements?.fields??{}).some(f=>f.phase==='active');
   for(const e of clouds.slice(0,hasElements?200:400)){
    const x=e.x,z=e.z,r=e.radius,fade=clamp((1-(e.progress??0))*5);
    for(let i=0;i<8;i++){const a=i*TAU/8,b=(i+1)*TAU/8,ax=x+Math.cos(a)*r,az=z+Math.sin(a)*r,bx=x+Math.cos(b)*r,bz=z+Math.sin(b)*r;
     ink.tri(x,.085,z,ax,.085,az,bx,.085,bz,i%2?P.jade:P.blue,.25*fade);
     core.line(ax,.10,az,bx,.10,bz,.018,P.leaf,.43*fade*(reduced?.65:1));
    }fieldFootprints++;
   }
   elementStats=elementFX.draw(states.elements,{time:states.clock??now,reduced,surfaceBudget:400-fieldFootprints,eventBudget:8});active+=elementStats.events;
   // Reserve room for contact/crit feedback even during a full army's persistent fields.
   const detailed=[...clouds.slice(0,4),...entities.filter(e=>!clouds.includes(e)).slice(0,8)];
   for(const e of detailed)take(e,'effect');
   const casts=Object.values(states.casts??{}).sort((a,b)=>(a.phase==='channel'?1:0)-(b.phase==='channel'?1:0)||b.id-a.id);
   const channels=casts.filter(e=>e.kind==='flame_cloak'&&e.phase==='channel');
   for(const e of [...channels.slice(0,4),...casts.filter(e=>!channels.includes(e)).slice(0,8-Math.min(4,channels.length))])take(e,'cast');
   const buffs=Object.values(states.buffs??{}).sort((a,b)=>(['burn','poison'].includes(b.kind)?1:0)-(['burn','poison'].includes(a.kind)?1:0)||b.id-a.id);
   for(const e of buffs.slice(0,8))take(e,'buff');
   skipped+=Math.max(0,entities.length-12)+Math.max(0,casts.length-8)+Math.max(0,buffs.length-8);
  }
  const submit=(e,age)=>{if(age<0||age>=(VFX_STYLE[e.kind]?.life??.55))return;if(active>=maxEvents){skipped++;return;}if(draw(e,age,reduced)){active++;kinds[e.kind]=(kinds[e.kind]??0)+1;}};
  for(let i=events.length-1;i>=0;i--)submit(events[i],now-events[i].time);
  for(const t of Object.values(s?.visualTroops??{}))if(t.state==='spin'){
   const r=t.spinRadius??2.9,p=clamp(t.spinProgress??0),a=p*TAU;
   if(active>=maxEvents){skipped++;continue;}active++;
   ink.arc(t.x,t.z,r,a,Math.PI*1.4,.2,P.blue,.8,.16);core.arc(t.x,t.z,r,a,Math.PI*1.4,.075,P.ice,reduced?.4:.88,.22);core.arc(t.x,t.z,r*.7,a-.4,Math.PI,.035,P.cyan,.6,.21);kinds.spin=(kinds.spin??0)+1;}
  for(const t of Object.values(s?.visualTroops??{}))if(t.state==='wall_charge'&&active<maxEvents){
   const charge=clamp(1-(t.wallCharge??0)),pulse=.55+.45*Math.sin((now*10)+(t.id??0)),r=.48+.18*charge;
   ink.arc(t.x,t.z,r*.88,(now*2.6)+(t.id??0),Math.PI*1.72,.095,P.ink,.8,.12,false);
   core.arc(t.x,t.z,r,(now*2.6)+(t.id??0),Math.PI*1.72,.038,P.gold,.55+pulse*.4,.17,false);
   core.arc(t.x,t.z,r*.58,-now*1.6-(t.id??0),Math.PI*1.3,.025,P.cream,.5+pulse*.35,.19,false);
   for(let i=0;i<3;i++){const a=(t.id??0)*.71+i*TAU/3-now*2.1,x=t.x+Math.cos(a)*r,z=t.z+Math.sin(a)*r;core.shard(x,.18,z,.10+pulse*.04,.20+pulse*.1,a,P.gold,pulse);}
   active++;kinds.wall_charge=(kinds.wall_charge??0)+1;
  }
  for(const e of Object.values(s?.damageEvents??{}).reverse())if(!e.secondary)submit({...e,kind:e.critical?'critical':'hit',radius:1},now-e.time);
  // Preserve analytic residue after the legacy native effect's shorter lifetime.
  for(const e of Object.values(s?.visualEffects??{}))residuals.set(e.id,e);
  for(const [id,e]of residuals)if(now-e.time>=Math.max(.55,VFX_STYLE[e.kind]?.life??0))residuals.delete(id);
  while(residuals.size>64)residuals.delete(residuals.keys().next().value);
  for(const e of [...residuals.values()].reverse()){
   if(['lightning','impact','critical'].includes(e.kind))continue;
   if(VFX_STYLE[e.kind]&&events.some(v=>v.kind===e.kind&&Math.abs(v.time-e.time)<.05&&Math.hypot(v.x-e.x,v.z-e.z)<.1))continue;
   submit(e,now-e.time);}
  const attunements=skillAttunements(s??{},now,reduced);const trailSegments=trails(s??{},now,reduced);ink.end();core.end();
  stats={style:'storybook-faceted-v1',activeEvents:active,eventBudget:maxEvents,skippedEvents:skipped,kinds,fieldFootprints,elements:elementStats,triggers:triggerStats,resonance:resonanceStats,composition:compositionStats,skillAttunements:attunements,boostedTrails:boostedTrailCount,trailSegments,trailSlots:slots.filter(v=>v.id!==null).length,
   ink:ink.inspect(),core:core.inspect(),reducedMotion:reduced,clock:now,drawCalls:Number(ink.inspect().vertices>0)+Number(core.inspect().vertices>0),debug};
 }
 return {update,inspect:()=>stats,setDebugMode(mode){debug=mode;const n=({overdraw:1,luminance:2})[mode]??0;ink.material.uniforms.debugMode.value=n;core.material.uniforms.debugMode.value=n;},dispose(){if(disposed)return;disposed=true;reset();ink.dispose();core.dispose();}};
}
