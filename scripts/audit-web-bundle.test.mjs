import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {audit, main} from './audit-web-bundle.mjs';
import {dataRecord, writePublication} from './web-export-files.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unone-audit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'player'), files=new Map();
  const put=(name,bytes)=>files.set(name,dataRecord(name,Buffer.from(bytes)));
  const json=(name,value)=>put('content/'+name,JSON.stringify(value));
  const png=Buffer.from('89504e470d0a1a0a0000000d494844520000000200000002','hex');
  put('content/one.png',png);put('content/two.png',png);put('content/icon.svg','<svg/>');
  put('content/entry.luaubc','entry');put('content/data.bin','ab');put('content/lazy.bin','lazy');put('content/face.ttf','font');
  put('content/effect.efk','effect');put('content/side.bin','sidecar');
  put('content/names.ttf','names');
  json('presentation.json',{ui:{font_source:'face.ttf',fonts:[{source:'face.ttf',on_demand:true},{source:'names.ttf',on_demand:true}]}});
  const assets=[['a','one.png'],['b','two.png'],['c','one.png'],['svg','icon.svg']].map(([id,source])=>({id,kind:'texture2d',source,bundle:'art'}));
  assets.push({id:'fx',kind:'effekseer',source:'effect.efk',files:['side.bin'],bundle:'effects'});
  json('assets.json',{assets});
  json('image-assets.json',{version:1,groups:{start:['a'],more:['a','b'],aliases:['a','c'],icon:['svg']},startup:['start'],
    budget:{max_bytes:32,max_entries:3},dimensions:{a:{format:'png',width:2,height:2}}});
  json('project.json',{script_bytecode:{source:'entry.luaubc'},data_assets:[
    {id:'one',source:'data.bin'},{id:'two',source:'data.bin'},{id:'late',source:'lazy.bin',on_demand:true}],
    scene:{entities:[{sprite:{asset:'a',visible:false}}],particle_effects:{sparks:{emitters:[{texture:'b'}]}}}});
  writePublication(root,'<head></head>',files,{project:'fixture',variant:'production',renderer_mode:'official'});
  return {root,dir};
}

test('sealed bytes, distinct URLs, shared IDs, eager inputs and preparation estimates stay separate',t=>{
  const {root}=fixture(t), report=audit(root,{hold:['more']});
  assert.equal(report.metrics.logical_bytes,report.inventory.generation_bytes);
  assert.equal(report.inventory.indexed_bytes,report.metrics.logical_bytes*2+report.inventory.index_bytes);
  assert.deepEqual(report.payload.staged.map(s=>s.id),['one','two','unone:script-bytecode']);
  assert.equal(report.metrics.eager_data_bytes,7);
  assert.equal(report.payload.on_demand[0].id,'late');
  assert.deepEqual(report.payload.ui_font_sources,[{source:'face.ttf',bytes:4,on_demand:false},{source:'names.ttf',bytes:5,on_demand:true}]);
  assert.equal(report.metrics.eager_font_bytes,4);
  assert.equal(report.logical_breakdown.reduce((n,r)=>n+r.bytes,0),report.metrics.logical_bytes);
  assert.deepEqual(report.asset_catalog.bundles.find(b=>b.name==='effects'),{name:'effects',entries:1,unique_sources:2,source_bytes:13});
  assert.deepEqual(report.asset_catalog.shared_source_ids,[{source:'content/one.png',ids:['a','c']}]);
  assert.equal(report.metrics.duplicate_bytes,24);
  assert.equal(report.metrics.image_rgba_bytes,32);
  assert.equal(report.images.groups.find(g=>g.name==='aliases').unique_urls,1);
  assert.equal(report.images.groups.find(g=>g.name==='aliases').entries,2);
  assert.deepEqual(report.images.groups.find(g=>g.name==='icon').unknown_rgba_ids,['svg']);
  assert.equal(report.images.scene_plus_startup.known_rgba_bytes,32);
  assert(report.findings.some(f=>f.code==='IMAGE_GROUP_LIMIT_NEAR'&&f.subject==='selected groups'));
  assert(report.findings.some(f=>f.code==='IMAGE_HEADER_INSPECTION'));
  assert.throws(()=>audit(root,{hold:['typo']}),/Unknown --hold/);
});

test('file identity distinguishes an actual hard link and unindexed or tampered input is rejected',t=>{
  const {root}=fixture(t), m=JSON.parse(fs.readFileSync(path.join(root,'export.json')));
  const source=path.join(root,'content/data.bin'), link=path.join(root,m.release_root,'content/data.bin');
  fs.unlinkSync(link);fs.linkSync(source,link);
  const report=audit(root);
  assert(report.inventory.hardlinked_alias_pairs>=1);
  fs.writeFileSync(source,'tampered');
  assert.throws(()=>audit(root),/WEB_REFRESH_BASE_HASH/);
});

test('command writes fresh machine-readable reports, compares metrics and fails user-selected gates',t=>{
  const {root,dir}=fixture(t), baseline=path.join(dir,'base.json'), output=path.join(dir,'next.json');
  assert.equal(main(['--export',root,'--out',baseline]),0);
  assert.throws(()=>main(['--export',root,'--out',baseline]),/fresh/);
  assert.throws(()=>main(['--export',root,'--out',path.join(root,'bad.json')]),/fresh/);
  assert.equal(main(['--export',root,'--hold','more','--out',output,'--baseline',baseline,
    '--max-eager-data-bytes','6','--fail-on','DUPLICATE_CONTENT_URLS']),1);
  const report=JSON.parse(fs.readFileSync(output));
  assert.equal(report.comparison.delta.image_rgba_bytes,16);
  assert.equal(report.comparison.delta.logical_bytes,0);
  assert.equal(report.gates.failures.length,2);
  const unknown=path.join(dir,'unknown.json');
  assert.equal(main(['--export',root,'--out',unknown,'--hold','icon','--max-image-rgba-bytes','5000']),1);
  assert.throws(()=>main(['--export',root,'--fail-on','not-a-code']),/Unknown --fail-on/);
});
