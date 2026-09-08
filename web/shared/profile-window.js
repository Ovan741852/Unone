// Host-only measurements. Never feed timing into simulation inputs.
export function createProfileWindow(limit=2048){
 let active=false,id=0,started=0,ended=0,ticks=[],frames=[],tickCount=0,frameCount=0;
 const push=(array,value)=>{if(array.length===limit)array.shift();array.push(value);};
 const stats=(values)=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b);return {samples:v.length,mean_ms:v.reduce((a,b)=>a+b,0)/v.length,median_ms:v[Math.floor(v.length/2)],p95_ms:v[Math.ceil(v.length*.95)-1],max_ms:v.at(-1)};};
 return {
  start(){active=true;id++;started=performance.now();ended=0;ticks=[];frames=[];tickCount=0;frameCount=0;},
  stop(){if(active)ended=performance.now();active=false;},
  tick(value){if(active){tickCount++;push(ticks,value);}},
  frame(value){if(active){frameCount++;push(frames,value);}},
  read(){return {id,active,wall_ms:id?(active?performance.now():ended)-started:0,tick_count:tickCount,render_count:frameCount,retained_limit:limit,
   cpu:Object.fromEntries(['input_ms','wasm_tick_publish_ms','decode_ms'].map(k=>[k,stats(ticks.map(v=>v[k]))])),render_cpu:stats(frames),
   note:'Disjoint host CPU spans. WASM tick includes runtime and publication. GPU timing is separate. Distributions cover retained samples only.'};},
 };
}
