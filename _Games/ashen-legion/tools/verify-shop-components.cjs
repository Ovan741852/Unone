// Integration acceptance: actual exported renderer, actual pointer routing and
// actual glyph bounds. Run after build-formal-ui + finish_export.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const out=path.resolve(__dirname,'../tests/shop-layout');fs.mkdirSync(out,{recursive:true});
const overlap=(a,b)=>a.x<b.x+b.width-.01&&a.x+a.width>b.x+.01&&a.y<b.y+b.height-.01&&a.y+a.height>b.y+.01;
const contains=(a,b)=>a.x<=b.x+.02&&a.y<=b.y+.02&&a.x+a.width>=b.x+b.width-.02&&a.y+a.height>=b.y+b.height-.02;
const parts=['tl','t','tr','l','c','r','bl','b','br'];
function check(tree,modal,viewport={width:844,height:390}){
 const nodes=tree.children,by=new Map(nodes.map(n=>[n.id,n])),failures=[];
 const ok=(test,message)=>{if(!test)failures.push(message)};
 const union=rs=>{const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return{x,y,width:Math.max(...rs.map(r=>r.x+r.width))-x,height:Math.max(...rs.map(r=>r.y+r.height))-y}};
 const box=id=>{if(by.has(id))return by.get(id).rect;const ns=parts.map(p=>by.get(id+'_'+p));ok(ns.every(Boolean),'Incomplete nine-slice '+id);return ns.every(Boolean)?union(ns.map(n=>n.rect)):{x:0,y:0,width:0,height:0}};
 const siblings=ids=>{for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)ok(!overlap(box(ids[i]),box(ids[j])),`Sibling overlap: ${ids[i]} / ${ids[j]}`)};
 for(const n of nodes)ok(contains({x:0,y:0,width:100,height:100},n.rect),'Offscreen '+n.id);
 const window=box('screen_back'),cards=[1,2,3,4].map(i=>box('stock_panel_'+i));
 for(const node of nodes.filter(n=>n.id.endsWith('_tl'))){
  const key=node.asset.replace('texture://ui_','').replace(/-tl$/,'');
  const [left,top]=key.includes('window')?[360,540]:key.includes('card')?[210,360]:[300,100];
  const actual=node.rect.width*viewport.width/(node.rect.height*viewport.height);
  ok(Math.abs(actual-left/top)<.002,'Distorted corner '+node.id);
 }
 cards.forEach((card,i)=>{
  ok(contains(window,card),'Card outside window '+i);
  ok(Math.abs(card.height-cards[0].height)<.01,'Unequal card height '+i);
  if(i)ok(card.x-(cards[i-1].x+cards[i-1].width)>=.6,'Card gap collapsed '+i);
  const ids=['icon','name','desc','cost','deploy','detail'].map(role=>'stock_'+role+'_'+(i+1)+(role==='detail'?'_plate':''));
  const safe={x:card.x+1.5,y:card.y+3,width:card.width-3,height:card.height-11};
  for(const id of ids)ok(contains(safe,box(id)),'Outside card content-safe area '+id);
  siblings(ids);
 });
 siblings(['tab_home_plate','tab_sell_plate','screen_title','screen_gold','screen_crystals','shop_window_title']);
 if(!modal)siblings(['stock_panel_1','stock_panel_2','stock_panel_3','stock_panel_4','shopkeeper_portrait','shopkeeper_name','shopkeeper_line','stock_hint','refresh_plate','ready_plate']);
 if(modal){
  const frame=box('shop_detail_modal'),ids=['kicker','title','icon','story','price','deploy','trigger','effect','buy_plate','cancel_plate','close_plate'].map(s=>'shop_detail_'+s);
  for(const id of ids)ok(contains(frame,box(id)),'Outside modal '+id);
  siblings(ids);
  ok(!by.has('refresh'),'Underlying reroll rendered above modal');
 }
 // Same-size buttons must share corner sizes and actual plate height.
 const buttonIds=['stock_detail_1','stock_detail_2','stock_detail_3','stock_detail_4','tab_home','tab_sell','ready'];
 const heights=buttonIds.map(id=>box(id+'_plate').height);
 ok(Math.max(...heights)-Math.min(...heights)<.15,'Inconsistent shared button height');
 return failures;
}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const report={ok:false,checks:[],errors:[]};try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
 await page.addInitScript(()=>{
  const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,rect=p.rect,fill=p.fillText;
  p.clearRect=function(...args){if(this.canvas.id==='formal-ui')window.__glyphs=[];return clear.apply(this,args)};
  p.rect=function(x,y,width,height){if(this.canvas.id==='formal-ui')this.__textRect={x,y,width,height};return rect.call(this,x,y,width,height)};
  p.fillText=function(text,x,y,...rest){if(this.canvas.id==='formal-ui'){
   const m=this.measureText(text);(window.__glyphs??=[]).push({text,font:parseFloat(this.font),clip:this.__textRect,ink:{x:x-m.actualBoundingBoxLeft,y:y-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent}});
  }return fill.call(this,text,x,y,...rest)};
 });
 await page.goto((process.env.GAME_TEST_URL||'http://127.0.0.1:8190/')+'?seed=42');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
 async function click(action,target){const r=await page.evaluate(({action,target})=>window.ashen.uiTree().children.find(n=>n.kind==='button'&&(target?n.id===target:n.action===action))?.rect,{action,target});assert.ok(r,'Missing '+action);const v=page.viewportSize();await page.mouse.click((r.x+r.width/2)*v.width/100,(100-r.y-r.height/2)*v.height/100);await page.mouse.move(2,2);await page.waitForTimeout(160);}
 await click('Start');await click('Profile1');await click('LaunchExpedition');await page.waitForFunction(()=>window.ashen.state().phase==='choice');
 const index=await page.evaluate(()=>Object.values(window.ashen.state().cards).findIndex(c=>c.id==='market'));
 await click('Choice'+(index+1));
 async function capture(name,modal){
  await page.waitForTimeout(850);await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));
  const {tree,glyphs}=await page.evaluate(()=>({tree:window.ashen.uiTree(),glyphs:window.__glyphs}));
  const failures=check(tree,modal,page.viewportSize());
  for(const g of glyphs){if(!contains(g.clip,g.ink))failures.push('Clipped glyph: '+g.text);if(g.font<9.8)failures.push('Unreadably small: '+g.text+' '+g.font);}
  await page.screenshot({path:path.join(out,name+'.png')});report.checks.push({name,failures,glyphCount:glyphs.length,minFont:Math.min(...glyphs.map(g=>g.font))});
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({tree,glyphs},null,2));
 }
 for(const [width,height]of [[1440,900],[1280,720],[900,600],[844,390]]){
  await page.setViewportSize({width,height});await capture(`components-${width}`,false);
  for(let i=1;i<=4;i++){await click('ShopDetail'+i);await capture(`components-detail${i}-${width}`,true);await click('ShopDetailClose','shop_detail_close');}
 }
 await click('ShopDetail1');await click('Buy1');await capture('components-purchased-844',true);await click('ShopDetailClose','shop_detail_close');await capture('components-receipt-844',false);
 // Adversarial copy + animation frames exercise the same public composition
 // functions; they do not mutate gameplay or a saved profile.
 const stress=await page.evaluate(async()=>{
  const {fitFormalUI}=await import('./presentation/adaptive-ui.mjs'),{createUiMotion}=await import('./presentation/ui-motion.mjs');
  const snapshot={ui:window.ashen.uiTree()},copy=structuredClone(snapshot);
  for(const n of copy.ui.children)if(/^stock_name_/.test(n.id))n.text='傳說中的雷霆風暴長槍';else if(/^stock_desc_/.test(n.id))n.text='每次命中敵人後觸發範圍連鎖雷擊；持續造成傷害並降低附近所有敵人的移動速度。';
  const fitted=fitFormalUI(copy,{width:844,height:390});let at=0;const motion=createUiMotion({now:()=>at});
  return [0,40,80,160,320,800].map(t=>{at=t;return motion.draw(fitted).ui});
 });
 stress.forEach((tree,i)=>report.checks.push({name:'animation-long-copy-'+i,failures:check(tree,false)}));
 report.ok=report.errors.length===0&&report.checks.every(c=>!c.failures.length);
 fs.writeFileSync(path.join(out,'components-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.ok(report.ok,'Shop component acceptance failed');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
