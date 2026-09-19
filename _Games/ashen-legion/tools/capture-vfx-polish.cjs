// Browser-only art fixture: fixed event receipts and clock for comparable captures.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const mode=process.argv[2]||'after',motion=mode==='motion',out=path.resolve(__dirname,'../tests/vfx-polish');fs.mkdirSync(out,{recursive:true});
const fixture=`
function Game.start(api:any)
 apiRef=api;reset();beginBattle();S.rewardClock=10
 S.selected=2;fire();local t=troops[#troops];t.x=-5;t.z=6;t.state="spin";t.spin=.18;t.skills.spinRadius=2.9
 for i,kind in ipairs({"lightning","frost","ember","cleave","shock","leaf"})do
  local x=((i-1)%3-1)*6;local z=i<=3 and -3 or 2
  combatVisual(kind,x,z,x+2,z+1,t,2.1)
  S.vfx[#S.vfx].time=9.86
 end
 effect(0,0,"frost",2.1)
 monsters[1].x=0;monsters[1].z=2;monsters[1].slow=1.2;skillRuntime:update(.01,troops)
 S.damageEvent+=1;table.insert(S.damageEvents,{id=S.damageEvent,monsterId=1,playerId=1,source=t.visualId,amount=135,critical=true,secondary=false,x=3,z=6,rank=2,time=9.86})
 publish(api)
end
function Game.update(api:any,dt:number)
 ${motion?'S.rewardClock+=dt;for i,e in ipairs(S.vfx)do e.time=10+math.floor((S.rewardClock-10)/1.5)*1.5+(i-1)*.07 end;local t=troops[1];if t then t.spin=(S.rewardClock-10)%t.skills.spinDuration end':''}
 publish(api)
end
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:900},...(motion?{recordVideo:{dir:out,size:{width:1440,height:900}}}:{})});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('**/content/project.json',async route=>{const response=await route.fetch(),payload=await response.json();payload.script=payload.script.replace('return Game',fixture+'\nreturn Game');await route.fulfill({response,json:payload})});
 await page.goto('http://127.0.0.1:8190/?build=vfx-'+mode);await page.waitForSelector('body[data-ready=true]',{timeout:45000});await page.waitForTimeout(1000);
 await page.evaluate(()=>{const note=document.createElement('div');note.textContent='特效美術驗證 · 固定事件與時間 · 非自然出獎';note.style.cssText='position:fixed;bottom:4px;left:35%;z-index:100;color:#eddbb8;background:#112427d9;padding:6px 12px;font:12px sans-serif;pointer-events:none';document.body.append(note)});
 await page.screenshot({path:path.join(out,mode+'-game.png')});
 const metrics=await page.evaluate(()=>ashen.metrics());fs.writeFileSync(path.join(out,mode+'-capture.json'),JSON.stringify({mode,scope:'Actual renderer / production pool of 40 game-owned ice shards plus fixed receipts for six procs, spin and critical',errors,metrics},null,2));
 if(motion){await page.waitForTimeout(7000);const video=page.video();await context.close();await video.saveAs(path.join(out,'skill-vfx-motion.webm'));}
 if(errors.length)throw Error(errors.join('\n'));console.log(mode+' actual-host screenshot saved');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
