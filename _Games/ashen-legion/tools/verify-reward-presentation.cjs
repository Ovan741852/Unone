// Isolated presentation contract fixtures; never add prizes to the actual game.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto('http://127.0.0.1:8190/?build=storybook-reward-fixture');await page.waitForSelector('body[data-ready="true"]',{timeout:45000});
 const result=await page.evaluate(async()=>{
  const {createRewardPresentation}=await import('./presentation/rewards.mjs');const container=document.createElement('div');container.id='reward-fixture';container.style.cssText='position:fixed;inset:0;background:#112c34;z-index:100';document.body.append(container);
  const fx=await createRewardPresentation({container}),s={phase:'battle',seat:1,paused:false,audioMuted:true,fired:0,event:0,rewardClock:0,rewards:[],hordeNotice:0},samples=[];
  const event=(id,tier,title)=>{s.event=id;s.rewards=[{id,tier,title,playerId:1,amount:100,multiplier:2,time:s.rewardClock}];fx.update(s,.1);samples.push(fx.inspect());};
  event(1,1,'');event(2,3,'BIG WIN');event(3,1,'');event(4,4,'LEGENDARY WIN');event(5,3,'BIG WIN');
  for(let i=0;i<70;i++)fx.update(s,.1);
  event(6,3,'MEGA WIN');window.rewardFixture={fx,s};return samples;
 });
 assert.equal(result[0].celebrationVisible,false,'ordinary prize stays local');assert.equal(result[1].activeAsset,'big-win');assert.equal(result[2].activeAsset,'big-win','ordinary award cannot interrupt BIG WIN');assert.equal(result[3].activeAsset,'legendary-win');assert.equal(result[4].activeAsset,'legendary-win','BIG WIN cannot downgrade LEGENDARY WIN');assert.equal(result[5].activeAsset,'mega-win');
 await page.evaluate(()=>{for(let i=0;i<10;i++)window.rewardFixture.fx.update(window.rewardFixture.s,.1)});
 await page.screenshot({path:path.resolve(__dirname,'../storybook-mega-fixture.png')});
 await page.evaluate(()=>{window.rewardFixture.fx.dispose();document.querySelector('#reward-fixture').remove()});
 fs.writeFileSync(path.resolve(__dirname,'../tests/storybook-rewards.json'),JSON.stringify({ok:true,scope:'Synthetic presentation events only; not lottery/balance evidence',samples:result},null,2));console.log('PASS ordinary/local, BIG, MEGA, LEGENDARY and priority protection');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
