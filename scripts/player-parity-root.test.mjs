// Execute the real verifier's configuration only. No CLI/Core/export is
// substituted: the process spy observes cwd before any export is attempted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {tmpdir} from 'node:os';
import {parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const script=fileURLToPath(new URL('./verify-player-parity.mjs',import.meta.url));
function configuration(args){
 const original=fs.readFileSync(script,'utf8'),end=original.indexOf('\ntry {');
 assert(end>0,'Verifier configuration boundary required');
 const setup=original.slice(0,end).replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url','verifierUrl');
 const tools=path.resolve('preserved-tools'),checkout=path.resolve('selected-checkout');
 const argv=args(checkout),calls=[],context={verifierUrl:pathToFileURL(path.join(tools,'scripts/verify-player-parity.mjs')).href,
  resolve:path.resolve,dirname:path.dirname,join:path.join,fileURLToPath,parseArgs:options=>parseArgs({...options,args:argv}),tmpdir,
  mkdtempSync:()=>path.join(tmpdir(),'configuration-only-no-directory-created'),
  process:{argv:[process.execPath,script,...argv],env:{}},
  runWithEvidence:(command,argv,options)=>{calls.push({command,argv,...options});return {status:0};}};
 const result=vm.runInNewContext(setup+'\nrun(cli,["--version"]);({root,toolRoot,fixture});',context);
 return {result,calls,tools,checkout};
}
test('preserved verifier executes CLI from the explicitly selected source checkout',()=>{
 const {result,calls,tools,checkout}=configuration(root=>['--source-root',root,'--cli',path.join(root,'target/release/game')]);
 assert.equal(result.root,checkout);assert.equal(result.toolRoot,tools);
 assert.equal(result.fixture,path.join(checkout,'tests/host-parity-project'));
 assert.equal(calls.length,1);assert.equal(calls[0].cwd,checkout);
 assert.equal(calls[0].command,path.join(checkout,'target/release/game'));
});
test('ordinary in-checkout verifier invocation keeps its existing default root',()=>{
 const {result,calls,tools}=configuration(()=>[]);
 assert.equal(result.root,tools);assert.equal(result.toolRoot,tools);assert.equal(calls[0].cwd,tools);
});
test('nested host verifier explicitly keeps CLI execution in the selected checkout',()=>{
 const source=fs.readFileSync(new URL('./verify-host-parity.mjs',import.meta.url),'utf8');
 const helper=source.match(/^function runNative\(\)\{.*\}$/m)?.[0];assert(helper,'Actual native command helper required');
 const checkout=path.resolve('selected-checkout'),calls=[];
 const invoke=vm.runInNewContext('('+helper+')',{cli:'matching-cli',fixture:'fixture',hasTests:true,sourceRoot:checkout,
  spawnSync:(command,args,options)=>{calls.push({command,args,...options});return {status:0};}});
 invoke();assert.equal(calls.length,1);assert.equal(calls[0].cwd,checkout);
 assert.equal(calls[0].command,'matching-cli');assert.equal(calls[0].args.at(-1),'--json');
});
