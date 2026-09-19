const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/hazel-icons');fs.mkdirSync(out,{recursive:true});
const png=name=>'data:image/png;base64,'+fs.readFileSync(path.join(root,'assets/formal-ui',name+'.png')).toString('base64');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1120}});
 const groups=[['建築與商店',[['building-market','林間集市'],['building-alchemy','藥水工坊'],['building-forge','附魔鐵砧'],['building-barracks','军團研究'],['building-curse','荊棘契約'],['building-keep','領主城堡']]],
 ['技能與屬性',[['skill-flame_cloak','火焰斗篷'],['skill-firstborn','初生之犢'],['skill-critical','爆擊'],['skill-lightning','雷擊'],['skill-plague_vial','魔藥瓶'],['icon-life','生命']]],
 ['裝備與操作',[['gear-legacy_gift','傳承魂燈'],['gear-longlife','延命護甲'],['gear-haste','疾風足具'],['icon-sword','劍兵'],['icon-coin','金幣'],['icon-gloves','手部']]]];
 let html=`<style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#1b302b;color:#efdebb;font:16px 'Microsoft JhengHei',sans-serif}h1{font-size:28px;margin:0 0 8px}header{display:flex;align-items:center;gap:32px;margin-bottom:20px}header img{width:220px;height:220px;object-fit:contain}h2{font-size:18px;color:#cbaa71;font-weight:500;letter-spacing:.12em;margin:20px 0 12px}section{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}.card{background:#344336;border-top:1px solid #827750;padding:10px 12px;text-align:center}.pictures{display:flex;align-items:end;justify-content:center;gap:6px}small{display:block;color:#c3b28f;font-size:12px;margin:5px 0}.label{margin:8px 0}</style><header><img src="${png('quartermaster-v1')}"><div><h1>榛姨的遠征行囊</h1><p>暖金邊光 · 苔綠布料 · 赤褐皮革 · 手繪明暗切面</p><small>正式遊戲圖示　128 px / 48 px</small></div></header>`;
 for(const [title,items]of groups){html+='<h2>'+title+'</h2><section>';for(const [name,label]of items)html+=`<div class="card"><div class="pictures"><img width="128" height="128" src="${png(name)}"><img width="48" height="48" src="${png(name)}"></div><div class="label">${label}</div></div>`;html+='</section>';}
 await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'hazel-icons.png'),fullPage:true});
 const all=fs.readdirSync(path.join(root,'assets/formal-ui')).filter(f=>/^(gear-|skill-|icon-|symbol-|building-).*\.svg$/.test(f));
 const styled=all.filter(f=>fs.readFileSync(path.join(root,'assets/formal-ui',f),'utf8').includes('data-art-style="hazel-faceted-v1"'));
 console.log(JSON.stringify({total:all.length,styled:styled.length,unconverted:all.filter(f=>!styled.includes(f))}));
 if(all.some(f=>!styled.includes(f)))throw Error('Unconverted icon');
 // Real official UI screens, not the contact sheet: native purchases unchanged.
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.setViewportSize({width:1440,height:810});await page.goto('http://127.0.0.1:8190/?build=hazel-icons-v1&seed=42');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
 const action=async a=>{await page.evaluate(a=>ashen.action(a),a);await page.waitForTimeout(450);await page.waitForFunction(()=>ashen.metrics().ui.assets.every(a=>a.state==='ready'))};
 await action('UI_town');await page.screenshot({path:path.join(out,'town.png')});await action('UI_home');await action('Start');await page.waitForFunction(()=>ashen.state().phase==='choice');await page.waitForTimeout(600);await page.screenshot({path:path.join(out,'locations.png')});
 await action('Choice1');await page.screenshot({path:path.join(out,'shop.png')});await action('Buy1');await action('UI_gear');await page.screenshot({path:path.join(out,'equipment.png')});
 await action('UI_home');await action('LeaveShop');await action('Unit3');await action('Mode_auto');await action('Auto_apply');await page.waitForTimeout(2400);
 const ui=await page.evaluate(()=>({tree:ashen.uiTree(),labels:ashen.metrics().labels,diagnostics:ashen.metrics().ui.diagnostics}));
 if(JSON.stringify(ui).includes('即將破防'))throw Error('Removed banner still appears');
 if(errors.length||ui.diagnostics.length)throw Error(JSON.stringify({errors,diagnostics:ui.diagnostics}));
 await page.screenshot({path:path.join(out,'battle.png')});
 const nearBreak=await page.evaluate(async()=>{
  const {createWorldLabels}=await import('/presentation/world-labels.mjs');
  const anchor=document.createElement('canvas');document.querySelector('#stage').append(anchor);const labels=createWorldLabels({before:anchor,projectPoint:ashen.projectPoint});
  const s={phase:'battle',rewardClock:1,seat:1,monsters:[{id:901,name:'接近破防測試怪',rank:1,x:0,z:0,guard:100,damage:90,guardProgress:.9}],targetId:0};labels.draw(s);const unselected=labels.inspect();
  labels.draw({...s,targetId:901});const selected=labels.inspect();labels.dispose();anchor.remove();return {unselected,selected};
 });
 if(nearBreak.unselected.nameplates.length!==0||nearBreak.selected.nameplates.length!==1||JSON.stringify(nearBreak).includes('即將破防'))throw Error('Near-break banner regression');
 fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({total:all.length,styled:styled.length,unconverted:all.filter(f=>!styled.includes(f)),ui,nearBreak,errors},null,2));
 console.log('PASS real town, map locations, shop, equipment and battle; icon loads and removed near-break message');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
