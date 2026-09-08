// Compare repeated measurements, never a guessed FPS or an unsupported null.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
export function verifyPerformance(baseline,candidate,budgets){
 const errors=[],checks=[];
 const invalid=message=>errors.push({code:'PERFORMANCE_EVIDENCE_INVALID',message});
 for(const [name,data]of Object.entries({baseline,candidate})){
  if(data.version!==1||!data.case||!Array.isArray(data.runs)||data.runs.length<3)invalid(`${name}: version 1, case and at least three runs required`);
  for(const key of ['project','seed','profile','device','viewport','simulation_hz'])if(data.case?.[key]===undefined)invalid(`${name}: case.${key} required`);
  if(data.case?.profile!=='release')invalid(`${name}: release build required`);
 }
 if(!isDeepStrictEqual(baseline.case,candidate.case))invalid('Case/device/viewport/simulation settings must match');
 if(!Array.isArray(budgets)||!budgets.length)invalid('At least one metric budget required');
 if(errors.length)return {ok:false,errors,checks};
 const ref=baseline.runs[0];
 for(const run of [...baseline.runs,...candidate.runs]){
  if(typeof run.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(run.digest)||run.digest!==ref.digest||!Number.isSafeInteger(run.ticks)||run.ticks<1||run.ticks!==ref.ticks)invalid('Every run must end at the same tick and canonical digest');
 }
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 for(const budget of budgets){
  if(Object.keys(budget).some(k=>!['metric','direction','max_regression_percent','absolute_limit'].includes(k))||typeof budget.metric!=='string'||!['lower','higher'].includes(budget.direction)||!Number.isFinite(budget.max_regression_percent)||budget.max_regression_percent<0||(budget.absolute_limit!==undefined&&!Number.isFinite(budget.absolute_limit))){invalid('Invalid or unknown budget field');continue;}
  const a=baseline.runs.map(r=>r.metrics?.[budget.metric]),b=candidate.runs.map(r=>r.metrics?.[budget.metric]);
  if([...a,...b].some(v=>!Number.isFinite(v)||v<0)){invalid(`${budget.metric}: missing/unsupported/nonfinite measurements`);continue;}
  const before=median(a),after=median(b),sign=budget.direction==='lower'?1:-1;
  const regression=before===0?(after===0?0:sign*Infinity):sign*(after-before)/before*100;
  const absolute=budget.absolute_limit===undefined||sign*after<=sign*budget.absolute_limit;
  checks.push({metric:budget.metric,baseline_median:before,candidate_median:after,regression_percent:Number.isFinite(regression)?regression:null,passed:regression<=budget.max_regression_percent&&absolute,baseline_range:[Math.min(...a),Math.max(...a)],candidate_range:[Math.min(...b),Math.max(...b)]});
 }
 return {ok:errors.length===0&&checks.every(c=>c.passed),errors,checks,note:'Median of repeated runs; ranges expose variability, not statistical significance. CPU cadence is not verified display FPS.',next_command:'Capture three release profile windows per case, include device/viewport/seed and end-tick digest, then rerun this command.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);if(args.length<3||args.length>4)throw Error('Usage: node scripts/verify-performance-budget.mjs baseline.json candidate.json budgets.json [output.json]');const report=verifyPerformance(...args.slice(0,3).map(p=>JSON.parse(readFileSync(p,'utf8'))));const text=JSON.stringify(report,null,2);if(args[3])writeFileSync(args[3],text+'\n');console.log(text);process.exitCode=report.ok?0:1;}catch(error){console.log(JSON.stringify({ok:false,error:String(error.message)}));process.exitCode=1;}
}
