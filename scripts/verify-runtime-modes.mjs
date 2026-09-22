// Build/runtime pairing, not a claim that interpreter samples predict JIT speed.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:null;};
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const fault=(code,message,fix)=>Object.assign(Error(message),{code,fix});

export async function sourceFingerprint(base=root){
 const files=['Cargo.toml','Cargo.lock','crates/unone-engine/Cargo.toml'];
 async function walk(path){for(const entry of await readdir(join(base,path),{withFileTypes:true})){const name=path+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);}}
 await walk('crates/unone-engine/src');await walk('crates/unone-engine/examples');
 const digest=createHash('sha256');for(const path of files.sort()){digest.update(path+'\0');digest.update(hash(await readFile(join(base,path)))+'\0');}return digest.digest('hex');
}

export function compareModes(diagnostic,production){
 for(const report of [diagnostic,production]){
  if(report?.schema!=='unone.execution-probe.v1'||!report.execution||!report.measurement||!Object.hasOwn(report,'failure')||!Array.isArray(report.compiled_systems)||!Number.isInteger(report.requested_frames)||report.requested_frames<1||!Number.isInteger(report.completed_frames)||report.completed_frames<0||report.completed_frames>report.requested_frames||!Number.isInteger(report.warmup)||report.warmup<0||!Array.isArray(report.checkpoints)||!report.checkpoints.length||report.checkpoints.some((c,i)=>!c||c.tick!==i||typeof c.digest!=='string'||!c.digest)||!Array.isArray(report.tick_ms)||report.tick_ms.length!==report.completed_frames||report.tick_ms.some(v=>!Number.isFinite(v)||v<0))throw fault('MODE_REPORT_INVALID','Invalid probe report, counts or checkpoint sequence.','Use execution_probe from this revision; preserve the rejected report.');
  if(!report.failure&&report.checkpoints.length!==report.warmup+report.requested_frames+1)throw fault('MODE_REPORT_INCOMPLETE','Successful report omitted required per-tick checkpoints.','Rerun the probe without deleting evidence; do not compare only the final frame.');
 }
 for(const key of ['project_sha256','scenario_sha256','engine_version','seed','warmup','requested_frames','compiled_systems'])if(JSON.stringify(diagnostic[key])!==JSON.stringify(production[key]))throw fault('MODE_WORKLOAD_MISMATCH',`Different ${key}.`,'Use the same loaded payload, normalized inputs and engine source for both modes.');
 if(diagnostic.execution.rust_profile!=='release'||!diagnostic.execution.preview_tools||diagnostic.execution.native_codegen_requested||diagnostic.execution.luau_execution!=='interpreter'||!diagnostic.measurement.sampling)throw fault('DIAGNOSTIC_MODE_INVALID','Diagnostic mode must be release/interpreter with sampling enabled.','Build --no-default-features --features all-systems,native-codegen,preview-tools.');
 if(production.execution.rust_profile!=='release'||production.execution.preview_tools||!production.execution.native_codegen_requested||production.execution.native_codegen_supported!==true||production.execution.luau_execution!=='native-codegen-eligible'||production.measurement.sampling||production.diagnosis!==null)throw fault('PRODUCTION_MODE_UNAVAILABLE','Production codegen mode was not available or contains diagnostic probes.','Use a supported native CPU/ABI and build --release --no-default-features --features all-systems,native-codegen; do not silently substitute an interpreter.');
 if(diagnostic.execution.target_arch!==production.execution.target_arch||diagnostic.execution.target_os!==production.execution.target_os)throw fault('MODE_TARGET_MISMATCH','Different build targets.','Run both binaries on the same target.');
 let divergence=null;
 for(let index=0;index<Math.max(diagnostic.checkpoints.length,production.checkpoints.length);index++){
  if(JSON.stringify(diagnostic.checkpoints[index])!==JSON.stringify(production.checkpoints[index])){divergence={checkpoint:index,diagnostic:diagnostic.checkpoints[index]??null,production:production.checkpoints[index]??null};break;}
 }
 const success=!diagnostic.failure&&!production.failure&&diagnostic.completed_frames===diagnostic.requested_frames&&production.completed_frames===production.requested_frames;
 const passed=success&&!divergence;
 return {passed,behavior_match:!divergence,execution_success:success,first_divergence:divergence,
  diagnostic_failure:diagnostic.failure,production_failure:production.failure,
  production_mean_tick_ms:passed?mean(production.tick_ms):null,
  diagnostic_mean_tick_ms:mean(diagnostic.tick_ms),
  verdict:passed?'paired-behavior-verified-not-an-optimization-verdict':'blocked',
  limitations:['No per-function native compilation counts, GPU/render/FPS or actual device validation.','Do not use diagnostic/production timing ratio as optimization speedup. Compare old/new production repetitions separately.']};
}

