// Read-only visual/capability audit. The production game is driven by normal input.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../tests/trail-audit');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8190/?build=trail-audit&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 async function click(a){const r=await page.evaluate(a=>ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===a)?.rect,a);assert.ok(r,a);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(150);}
 await click('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(650);await click('Choice1');await page.waitForTimeout(650);await click('LeaveShop');
 const aims=[];
 for(const [name,x,z] of [['near',2,7],['far',10,-10]]){
  const p=await page.evaluate(([x,z])=>ashen.projectPoint(x,z),[x,z]);await page.mouse.move(p.x,p.y);await page.waitForTimeout(140);
  aims.push(await page.evaluate(()=>({aimX:ashen.state().aimX,aimZ:ashen.state().aimZ})));await page.screenshot({path:path.join(out,name+'-aim.png')});
 }
 await click('Unit2');const aim=await page.evaluate(()=>ashen.projectPoint(7,-6));await page.mouse.move(aim.x,aim.y);await page.mouse.down();await page.waitForTimeout(180);await page.mouse.up();
 const inFlight=await page.evaluate(()=>Object.values(ashen.state().visualTroops));await page.screenshot({path:path.join(out,'spear-flight.png')});
 await click('Pause');
 // Draw the exact shipped native particle renderer in an isolated WebGL scene.
 // This is a renderer capability measurement, not the game's own mesh sparks.
 const native=await page.evaluate(async()=>{
  const T=await import('three'),{createParticleRenderer}=await import('./web/renderer/particles.js');
  const canvas=document.createElement('canvas'),renderer=new T.WebGLRenderer({canvas}),scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);
  renderer.setSize(300,300,false);camera.position.z=10;const fx=createParticleRenderer(T,scene);
  const draw=count=>{fx.draw(Array.from({length:count},(_,i)=>({id:'p'+i,position:{x:(i%8-3.5)*.3,y:(Math.floor(i/8)-1.5)*.3,z:0},size:.15,color:[1,.6,.1,1],additive:true})));renderer.render(scene,camera);return{particles:count,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};};
  const samples=[draw(1),draw(32),draw(128)];fx.draw([]);renderer.dispose();renderer.forceContextLoss();return samples;
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({ok:true,scope:'Real aiming and spear flight; isolated shipped WebGL native particle renderer draw-call measurement',aims,inFlight,native,errors},null,2));console.log(JSON.stringify({aims,inFlight:inFlight.map(t=>({id:t.id,state:t.state,y:t.y})),native}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
