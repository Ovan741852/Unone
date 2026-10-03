// Synthetic route/state coverage from the actual Luau/WASM project, rendered by
// the exported official Canvas UI. Complements (does not replace) real play tests.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=new URL('../tests/all-ui/',import.meta.url);mkdirSync(out,{recursive:true});
const setup='S.phase="shop";S.location="market";stockShop();';
const gear='for i=1,8 do addItem(gearCatalog[i],12) end;S.worn[1][5]=1;';
const cases={menu:'',profiles:'formalRoute="profiles"',profiles_saved:'formalRoute="profiles";S.profiles[1].created=true',delete:'formalRoute="profiles";S.deleteCandidate=1',settings:'formalRoute="settings"',town:'formalRoute="town"',town_modal:'formalRoute="town";S.townUpgradePending=true;S.townUpgradeIndex=1',map:'S.phase="map";S.mapMoving=false;S.mapFrom=0',choice:'S.phase="choice";S.cards={{id="market",name="榛姨商店",desc="買入裝備，補強下一輪的軍備。"},{id="tech",name="軍團研究",desc="研究兵種專長，不增加每次派兵費。"},{id="enchant",name="附魔鐵砧",desc="替已穿戴的裝備附魔，選擇採用或保留原詞綴。"}}',market:setup,market_modal:setup+'formalShopDetail=1',market_sold:setup+'S.stock[1].sold=true',sell_empty:setup+'formalRoute="sell"',sell:setup+gear+'formalRoute="sell"',gear:setup+gear+'S.phase="loadout";S.loadoutReturn="shop";formalRoute="gear";S.equipSlot=5',gear_empty:setup+'S.phase="loadout";S.loadoutReturn="shop";formalRoute="gear"',runes:setup+'S.phase="loadout";S.loadoutReturn="shop";formalRoute="runes";S.runeBag[1]=1',enchant_empty:'S.phase="shop";S.location="enchant";stockShop()',enchant:'S.phase="shop";S.location="enchant";stockShop();'+gear+'S.equipSlot=5',enchant_offer:'S.phase="shop";S.location="enchant";stockShop();'+gear+'S.equipSlot=5;S.enchantPending={tier=2,skill="pierce"}',battle:'beginBattle()',auto:'beginBattle();S.autoConfigOpen=true;S.paused=true;S.autoDraft=autoPreset("all")',auto_empty:'beginBattle();S.autoConfigOpen=true;S.paused=true;S.autoDraft={}',pause:'beginBattle();S.paused=true',guide:'beginBattle();S.paused=true;formalRoute="guide"',abandon:'beginBattle();S.paused=true;formalRoute="abandon"',celebration:'S.phase="celebration"',celebration_pause:'S.phase="celebration";S.paused=true',clear:'S.phase="clear"',clear_chest:'S.phase="clear";S.chestCount=1',clear_reward:'S.phase="clear";S.chestResult="精良強化符文"',victory:'S.phase="victory"',defeat:'S.phase="defeat";S.resultElapsed=2;S.message="金幣用盡，軍團需要重新整備。"'};
for(const name of ['rune','potion','tech','curse'])cases['shop_'+name]=`S.phase="shop";S.location="${name}";stockShop()`;
cases.sell_rune='S.phase="shop";S.location="rune";stockShop();formalRoute="sell";S.runeBag[1]=2';
const snapshots=[];
loadProject(module,{...payload,script:payload.script.replace('return Game','local base=Game.start\nfunction Game.start(api:any)base(api);api.observation.set("gear_catalog_size",#gearCatalog)end\nreturn Game')},42n);
const gearCount=readObservation(module).world.observations.gear_catalog_size;
for(let offset=0;offset<gearCount;offset+=4)cases['market_catalog_'+offset]=setup+`S.stock={};for i=${offset+1},math.min(${offset+4},#gearCatalog)do local d=gearCatalog[i];table.insert(S.stock,{kind="gear",name=d.name,skill=d.skill,slot=d.slot,price=math.ceil(d.price/8),deployExtra=sourcePrices[d.skill]})end`;
cases.choice='S.phase="choice";S.offer={locationEntries[1],locationEntries[2],locationEntries[3]}';
cases.gear_detail=cases.gear+';formalGearDetail=1';
cases.gear_other_owner=cases.gear+';S.worn[1][5]=0;S.worn[2][5]=1';
cases.gear_other_owner_detail=cases.gear_other_owner+';formalGearDetail=1';
cases.town_populated='formalRoute="town";town.materials=49;town.runs=13;town.bestRound=2;town.levels[1]=2';
cases.profiles_populated='formalRoute="profiles";S.profiles[1].created=true;S.profiles[1].materials=49;S.profiles[1].runs=13;S.profiles[1].bestRound=2';
cases.gear_spear=cases.gear+';S.selected=2';
cases.gear_cavalry=cases.gear+';S.selected=3';
cases.runes_page3=cases.runes+';formalPage=3';
for(const name of ['rune','potion','tech','curse'])cases['detail_'+name]=cases['shop_'+name]+';formalShopDetail=1';
cases.shop_receipt=cases.shop_rune+';formalReceipt="已取得「中王細收符文」，已放入背包。";formalReceiptUntil=99999;S.message="上一次操作訊息"';
// All seven destinations, including marker interpolation along each route leg.
for(let round=1;round<=7;round++){
 if(round>1)cases['map_station_'+round]=`S.phase="map";S.round=${round};S.mapFrom=${round-1};S.mapMoving=false;S.mapPosition=${round}`;
 for(const [stage,elapsed]of [['start',0],['middle',.75],['arriving',1.49]])cases[`map_${round}_${stage}`]=`S.phase="map";S.round=${round};S.mapFrom=${round-1};S.mapMoving=true;S.mapElapsed=${elapsed}`;
}
for(const [name,code]of Object.entries(cases)){
 try{loadProject(module,{...payload,script:payload.script.replace('return Game',`local start=Game.start\nfunction Game.start(api:any)start(api)\n${code}\npublish(api)end\nreturn Game`)},42n);}catch(error){throw new Error(`Fixture ${name}: ${error.result?.error??error.message}`);}
 const snapshot=JSON.parse(JSON.stringify(readObservation(module)));
 snapshots.push({name,snapshot});
}
const assets=JSON.parse(readFileSync(new URL('../assets.json',import.meta.url))).assets;
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={fixture:true,ok:false,cases:[],errors:[]};
try{
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/all-ui-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#0a1712}canvas{display:block}</style><canvas id="formal-ui"></canvas>'}));
 await page.goto('http://127.0.0.1:8190/all-ui-fixture');
 await page.evaluate(async assets=>{
  const {createCanvasUi}=await import('/web/shared/canvas-ui.mjs');
  window.fit=(await import('/presentation/adaptive-ui.mjs')).fitFormalUI;
  const p=CanvasRenderingContext2D.prototype,rect=p.rect,fill=p.fillText,clear=p.clearRect;
  p.clearRect=function(...a){if(this.canvas.id==='formal-ui')window.glyphs=[];return clear.apply(this,a)};
  p.rect=function(x,y,width,height){this.clipBox={x,y,width,height};return rect.call(this,x,y,width,height)};
  p.fillText=function(text,x,y,...a){if(this.canvas.id==='formal-ui'){const m=this.measureText(text);window.glyphs.push({text,font:parseFloat(this.font),clip:this.clipBox,ink:{x:x-m.actualBoundingBoxLeft,y:y-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent}})}return fill.call(this,text,x,y,...a)};
  window.renderer=createCanvasUi(document.querySelector('canvas'),{resolveAsset:id=>'/content/'+assets.find(a=>a.id===id).source,fontFamily:'"Microsoft JhengHei",sans-serif',textColor:'#f4e4b8'});
 },assets);
 for(const [width,height]of [[1920,1080]]){
  await page.setViewportSize({width,height});
  for(const {name,snapshot}of snapshots){
   const result=await page.evaluate(async({snapshot,width,height})=>{
    const fitted=window.fit(snapshot,{width,height}),tree=fitted.world.ui;
    window.renderer.draw(fitted,{width,height,dpr:1});
    for(let i=0;i<100&&window.renderer.report().assets.some(a=>a.state==='loading');i++)await new Promise(r=>setTimeout(r,10));
    window.renderer.draw(fitted,{width,height,dpr:1});
    return {tree,glyphs:window.glyphs,metrics:window.renderer.report()};
   },{snapshot,width,height});
   const {tree,glyphs,metrics}=result,nodes=tree.children,failures=[];
   const contains=(a,b)=>a.x<=b.x+.25&&a.y<=b.y+.25&&a.x+a.width>=b.x+b.width-.25&&a.y+a.height>=b.y+b.height-.25;
   const overlap=(a,b)=>a.x<b.x+b.width-.08&&a.x+a.width>b.x+.08&&a.y<b.y+b.height-.08&&a.y+a.height>b.y+.08;
   for(const n of nodes)if(!contains({x:0,y:0,width:100,height:100},n.rect))failures.push('offscreen '+n.id);
   for(const g of glyphs){if(g.font<13.95)failures.push('font '+g.text+' '+g.font.toFixed(2));if(!contains(g.clip,g.ink))failures.push('clip '+g.text);}
   const modal=nodes.findLastIndex(n=>['town_upgrade_shade','shop_detail_shade','gear_detail_shade','enchant_reveal_back'].includes(n.id));
   const texts=nodes.slice(Math.max(0,modal)).filter(n=>n.text);
   for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++)if(overlap(texts[i].rect,texts[j].rect))failures.push('text overlap '+texts[i].id+' / '+texts[j].id);
   const actions=new Map();for(const n of nodes.slice(Math.max(0,modal)).filter(n=>n.kind==='button')){const rs=actions.get(n.action)??[];rs.push(n.rect);actions.set(n.action,rs)}
   for(const [action,rs]of actions){const w=Math.max(...rs.map(r=>r.x+r.width))-Math.min(...rs.map(r=>r.x)),h=Math.max(...rs.map(r=>r.y+r.height))-Math.min(...rs.map(r=>r.y));if(w*width/100<43.8||h*height/100<43.8)failures.push('hit below 44px '+action);}
   if(metrics.diagnostics.length)failures.push(...metrics.diagnostics.map(d=>d.message));
   if(name==='gear_other_owner'&&!nodes.find(n=>n.id==='gear_name_1')?.text.includes('槍兵持有'))failures.push('missing equipment owner');
   if(name==='gear_other_owner_detail'&&(!nodes.find(n=>n.id==='gear_detail_quote')?.text.includes('槍兵穿戴中')||nodes.find(n=>n.id==='gear_detail_equip')?.text!=='轉交此裝備'))failures.push('missing transfer disclosure');
   if(nodes.some(n=>n.id==='shop_window_title')&&!name.includes('modal')){
    for(const n of nodes.filter(n=>/^stock_name_\d+$/.test(n.id))){const summary=nodes.find(s=>s.id===n.id.replace('name','desc'));if(!summary?.text||summary.text.includes('…'))failures.push('missing/truncated core effect '+n.id);}
   }
   if(name.startsWith('map')){
    const back=nodes.find(n=>n.id==='map_back');
    if(back?.asset!=='texture://ui_forest-map-v2')failures.push('legacy map art');
    if(back&&Math.abs((back.rect.width*width)/(back.rect.height*height)-1672/941)>.002)failures.push('map aspect stretched');
    for(const n of nodes.filter(n=>/^map_(node_\d+|cursor_icon)$/.test(n.id))){
     if(!contains(back.rect,n.rect))failures.push('map marker outside illustration '+n.id);
     if(Math.abs(n.rect.width*width-n.rect.height*height)>.1)failures.push('map medallion stretched '+n.id);
    }
    if(nodes.filter(n=>/^map_number_\d+$/.test(n.id)).length!==7)failures.push('missing map station');
    const g=snapshot.world.observations.game;
    if(nodes.some(n=>/^screen_(gold|crystals)/.test(n.id)))failures.push('irrelevant map currencies');
    if(nodes.some(n=>n.id==='map_journal'))failures.push('duplicate chapter journal on map');
    if(actions.has('VisitLocation')===Boolean(g.mapMoving))failures.push('map arrival action state');
    if(nodes.some(n=>n.id==='map_cursor_icon')!==Boolean(g.mapMoving))failures.push('map marching marker state');
    for(let i=1;i<=7;i++){
     const link=nodes.find(n=>n.id==='map_link_'+i),done=i<g.round||i===g.round&&!g.mapMoving;
     if(link?.asset!==`texture://ui_map-link-${i}-${done?'done':'future'}`)failures.push('map route state '+i);
    }
   }
   report.cases.push({name,width,height,nodes:nodes.length,failures,minFont:Math.min(...glyphs.map(g=>g.font))});
   await page.screenshot({path:new URL(name+'-'+width+'.png',out).pathname.replace(/^\/([A-Z]:)/,'$1')});
   writeFileSync(new URL(name+'-'+width+'.json',out),JSON.stringify(result,null,2));
  }
 }
 report.ok=!report.errors.length&&report.cases.every(c=>!c.failures.length);
 writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,errors:report.errors,failures:report.cases.filter(c=>c.failures.length)},null,2));
 if(!report.ok)process.exitCode=1;
}finally{await browser.close()}
