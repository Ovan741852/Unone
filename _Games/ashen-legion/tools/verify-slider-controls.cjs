const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const uiPoint=require('./ui-test-pointer.cjs');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.GAME_TEST_URL||'http://127.0.0.1:8193/')+'?seed=42');
  await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  const findAction=action=>page.evaluate(action=>{
   const walk=nodes=>{for(const node of nodes||[]){if(node.kind==='button'&&node.action===action)return node;if(node.children){const hit=walk(node.children);if(hit)return hit;}}};
   return walk(window.ashen.uiTree().children);
  },action);
  const flatten=()=>page.evaluate(()=>{
   const nodes=[];
   const walk=children=>{for(const node of children||[]){nodes.push(node);if(node.children)walk(node.children);}};
   walk(window.ashen.uiTree().children);return nodes;
  });
  const settings=await findAction('UI_settings');assert.ok(settings,'Missing settings action');
  const point=await uiPoint(page,settings.rect);await page.mouse.click(point.x,point.y);await page.waitForTimeout(200);
  let nodes=await flatten();
  const get=id=>nodes.find(node=>node.id===id);
  for(const id of ['settings_music_track','settings_music_fill','settings_music_handler','settings_music_track_widget','settings_music_value'])assert.ok(get(id),'Missing '+id);
  assert.equal(get('settings_music_track_widget').kind,'slider');
  const before=get('settings_music_handler').rect.x,rail=get('settings_music_track_widget').rect;
  const start=await uiPoint(page,rail,.15,.5),finish=await uiPoint(page,rail,.85,.5);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(finish.x,finish.y,{steps:6});await page.mouse.up();await page.waitForTimeout(160);
  nodes=await flatten();
  assert.ok(get('settings_music_handler').rect.x>before,'handler did not move with drag');
  assert.match(get('settings_music_value').text,/%$/);
  const fillBefore=get('settings_music_fill').rect.width;
  assert.equal(get('settings_music_fill').kind,'image');
  for(const [u,value]of [[.01,'0%'],[.99,'100%']]){
   const end=await uiPoint(page,rail,u,.5);await page.mouse.click(end.x,end.y);await page.waitForTimeout(160);
   nodes=await flatten();assert.equal(get('settings_music_value').text,value);
   assert.ok(get('settings_music_fill').rect.width>0);
   if(value==='0%')assert.ok(get('settings_music_fill').rect.width<.01);
   else assert.ok(get('settings_music_fill').rect.width>fillBefore);
  }

  assert.deepEqual(errors,[]);
  console.log('PASS slider component exposes track/fill/handler/slider nodes and drag updates the handler.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
