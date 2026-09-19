// Local warm-cache acceptance harness. Switch generations without clearing browser cache.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];for(const n of ['--cli','--runtime','--output'])if(!args.includes(n))throw Error(`${n} required`);
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(get('--output')),cli=path.resolve(get('--cli'));if(fs.existsSync(out))throw Error('Choose a new output directory');fs.mkdirSync(out,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),exports={};
for(const generation of ['A','B']){
 const project=path.join(out,`project-${generation}`),runtime=path.join(out,`runtime-${generation}`);fs.cpSync(path.join(repo,'docs/fixtures/sdk-ui'),project,{recursive:true});fs.cpSync(path.resolve(get('--runtime')),runtime,{recursive:true});
 const config=JSON.parse(fs.readFileSync(path.join(project,'project.unone.json')));config.name=`Cache upgrade ${generation}`;fs.writeFileSync(path.join(project,'project.unone.json'),JSON.stringify(config));
 if(generation==='B'){
  const file=path.join(runtime,'runtime.json'),r=JSON.parse(fs.readFileSync(file));fs.appendFileSync(path.join(runtime,r.javascript),'\n// cache upgrade B\n');
  // Valid empty custom section changes binary identity without changing Core semantics.
  fs.appendFileSync(path.join(runtime,r.wasm),Buffer.from([0,1,0]));r.javascript_sha256=hash(fs.readFileSync(path.join(runtime,r.javascript)));r.wasm_sha256=hash(fs.readFileSync(path.join(runtime,r.wasm)));r.wasm_bytes=fs.statSync(path.join(runtime,r.wasm)).size;fs.writeFileSync(file,JSON.stringify(r));
 }
 const dir=path.join(out,generation),r=spawnSync(cli,['--project',project,'export','web','--runtime',runtime,'--output',dir,'--json'],{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});
 fs.writeFileSync(path.join(out,`export-${generation}.json`),r.stdout||'{}');if(r.status!==0)throw Error(r.stdout+r.stderr);
 const report=JSON.parse(r.stdout).value;if(!report.release_root)throw Error('CLI lacks generation sealing');exports[generation]={dir,release_root:report.release_root};
}
if(exports.A.release_root===exports.B.release_root)throw Error('Generations collided');
let active='A';const requests=[];const evidence=()=>({version:1,active,exports,requests,runnerSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),note:'HTTP requests alone do not prove browser visual correctness; pair with browser observations'});
const save=()=>fs.writeFileSync(path.join(out,'cache-evidence.json'),JSON.stringify(evidence(),null,2)+'\n');save();
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/__switch/B'&&req.method==='POST'){active='B';save();res.end('B');return;}
 if(url.pathname==='/__evidence'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(evidence()));return;}
 const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
 const owner=relative.startsWith(exports.A.release_root)?'A':relative.startsWith(exports.B.release_root)?'B':active;
 const file=path.resolve(exports[owner].dir,relative);if(!file.startsWith(exports[owner].dir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const bytes=fs.readFileSync(file);requests.push({at:new Date().toISOString(),active,owner,url:url.pathname,sha256:hash(bytes)});save();
 res.setHeader('Cache-Control',relative==='index.html'?'no-cache, must-revalidate':'public, max-age=31536000, immutable');
 const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'})[ext]??'application/octet-stream');res.end(bytes);
});
server.listen(0,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}/`;fs.writeFileSync(path.join(out,'server.json'),JSON.stringify({url,pid:process.pid}));console.log(JSON.stringify({url,output:out,instructions:'Open A, POST /__switch/B, reload same tab without clearing cache; expect title Cache upgrade B and no playerError. Old generation URLs remain served.'}));});
