import {createLottieHost} from './lottie/runtime/lottie.mjs';
import {clamp,easeOut} from './combat-feedback-layout.mjs';
// Entirely presentation: a deterministic ceremony consumes a settled receipt.
export async function createUltimateWin(assetBase=''){
 const response=await fetch(assetBase+'presentation/lottie/ultimate-crown.json');if(!response.ok)throw Error('Ultimate crown: '+response.status);
 const crown=document.createElement('canvas');crown.width=800;crown.height=480;
 const host=createLottieHost({assets:{crown:await response.json()}}),mount=host.mount({instanceId:'crown',asset:'crown',canvas:crown,pointerEvents:'passthrough'});if(!mount.ok)throw Error(JSON.stringify(mount));
 const canvas=document.createElement('canvas'),p=canvas.getContext('2d');let last={};
 const poly=(points,color)=>{p.beginPath();points.forEach(([x,y],i)=>i?p.lineTo(x,y):p.moveTo(x,y));p.closePath();p.fillStyle=color;p.fill();};
 function text(value,x,y,size,color,{stroke=true,font='Georgia',maxWidth=Infinity}={}){
  p.font=`bold ${size}px ${font},serif`;const fit=Math.min(1,maxWidth/Math.max(1,p.measureText(value).width));p.font=`bold ${size*fit}px ${font},serif`;p.textAlign='center';p.lineJoin='round';
  if(stroke){p.strokeStyle='#432d2e';p.lineWidth=Math.max(2,size*.075);p.strokeText(value,x,y+size*.03);}p.fillStyle=color;p.fillText(value,x,y);
 }
 function render({width:w,height:h,age,amount,duration=6.4,reduced=false,insets={}}){
  // Pixel budget is bounded on high-DPR phones; Canvas UI handles final scaling.
  const scale=Math.min(1,1600/w,1200/h),W=Math.round(w*scale),H=Math.round(h*scale);if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  p.setTransform(scale,0,0,scale,0,0);p.clearRect(0,0,w,h);
  const a=clamp(age,0,duration),out=1-easeOut((a-(duration-.65))/.65),entry=reduced?1:easeOut(a/.28),alpha=entry*out;
  const l=insets.left??0,r=insets.right??0,t=insets.top??0,b=insets.bottom??0,sw=w-l-r,sh=h-t-b,cx=l+sw/2,portrait=sw/sh<1.05;
  p.save();p.globalAlpha=alpha;
  const bg=p.createRadialGradient(cx,sh*.43,0,cx,sh*.45,Math.max(w,h)*.78);bg.addColorStop(0,'#403837');bg.addColorStop(.45,'#182c2c');bg.addColorStop(1,'#07171d');p.fillStyle=bg;p.fillRect(0,0,w,h);
  // Slow two-color illumination. No repeated full-screen strobe.
  for(const [x,color]of [[w*.12,'#be743547'],[w*.94,'#598f9344']]){const g=p.createRadialGradient(x,h*.4,0,x,h*.4,h*.68);g.addColorStop(0,color);g.addColorStop(1,'#00000000');p.fillStyle=g;p.fillRect(0,0,w,h);}
  const cy=t+sh*(portrait?.36:.34),radius=Math.max(w,h)*.8;
  if(!reduced){p.save();p.translate(cx,cy);p.rotate(a*.025);for(let i=0;i<20;i++){const angle=i*Math.PI/10;p.save();p.rotate(angle);poly([[0,0],[-radius*.024,-radius],[radius*.04,-radius]],i%2?'#dba8540b':'#ffd99b14');p.restore();}p.restore();}
  // Low-poly border cuts, both color and shape match the faceted portrait art.
  p.strokeStyle='#b48c5266';p.lineWidth=1;p.strokeRect(l+12,t+12,sw-24,sh-24);
  for(const [x,y,sx,sy]of [[l+12,t+12,1,1],[w-r-12,t+12,-1,1],[l+12,h-b-12,1,-1],[w-r-12,h-b-12,-1,-1]]){p.save();p.translate(x,y);p.scale(sx,sy);poly([[0,0],[54,0],[33,6],[9,9],[6,33],[0,54]],'#e8bd77');p.restore();}
  if(!reduced&&a>.42){
   const ring=easeOut((a-.42)/.75);p.strokeStyle=`rgba(255,222,156,${(1-ring)*.75})`;p.lineWidth=3+(1-ring)*10;p.beginPath();p.ellipse(cx,cy,Math.max(1,sw*.8*ring),Math.max(1,sh*.48*ring),0,0,Math.PI*2);p.stroke();
   for(let i=0;i<(portrait?60:104);i++){
    const delay=(i%17)*.095,u=a-.45-delay;if(u<0)continue;const period=2.3+(i%7)*.12,life=u%period,angle=i*2.39996,x=cx+Math.sin(angle)*(sw*.15+sw*.055*life*(i%6+1)),y=cy-Math.cos(angle)*sh*.19-life*sh*.31+life*life*sh*.23;
    const size=(4+i%6)*Math.min(1.3,sw/600+.5);p.save();p.translate(x,y);p.rotate(angle+life*(i%2?1:-1)*2.5);p.globalAlpha=alpha*Math.min(1,life*6)*clamp((period-life)*2,0,1);
    if(i%3){
     p.scale(.28+.72*Math.abs(Math.cos(life*4+i)),1);
     const points=Array.from({length:8},(_,k)=>[Math.cos(k*Math.PI/4)*size,Math.sin(k*Math.PI/4)*size]);poly(points,'#ad6c30');p.translate(-size*.12,-size*.18);poly(points,'#eac16a');p.strokeStyle='#fff1b0';p.lineWidth=1;p.stroke();p.fillStyle='#ae782f';p.fillRect(-size*.13,-size*.53,size*.26,size*1.06);
    }else{poly([[-size*.5,-size*.5],[size*.5,-size*.5],[size*.5,size*.5],[-size*.5,size*.5]],'#fff1b4');}
    p.restore();
   }
  }
  // The crown uses the official Lottie player, not CSS keyframes.
  host.seekFrame('crown',reduced?150:Math.min(383,a*60));
  const artW=Math.min(sw*(portrait?1.06:.74),sh*(portrait?.85:1.30)),artH=artW*.6;
  p.drawImage(crown,cx-artW/2,cy-artH*.51,artW,artH);
  const titleY=t+sh*(portrait?.535:.53),reveal=reduced?1:easeOut((a-.43)/.25);
  p.save();p.globalAlpha=alpha*reveal;
  const gold=p.createLinearGradient(0,titleY-sh*.04,0,titleY+sh*.25);gold.addColorStop(0,'#fff2c4');gold.addColorStop(.5,'#efc174');gold.addColorStop(1,'#bf7e44');
  text('LEGENDARY',cx,titleY,Math.min(portrait?44:78,sw*.099),gold,{maxWidth:sw*.87});
  text('WIN',cx,titleY+sh*.071,Math.min(portrait?50:88,sh*.079),gold);
  text('終 極 大 獎',cx,t+sh*(portrait?.145:.12),Math.max(14,Math.min(21,sw*.034)),'#efd8a8',{stroke:false,font:'"Microsoft JhengHei"'});
  const scoreY=t+sh*.77,size=Math.min(portrait?67:112,sw*.16);
  p.shadowColor='#ffc76b66';p.shadowBlur=reduced?0:18;
  text('+'+amount.toLocaleString('en-US'),cx,scoreY,size,'#fff0b5',{maxWidth:sw*.86});p.shadowBlur=0;
  text('獲 得 金 幣',cx,scoreY+sh*.042,Math.max(12,Math.min(17,sw*.032)),'#d4b68b',{stroke:false,font:'"Microsoft JhengHei"'});
  const seal=clamp((a-4.45)/.3,0,1);p.globalAlpha=alpha*seal;
  text('森林記住了你的勝利',cx,t+sh*.882,Math.max(13,Math.min(20,sw*.039)),'#f0d3a0',{stroke:false,font:'"Microsoft JhengHei"',maxWidth:sw*.85});
  p.strokeStyle='#d9ae6a';p.lineWidth=1;p.beginPath();p.moveTo(cx-sw*.16,t+sh*.844);p.lineTo(cx+sw*.16,t+sh*.844);p.stroke();
  p.restore();
  if(!reduced){const flash=Math.max(0,1-Math.abs(a-.46)/.115)*.42;p.fillStyle=`rgba(255,228,174,${flash})`;p.fillRect(0,0,w,h);}
  p.restore();last={age:a,fullscreen:true,particleBudget:reduced?0:portrait?60:104,reducedMotion:reduced,lottie:host.inspect('crown'),safeRect:{x:l,y:t,width:sw,height:sh}};return canvas;
 }
 return {render,inspect:()=>last,dispose:()=>host.disposeHost()};
}