async function main(){
 const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--project','--scenario','--target-dir','--output','--repeats','--timeout-ms'].includes(key)||options[key]!==undefined||!process.argv[i+1])throw fault('MODE_ARGUMENT_INVALID',`Invalid option ${key}.`,'Pass --project host.json --scenario inputs.json --target-dir ABS --output NEW_ABS [--repeats 3] [--timeout-ms 120000].');options[key]=process.argv[i+1];}
 for(const key of ['--project','--scenario','--target-dir','--output'])if(!options[key]||!isAbsolute(options[key]))throw fault('MODE_ARGUMENT_INVALID',`${key} must be absolute.`,'Choose explicit input paths, a build cache and a new evidence directory.');
 const repeats=Number(options['--repeats']??3),timeout=Number(options['--timeout-ms']??120000);
 if(!Number.isInteger(repeats)||repeats<2||repeats>10||!Number.isInteger(timeout)||timeout<1000||timeout>300000)throw fault('MODE_LIMIT_INVALID','Use 2..10 repetitions and 1000..300000 ms per probe.','Choose bounded repeat/timeout values.');
 const output=options['--output'];await mkdir(output); // EEXIST protects earlier evidence
 const project=await readFile(options['--project']),scenario=await readFile(options['--scenario']);
 await writeFile(join(output,'project.json'),project,{flag:'wx'});await writeFile(join(output,'scenario.json'),scenario,{flag:'wx'});
 const evidence={schema:'unone.mode-pair.v1',created_at:new Date().toISOString(),project_sha256:hash(project),scenario_sha256:hash(scenario),pairs:[],builds:{},passed:false};
 try{
  evidence.cargo_lock_sha256=hash(await readFile(join(root,'Cargo.lock')));
  evidence.engine_source_sha256=await sourceFingerprint();
  const rust=await exec('rustc',['--version'],{cwd:root});evidence.rustc=rust.stdout.trim();
  for(const mode of ['diagnostic','production']){
   const target=join(options['--target-dir'],mode),features='all-systems,native-codegen'+(mode==='diagnostic'?',preview-tools':'');
   const args=['build','-p','unone-engine','--example','execution_probe','--release','--no-default-features','--features',features,'--target-dir',target,'-j','2','--locked'];
   let build;try{build=await exec('cargo',args,{cwd:root,timeout:600000,maxBuffer:16*1024*1024,windowsHide:true});}catch(error){await writeFile(join(output,`${mode}-build.log`),String(error.stdout||'')+String(error.stderr||''));throw fault('MODE_BUILD_FAILED',`${mode} build failed.`,'Read the retained build log; no fallback mode was used.');}
   await writeFile(join(output,`${mode}-build.log`),build.stdout+build.stderr);
   const binary=join(target,'release','examples','execution_probe'+(process.platform==='win32'?'.exe':''));
   evidence.builds[mode]={binary,sha256:hash(await readFile(binary)),cargo_args:args};
  }
  if(await sourceFingerprint()!==evidence.engine_source_sha256)throw fault('MODE_SOURCE_CHANGED','Engine source changed between builds.','Finish source edits, then rerun in a new evidence directory.');
  let firstCheckpoints=null;
  for(let index=0;index<repeats;index++){
   const reports={},order=index%2?['production','diagnostic']:['diagnostic','production'];
   for(const mode of order){
    const build=evidence.builds[mode];if(hash(await readFile(build.binary))!==build.sha256)throw fault('MODE_BINARY_CHANGED','Probe binary changed during the experiment.','Build in a dedicated target directory and restart in a new evidence directory.');
    let run;try{run=await exec(build.binary,[join(output,'project.json'),join(output,'scenario.json')],{cwd:root,timeout,maxBuffer:32*1024*1024,windowsHide:true});}catch(error){await writeFile(join(output,`${index}-${mode}-failure.log`),String(error.stdout||'')+String(error.stderr||''));throw fault('MODE_PROBE_FAILED',`${mode} failed or exceeded ${timeout} ms.`,'Inspect the retained log; timeout is not zero runtime and no automatic fallback occurred.');}
    const report=JSON.parse(run.stdout);if(report.project_sha256!==evidence.project_sha256||report.scenario_sha256!==evidence.scenario_sha256)throw fault('MODE_INPUT_CHANGED','Loaded inputs differ from pinned experiment inputs.','Preserve evidence, then start a fresh experiment.');
    reports[mode]=report;await writeFile(join(output,`${index}-${mode}.json`),JSON.stringify(report,null,2));
   }
   evidence.pairs.push({index,order,...compareModes(reports.diagnostic,reports.production)});
   if(!evidence.pairs.at(-1).passed)break; // retain both modes' failure evidence; do not repeat a failed pair
   if(firstCheckpoints&&JSON.stringify(reports.diagnostic.checkpoints)!==firstCheckpoints)throw fault('MODE_NONREPRODUCIBLE','Behavior changed across repeated identical workloads.','Investigate nondeterminism before reporting performance.');
   firstCheckpoints??=JSON.stringify(reports.diagnostic.checkpoints);
  }
  evidence.passed=evidence.pairs.every(p=>p.passed);
  if(await sourceFingerprint()!==evidence.engine_source_sha256){evidence.passed=false;throw fault('MODE_SOURCE_CHANGED','Engine source changed during measurement.','Repeat against fixed engine source in a new evidence directory.');}
  evidence.production_median_of_mean_tick_ms=evidence.passed?median(evidence.pairs.map(p=>p.production_mean_tick_ms)):null;
  evidence.limitation='Behavior equality is not game acceptance or a speedup verdict. Native CPU only; rendering, WebView and browser JIT tiers are outside this probe.';
 }catch(error){evidence.passed=false;evidence.error={code:error.code||'MODE_EXPERIMENT_FAILED',cause:error.message,fix:error.fix||'Inspect saved evidence before retrying in a new directory.'};}
 finally{await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({output,passed:evidence.passed,error:evidence.error,pairs:evidence.pairs}));if(!evidence.passed)process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({ok:false,code:error.code||'MODE_EXPERIMENT_FAILED',cause:error.message,fix:error.fix}));process.exitCode=1;});
