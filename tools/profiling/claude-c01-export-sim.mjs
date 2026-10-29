// Check that player templates still satisfy crates/unone-cli/src/export.rs replace_required()
// targets and PROFILE_/DEVELOPER_ markers, then write production/development substituted main.js.
// Usage: node tools/profiling/claude-c01-export-sim.mjs <export.rs> <templates/web> <out-dir>
import fs from 'node:fs';
const [exportRs,tpl,out]=process.argv.slice(2);const rs=fs.readFileSync(exportRs,'utf8');
const BS=String.fromCharCode(92),unrust=s=>s.split(BS+'"').join('"').split(BS+BS).join(BS);
const at=rs.indexOf('for (marker, code) in ['),loop=rs.slice(at,rs.indexOf('] {',at));
const pairs=[...loop.matchAll(/\(\s*"(\/\* [A-Z_]+ \*\/)",\s*"((?:[^"\\]|\\.)*)",?\s*\)/g)].map(m=>[m[1],unrust(m[2])]);
const required=[...rs.matchAll(/replace_required\(\s*text,\s*"((?:[^"\\]|\\.)*)"/g)].map(m=>unrust(m[1]));
const read=p=>fs.readFileSync(`${tpl}/${p}`,'utf8').replace(/\r\n/g,'\n');
const main=read('player/main.js'),three=read('renderer/three.js'),count=(s,t)=>s.split(t).length-1;
const checks=[];
for(const t of required)checks.push({target:t.slice(0,90),main:count(main,t),three:count(three,t),ok:count(main,t)+count(three,t)===1});
for(const [m] of pairs)checks.push({target:m,main:count(main,m),ok:count(main,m)===1});
for(const m of ['/* DEVELOPER_IMPORT */','/* DEVELOPER_CONNECT */'])checks.push({target:m,main:count(main,m),ok:count(main,m)===1});
for(const mode of ['production','development']){
 let s=main;for(const [m,c] of pairs)s=s.replace(m,()=>mode==='development'?c:'');
 s=mode==='development'?s.replace('/* DEVELOPER_IMPORT */',"import {createDeveloper} from '../developer/main.js';\nconst developer=createDeveloper();").replace('/* DEVELOPER_CONNECT */','developer.connect({});')
  :s.replace('/* DEVELOPER_IMPORT */','').replace('/* DEVELOPER_CONNECT */','');
 fs.writeFileSync(`${out}/main.${mode}.mjs`,s);
}
const report={marker_pairs:pairs.length,required_targets:required.length,all_ok:pairs.length===9&&checks.every(c=>c.ok),checks};
fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,1));console.log(JSON.stringify({marker_pairs:report.marker_pairs,required_targets:report.required_targets,all_ok:report.all_ok,failed:checks.filter(c=>!c.ok)}));
