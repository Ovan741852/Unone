// Real-browser pixel and lifecycle gate for the developer DOM projection.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=process.argv[2];if(!out)throw Error('Usage: node scripts/verify-ui-slice-dom.mjs <evidence-directory>');
mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url);
let playwright;try{playwright=require(process.env.UNONE_PLAYWRIGHT_MODULE||'playwright');}catch(error){
 if(process.env.UNONE_PLAYWRIGHT_MODULE)throw error;
 playwright=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const modules=new Map(['ui-tree.js','ui-contract.mjs','ui-geometry.mjs','ui-style.mjs'].map(n=>['/'+n,readFileSync(new URL('../web/shared/'+n,import.meta.url))]));
const server=createServer((req,res)=>{
 if(modules.has(req.url)){res.setHeader('Content-Type','text/javascript');res.end(modules.get(req.url));return;}
 res.setHeader('Content-Type','text/html');res.end('<style>#layer{position:relative;width:300px;height:100px}.unone-ui-node{position:absolute}</style><div id="layer"></div>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await playwright.chromium.launch({channel:process.env.UNONE_BROWSER_CHANNEL||'msedge',headless:true});
const report={ok:false,cases:[],errors:[]};
try{
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:700,height:500},deviceScaleFactor:dpr});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async()=>{
   const {createUiTree}=await import('/ui-tree.js');
   const colors=['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#800000','#008000','#000080'];
   const source=document.createElement('canvas');source.width=source.height=9;const ctx=source.getContext('2d');
   colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect((i%3)*3,Math.floor(i/3)*3,3,3);});
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9">'+colors.map((c,i)=>`<rect x="${i%3*3}" y="${Math.floor(i/3)*3}" width="3" height="3" fill="${c}"/>`).join('')+'</svg>';
   const assets={png:source.toDataURL(),svg:'data:image/svg+xml,'+encodeURIComponent(svg)};
   window.publish=createUiTree(document.querySelector('#layer'),{resolveAsset:id=>assets[id]});
   window.node={kind:'image',id:'frame',asset:'png',alt:'Nine-slice frame',rect:{x:0,y:0,width:100,height:100},slice:{left:3,top:3,right:3,bottom:3,pixels_per_unit:.3}};
  });
  for(const asset of ['png','svg'])for(const [width,height]of [[300,100],[100,300]]){
   await page.evaluate(({asset,width,height})=>{const layer=document.querySelector('#layer');layer.style.width=width+'px';layer.style.height=height+'px';window.node.asset=asset;window.publish({ui:{children:[window.node]}});},{asset,width,height});
   await page.waitForFunction(({width,height,dpr})=>{const c=document.querySelector('canvas');return c?.width===width*dpr&&c.height===height*dpr&&c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[3]===255;},{width,height,dpr});
   const pixels=await page.evaluate(()=>{const c=document.querySelector('canvas'),ctx=c.getContext('2d'),inset=c.height*.05;return {label:c.getAttribute('aria-label'),error:c.dataset.assetError,pixels:[inset,c.height/2,c.height-inset].flatMap(y=>[inset,c.width/2,c.width-inset].map(x=>[...ctx.getImageData(x,y,1,1).data]))};});
   assert.equal(pixels.label,'Nine-slice frame');assert.equal(pixels.error,undefined);
   const expected=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255],[0,255,255],[128,0,0],[0,128,0],[0,0,128]];
   pixels.pixels.forEach((p,i)=>p.forEach((v,c)=>assert.ok(Math.abs(v-(c===3?255:expected[i][c]))<=3,JSON.stringify({asset,dpr,width,height,i,p}))));
   await page.locator('#layer').screenshot({path:join(out,`dom-${asset}-${dpr}x-${width}x${height}.png`)});
   report.cases.push({asset,dpr,width,height,nine_regions:true});
  }
  await page.evaluate(()=>{window.node.slice.left=100;window.publish({ui:{children:[window.node]}});});
  await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.assetError?.startsWith('UI_SLICE_BOUNDS'));
  const count=await page.evaluate(()=>{window.publish({ui:{budget:{max_nodes:3000},children:Array.from({length:3000},(_,i)=>({kind:'text',id:'n'+i,text:'',rect:{x:0,y:0,width:1,height:1}}))}});return {nodes:document.querySelectorAll('[data-node-id]').length,staleErrors:document.querySelectorAll('[data-asset-error]').length};});
  assert.deepEqual(count,{nodes:3000,staleErrors:0});await page.close();
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.errors.push(e.stack);throw e;}finally{
 writeFileSync(join(resolve(out),'dom-report.json'),JSON.stringify(report,null,2));await browser.close();server.close();
}
console.log(JSON.stringify(report));
