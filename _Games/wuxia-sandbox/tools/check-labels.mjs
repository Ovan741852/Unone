import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tombstonePosition} from '../viewer/tombstone.js';

const source=readFileSync(new URL('../viewer/app.js',import.meta.url),'utf8');
const start=source.indexOf('function positionLabels(){');
const end=source.indexOf('\nasync function poll()',start);
assert.ok(start>=0&&end>start,'extract actual positionLabels');
assert.ok(!source.includes('dataset.hover'),'hover must not control label positioning');
const npc=[{id:'alive',alive:true,hp:0},{id:'grave',alive:false}];
const entities=Object.fromEntries(npc.map(n=>[n.id,{transform3d:{position:{x:200,z:200}}}]));
const plates=new Map(npc.map(n=>[n.id,{hidden:false,dataset:{},style:{}}]));
let depth=0;
const context={world:{observations:{view_model:{npc}},entities},plates,tombstonePosition,
  project:(x,height,z)=>({x,y:z-height,z:depth}),canvas:{clientWidth:800,clientHeight:600},
  landmarks:[],camera:{distance:42},selected:'alive'};
const positionLabels=runInNewContext(source.slice(start,end)+'\npositionLabels;',context);
positionLabels();
assert.equal(plates.get('alive').style.translate,'200px 197.6px');
assert.equal(plates.get('grave').style.translate,'200px 199.1px');
for(const plate of plates.values())assert.equal(plate.hidden,false,'overlaps stay visible');
const stationary=plates.get('alive').style.translate;
context.selected='grave';npc.reverse();entities.grave.transform3d.position={x:201,z:202};
positionLabels();
assert.equal(plates.get('alive').style.translate,stationary,'neighbors/order/selection cannot move an anchor');
for(const plate of plates.values())assert.equal(plate.hidden,false);
plates.get('alive').dataset.hover='true';
entities.alive.transform3d.position={x:250,z:230};positionLabels();
assert.equal(plates.get('alive').style.translate,'250px 227.6px','hover cannot freeze a moving resident');
for(const [x,z,d,hidden] of [[200,590,0,false],[200,3,0,false],[-1,200,0,true],
  [801,200,0,true],[200,0,0,true],[200,603,0,true],[200,200,-1.1,true],[200,200,1.1,true]]){
  entities.alive.transform3d.position={x,z};depth=d;positionLabels();
  assert.equal(plates.get('alive').hidden,hidden,`viewport/frustum ${x},${z},${d}`);
}
depth=0;delete entities.alive;positionLabels();
assert.equal(plates.get('alive').hidden,true,'missing position hides an existing label');
assert.equal(plates.get('grave').hidden,false,'other labels remain visible');
console.log('Label checks passed: fixed anchors, visible overlaps, order/selection independence, hover tracking, viewport/frustum/missing-position culling.');
