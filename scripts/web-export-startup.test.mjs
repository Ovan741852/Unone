// The refresh tool writes the startup screen like `game export web` does
// (crates/unone-cli/src/export.rs apply_startup_screen and its test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startupFor} from './web-export-content.mjs';
import {applyStartupScreen,startupForeground} from './web-export-host.mjs';

const template=fs.readFileSync(new URL('../web/player/index.html',import.meta.url),'utf8');

test('refreshed pages carry the same logo and theme as game export web',()=>{
 const page=applyStartupScreen(template,{logo:'brand/logo.png',background:'#F5F0E6'},'Tea & "Cakes"');
 assert(page.includes('<img class="unone-startup-logo" src="content/brand/logo.png" alt="Tea &amp; &quot;Cakes&quot;">'));
 assert(!page.includes('UNONE_STARTUP_LOGO')&&!page.includes('aria-label="Unone"'));
 assert(page.includes('#unone-startup{--startup-bg:#f5f0e6;--startup-fg:#111827;--startup-accent:#0369a1;--startup-error:#b91c1c}'));
 assert(applyStartupScreen(template,{background:'#0A0A20'},'x').includes('#unone-startup{--startup-bg:#0a0a20;--startup-fg:#f3f4f6}'));
 assert.equal(applyStartupScreen(template,null,'x'),template);
 assert.equal(startupForeground('#0a0a20'),'#f3f4f6');assert.equal(startupForeground('#ffffff'),'#111827');
});

test('refresh copies a checked logo and rejects what game export web rejects',()=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'unone-startup-'));
 try{
  fs.mkdirSync(path.join(project,'brand'));const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('logo')]);
  fs.writeFileSync(path.join(project,'brand/logo.png'),png);fs.writeFileSync(path.join(project,'brand/fake.png'),'GIF89a');
  fs.writeFileSync(path.join(project,'brand/mark.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');fs.writeFileSync(path.join(project,'brand/empty.svg'),'');
  fs.writeFileSync(path.join(project,'brand/huge.svg'),'<svg>'+' '.repeat(1024*1024));
  const files=new Map();assert.deepEqual(startupFor(project,files,{logo:'brand/logo.png',background:'#000000'}),{logo:'brand/logo.png',background:'#000000'});
  assert.equal(files.get('content/brand/logo.png').bytes,png.length);
  assert.deepEqual(startupFor(project,new Map(),{logo:'brand/mark.svg'}),{logo:'brand/mark.svg'});
  for(const [startup,code] of [[{logo:'../logo.png'},'STARTUP_LOGO_PATH_INVALID'],[{logo:'brand/logo.gif'},'STARTUP_LOGO_FORMAT_UNSUPPORTED'],[{logo:'brand/fake.png'},'STARTUP_LOGO_FORMAT_UNSUPPORTED'],
   [{logo:'brand/empty.svg'},'STARTUP_LOGO_SIZE_INVALID'],[{logo:'brand/huge.svg'},'STARTUP_LOGO_SIZE_INVALID'],[{logo:'brand/absent.png'},'STARTUP_LOGO_MISSING'],
   [{background:'teal'},'STARTUP_BACKGROUND_INVALID'],[{background:'#12345'},'STARTUP_BACKGROUND_INVALID'],[{title:'x'},'WEB_REFRESH_STARTUP_INVALID']])
   assert.throws(()=>startupFor(project,new Map(),startup),new RegExp(code),JSON.stringify(startup));
 }finally{fs.rmSync(project,{recursive:true,force:true});}
});
