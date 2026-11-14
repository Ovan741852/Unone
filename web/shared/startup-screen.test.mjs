import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStartupScreen,STARTUP_STEPS} from './startup-screen.mjs';

// The parts of index.html's startup screen the module writes to.
function page(){
 const element=()=>({style:{},attributes:{},textContent:'',hidden:false,setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}});
 const parts={bar:element(),fill:element(),label:element(),error:element()};parts.error.hidden=true;
 const root={...element(),dataset:{state:'booting'},querySelector:selector=>parts[selector.replace('.unone-startup-','')]??null};
 return {root,parts,body:{dataset:{}}};
}
const fill=parts=>Number(/scaleX\((.*)\)/.exec(parts.fill.style.transform)[1]);

test('the screen the page draws before scripts names every part this module drives',()=>{
 const html=fs.readFileSync(new URL('../player/index.html',import.meta.url),'utf8');
 for(const part of ['id="unone-startup" data-state="booting"','class="unone-startup-bar" role="progressbar"','class="unone-startup-fill"','class="unone-startup-label"','class="unone-startup-error" role="alert" hidden',
  '<!--UNONE_STARTUP_LOGO-->','<!--/UNONE_STARTUP_LOGO-->','/*UNONE_STARTUP_THEME*/'])assert(html.includes(part),part);
 assert(!html.includes('id="status"'),'the plain Loading text is gone');
});

test('progress follows real steps, never moves backwards and names the current step',()=>{
 let time=100;const {root,parts,body}=page(),screen=createStartupScreen({root,body,boot:0,now:()=>time,schedule(){}});
 assert.equal(root.dataset.state,'loading','the player module ran: the indeterminate boot phase is over');
 const player=STARTUP_STEPS.find(step=>step.id==='player').weight/STARTUP_STEPS.reduce((sum,step)=>sum+step.weight,0);
 assert.equal(fill(parts),player);assert.equal(parts.label.textContent,'Loading game content…');
 screen.start('content');time=150;screen.complete('content');
 screen.start('images');screen.start('data');assert.equal(parts.label.textContent,'Preparing images…','concurrent steps are named in table order');
 screen.progress('images',2.5,10);assert.equal(parts.label.textContent,'Preparing images 2/10');const partway=fill(parts);
 screen.progress('images',1,10);assert.equal(fill(parts),partway,'a late lower count never moves the bar back');
 screen.progress('images',10,10);screen.complete('images');
 screen.progress('data',1,4);screen.start('fonts');screen.complete('fonts');screen.start('runtime');
 assert.equal(parts.label.textContent,'Starting runtime…');screen.complete('runtime');
 assert.equal(parts.label.textContent,'Loading data 1/4','a step still loading after the ones before it is named next');
 assert.equal(parts.bar.attributes['aria-valuenow'],String(Math.round(fill(parts)*100)));
 const report=JSON.parse(body.dataset.playerStartup);assert.equal(report.state,'loading');assert.equal(report.step,'data');
 assert.deepEqual(report.steps.find(step=>step.id==='data'),{id:'data',state:'active',done:1,total:4,started_ms:150});
 assert.deepEqual(report.steps.find(step=>step.id==='content'),{id:'content',state:'done',started_ms:100,ms:150},'each step says when it began and when it completed');
 assert.deepEqual(report.steps.find(step=>step.id==='player'),{id:'player',state:'done',ms:100},'the module graph has no start mark of its own: it ran from boot');
 assert.throws(()=>screen.start('typo'),/PLAYER_STARTUP_STEP_UNKNOWN/);
});

test('the first presented frame completes the bar, fades the screen and then hides it',()=>{
 const {root,parts,body}=page(),later=[];const screen=createStartupScreen({root,body,schedule:(work,ms)=>later.push({work,ms})});
 screen.start('present');screen.ready();
 assert.equal(fill(parts),1);assert.equal(root.dataset.state,'ready');assert.equal(root.attributes['aria-hidden'],'true');assert.equal(root.hidden,false,'the fade runs first');
 assert.equal(later.length,1);later[0].work();assert.equal(root.hidden,true);
 screen.progress('data',1,2);screen.complete('audio');assert.equal(JSON.parse(body.dataset.playerStartup).state,'ready','late startup work cannot reopen the screen');
});

test('a startup failure keeps the screen, names the failed step and shows the whole error',()=>{
 const {root,parts,body}=page(),screen=createStartupScreen({root,body,schedule(){}});
 screen.complete('content');screen.start('images');screen.complete('images');screen.start('fonts');
 screen.fail(Error('UI_FONT_LOAD_FAILED: Observatory Reading 400\nsecond line'));
 assert.equal(root.dataset.state,'failed');assert.equal(parts.label.textContent,'Startup failed while loading fonts');
 assert.equal(parts.error.hidden,false);assert.equal(parts.error.textContent,'UI_FONT_LOAD_FAILED: Observatory Reading 400\nsecond line');
 const report=JSON.parse(body.dataset.playerStartup);assert.equal(report.state,'failed');assert.equal(report.failed_step,'fonts');
 screen.complete('fonts');screen.ready();assert.equal(root.dataset.state,'failed','nothing after a failure hides it');
});

test('a failure after the first frame shows the screen again over the stopped game',()=>{
 const {root,parts,body}=page(),later=[];const screen=createStartupScreen({root,body,schedule:work=>later.push(work)});
 screen.ready();screen.fail('TICK_FAILED: boom');later.forEach(work=>work());
 assert.equal(root.hidden,false,'the pending hide does not run after the failure');assert.equal(root.attributes['aria-hidden'],undefined);
 assert.equal(parts.label.textContent,'The game stopped');assert.equal(parts.error.textContent,'TICK_FAILED: boom');
 assert.equal(JSON.parse(body.dataset.playerStartup).failed_step,null);
});

test('without the markup (a project-owned page) the screen still reports and never throws',()=>{
 const body={dataset:{}},screen=createStartupScreen({body,schedule(){}});
 screen.start('content');screen.progress('content',1,0);screen.fail('x');assert.equal(JSON.parse(body.dataset.playerStartup).failed_step,'content');
 assert.doesNotThrow(()=>createStartupScreen().ready());
});
