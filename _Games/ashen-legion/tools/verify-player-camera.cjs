const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('https://node.tail044891.ts.net:8444/?build=player-fov');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(a){const r=await page.evaluate(a=>window.ashen.uiTree().children.find(n=>n.action===a)?.rect,a);assert.ok(r);await page.mouse.click((r.x+r.width/2)*14.4,(100-r.y-r.height/2)*9);await page.waitForTimeout(120);}
 async function cannotSwitch(){
  assert.equal(await page.evaluate(()=>window.ashen.uiTree().children.some(n=>/^(Seat|Player)[1-4]$/.test(n.action??''))),false);
  const gold=await page.evaluate(()=>window.ashen.state().coins);
  for(const prefix of ['Seat','Player'])for(let i=1;i<=4;i++){
   await page.evaluate(a=>window.ashen.action(a),prefix+i);await page.waitForTimeout(50);
   assert.equal(await page.evaluate(()=>window.ashen.state().seat),1);assert.equal(await page.evaluate(()=>window.ashen.state().coins),gold);
  }
 }
 await cannotSwitch();await click('Start');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await click('Choice1');await click('LeaveShop');
 const walls=await page.evaluate(()=>window.ashen.metrics().walls);const extent=await page.evaluate(()=>window.ashen.state().arenaHalfExtent);assert.equal(walls.innerFace,extent);assert.equal(extent,12.5);assert.ok(walls.segments>80);
 const seats=[[0,12.2],[12.2,0],[0,-12.2],[-12.2,0]],evidence=[];
 for(const seat of [1]){
  await cannotSwitch();
  const cannon=await page.evaluate(([x,z])=>window.ashen.projectPoint(x,z),seats[seat-1]);assert.ok(Math.abs(cannon.x-720)<1);assert.ok(cannon.y>540&&cannon.y<810,'selected cannon is foreground');
  const widths=await page.evaluate(seat=>{const a=(seat-1)*Math.PI/2,c=Math.cos(a),s=Math.sin(a),p=(x,z)=>window.ashen.projectPoint(x*c+z*s,z*c-x*s);return {far:Math.abs(p(12.5,-12.5).x-p(-12.5,-12.5).x),near:Math.abs(p(12.5,12.5).x-p(-12.5,12.5).x)};},seat);assert.ok(widths.far>widths.near*1.2,'far wall must be visibly wider');
  const target={x:1.2,z:-1.1};const screen=await page.evaluate(p=>window.ashen.projectPoint(p.x,p.z),target);await page.mouse.move(screen.x,screen.y);await page.waitForTimeout(150);
  const state=await page.evaluate(()=>window.ashen.state());assert.ok(Math.abs(state.aimX-target.x)<.02);assert.ok(Math.abs(state.aimZ-target.z)<.02);evidence.push({seat,cannon,aim:[state.aimX,state.aimZ]});
 }

 for(const [width,height]of [[1440,900],[1280,720],[900,600]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(250);
  const points=await page.evaluate(()=>({left:window.ashen.projectPoint(-12.86,-12.86),right:window.ashen.projectPoint(12.86,-12.86),base:window.ashen.projectPoint(0,12.2)}));
  assert.ok(Math.abs(points.left.x/width-.01)<.002);assert.ok(Math.abs(points.right.x/width-.99)<.002);assert.ok(Math.abs(points.base.y/height-.88)<.002);assert.ok(Math.abs(points.left.y/height-.28)<.002);
 }
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(250);await page.screenshot({path:path.resolve(__dirname,'../player-fov.png')});assert.deepEqual(errors,[]);
 fs.writeFileSync(path.resolve(__dirname,'../tests/player-camera.json'),JSON.stringify({ok:true,url:page.url(),evidence,errors},null,2));console.log('PASS remote HTTPS: fixed player camera, rejected seat actions in menu/battle, no seat controls, correct pointer projection.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
