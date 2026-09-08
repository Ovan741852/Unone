import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const names=new Set();
for(const file of readdirSync(resolve(root,'web/renderer')).filter(file=>file.endsWith('.js'))) {
  for(const match of readFileSync(resolve(root,'web/renderer',file),'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g)) {
    if(match[1]!=='WebGPURenderer')names.add(match[1]);
  }
}
// WebGL player exports only the renderer's referenced public Three API.
const input=`export {${[...names].sort().join(',')}} from './three.module.js';`;
const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',[
  '--yes','esbuild@0.25.12','--bundle','--minify','--format=esm','--legal-comments=eof',
  '--sourcefile=three.player.js','--outfile=three.player.min.js'
],{cwd:resolve(root,'web/vendor/three'),input,encoding:'utf8',shell:process.platform==='win32'});
if(result.status!==0)throw new Error(result.stderr??'Three player build failed');
console.log(result.stderr.trim());
