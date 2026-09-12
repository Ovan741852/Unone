import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,game=resolve(process.argv[2]||resolve(here,'../../_Games/ashen-legion')),dist=resolve(game,'dist/web');
const config=JSON.parse(await readFile(resolve(game,'project.unone.json'),'utf8'));
const tests=new Map(config.test_files.map(p=>[p.split('/').at(-1),p]));
const sha=s=>createHash('sha256').update(s).digest('hex');
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    res.setHeader('cache-control','no-store');
    if(path==='/api/catalog'){
      const payload=JSON.parse(await readFile(resolve(dist,'content/project.json'),'utf8'));
      const source=await readFile(resolve(game,'main.luau'),'utf8');
      const exported=payload.script??payload.entry_script_source??payload.scripts?.['main.luau'];
      const specs=await Promise.all([...tests].map(async([id,p])=>{const s=JSON.parse(await readFile(resolve(game,p),'utf8'));return {id,name:s.name,seed:s.seed,frames:s.frames};}));
      res.setHeader('content-type','application/json');res.end(JSON.stringify({application:'unone-fishing-quicktest',specs,sourceMatchesExport:source===exported,scriptHash:typeof exported==='string'?sha(exported):null}));return;
    }
    let file;
    if(path.startsWith('/spec/')){const id=path.slice(6);if(!tests.has(id)){res.writeHead(404);res.end();return;}file=resolve(game,tests.get(id));}
    else {const base=path.startsWith('/game/')?dist:here;const rel=path.startsWith('/game/')?path.slice(6):path==='/'?'index.html':path.slice(1);file=resolve(base,rel);if(!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}}
    if(!(await stat(file)).isFile())throw Error('not a file');
    res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.QUICKTEST_PORT||8194),'127.0.0.1',()=>console.log(`Unone fishing quicktest: http://127.0.0.1:${server.address().port}/`));
