import {createWinDock} from './win-dock.mjs';
import {createRewardImpact} from './reward-impact.mjs';
export async function createRewardPresentation({assetBase='',container=document.body,getInsets=()=>({})}={}){
 const dock=await createWinDock({assetBase,container,getInsets});
 const impact=createRewardImpact({container});
 const special=document.createElement('canvas');special.width=360;special.height=440;special.id='special-reward';special.style.cssText='position:fixed;left:50%;top:14%;transform:translateX(-50%);width:180px;height:220px;pointer-events:none;z-index:48';container.append(special);const paint=special.getContext('2d');

 let lastEvent=0,lastFired=0,lastCrit=0,lastHorde=false,audio,muted=false,clock=0,cues=[],lastRoll=-1,rollTick=0,lastPhase='';
 const unlock=()=>{audio??=new AudioContext();if(audio.state==='suspended')audio.resume().catch(()=>{})};
 document.addEventListener('pointerdown',unlock);
 function tone(frequency,duration,volume,type='sine',decay=.55){
  if(muted||!audio||audio.state!=='running')return;
  const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
  oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,now);oscillator.frequency.exponentialRampToValueAtTime(frequency*decay,now+duration);
  gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  oscillator.connect(gain).connect(audio.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};oscillator.start();oscillator.stop(now+duration);
 }
 function update(s,dt){
  if(!s)return;dock.update(s,dt);impact.update(s,dt);clock+=s.paused?0:Math.min(.1,dt);
  if(s.event<lastEvent||(s.phase==='menu'&&lastPhase!=='menu')){lastEvent=0;cues=[];lastRoll=-1;}lastPhase=s.phase;
  muted=Boolean(s.audioMuted)||s.paused;if(s.fired>lastFired)tone(240,.09,.018,'triangle');lastFired=s.fired;
  if(s.criticalHits>lastCrit)tone(440,.12,.018,'triangle');lastCrit=s.criticalHits??0;
  const horde=s.hordeNotice>0;if(horde&&!lastHorde)tone(130,.5,.025,'sawtooth');lastHorde=horde;
  if(s.event<lastEvent)lastEvent=0;
  const fresh=Object.values(s.rewards??{}).filter(e=>e.id>lastEvent&&(e.playerId??s.seat)===(s.seat??1));lastEvent=s.event;
  if(fresh.length){const e=fresh.sort((a,b)=>b.tier-a.tier||b.amount-a.amount)[0];
   if(e.tier<3)tone(660,.16,.014);
   else{
    const ultimate=e.tier>=4,mega=e.title==='MEGA WIN',delay=ultimate?.43:0;
    if(ultimate){cues=[];tone(196,.42,.018,'triangle',2);}
    cues.push({at:clock+delay,f:ultimate?65:mega?82:110,d:ultimate?.85:.35,v:.038,type:'sine',decay:.36});
    for(const [i,f]of (ultimate?[523,659,784,1046,1319]:mega?[659,784,1046]:[784,988,1175]).entries())cues.push({at:clock+delay+.06+i*.075,f,d:ultimate?1.05:.45,v:.014,type:'triangle',decay:1});
    if(ultimate)for(const f of [523,784,1046])cues.push({at:clock+4.45,f,d:1.1,v:.012,type:'sine',decay:1});
    cues=cues.slice(-24);
   }
  }
  if(!s.paused){const due=cues.filter(c=>c.at<=clock);cues=cues.filter(c=>c.at>clock);for(const c of due)tone(c.f,c.d,c.v,c.type,c.decay);}
  const fx=dock.inspect();
  if(fx.celebrationVisible&&fx.stage==='count'&&fx.rolledAmount!==lastRoll&&clock-rollTick>.09){tone(1320+(fx.rolledAmount%5)*55,.045,.005,'sine',1);rollTick=clock;}lastRoll=fx.rolledAmount;
  const wheel=s.roulette,age=wheel?s.rewardClock-wheel.time:99;
  const key=s.phase==='celebration'?'':wheel&&age<3.5?'wheel':s.chestCount>0&&!s.chestResult&&['clear','victory'].includes(s.phase)?'chest':'';
  paint.clearRect(0,0,360,440);paint.save();paint.scale(2,2);paint.translate(90,96);
  if(key==='wheel'){
   const progress=Math.min(1,age/2.6),angle=(1-(1-progress)**3)*(1080-(wheel.result-1)*60-30)*Math.PI/180;
   paint.save();paint.rotate(angle);for(let i=0;i<6;i++){paint.beginPath();paint.moveTo(0,0);paint.arc(0,0,77,i*Math.PI/3,(i+1)*Math.PI/3);paint.closePath();paint.fillStyle=['#c2a05a','#356b59','#7f5276','#477184','#a76943','#8c9346'][i];paint.fill();paint.strokeStyle='#f7df93';paint.lineWidth=2;paint.stroke()}paint.restore();paint.fillStyle='#fff1ad';paint.beginPath();paint.moveTo(-9,-89);paint.lineTo(9,-89);paint.lineTo(0,-69);paint.fill();paint.font='bold 14px "Microsoft JhengHei"';paint.textAlign='center';paint.fillText(age<2.6?'奇遇輪盤':wheel.label,0,107);
  }else if(key==='chest'){
   const gold=['#b6854b','#63aa8c','#f2c94c'][s.chests?.[0]?.tier-1]??'#b6854b',p=Math.min(1,s.chestHold??0);
   const poly=(points,fill,stroke='#302c23')=>{paint.beginPath();points.forEach(([x,y],i)=>i?paint.lineTo(x,y):paint.moveTo(x,y));paint.closePath();paint.fillStyle=fill;paint.fill();paint.strokeStyle=stroke;paint.lineWidth=2;paint.stroke();};
   paint.fillStyle='#091e20';paint.beginPath();paint.ellipse(0,42,70,12,0,0,Math.PI*2);paint.fill();
   if(p>0){const glow=paint.createRadialGradient(0,-20,2,0,-20,85);glow.addColorStop(0,'#ffe7a5');glow.addColorStop(1,'#ffe7a500');paint.globalAlpha=p*.75;paint.fillStyle=glow;paint.fillRect(-85,-100,170,155);paint.globalAlpha=1;}
   poly([[-64,-16],[45,-10],[45,43],[-59,36]],'#74503a');
   poly([[45,-10],[66,-25],[64,28],[45,43]],'#3d4330');
   poly([[-58,-9],[39,-4],[37,10],[-58,2]],'#986a45');
   poly([[-57,7],[38,14],[36,36],[-55,28]],'#5d4333');
   for(const x of [-48,25])poly([[x,-14],[x+11,-13],[x+11,39],[x,38]],gold);
   paint.save();paint.translate(0,-p*30);paint.rotate(-p*.15);
   poly([[-64,-18],[-52,-44],[47,-40],[46,-10]],'#9e754e');
   poly([[-52,-44],[-32,-59],[66,-52],[47,-40]],'#b59863');
   poly([[47,-40],[66,-52],[66,-25],[46,-10]],'#5b543b');
   for(const x of [-47,26])poly([[x,-18],[x+1,-44],[x+14,-43],[x+13,-17]],gold);
   poly([[-57,-15],[42,-8],[43,-1],[-58,-9]],gold);paint.restore();
   poly([[-10,-13],[10,-11],[13,5],[0,17],[-14,2]],gold);
   poly([[-3,-7],[3,-6],[4,4],[-3,3]],'#44372b');
   paint.fillStyle='#fbe8b1';for(const [x,y]of [[-43,24],[30,31],[-42,-29],[32,-24]]){paint.beginPath();paint.arc(x,y,2,0,Math.PI*2);paint.fill();}

  }
  paint.restore();special.style.display=key&&!s.paused?'block':'none';
  // Leave the earned/refund/crystal rows clear. The chest is a small ornament
  // beside the open button (below it on portrait), with no duplicate caption.
  const portrait=innerWidth/innerHeight<1.05;
  special.style.left=key==='wheel'?'84%':portrait?'50%':'88%';special.style.top=key==='wheel'?'24%':portrait?'74%':'59%';
  special.style.width=key==='wheel'?'min(20vw,150px)':portrait?'min(18vw,70px)':'min(14vw,16vh,120px)';special.style.height='auto';
 }
 return {update,applyCamera:impact.applyCamera,inspect:()=>({...dock.inspect(),impact:impact.inspect(),audio:{pendingCues:cues.length,muted}}),dispose(){document.removeEventListener('pointerdown',unlock);audio?.close();impact.dispose();dock.dispose();special.remove()}};
}
