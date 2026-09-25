import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildingCatalog,buildingInfo,buildingPosition} from '../viewer/buildings.js';
import {TownCamera} from '../viewer/camera.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const layout=JSON.parse(read('assets/town-layout.json')),scene=JSON.parse(read('scenes/main.scene.json'));
// Supplied resident shape in a synthetic UI fixture; no simulation or live requests.
const npc=[{id:'npc_1',name:'沈長安',role:'鏢師',residence:'home_1',alive:false},
 {id:'npc_2',name:'蘇晚晴',role:'說書人',residence:'home_1',alive:false},
 {id:'npc_23',name:'陸青鹽',role:'鹽商',residence:'home_12',alive:true,hp:0,injury:100}];
const world={entities:Object.fromEntries(scene.entities.map(e=>[e.id,e])),observations:{view_model:{npc,
 buildings:[{id:'inn',name:'聽雨客棧',purpose:'原生用途紀錄',occupants:0}]}}};
const before=structuredClone({world,layout}),base=buildingCatalog(layout),catalog=buildingCatalog(layout,world);
assert.equal(base.length,33);assert.equal(catalog.length,37);assert.equal(catalog.filter(b=>b.kind==='home').length,20);
assert.equal(new Set(catalog.map(b=>b.id)).size,37);
const home=catalog.find(b=>b.id==='home_1'),inn=catalog.find(b=>b.id==='inn'),stall=catalog.find(b=>b.kind==='stall');
assert.deepEqual(buildingInfo(world,home).residents.map(n=>[n.id,n.status]),[['npc_1','生前住戶 · 已故'],['npc_2','生前住戶 · 已故']]);
assert.equal(buildingInfo(world,catalog.find(b=>b.id==='home_12')).residents[0].status,'登記住戶 · 在世');
assert.equal(buildingInfo(world,inn).purpose,'原生用途紀錄');assert.equal(buildingInfo(world,inn).occupants,'0 人');
assert.equal(buildingInfo(world,stall).purpose,'雲水市集附屬攤位');assert.equal(buildingInfo(world,stall).note,'未記錄獨立經營者');
for(const absent of [{},{observations:{view_model:{npc:{},buildings:{}}}}]){
 assert.deepEqual(buildingInfo(absent,home).residents,[]);
 assert.equal(buildingInfo(absent,inn).purpose,'未記錄');assert.equal(buildingInfo(absent,inn).occupants,'未記錄');
}
assert.equal(buildingCatalog(layout,{entities:{tree:{mesh3d:{asset:'mesh://house-1'}},market_extra_99_99:{mesh3d:{asset:'mesh://stall-red'}}}}).length,33);
assert.deepEqual(buildingPosition(world,home),world.entities.home_1.transform3d.position);
assert.deepEqual(buildingPosition({},home),{x:home.x,y:0,z:home.z});assert.equal(buildingPosition({},stall),null);
assert.deepEqual({world,layout},before,'catalog/details must not mutate snapshots');

