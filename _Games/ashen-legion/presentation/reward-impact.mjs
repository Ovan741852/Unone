import {createCanvasUi} from '../web/shared/canvas-ui.mjs';
import {clamp} from './combat-feedback-layout.mjs';
// Receipts drive bounded, additive camera impulses; no combat hit-stop or RNG.
export function createRewardImpact({container=document.body}={}){
 const canvas=document.createElement('canvas');canvas.id='reward-impact';canvas.style.cssText=`position:${container===document.body?'fixed':'absolute'};inset:0;width:100%;height:100%;pointer-events:none;z-index:7`;container.append(canvas);
 const art=document.createElement('canvas'),p=art.getContext('2d'),ui=createCanvasUi(canvas,{resolveAsset:()=>art});
 let clock=0,lastEvent=0,lastPhase='',bursts=[],offset={x:0,y:0},lastImpulse=-10,serial=0,report={};
 function update(s,dt){
  if(!s)return;clock+=s.paused?0:clamp(dt,0,.1);
  if(s.event<lastEvent||(s.phase==='menu'&&lastPhase!=='menu')){lastEvent=0;bursts=[];lastImpulse=-10;offset={x:0,y:0};}lastPhase=s.phase;
  const fresh=Object.values(s.rewards??{}).filter(e=>e.id>lastEvent&&e.tier>=3&&(e.playerId??s.seat)===(s.seat??1));lastEvent=s.event??lastEvent;
  if(fresh.length){const e=fresh.sort((a,b)=>b.tier-a.tier||b.amount-a.amount)[0],power=e.tier>=4?3:e.title==='MEGA WIN'?2:1;
   // At most one impulse every 120 ms, with at most four live tails.
   if(clock-lastImpulse>=.12||power===3){bursts.push({at:clock,id:e.id,power});lastImpulse=clock;serial++;}bursts=bursts.slice(-4);
  }
  bursts=bursts.filter(b=>clock-b.at<(b.power===3?1.45:.95));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,visible=!s.paused&&['battle','celebration'].includes(s.phase);
  offset={x:0,y:0};let peak=0;
  if(visible&&!reduced)for(const b of bursts){const t=clock-b.at-(b.power===3?.43:0),duration=b.power===3?.85:b.power===2?.55:.34;if(t<0||t>duration)continue;
   const envelope=(1-t/duration)**2,amp=([0,.09,.16,.25][b.power])*envelope;
   offset.x+=Math.cos(t*73+b.id)*amp;offset.y+=Math.sin(t*93+b.id)*amp*.58;peak=Math.max(peak,amp);
  }
  offset.x=clamp(offset.x,-.28,.28);offset.y=clamp(offset.y,-.17,.17);
  canvas.style.display=visible&&bursts.some(b=>b.power<3)?'block':'none';
  if(canvas.style.display==='block'){
   const w=canvas.clientWidth,h=canvas.clientHeight,scale=Math.min(1,1400/w,1000/h);if(art.width!==Math.round(w*scale)||art.height!==Math.round(h*scale)){art.width=Math.round(w*scale);art.height=Math.round(h*scale);}p.setTransform(scale,0,0,scale,0,0);p.clearRect(0,0,w,h);
   for(const b of bursts){if(b.power===3)continue;const a=clock-b.at,cx=w*.5,cy=h*(w/h<1.05?.4:.33),fade=clamp(1-a/.85,0,1);
    if(!reduced){const g=p.createRadialGradient(cx,cy,0,cx,cy,w*.43);g.addColorStop(0,`rgba(255,205,126,${fade*(b.power===2?.19:.11)})`);g.addColorStop(1,'#e7af6000');p.fillStyle=g;p.fillRect(0,0,w,h);
     const radius=(30+a*250)*(b.power===2?1.3:1);p.strokeStyle=`rgba(255,222,168,${fade*.65})`;p.lineWidth=1+fade*2;p.beginPath();p.ellipse(cx,cy,radius,radius*.38,0,0,Math.PI*2);p.stroke();
     for(let i=0;i<(b.power===2?40:24);i++){const angle=i*2.39996+b.id,life=clamp(a/.85,0,1),r=25+life*(90+i%7*20),x=cx+Math.cos(angle)*r,y=cy+Math.sin(angle)*r*.65+life*life*45,size=(2+i%3)*fade;p.save();p.translate(x,y);p.rotate(angle+life*3);p.globalAlpha=fade;p.fillStyle=i%3?'#eac177':'#fff3cc';p.fillRect(-size,-size*.4,size*2,size*.8);p.restore();}
    }
   }
   ui.draw({ui:{kind:'screen',id:'reward_impact',node:'impact:'+clock,children:[{id:'impact_art',kind:'image',asset:'impact',fit:'stretch',rect:{x:0,y:0,width:100,height:100}}]}});
  }
  report={impulses:serial,liveImpulses:bursts.length,offset:{...offset},peak,reducedMotion:reduced,hudShakes:false,particleBudget:reduced?0:160,diagnostics:ui.report().diagnostics};
 }
 function applyCamera(c){
  if(!c||(!offset.x&&!offset.y))return;
  const dx=c.target.x-c.position.x,dz=c.target.z-c.position.z,len=Math.hypot(dx,dz)||1,rx=-dz/len,rz=dx/len;
  // Move eye and target together; the renderer's actual camera is also the
  // raycast/picking camera. No CSS transform and no accumulated camera drift.
  for(const point of [c.position,c.target]){point.x+=rx*offset.x;point.y+=offset.y;point.z+=rz*offset.x;}
 }
 return {update,applyCamera,inspect:()=>report,dispose(){ui.dispose();canvas.remove();}};
}
