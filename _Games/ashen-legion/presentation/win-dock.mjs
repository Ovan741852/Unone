import {createLottieHost} from './lottie/runtime/lottie.mjs';
import {createCanvasUi} from '../web/shared/canvas-ui.mjs';
import {combatFeedbackLayout,percentRect,clamp,easeOut} from './combat-feedback-layout.mjs';
import {createUltimateWin} from './ultimate-win.mjs';
const priority=e=>e.tier>=4?3:e.title==='MEGA WIN'?2:1;
const assetFor=p=>p===3?'legendary-win':p===2?'mega-win':'big-win';
// Presentation-only receipt accumulator. Wallet settlement never waits for this.
export async function createWinDock({assetBase='',container=document.body,getInsets=()=>({})}={}){
 const assets=Object.fromEntries(await Promise.all(['big-win','mega-win','legendary-win'].map(async id=>{
  const r=await fetch(assetBase+'presentation/lottie/'+id+'-dock.json');if(!r.ok)throw Error('Reward art failed: '+r.status);return [id,await r.json()];
 })));
 const canvas=document.createElement('canvas');canvas.id='official-lottie';canvas.style.cssText=`position:${container===document.body?'fixed':'absolute'};inset:0;width:100%;height:100%;pointer-events:none;z-index:8`;container.append(canvas);
 const art=document.createElement('canvas'),composite=document.createElement('canvas');for(const c of [art,composite]){c.width=960;c.height=220;}
 const host=createLottieHost({assets}),mounted=host.mount({instanceId:'reward',asset:'big-win',canvas:art,pointerEvents:'passthrough'});if(!mounted.ok)throw Error(JSON.stringify(mounted));
 const ultimate=await createUltimateWin(assetBase);let graphic=composite;
 const ui=createCanvasUi(canvas,{resolveAsset:()=>graphic}),paint=composite.getContext('2d');
 let clock=0,lastEvent=0,active=false,start=0,countStart=0,countDuration=1.35,countFrom=0,total=0,rolled=0,until=0,power=0,activeAsset=null,eventIds=[],completed=[],rect=null,dock=null,stage='idle',lastPhase='';
 const countAt=()=>Math.min(total,Math.floor(countFrom+(total-countFrom)*easeOut((clock-countStart)/countDuration)));
 function reset(){lastEvent=0;active=false;start=clock;total=rolled=countFrom=0;power=0;activeAsset=null;eventIds=[];stage='idle';}
 function update(s,dt){
  if(!s)return;clock+=s.paused?0:clamp(dt,0,.1);
  if(s.event<lastEvent||(s.phase==='menu'&&lastPhase!=='menu')){reset();completed=[];}lastPhase=s.phase;
  if(active&&power===3&&s.phase==='celebration'&&s.roundOutro?.tier===4&&eventIds.includes(s.roundOutro.eventId))clock=start+s.roundOutro.elapsed;
  if(active&&clock>=until){rolled=total;completed.push(total);completed=completed.slice(-8);active=false;}
  const fresh=Object.values(s.rewards??{}).filter(e=>e.id>lastEvent&&e.tier>=3&&(e.playerId??s.seat)===(s.seat??1)&&Number.isFinite(e.amount)&&e.amount>0);
  lastEvent=s.event??lastEvent;
  if(fresh.length){
   const newPower=Math.max(...fresh.map(priority)),sum=fresh.reduce((n,e)=>n+e.amount,0);
   if(!active){active=true;start=clock;countStart=clock+.56;countDuration=newPower===3?2:1.35;countFrom=0;rolled=0;total=sum;power=newPower;eventIds=[];activeAsset=assetFor(power);host.setSource('reward',activeAsset);}
   else {countFrom=countAt();total+=sum;countStart=Math.max(clock,start+.56);countDuration=power===3?Math.max(.1,start+4.35-countStart):newPower===3?1.8:1.2;if(newPower>power){power=newPower;activeAsset=assetFor(power);host.setSource('reward',activeAsset);}}
   // Escalation receives its own anticipation/impact, without losing a score
   // already accumulating. Smaller receipts cannot restart an ultimate.
   if(newPower===3){start=clock;countStart=clock+.85;countDuration=3.5;until=start+6.4;}
   else if(power!==3)until=countStart+countDuration+.85;
   eventIds.push(...fresh.map(e=>e.id));eventIds=eventIds.slice(-40);
  }
  // Authoritative Luau outro time also survives a hidden tab or paused frame.
  if(active&&power===3&&s.phase==='celebration'&&s.roundOutro?.tier===4&&eventIds.includes(s.roundOutro.eventId))clock=start+s.roundOutro.elapsed;
  if(active){rolled=countAt();stage=clock<start+.16?'burst':clock<start+.56?'travel':clock<countStart+countDuration?'count':'hold';}
  else stage='idle';
  const visible=active&&!s.paused&&['battle','celebration','clear','victory'].includes(s.phase);canvas.style.display=visible?'block':'none';
  if(!visible)return;
  const width=canvas.clientWidth,height=canvas.clientHeight,layout=combatFeedbackLayout({width,height,insets:getInsets()},s.phase);dock=layout.dock;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,age=clock-start;
  if(power===3){
   stage=age<.43?'anticipation':age<.85?'impact':age<4.35?'count':age<5.75?'hold':'exit';
   rect={x:0,y:0,width,height};dock=null;
   graphic=ultimate.render({width,height,age,amount:rolled,reduced,insets:getInsets()});
   ui.draw({ui:{kind:'screen',id:'ultimate_ceremony',node:'ultimate:'+clock,children:[{id:'ultimate_win',kind:'image',asset:'ultimate',fit:'stretch',rect:{x:0,y:0,width:100,height:100}}]}});
   return;
  }
  graphic=composite;
  const burstW=Math.min(width*(layout.portrait?.92:.42),660),burstH=burstW*220/960;
  const origin={x:width*.5-burstW/2,y:height*(layout.portrait?.40:.33)-burstH/2,width:burstW,height:burstH};
  const travel=reduced?1:easeOut((age-.16)/.4),pop=reduced?1:age<.16?1+.08*Math.sin(Math.PI*age/.16):1;
  rect=Object.fromEntries(['x','y','width','height'].map(k=>[k,origin[k]+(dock[k]-origin[k])*travel]));
  if(!reduced&&travel<1){rect.y-=Math.sin(travel*Math.PI)*height*.035;rect.x-=rect.width*(pop-1)/2;rect.y-=rect.height*(pop-1)/2;rect.width*=pop;rect.height*=pop;}
  rect.x=clamp(rect.x,0,width-rect.width);rect.y=clamp(rect.y,0,height-rect.height);
  host.seekFrame('reward',reduced?100:Math.min(100,age*60));
  paint.clearRect(0,0,960,220);paint.save();paint.globalAlpha=clamp((until-clock)/.25,0,1);paint.drawImage(art,0,0);
  paint.textAlign='center';paint.lineJoin='round';paint.font='bold 23px "Microsoft JhengHei",sans-serif';paint.fillStyle='#d3b890';paint.fillText('獲得金幣',709,65);
  const text='+'+rolled.toLocaleString('en-US');paint.font='bold 107px Georgia,serif';const size=107*Math.min(1,375/Math.max(1,paint.measureText(text).width));paint.font=`bold ${size}px Georgia,serif`;
  paint.shadowColor='#0d0b13';paint.shadowBlur=8;paint.shadowOffsetY=4;paint.strokeStyle='#53301f';paint.lineWidth=6;
  const gold=paint.createLinearGradient(0,70,0,170);gold.addColorStop(0,'#fffbe0');gold.addColorStop(.65,'#ffd87c');gold.addColorStop(1,'#be7c3c');paint.fillStyle=gold;paint.strokeText(text,710,164);paint.fillText(text,710,164);paint.restore();
  ui.draw({ui:{kind:'screen',id:'reward_dock',node:'reward:'+clock,children:[{id:'win_badge',kind:'image',asset:'badge',fit:'contain',rect:percentRect(rect,width,height)}]}});
 }
 return {update,inspect:()=>({...host.inspect('reward'),celebrationVisible:canvas.style.display==='block',fullscreen:active&&power===3,ultimate:power===3?ultimate.inspect():null,activeTier:power===3?4:power?3:0,activeAsset,stage,rolledAmount:rolled,targetAmount:total,eventIds:[...eventIds],completedAmounts:[...completed],dockRect:dock,visualRect:rect,usesMultiplier:false,pointerEvents:'none',diagnostics:ui.report().diagnostics}),dispose(){ultimate.dispose();host.disposeHost();ui.dispose();canvas.remove();}};
}
