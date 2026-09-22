// Browser/GPU lifecycle regression, synthetic assets in an isolated browser.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.GAME_TEST_URL||'http://127.0.0.1:8190/');
  await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const result=await page.evaluate(async()=>{
   const T=await import('three'),{createLoadoutPreview}=await import('./presentation/loadout-preview.mjs');
   const geometry=new T.BoxGeometry(.1,.1,.1),material=new T.MeshStandardMaterial();
   let sharedGeometryDisposals=0;geometry.addEventListener('dispose',()=>sharedGeometryDisposals++);
   const soldier=new T.Group(),hand=new T.Bone();hand.name='mixamorigRightHand';soldier.add(hand,new T.Mesh(geometry,material));
   const equipment=new T.Group();equipment.add(new T.Mesh(geometry,material));
   const canvas=document.createElement('canvas');canvas.style.cssText='width:200px;height:300px';document.body.append(canvas);
   const preview=await createLoadoutPreview({canvas,preparedAssets:Promise.resolve({assets:new Map([['soldier',{scene:soldier,animations:[]}]]),equipmentAssets:new Map([['test',{scene:equipment}]])})});
   const roots=[];
   for(let i=0;i<20;i++){
    preview.update({phase:'loadout',uiRoute:'gear',selected:1,items:[{id:i+1,skill:'test'}],worn:[[0,0,0,0,i+1]]},.016);
    roots.push(preview.inspect().actorRoots);
   }
   const rendered=preview.inspect();preview.dispose();canvas.remove();
   const result={roots,sharedGeometryDisposals,drawCalls:rendered.drawCalls,meshes:rendered.meshes};
   geometry.dispose();material.dispose();return result;
  });
  assert.deepEqual(errors,[]);assert.ok(result.roots.every(count=>count===1));
  assert.equal(result.sharedGeometryDisposals,0);assert.ok(result.drawCalls>0);assert.ok(result.meshes>=2);
  console.log(JSON.stringify({ok:true,...result}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1;});
