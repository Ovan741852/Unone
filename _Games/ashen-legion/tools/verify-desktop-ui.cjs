// Actual exported game, isolated browser saves, fixed-desktop contracts.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const uiPoint=require('./ui-test-pointer.cjs');
const out=path.resolve(__dirname,'../tests/desktop-ui-v4');fs.mkdirSync(out,{recursive:true});
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<.06,`${label}: ${a} != ${b}`);
const union=rs=>{const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return{x,y,width:Math.max(...rs.map(r=>r.x+r.width))-x,height:Math.max(...rs.map(r=>r.y+r.height))-y}};
function frame(nodes,id){const direct=nodes.find(n=>n.id===id);return direct?.rect??union(['tl','t','tr','l','c','r','bl','b','br'].map(p=>{const n=nodes.find(n=>n.id===id+'_'+p);assert.ok(n,'Missing frame part '+id+'_'+p);return n.rect}));}
const top=r=>100-r.y-r.height,center=r=>r.y+r.height/2;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),report={ok:false,checks:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
  await page.goto((process.env.GAME_TEST_URL||'http://127.0.0.1:8190/')+'?seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const nodes=()=>page.evaluate(()=>window.ashen.uiTree().children);
  const state=()=>page.evaluate(()=>window.ashen.state());
  async function settle(){await page.waitForTimeout(200);await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));}
  async function click(id){const n=(await nodes()).find(n=>n.id===id&&n.kind==='button');assert.ok(n,'Missing '+id);const p=await uiPoint(page,n.rect);await page.mouse.click(p.x,p.y);await page.mouse.move(2,2);await settle();}
  async function capture(name){await settle();await page.screenshot({path:path.join(out,name+'.png')});}
  async function noRunResources(){assert.ok(!(await nodes()).some(n=>/^screen_(gold|crystals)/.test(n.id)),'Unexpected run-resource header');assert.ok(!/金幣|結晶/.test(await page.locator('#shop-accessible-status').textContent()),'Unexpected run-resource announcement');}
  await click('settings');await noRunResources();await click('settings_back');await click('start');await noRunResources();
  const baseline=await nodes();
  for(const [width,height]of [[1920,1080],[1280,720],[1600,1000],[2560,1440]]){
   await page.setViewportSize({width,height});await settle();
   const metrics=await page.evaluate(()=>window.ashen.metrics().viewport),b=await page.locator('#game').boundingBox(),scale=Math.min(width/1920,height/1080);
   assert.equal(metrics.width,1920);assert.equal(metrics.height,1080);assert.equal(metrics.rotationDegrees,0);assert.equal(metrics.fixedDesktop,true);
   near(b.width,1920*scale,'stage width');near(b.height,1080*scale,'stage height');near(b.x,(width-b.width)/2,'horizontal centering');near(b.y,(height-b.height)/2,'vertical centering');
   assert.deepEqual(await nodes(),baseline,'Viewport resized/reflowed individual UI nodes');
   report.checks.push(`Fixed 1920×1080 composition, unchanged text/rectangles, uniform centered scale at ${width}×${height}`);
  }
  await page.setViewportSize({width:1600,height:1000});await settle();await capture('profiles-letterbox');
  await click('profile_create_3');assert.equal((await state()).uiRoute,'town');await noRunResources();
  const town=await nodes(),get=id=>{const n=town.find(n=>n.id===id);assert.ok(n,id);return n.rect};
  const material=get('town_material_icon'),balance=get('town_gold');near(material.width*19.2,48,'material width');near(material.height*10.8,48,'material height');near(center(material),center(balance),'material/value vertical center');
  assert.ok((balance.x-material.x-material.width)*19.2<=16,'Material/value gap too large');
  for(let i=1;i<=8;i++){
   const r=frame(town,'town_'+i+'_plate'),icon=get('town_icon_'+i),costIcon=get('town_cost_icon_'+i),cost=get('town_cost_'+i);
   near(icon.width*19.2,72,'research icon width');near(icon.height*10.8,72,'research icon height');near(center(icon),center(r),'research icon center');
   near(get('town_name_'+i).x,get('town_effect_'+i).x,'research text left axis');near(center(costIcon),center(cost),'cost center');near(costIcon.height*10.8,36,'cost icon height');
   assert.ok((cost.x-costIcon.x-costIcon.width)*19.2<=14,'Cost gap too large');
  }
  assert.equal(town.find(n=>n.id==='town_scene').asset,'texture://ui_shop-backdrop');
  await capture('town-letterbox');report.checks.push('Real letterboxed pointer creates profile; research icons 72px, costs 36px, resource 48px; shared left axis and centered tight icon/value pairs');
  await click('town_back');await click('start');await click('profile_delete_3');await noRunResources();await page.keyboard.press('Escape');await settle();assert.equal((await state()).deleteCandidate,0);
  const profiles=await nodes(),load=frame(profiles,'profile_load_3_plate'),remove=frame(profiles,'profile_delete_3_plate');near(load.height,remove.height,'profile button heights');near(load.y,remove.y,'profile button baseline');assert.ok(remove.x>=load.x+load.width,'Profile actions overlap');
  await page.setViewportSize({width:1920,height:1080});await capture('profiles-saved-desktop');
  report.checks.push('Profile/delete/settings omit run resources, Escape preserves save, primary/secondary profile actions share height and baseline');
  await page.setViewportSize({width:1600,height:1000});await settle();
  await page.locator('[data-shop-control="profile_load_3"]').focus();await page.keyboard.press('Tab');await settle();
  const focusId=await page.evaluate(()=>document.activeElement.dataset.shopControl),focusNodes=(await nodes()).filter(n=>n.id===focusId||n.id===focusId+'_hit_top'||n.id===focusId+'_hit_bottom');
  const focus=union(focusNodes.map(n=>n.rect)),ring=await page.locator('[data-shop-focus]').boundingBox(),stage=await page.locator('#game').boundingBox();assert.ok(ring,'Visible keyboard focus');
  near(ring.x,stage.x+focus.x*stage.width/100,'focus left');near(ring.y,stage.y+top(focus)*stage.height/100,'focus top');near(ring.width,focus.width*stage.width/100,'focus width');
  await click('profile_load_3');await click('launch_expedition');await page.waitForFunction(()=>window.ashen.state().phase==='choice');await settle();await noRunResources();
  const choice=await nodes(),cards=[1,2,3].map(i=>frame(choice,'choice_plate_'+i));
  for(let i=1;i<=3;i++){
   const r=cards[i-1],hit=choice.find(n=>n.id==='choice_'+i);assert.deepEqual(hit.rect,r,'Whole portrait card must be clickable');assert.equal(hit.action,'Choice'+i);
   near(r.y,cards[0].y,'choice baseline');near(r.height,cards[0].height,'choice height');assert.ok(r.height*10.8>r.width*19.2,'Choice card is not portrait');
   if(i>1)assert.ok(r.x>cards[i-2].x+cards[i-2].width,'Choice cards overlap');
   const desc=choice.find(n=>n.id==='choice_desc_'+i),portrait=choice.find(n=>n.id==='choice_icon_'+i);assert.ok(top(portrait.rect)>=40.5,'Portrait overlaps crest');assert.ok(top(desc.rect)+desc.rect.height<72,'Description crosses inner gold border');
   assert.ok(desc.text&&!desc.text.includes('…'),'Incomplete choice summary');assert.match(await page.locator(`[data-shop-control="choice_${i}"]`).textContent(),/拜訪此處/);
  }
  assert.ok(!choice.some(n=>n.id==='story_back'),'Old wide story panel remains');
  await page.setViewportSize({width:1920,height:1080});await capture('choice-desktop');
  await page.setViewportSize({width:1600,height:1000});await settle();
  const market=Object.values((await state()).cards).findIndex(c=>c.id==='market'),portrait=(await nodes()).find(n=>n.id==='choice_icon_'+(market+1)),p=await uiPoint(page,portrait.rect);
  await page.mouse.click(p.x,p.y);await page.mouse.move(2,2);await settle();assert.equal((await state()).location,'market');
  report.checks.push('Keyboard focus follows the same letterbox transform; three equal portrait choices stay horizontal, avoid decoration, and portrait clicks enter the intended merchant');
  assert.ok((await nodes()).some(n=>n.id==='screen_gold_icon'),'Shop must retain actual balances');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(900);
  const before=frame(await nodes(),'stock_panel_1'),point=await uiPoint(page,before);await page.mouse.move(point.x,point.y);await page.waitForTimeout(120);
  assert.ok(frame(await nodes(),'stock_panel_1').height>before.height,'Hover feedback missing');
  await page.mouse.move(2,2);await page.waitForTimeout(350);near(frame(await nodes(),'stock_panel_1').height,before.height,'Pointer leave clears hover');
  await click('stock_hit_1');await page.waitForTimeout(900);
  const detail=await nodes(),heights=[1,2,3,4].map(i=>frame(detail,'stock_panel_'+i).height);heights.forEach(h=>near(h,heights[0],'Background cards equal under modal'));
  report.checks.push('Shop retains balances; pointer leave clears hover and detail modal does not leave background cards at unequal heights');
  report.ok=!report.errors.length;
 }catch(e){report.errors.push(e.stack);throw e;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
