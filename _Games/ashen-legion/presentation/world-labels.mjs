import {createCanvasUi} from '../web/shared/canvas-ui.mjs';
import {combatFeedbackLayout,percentRect,clamp,easeOut} from './combat-feedback-layout.mjs';
import {guardFeedback} from './guard-feedback.mjs';
// Actual hit/reward receipts become noninteractive official Canvas image nodes.
// Glyph sprites are original vector drawing, with a bounded cache and no DOM text.
export function createWorldLabels({before,projectPoint,getInsets=()=>({})}){
 const canvas=document.createElement('canvas');canvas.id='world-labels';canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';before.before(canvas);
 const cache=new Map();
 function sprite(id){
  if(cache.has(id)){const value=cache.get(id);cache.delete(id);cache.set(id,value);return value;}
  const [kind,value='',fade='16']=id.split('|'),c=document.createElement('canvas'),p=c.getContext('2d');
  if(kind==='guard'){
   c.width=360;c.height=74;p.fillStyle='#14232bef';p.beginPath();p.moveTo(10,0);p.lineTo(360,0);p.lineTo(350,66);p.lineTo(0,66);p.closePath();p.fill();
   const [steps,state]=value.split(':');p.fillStyle='#334440';p.fillRect(12,52,336,10);
   p.fillStyle=state==='near'?'#efb86a':state==='miss'?'#8c9b9a':'#71b9af';p.fillRect(12,52,336*Number(steps)/20,10);
   if(state==='near'){p.fillStyle='#ffe7b2';p.fillRect(12,3,336,2);}
  }else if(kind==='elite'){
   c.width=360;c.height=74;p.fillStyle='#14232bdf';p.beginPath();p.moveTo(10,0);p.lineTo(360,0);p.lineTo(350,66);p.lineTo(0,66);p.closePath();p.fill();p.fillStyle='#c5a178';p.fillRect(12,3,336,2);
  }else if(kind==='burst'){
   c.width=c.height=128;p.globalAlpha=Number(fade)/16;p.translate(64,64);
   for(let i=0;i<8;i++){p.rotate(Math.PI/4);p.fillStyle=i%2?'#ffeabb':'#e28f3c';p.beginPath();p.moveTo(0,-56);p.lineTo(5,-18);p.lineTo(0,-5);p.lineTo(-3,-18);p.closePath();p.fill();}
   p.strokeStyle='#ffebc9';p.lineWidth=3;p.rotate(.3);p.beginPath();p.moveTo(-27,14);p.lineTo(27,-14);p.stroke();
  }else{
   const crit=kind==='critical',gold=kind==='gold';p.font='bold 96px Georgia,serif';
   c.width=Math.ceil(p.measureText(value).width)+50+(gold?48:0);c.height=crit?176:132;
   p.globalAlpha=Number(fade)/16;p.font='bold 96px Georgia,serif';p.textAlign='center';p.lineJoin='round';
   const x=c.width/2+(gold?18:0),y=crit?144:102;
   const gradient=p.createLinearGradient(0,y-85,0,y+5);
   const tint=kind==='poison'?['#eeffd1','#b7d875','#619854']:kind==='burn'?['#fff1c9','#edb563','#ce6b3d']:kind==='electric'?['#e8fdff','#8de1eb','#559bab']:null;
   gradient.addColorStop(0,tint?.[0]??(crit?'#fff6d1':gold?'#fff2bf':'#fff7e8'));gradient.addColorStop(.6,tint?.[1]??(crit?'#ffd259':gold?'#f4d08b':'#f0e6d8'));gradient.addColorStop(1,tint?.[2]??(crit?'#e9753b':gold?'#ce9f55':'#c4bcae'));
   p.shadowColor='#160e14';p.shadowBlur=9;p.shadowOffsetY=5;p.strokeStyle=crit?'#64281c':'#21181c';p.lineWidth=10;p.strokeText(value,x,y);p.fillStyle=gradient;p.fillText(value,x,y);
   if(crit){p.shadowBlur=0;p.font='bold 24px "Microsoft JhengHei",sans-serif';p.lineWidth=5;p.strokeText('爆擊',c.width/2,31);p.fillStyle='#ffe1a1';p.fillText('爆擊',c.width/2,31);}
   if(gold){p.shadowBlur=0;p.fillStyle='#f4c85e';p.strokeStyle='#402918';p.lineWidth=5;p.beginPath();p.ellipse(30,69,19,27,-.2,0,Math.PI*2);p.fill();p.stroke();p.strokeStyle='#fff0b3';p.lineWidth=3;p.beginPath();p.moveTo(29,54);p.lineTo(32,84);p.stroke();}
  }
  cache.set(id,c);while(cache.size>240)cache.delete(cache.keys().next().value);return c;
 }
 const ui=createCanvasUi(canvas,{resolveAsset:sprite,fontFamily:'"Microsoft JhengHei",sans-serif',textColor:'#ead6aa'});
 let report={labels:0,payouts:0,damage:0,criticals:0,items:[]};
 return {draw(s){
  const children=[],occupied=[],w=canvas.clientWidth,h=canvas.clientHeight,{portrait,field}=combatFeedbackLayout({width:w,height:h,insets:getInsets()});
  report={labels:0,payouts:0,damage:0,criticals:0,items:[],guards:[],nameplates:[],missLabels:0,usesMultiplier:false};
  const image=(id,asset,rect)=>children.push({id,kind:'image',asset,fit:'contain',rect:percentRect(rect,w,h)});
  function place(id,asset,point,height){
   const art=sprite(asset),width=height*art.width/art.height;
   const r={x:clamp(point.x-width/2,field.x,field.x+field.width-width),y:clamp(point.y-height,field.y,field.y+field.height-height),width,height};
   let clear=false;for(let i=0;i<5;i++){
    const overlap=occupied.some(b=>r.x<b.x+b.width+3&&r.x+r.width+3>b.x&&r.y<b.y+b.height+3&&r.y+r.height+3>b.y);
    if(!overlap){clear=true;break;}r.y-=height*.68+3;if(r.y<field.y)break;
   }
   if(!clear||r.y<field.y)return null;occupied.push(r);image(id,asset,r);return r;
  }
  if(s?.phase==='battle'&&!s.paused){
   const now=s.rewardClock,scale=clamp(Math.min(w/900,h/650),.75,1.15),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   const hits=Object.values(s.damageEvents??{}).filter(e=>e.playerId===(s.seat??1)&&now-e.time>=0&&now-e.time<(e.critical?1.05:.82)).sort((a,b)=>Number(b.critical)-Number(a.critical)||b.time-a.time).slice(0,portrait?14:22);
   const prizes=Object.values(s.rewards??{}).filter(e=>(e.playerId??s.seat)===(s.seat??1)&&now-e.time>=0&&now-e.time<1.25).sort((a,b)=>b.amount-a.amount||b.id-a.id).slice(0,4);
   const loot=Object.values(s.plunderEvents??{}).filter(e=>e.playerId===(s.seat??1)&&now-e.time>=0&&now-e.time<.7).slice(-4);
   const events=[...loot.map(e=>({...e,id:1000000+e.id,kind:'gold',plunder:true})),...hits.map(e=>({...e,kind:e.critical?'critical':'damage'})),...prizes.map(e=>({...e,kind:'gold'}))].sort((a,b)=>(a.kind==='damage')-(b.kind==='damage')||b.time-a.time);
   for(const e of events){
    const age=now-e.time,critical=e.kind==='critical',gold=e.kind==='gold',life=gold?1.25:critical?1.05:.82;
    const fade=Math.max(1,Math.round(16*(1-clamp((age-life*.6)/(life*.4),0,1))));
    const value=(gold?'+':'')+Math.max(1,Math.round(e.amount)).toLocaleString('en-US');
    const point=projectPoint(e.x,e.z,([.8,1,1.5,1.8,2.7][(e.rank??2)-1]??1));
    point.x+=reduced?0:((e.id%5)-2)*6*easeOut(age/.45);point.y-=reduced?12:8+38*easeOut(age/life);
    const pop=critical&&!reduced?1+.3*Math.sin(Math.PI*clamp(age/.22,0,1)):1,height=(critical?48:e.plunder?21:gold?30:29)*scale*pop;
    const tint=e.damageType==='poison'?'poison':['burn','flame_cloak','ignite'].includes(e.damageType)?'burn':['lightning','conduct','electrified'].includes(e.damageType)?'electric':e.kind;
    const r=place(e.kind+'_'+e.id,tint+'|'+value+'|'+fade,point,e.secondary?height*.83:height);if(!r)continue;
    if(critical){report.criticals++;if(age<.22&&!reduced){const size=(24+35*easeOut(age/.22))*scale;image('crit_burst_'+e.id,'burst||'+Math.max(1,Math.round(16*(1-age/.22))),{x:r.x+r.width/2-size/2,y:r.y+r.height*.7-size/2,width:size,height:size});}}
    if(gold)report.payouts++;else report.damage++;
    report.items.push({id:e.id,kind:e.kind,text:value,amount:e.amount,rect:r});
   }
   // Progress never promotes an untargeted monster into an attention banner.
   const monsters=Object.values(s.monsters??{}).map(m=>({m,guard:guardFeedback(m,s)})).filter(({m})=>m.rank>=3||m.id===s.targetId)
    .sort((a,b)=>(b.m.id===s.targetId)-(a.m.id===s.targetId)||b.m.rank-a.m.rank||a.m.id-b.m.id).slice(0,portrait?3:4);
   for(const {m,guard:g} of monsters){
    const p=projectPoint(m.x,m.z,[1,1.6,2.5,3.1,4.8][m.rank-1]),name=(m.id===s.targetId?'◆ ':m.rank>=4?'♛ ':'')+m.name;
    const detailed=m.id===s.targetId;
    const r=place('monster_'+m.id,detailed?'guard|'+Math.floor(g.progress*20)+':'+g.kind:'elite',p,(detailed?29:17)*scale);
    if(r){const text=detailed?name+' · '+g.label+(g.kind==='miss'?'':' '+g.percent+'%'):name;
     children.push({id:'monster_name_'+m.id,kind:'text',text,rect:percentRect({x:r.x+4,y:r.y+1,width:r.width-8,height:r.height*(detailed?.64:.82)},w,h)});
     report.labels++;report.nameplates.push({id:m.id,text,targeted:m.id===s.targetId,kind:detailed?g.kind:'elite',rect:r});
     if(detailed){report.guards.push({id:m.id,...g,rect:r});if(g.kind==='miss')report.missLabels++;}
    }
   }
  }
  ui.draw({ui:{kind:'screen',id:'world_annotations',node:s?.phase??'loading',children}});report.cacheSize=cache.size;
 },inspect:()=>({...report,diagnostics:ui.report().diagnostics}),dispose(){ui.dispose();canvas.remove();cache.clear()}};
}
