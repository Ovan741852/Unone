// Explicit local CLI only; deliberately NOT exposed as a plugin/MCP operation.
// Executes ONE reviewed Node script, with no shell. This is not an execution sandbox.
import { spawn } from 'node:child_process';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { RUN_SCHEMA } from '../src/rubric.mjs';
import { fingerprint, relativePath, snapshot, within } from '../src/files.mjs';

const args = process.argv.slice(2), options = {}, subjects = [], limitations = [];
try {
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]?.slice(2), value=args[i+1];
    if(!args[i]?.startsWith('--') || value===undefined || !['root','script','output','subject','mode','limitation','timeout'].includes(key)) throw new Error(`Unknown/incomplete option ${args[i]}`);
    if(key==='subject') subjects.push(value);
    else if(key==='limitation') limitations.push(value);
    else { if(key in options) throw new Error(`Duplicate --${key}`); options[key]=value; }
  }
  if(!options.root || !options.script || !options.output || !['fixture','local','live'].includes(options.mode) || !limitations.length) throw new Error('Required: --root <project> --script <relative.mjs> --output <new-relative.json> --subject <relative>... --mode fixture|local|live --limitation <not-verified>...');
  const timeout=Number(options.timeout ?? 30000);
  if(!Number.isInteger(timeout) || timeout<1000 || timeout>60000) throw new Error('--timeout must be 1000–60000 ms');
  relativePath(options.script); relativePath(options.output);
  if(!options.script.endsWith('.mjs')) throw new Error('Only an explicitly reviewed .mjs Node probe can be executed.');
  const root=await realpath(options.root);
  const before=await snapshot(root,subjects);
  const probeBefore=(await snapshot(root,[options.script])).files[0];
  const script=await realpath(path.join(root,options.script));
  const output=path.resolve(root,options.output);
  // Check and create only explicitly selected output parents, never traverse a symlink.
  let parent=root;
  for(const segment of options.output.split('/').slice(0,-1)) {
    const next=path.join(parent,segment);
    try { const info=await lstat(next); if(info.isSymbolicLink() || !info.isDirectory()) throw new Error('Output parents must be regular directories, not links.'); }
    catch(error) { if(error.code==='ENOENT') await mkdir(next,{mode:0o700}); else throw error; }
    parent=await realpath(next); if(!within(root,parent)) throw new Error('Output escaped the chosen root.');
  }
  // Reserve a NEW output before execution, so an existing capture never causes a second run.
  const file=await open(output,'wx',0o600);
  try {
    const startedAt=new Date().toISOString(), start=performance.now();
    const command=[process.execPath,script,'--root',root];
    let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),timedOut=false,outputTruncated=false;
    const limit=256*1024;
    const child=spawn(command[0],command.slice(1),{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,env:{...process.env,NODE_OPTIONS:''}});
    function append(current,chunk) {
      const available=limit-current.length;
      if(chunk.length>available) outputTruncated=true;
      return Buffer.concat([current,chunk.subarray(0,Math.max(0,available))]);
    }
    child.stdout.on('data',chunk=>{stdout=append(stdout,chunk);});
    child.stderr.on('data',chunk=>{stderr=append(stderr,chunk);});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    const completion=await new Promise(resolve=>{
      child.once('error',error=>resolve({exitCode:null,signal:null,spawnError:error.code ?? error.name}));
      child.once('close',(exitCode,signal)=>resolve({exitCode,signal,spawnError:null}));
    });
    clearTimeout(timer);
    const durationMs=Math.round((performance.now()-start)*1000)/1000;
    let sourceChanged=false,sourceCheckError=null;
    try {
      const after=await snapshot(root,subjects);
      const probeAfter=(await snapshot(root,[options.script])).files[0];
      sourceChanged=fingerprint(before.files)!==fingerprint(after.files) || probeBefore.sha256!==probeAfter.sha256;
    } catch(error) {
      // A broken/deleted subject is precisely when the actual execution output matters.
      // Preserve it, but explicitly invalidate provenance rather than leaving an empty file.
      sourceChanged=true;
      sourceCheckError={code:error.code ?? error.name,message:error.message,field:error.field ?? null,actual:error.actual ?? null};
    }
    const record={schema:RUN_SCHEMA,startedAt,command,node:process.version,platform:`${process.platform}/${process.arch}`,mode:options.mode,limitations,
      subject:before.files.map(({path,sha256})=>({path,sha256})),probe:{path:probeBefore.path,sha256:probeBefore.sha256},durationMs,...completion,timedOut,outputTruncated,sourceChanged,sourceCheckError,
      stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),
      trust:'Local capture of an explicitly selected script. Not signed attestation or proof of semantic claims; probe code is not sandboxed.'};
    await file.writeFile(JSON.stringify(record,null,2)+'\n');
    process.stdout.write(JSON.stringify({artifact:options.output,exitCode:record.exitCode,durationMs,timedOut,outputTruncated,sourceChanged})+'\n');
    process.exitCode=sourceChanged || timedOut || outputTruncated || completion.exitCode!==0 ? 1 : 0;
  } finally { await file.close(); }
} catch(error) { process.stderr.write(`PROBE_CAPTURE_FAILED: ${error.message}\nNothing was reported as successful. Preserve existing captures and repair the explicit inputs.\n`);process.exitCode=2; }
