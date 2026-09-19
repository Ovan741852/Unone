// Asset contracts complement (not replace) visual review in the real UI renderer.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=new URL('../',import.meta.url),out=new URL('tests/character-art/',root);
const read=path=>readFileSync(new URL(path,root));
const art=JSON.parse(read('design-v1/hazel-character-manifest.json'));
const assets=JSON.parse(read('assets.json')).assets;
const exported=JSON.parse(read('dist/web/content/assets.json')).assets;
const {chromium}=createRequire(import.meta.url)('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const generated=art.entries.filter(e=>e.generated);
assert.equal(generated.length,8,'Three units and five distinct NPCs');
const source=read('ui/formal-ui.luau').toString();
assert.match(source,/rune="portrait-runesmith"/);
assert.match(source,/tech="portrait-scholar"/);
const report={ok:false,entries:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 for(const entry of art.entries){
  const bytes=read(entry.runtime),sha=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,entry.runtimeSha256,entry.id+' runtime checksum');
  for(const resource of entry.resources??[entry.id]){
   const id='texture://ui_'+resource;
   assert.equal(assets.find(a=>a.id===id)?.source,entry.runtime,id+' game mapping');
   assert.equal(exported.find(a=>a.id===id)?.source,entry.runtime,id+' export mapping');
   assert.deepEqual(read('dist/web/content/'+entry.runtime),bytes,id+' exported bytes');
  }
  if(!entry.generated){report.entries.push({id:entry.id,reusedApprovedArt:true});continue;}
  assert.deepEqual(read(entry.original),bytes,'Keep lossless generated alpha and original');
  const metrics=await page.evaluate(async uri=>{
   const img=new Image();img.src=uri;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
   const data=ctx.getImageData(0,0,img.width,img.height).data;
   let clear=0,opaque=0,borderOpaque=0,minX=img.width,minY=img.height,maxX=-1,maxY=-1;
   const colors=new Set();
   for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){
    const i=(y*img.width+x)*4,a=data[i+3];
    if(a===0)clear++;
    if(a>240){opaque++;colors.add((data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4));}
    if(a>32){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(x===0||y===0||x===img.width-1||y===img.height-1)borderOpaque++;}
   }
   return {width:img.width,height:img.height,transparentRatio:clear/(img.width*img.height),opaqueRatio:opaque/(img.width*img.height),borderOpaque,colorBins:colors.size,bounds:{minX,minY,maxX,maxY}};
  },'data:image/png;base64,'+bytes.toString('base64'));
  assert.ok(metrics.width>=512&&metrics.height>=512,entry.id+' adequate resolution');
  assert.ok(metrics.transparentRatio>.1,entry.id+' true alpha background');
  assert.ok(metrics.opaqueRatio>.18,entry.id+' nonempty readable subject');
  assert.equal(metrics.borderOpaque,0,entry.id+' no clipped silhouette');
  assert.ok(metrics.colorBins>128,entry.id+' full-color artwork');
  report.entries.push({id:entry.id,...metrics});
 }
 // No legacy vector portrait or old vector character composite can reappear via aliases.
 const allowed=new Set(art.entries.map(e=>e.runtime));
 allowed.add('assets/formal-ui/portrait-lord-v2.png');
 for(const asset of assets.filter(a=>/^texture:\/\/ui_portrait-/.test(a.id)))assert.ok(allowed.has(asset.source),'Legacy portrait mapping: '+asset.id);
 report.ok=true;
}finally{await browser.close();mkdirSync(out,{recursive:true});writeFileSync(new URL('assets-report.json',out),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
