// Execute inspected public and Web probes through the unmodified Scout recorder.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-scout-fixes-2026-10-23';
const subjects=JSON.parse(await readFile(resolve(here,'subject-paths.json'),'utf8'));
for(const [script,output] of [['probe-v3.mjs','capture-public-v3.json'],['web-probe.mjs','capture-web.json']]){
 const argv=['plugins/org.unone.ai-native/scripts/record-probe.mjs','--root',root,'--script',base+'/'+script,'--output',base+'/'+output,'--mode','fixture','--timeout','60000','--limitation','Informed synthetic execution; independent blind author evidence is separate. No gameplay, renderer or performance-speedup claim.',...subjects.flatMap(path=>['--subject',path])];
 const r=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:70000,maxBuffer:512*1024});
 await writeFile(resolve(here,output+'.recorder.txt'),r.stdout+'\n'+r.stderr,{flag:'wx'});
 assert.equal(r.status,0,r.stdout+r.stderr);
 const capture=JSON.parse(await readFile(resolve(here,output),'utf8'));
 console.log(JSON.stringify({output,exitCode:capture.exitCode,sourceChanged:capture.sourceChanged,timedOut:capture.timedOut,outputTruncated:capture.outputTruncated}));
}