// Execute production label creation, click handlers, panel transitions and projection.
const source=read('viewer/app.js'),html=read('viewer/index.html');
const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const nodes=new Map();
function node(tag='div'){
 return {tag,hidden:false,children:[],dataset:{},style:{},attributes:{},textContent:'',
  setAttribute(k,v){this.attributes[k]=v;},append(...items){for(const item of items){item.parent=this;this.children.push(item);}},
  replaceChildren(...items){this.children=[];this.append(...items);},remove(){this.parent.children=this.parent.children.filter(n=>n!==this);},
  focus(){this.focused=true;},click(){this.onclick?.({detail:0});}};
}
const $=id=>{assert.ok(html.includes('id="'+id+'"'),'HTML selector '+id);if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
let depth=0;
const actions=[],context={world,townLayout:layout,selectedBuilding:null,lastBuildingKey:'',selected:null,detailOpen:false,innerWidth:1200,
 landmarks:[],plates:new Map(),buildingCatalog,buildingInfo,buildingPosition,$,document:{createElement:node},camera:new TownCamera(),
 action:id=>actions.push(id),showEconomy:()=>{},updateCameraUi:()=>{},
 project:(x,y,z)=>({x:x+400,y:300+z-y,z:depth}),canvas:{clientWidth:800,clientHeight:600}};
context.updateUi=()=>context.updateBuildingUi();
Object.assign(context,runInNewContext(section('function select(id)','\nconst money=')+'\n({select,selectBuilding,closeBuilding,focusBuilding,updateBuildingUi});',context));
context.updateBuildingUi();assert.equal(context.landmarks.length,37);
assert.ok(context.landmarks.every(l=>l.element.tag==='button'&&l.element.attributes['aria-controls']==='building-details'));
const label=id=>context.landmarks.find(l=>l.building.id===id).element;
context.camera.followId='npc_23';label('home_1').click();
assert.equal(context.camera.followId,null);assert.equal(context.detailOpen,false);assert.equal($('details').hidden,true);assert.equal($('building-details').hidden,false);
assert.equal($('building-title').textContent,'民居 1');assert.equal($('building-residents').children.length,2);assert.equal(actions.length,0);
const sue=$('building-residents').children[1];assert.equal(sue.children[0].textContent,'蘇晚晴');assert.match(sue.children[1].textContent,/已故/);
context.updateBuildingUi();assert.equal($('building-residents').children[1],sue,'unchanged snapshots retain keyboard focus/DOM');
sue.click();assert.equal(context.selected,'npc_2');assert.equal(context.detailOpen,true);assert.equal($('building-details').hidden,true);assert.equal($('details').hidden,false);
assert.equal(actions.at(-1),'inspect_npc_2');
label('home_12').click();$('building-residents').children[0].click();assert.equal(context.selected,'npc_23');assert.equal(context.detailOpen,true);
label('inn').click();assert.equal($('building-purpose').textContent,'原生用途紀錄');assert.equal($('building-occupants').textContent,'0 人');assert.equal($('building-household').hidden,true);
label(stall.id).click();assert.equal($('building-occupancy').hidden,true);assert.equal($('building-note').textContent,'未記錄獨立經營者');
label('home_2').click();assert.equal($('building-empty').hidden,false);assert.match(html,/id="building-empty">住戶未記錄/);
context.closeBuilding();assert.equal($('building-details').hidden,true);assert.equal(label('home_2').focused,true);

const positionLabels=runInNewContext(section('function positionLabels(){','\nasync function poll()')+'\npositionLabels;',context);
for(const distance of [99,42,14]){context.camera.distance=distance;positionLabels();assert.ok(context.landmarks.every(l=>!l.element.hidden),'all in-view labels survive close zoom');}
world.entities.home_1.transform3d.position={x:12,y:3,z:25};positionLabels();assert.equal(label('home_1').style.left,'412px');assert.equal(label('home_1').style.top,'318px');
const stationary=[label('home_1').style.left,label('home_1').style.top];context.landmarks.reverse();context.selectedBuilding='inn';positionLabels();
assert.deepEqual([label('home_1').style.left,label('home_1').style.top],stationary);
for(const [x,z,d] of [[-401,0,0],[401,0,0],[0,-301,0],[0,310,0],[0,0,-1.1],[0,0,1.1]]){
 world.entities.home_1.transform3d.position={x,y:0,z};depth=d;positionLabels();assert.equal(label('home_1').hidden,true);
}
depth=0;world.entities[stall.id].transform3d.position={x:NaN,z:0};positionLabels();assert.equal(label(stall.id).hidden,true);
for(const b of catalog.filter(b=>b.kind==='stall'))delete world.entities[b.id];
context.updateBuildingUi();assert.equal(context.landmarks.length,33,'removed native stalls leave no phantom labels');
assert.ok(!html.includes('id="landmarks" aria-hidden="true"'));
console.log('Building checks passed: authored 33 + 4 native stalls, authoritative residents/facilities, truthful missing data, no mutation, production buttons/panel/person transitions, native anchors, close zoom/frustum and removal. Offline UI fixture only.');
