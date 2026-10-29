// Actually rerun the repaired reviewed wrapper; preserve its failed predecessor.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-observation-profile-2026-10-23';
const subjects=JSON.parse(await readFile(resolve(here,'final-subject-paths.json'),'utf8'));
const output=base+'/capture-blind-replay-v2.json';
const args=['plugins/org.unone.ai-native/scripts/record-probe.mjs','--root',root,'--script',base+'/blind-replay-v2.mjs','--output',output,'--mode','fixture','--timeout','60000','--limitation','Informed replay of reviewed sealed generic inputs; newline-only canonical comparison; not blind authorship, full source provenance, GPU benchmark or rendered presentation.',...subjects.flatMap(p=>['--subject',p])];
const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:100*1024});
await writeFile(resolve(root,output+'.recorder.txt'),JSON.stringify({command:[process.execPath,...args],exitCode:r.status,stdout:r.stdout,stderr:r.stderr},null,2)+'\n',{flag:'wx'});
console.log(r.stdout);console.error(r.stderr);assert.equal(r.status,0);
