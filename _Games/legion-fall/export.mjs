import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),out=resolve(process.argv[2]??join(root,'dist/web'));
const result=spawnSync(join(repo,'target/debug/game.exe'),['--project',root,'export','web','--development','--output',out],{encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr+result.stdout);
for(const file of ['overlay.js','overlay.css','recording.js'])copyFileSync(join(root,file),join(out,file));
let html=readFileSync(join(out,'index.html'),'utf8').replace('</head>','<link rel="stylesheet" href="overlay.css"><script type="module" src="overlay.js"></script><script type="module" src="recording.js"></script></head>');writeFileSync(join(out,'index.html'),html);
const manifestPath=join(out,'export.json');
// Keep the verified export inventory accurate after adding game-owned presentation.
try{const m=JSON.parse(readFileSync(manifestPath));for(const path of ['index.html','overlay.js','overlay.css','recording.js']){const b=readFileSync(join(out,path)),f={path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};const i=m.files.findIndex(v=>v.path===path);if(i<0)m.files.push(f);else m.files[i]=f;}m.total_bytes=m.files.reduce((n,f)=>n+f.bytes,0);writeFileSync(manifestPath,JSON.stringify(m,null,2));}catch(e){throw new Error('EXPORT_INVENTORY_FAILED: '+e.message);}
console.log(out);
