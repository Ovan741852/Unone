import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
const project=resolve('_Games/ashen-legion/wardrobe');
const names=['idle','walk','stretch','attack','death','spawn','run','tpose'];
const input={clips:names,controller:{initial:'idle',states:Object.fromEntries(names.map(name=>[name,{clip:name,loop:['idle','walk','run','tpose'].includes(name),transition:.2,clamp:true}]))},filename:'wardrobe.json',force:true};
for(const tool of ['animator.validate','animator.install']){
 const result=spawnSync(process.execPath,['D:/Projects/Unone-animator/plugin.mjs'],{input:JSON.stringify({tool,input})+'\n',encoding:'utf8',env:{...process.env,UNONE_PROJECT_ROOT:project}});
 if(result.status!==0)throw Error(result.stderr);
 const response=JSON.parse(result.stdout);console.log(JSON.stringify(response));
 if(response.diagnostics?.some(d=>d.severity==='error')||response.ok===false)throw Error('Plugin rejected '+tool);
}
// Verify the installed entry point can resolve every official dependency.
await import(new URL('../wardrobe/.unone/staging/unone-animator/runtime/index.mjs',import.meta.url));
writeFileSync(resolve(project,'animator-controller.json'),JSON.stringify(input.controller,null,2));
console.log('PASS official staged runtime imports, controller ready');
