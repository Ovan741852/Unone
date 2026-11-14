// The official Web player's startup screen: a logo, a progress bar over the
// player's real startup steps and, when startup or the game fails, the error.
// index.html draws it before any script runs (the "player" step, while the
// browser fetches this module graph, is indeterminate); main.js drives the rest
// and hides it once the first frame is presented. The screen covers the whole window and centres
// on it, which is also the centre of a letterboxed stage (display aspect "keep"), so a logo or an
// error never has to fit a thin stage band. Weights are each step's share
// of the bar, not timings: a step moves the bar only when it really progresses.
const STEPS=[
 ['player','Loading player',10],
 ['content','Loading game content',5],
 ['images','Preparing images',15],
 ['fonts','Loading fonts',10],
 ['runtime','Starting runtime',25],
 ['data','Loading data',10],
 ['game','Starting game',10],
 ['renderer','Preparing renderer',5],
 ['audio','Loading audio',5],
 ['present','Preparing first frame',5],
];
export const STARTUP_STEPS=Object.freeze(STEPS.map(([id,label,weight])=>Object.freeze({id,label,weight})));
const TOTAL_WEIGHT=STARTUP_STEPS.reduce((sum,step)=>sum+step.weight,0);
const lower=text=>text[0].toLowerCase()+text.slice(1);

export function createStartupScreen({root=null,body=null,boot=0,now=()=>performance.now(),hideDelayMs=300,schedule=(work,ms)=>setTimeout(work,ms)}={}){
 const steps=new Map(STARTUP_STEPS.map(step=>[step.id,{...step,state:'pending',fraction:0,done:null,total:null,ms:null}]));
 const part=name=>root?.querySelector?.(`.unone-startup-${name}`)??null;
 const bar=part('bar'),fill=part('fill'),label=part('label'),error=part('error');
 let state='loading',failedStep=null,message=null;
 function stepOf(id){const step=steps.get(id);if(!step)throw Error(`PLAYER_STARTUP_STEP_UNKNOWN: ${id}`);return step;}
 // Concurrent steps (data loads beside images, fonts and runtime) are named in table order.
 function current(){
  for(const step of steps.values())if(step.state==='active')return step;
  for(const step of steps.values())if(step.state==='pending')return step;
  return null;
 }
 function progress(){let sum=0;for(const step of steps.values())sum+=step.weight*(step.state==='done'?1:step.fraction);return sum/TOTAL_WEIGHT;}
 function text(){
  if(state==='failed')return failedStep?`Startup failed while ${lower(stepOf(failedStep).label)}`:'The game stopped';
  if(state==='ready')return 'Ready';
  const step=current();if(!step)return 'Ready';
  // Image preparation counts half an entry per phase; show whole entries.
  return step.total?`${step.label} ${Math.floor(step.done)}/${step.total}`:`${step.label}…`;
 }
 function report(){
  return {state,progress:Math.round(progress()*10000)/10000,step:state==='loading'?current()?.id??null:null,failed_step:failedStep,
   steps:[...steps.values()].map(({id,state,done,total,ms})=>({id,state,...(total?{done,total}:{}),...(ms===null?{}:{ms})}))};
 }
 function render(){
  const value=progress();
  if(root){root.dataset.state=state;root.hidden=false;}
  if(fill)fill.style.transform=`scaleX(${value})`;
  if(bar)bar.setAttribute('aria-valuenow',String(Math.round(value*100)));
  if(label)label.textContent=text();
  if(error){error.textContent=message??'';error.hidden=message===null;}
  try{if(body)body.dataset.playerStartup=JSON.stringify(report());}catch{}
 }
 function finish(step){if(step.state==='done')return;step.state='done';step.fraction=1;step.ms=Math.round(now()-boot);}
 const api={
  start(id){const step=stepOf(id);if(state!=='loading'||step.state!=='pending')return;step.state='active';render();},
  // Counted work inside a step: data files, image entries, font faces. Never moves backwards.
  progress(id,done,total){const step=stepOf(id);if(state!=='loading'||step.state==='done')return;
   if(!(Number.isFinite(done)&&Number.isFinite(total)&&total>0))return;
   step.state='active';step.total=total;step.done=Math.min(Math.max(done,step.done??0),total);step.fraction=Math.max(step.fraction,step.done/total);render();},
  complete(id){const step=stepOf(id);if(state!=='loading')return;finish(step);render();},
  // The first frame is presented: the screen fades out and stops covering the game.
  ready(){if(state!=='loading')return;for(const step of steps.values())finish(step);state='ready';render();
   root?.setAttribute?.('aria-hidden','true');
   schedule(()=>{if(state==='ready'&&root)root.hidden=true;},hideDelayMs);},
  // A startup failure names its step; a failure after the first frame shows the screen again.
  fail(reason){
   if(state==='loading')failedStep=current()?.id??null;
   state='failed';message=String(reason?.message??reason);
   root?.removeAttribute?.('aria-hidden');render();
  },
  report,
 };
 api.complete('player');
 return api;
}
