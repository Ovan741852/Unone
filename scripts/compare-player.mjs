// Alternate fresh processes so one artifact does not always run first.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
const {values:v}=parseArgs({options:{before:{type:'string'},after:{type:'string'},output:{type:'string'},frames:{type:'string',default:'180'},warmup:{type:'string',default:'30'},pairs:{type:'string',default:'3'},'before-transport':{type:'string',default:'auto'},'after-transport':{type:'string',default:'auto'}}});
const pairs=Number(v.pairs);if(!v.before||!v.after||!Number.isInteger(pairs)||pairs<2||pairs>10)throw new Error('Use --before export --after export [--pairs 3] [--output report.json]');
const results=[],runner=fileURLToPath(new URL('./profile-player.mjs',import.meta.url));
for(let i=0;i<pairs;i++){
 const pair={order:i%2?['after','before']:['before','after']};
 for(const side of pair.order){const r=spawnSync(process.execPath,[runner,'--export',v[side],'--transport',v[side+'-transport'],'--frames',v.frames,'--warmup',v.warmup,'--repeats','1'],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:300000});if(r.status!==0)throw new Error(r.stderr+r.stdout);pair[side]=JSON.parse(r.stdout);console.error(`${i} ${side}: ${pair[side].runs[0].summary.total.mean_ms.toFixed(3)} ms/tick`);}
 if(JSON.stringify(pair.before.runs[0].checkpoints)!==JSON.stringify(pair.after.runs[0].checkpoints))throw new Error('BEHAVIOR_CHANGED: observation digest checkpoints differ; performance comparison rejected');
 results.push(pair);
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],means=side=>results.map(p=>p[side].runs[0].summary.total.mean_ms);
const before=median(means('before')),after=median(means('after'));
const report={version:1,method:'Alternating fresh Node processes; sampling off; fixed exported inputs; median of per-run means; not browser FPS',summary:{before_ms:before,after_ms:after,cost_reduction_percent:(1-after/before)*100,throughput_ratio:before/after,digest_checkpoints_equal:true},results};
const json=JSON.stringify(report,null,2);if(v.output)writeFileSync(v.output,json);else console.log(json);
