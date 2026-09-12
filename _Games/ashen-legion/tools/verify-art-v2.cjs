const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),out=path.resolve(__dirname,'../tests/art-v2');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],samples=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:8190/presentation/art-lab.html?kind=beetle');await page.waitForFunction(()=>window.artLab?.ready);
 for(const kind of ['beetle','boar','elder','stag','soldier','spear','cavalry','acorn','piglet','moth','turtle','treant','wheel','horse']){
  await page.selectOption('#species',kind);await page.waitForFunction(k=>window.artLab?.ready&&window.artLab.kind===k,kind);await page.waitForTimeout(180);
  const result=await page.evaluate(()=>{
   const e=artLab.entries[1],r={kind:artLab.kind,clips:e.asset.animations.map(a=>a.name),skins:0,triangles:0,vertices:0,bones:0,finite:true,maxRadius:0,uv:true};
   for(const clip of e.asset.animations){
    e.player.transition(clip.name,{duration:0});e.player.update(.001);
    for(const time of [.1,.4,.75]){
     e.player.seekNormalized(time);e.root.updateMatrixWorld(true);
     e.root.traverse(o=>{if(!o.isSkinnedMesh||o.userData.inkOutline)return;o.skeleton.update();const count=o.geometry.attributes.position.count,step=Math.max(1,Math.floor(count/100));
      for(let i=0;i<count;i+=step){const v=o.getVertexPosition(i,o.position.clone());if(!v.toArray().every(Number.isFinite))r.finite=false;r.maxRadius=Math.max(r.maxRadius,v.length());}
     });
    }
   }
   e.root.traverse(o=>{if(o.isSkinnedMesh&&!o.userData.inkOutline){r.skins++;r.vertices+=o.geometry.attributes.position.count;r.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;r.bones=Math.max(r.bones,o.skeleton.bones.length);r.uv&&=!!o.geometry.attributes.uv&&!!o.material.map;}});
   e.player.transition('idle',{duration:0});e.player.seekNormalized(.25);return r;
  });
  assert.equal(result.clips.length,8,kind+' clips');assert.ok(result.skins>0&&result.finite&&result.uv,JSON.stringify(result));assert.ok(result.maxRadius<5,JSON.stringify(result));if(['soldier','spear','cavalry'].includes(kind))assert.equal(result.bones,55);else assert.equal(result.bones,9);samples.push(result);
  await page.selectOption('#motion','idle');await page.waitForTimeout(200);await page.screenshot({path:path.join(out,kind+'-comparison.png')});console.log('PASS',kind,result.triangles,result.maxRadius);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'models.json'),JSON.stringify({ok:true,scope:'Actual GLTFLoader and official Unone Animator, 14 model views, eight clips each, finite skinned vertices and embedded UV textures',samples,errors},null,2));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
