const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const transparent=process.argv.includes('--transparent');
const root=path.resolve(__dirname,'..'),out=path.join(root,transparent?'tests/hazel-transparent':'tests/hazel-imgen');fs.mkdirSync(out,{recursive:true});
const assets=JSON.parse(fs.readFileSync(path.join(root,'assets.json'),'utf8')).assets;
const art=JSON.parse(fs.readFileSync(path.join(root,transparent?'design-v1/hazel-transparent-manifest.json':'design-v1/hazel-imgen-manifest.json'),'utf8'));
if(transparent){for(const e of art.entries){if(!e.alphaCheck?.valid||!e.runtimeAlphaRange||e.runtimeAlphaRange[0]!==0)throw Error('Missing verified native alpha: '+e.id);if(e.kind==='skill'){const gear=art.entries.find(g=>g.id===e.pairedEquipment);if(!gear&&process.argv.includes('--complete'))throw Error('Missing paired equipment: '+e.id);if(gear&&(gear.runtime===e.runtime||gear.sourceSha256===e.sourceSha256))throw Error('Equipment and skill share artwork: '+e.id);}}}
const png=name=>'data:image/png;base64,'+fs.readFileSync(path.join(root,assets.find(a=>a.id==='texture://ui_'+name).source)).toString('base64');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1120}});
 const groups=[['建築與商店',[['building-market','林間集市'],['building-alchemy','藥水工坊'],['building-forge','附魔鐵砧'],['building-barracks','軍團研究'],['building-curse','荊棘契約'],['building-keep','領主城堡']]],
 ['技能與屬性',[['skill-flame_cloak','火焰斗篷'],['skill-firstborn','初生之犢'],['skill-critical','爆擊'],['skill-lightning','雷擊'],['skill-plague_vial','魔藥瓶'],['icon-life','生命']]],
 ['裝備與操作',[['gear-legacy_gift','傳承魂燈'],['gear-longlife','延命護甲'],['gear-haste','疾風足具'],['icon-sword','劍兵'],['icon-coin','金幣'],['icon-gloves','手部']]]];
 let html=`<style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#1b302b;color:#efdebb;font:16px 'Microsoft JhengHei',sans-serif}h1{font-size:28px;margin:0 0 8px}header{display:flex;align-items:center;gap:32px;margin-bottom:20px}header img{width:220px;height:220px;object-fit:contain}h2{font-size:18px;color:#cbaa71;font-weight:500;letter-spacing:.12em;margin:20px 0 12px}section{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}.card{background:#344336;border-top:1px solid #827750;padding:10px 12px;text-align:center}.pictures{display:flex;align-items:end;justify-content:center;gap:6px}small{display:block;color:#c3b28f;font-size:12px;margin:5px 0}.label{margin:8px 0}</style><header><img src="${png('quartermaster-v1')}"><div><h1>榛姨的遠征行囊</h1><p>暖金邊光 · 苔綠布料 · 赤褐皮革 · 手繪明暗切面</p><small>正式遊戲圖示　128 px / 48 px</small></div></header>`;
 for(const [title,items]of groups){html+='<h2>'+title+'</h2><section>';for(const [name,label]of items)html+=`<div class="card"><div class="pictures"><img width="128" height="128" src="${png(name)}"><img width="48" height="48" src="${png(name)}"></div><div class="label">${label}</div></div>`;html+='</section>';}
 await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'hazel-icons.png'),fullPage:true});
 const all=assets.filter(a=>/^texture:\/\/ui_(gear-|skill-|icon-|symbol-|building-)/.test(a.id)).map(a=>a.id);
 const styled=art.entries.flatMap(e=>e.resources.map(id=>'texture://ui_'+id));
 const unconverted=all.filter(id=>!styled.includes(id));
 if(process.argv.includes('--complete')&&unconverted.length)throw Error('Remaining non-ImageGen icons: '+unconverted.join(','));
 const mismatched=art.entries.flatMap(e=>e.resources.filter(id=>assets.find(a=>a.id==='texture://ui_'+id)?.source!==e.runtime));
 if(mismatched.length)throw Error('Wrong runtime artwork: '+mismatched.join(','));
 console.log(JSON.stringify({artworks:art.entries.length,total:all.length,imgen:styled.length,remaining:unconverted.length}));
 for(let offset=0;offset<art.entries.length;offset+=24){
  const part=art.entries.slice(offset,offset+24);await page.setContent('<style>body{margin:0;background:#142a24;color:#eedabb;font:13px sans-serif;padding:16px;display:grid;grid-template-columns:repeat(6,1fr);gap:14px}figure{margin:0;text-align:center}img{width:150px;height:150px}small img{width:40px;height:40px}figcaption{height:28px}</style>'+part.map(e=>`<figure><img src="${png(e.resources[0])}"><small><img src="${png(e.resources[0])}"></small><figcaption>${e.name??e.id}</figcaption></figure>`).join(''));await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'catalog-'+(offset/24+1)+'.png'),fullPage:true});
 }
 // Real official UI screens, not the contact sheet: native purchases unchanged.
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.setViewportSize({width:1440,height:810});await page.goto('http://127.0.0.1:8190/?build='+(transparent?'hazel-transparent-v2':'hazel-imgen-v1')+'&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 const action=async a=>{await page.evaluate(a=>ashen.action(a),a);await page.waitForTimeout(450);await page.waitForFunction(()=>ashen.metrics().ui.assets.every(a=>a.state==='ready'))};
 await action('UI_town');await page.screenshot({path:path.join(out,'town.png')});await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(600);await page.screenshot({path:path.join(out,'locations.png')});
 const marketIndex=await page.evaluate(()=>Object.values(ashen.state().cards).findIndex(c=>c.id==='market'));
 if(marketIndex<0)throw Error('Use a fixture seed offering the market');await action('Choice'+(marketIndex+1));await page.screenshot({path:path.join(out,'shop.png')});await action('Buy1');await action('UI_gear');await page.screenshot({path:path.join(out,'equipment.png')});
 await action('UI_home');await action('LeaveShop');await action('Deploy');await action('Unit3');await action('Mode_auto');await action('Auto_apply');await page.waitForTimeout(2400);
 const ui=await page.evaluate(()=>({tree:ashen.uiTree(),labels:ashen.metrics().labels,diagnostics:ashen.metrics().ui.diagnostics}));
 if(JSON.stringify(ui).includes('即將破防'))throw Error('Removed banner still appears');
 if(errors.length||ui.diagnostics.length)throw Error(JSON.stringify({errors,diagnostics:ui.diagnostics}));
 await page.screenshot({path:path.join(out,'battle.png')});
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(450);
 await page.screenshot({path:path.join(out,'battle-landscape-phone.png')});
 const phone=await page.evaluate(()=>({diagnostics:ashen.metrics().ui.diagnostics,assets:ashen.metrics().ui.assets}));
 if(phone.diagnostics.length||phone.assets.some(a=>a.state!=='ready'))throw Error('Landscape phone icon loading failed');
 const nearBreak=await page.evaluate(async()=>{
  const {createWorldLabels}=await import('/presentation/world-labels.mjs');
  const anchor=document.createElement('canvas');document.querySelector('#stage').append(anchor);const labels=createWorldLabels({before:anchor,projectPoint:ashen.projectPoint});
  const s={phase:'battle',rewardClock:1,seat:1,monsters:[{id:901,name:'接近破防測試怪',rank:1,x:0,z:0,guard:100,damage:90,guardProgress:.9}],targetId:0};labels.draw(s);const unselected=labels.inspect();
  labels.draw({...s,targetId:901});const selected=labels.inspect();labels.dispose();anchor.remove();return {unselected,selected};
 });
 if(nearBreak.unselected.nameplates.length!==0||nearBreak.selected.nameplates.length!==1||JSON.stringify(nearBreak).includes('即將破防'))throw Error('Near-break banner regression');
 fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({artworks:art.entries.length,total:all.length,imgen:styled.length,unconverted,ui,phone,nearBreak,errors},null,2));
 console.log('PASS real town, map locations, shop, equipment and battle; icon loads and removed near-break message');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
