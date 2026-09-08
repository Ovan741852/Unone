// Host-only measurements. Never feed timing into simulation inputs.
export function createProfileWindow(limit=2048,now=()=>performance.now()){
 let active=false,id=0,started=0,ended=0,ticks=[],frames=[],tickCount=0,frameCount=0,lastFrame=null,intervals=[],overBudget=0,intervalCount=0,dropStart=null,dropEnd=null;
 const push=(array,value)=>{if(array.length===limit)array.shift();array.push(value);};
 const stats=(values)=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b);return {samples:v.length,mean_ms:v.reduce((a,b)=>a+b,0)/v.length,median_ms:v[Math.floor(v.length/2)],p95_ms:v[Math.ceil(v.length*.95)-1],max_ms:v.at(-1)};};
 return {
  start(counters={}){dropStart=Number.isFinite(counters.dropped_steps)?counters.dropped_steps:null;dropEnd=null;active=true;id++;started=now();ended=0;ticks=[];frames=[];tickCount=0;frameCount=0;lastFrame=null;intervals=[];overBudget=0;intervalCount=0;},
  stop(counters={}){if(active){ended=now();dropEnd=Number.isFinite(counters.dropped_steps)?counters.dropped_steps:null;}active=false;},
  tick(value){if(active){tickCount++;push(ticks,value);}},
  frame(value){if(active){const at=now();if(lastFrame!==null){const gap=at-lastFrame;push(intervals,gap);intervalCount++;if(gap>1000/60)overBudget++;}lastFrame=at;frameCount++;push(frames,value);}},
  read(counters={}){const dropped=active?counters.dropped_steps:dropEnd;return {id,active,wall_ms:id?(active?now():ended)-started:0,tick_count:tickCount,render_count:frameCount,retained_limit:limit,
   dropped_steps_delta:dropStart!==null&&Number.isFinite(dropped)&&dropped>=dropStart?dropped-dropStart:null,
   cpu:Object.fromEntries(['input_ms','wasm_tick_publish_ms','decode_ms'].map(k=>[k,stats(ticks.map(v=>v[k]))])),render_cpu:stats(frames),
   render_cadence:{interval_ms:stats(intervals),interval_count:intervalCount,intervals_over_60hz:overBudget,
    note:'CPU render completion intervals, not verified display presentation. Includes scheduling and simulation; paused renders must not be used as gameplay FPS.'},
   note:'Disjoint host CPU spans. WASM tick includes runtime and publication. GPU timing is separate. Distributions cover retained samples only.'};},
 };
}
