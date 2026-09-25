import assert from 'node:assert/strict';
import {createRouteManager} from '../viewer/routes.js';

const geometry=()=>({attributes:{position:{setXYZ(i,x,y,z){this.points[i]={x,y,z};},needsUpdate:false,points:[]}},dispose(){this.disposed=true;}});
class Material{constructor(options){Object.assign(this,options);}dispose(){this.disposed=true;}}
class Vector3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
class BufferGeometry{setFromPoints(points){this.attributes={position:{points, setXYZ(i,x,y,z){this.points[i]={x,y,z};},needsUpdate:false}};return this;}dispose(){this.disposed=true;}}
class Line{constructor(g,m){this.geometry=g;this.material=m;this.userData={};}computeLineDistances(){this.distancePasses=(this.distancePasses||0)+1;this.geometry.attributes.lineDistance=this.geometry.attributes.lineDistance||{values:[],setX(i,value){this.values[i]=value;},needsUpdate:false};}}
const THREE={LineDashedMaterial:Material,BufferGeometry,Vector3,Line};
const scene={children:[],add(line){this.children.push(line);},remove(line){this.children=this.children.filter(item=>item!==line);}};
const manager=createRouteManager(THREE,scene);
const npcs=Array.from({length:40},(_,i)=>({id:'npc_'+(i+1),alive:true,route:[{x:i,z:0},{x:i+1,z:0}],route_index:1}));
const entities=Object.fromEntries(npcs.map((npc,i)=>[npc.id,{transform3d:{position:{x:i,y:.04,z:i}}}]));
manager.sync(npcs,entities,null);
assert.equal(manager.diagnostics().count,40);
assert.deepEqual(new Set(manager.diagnostics().ids),new Set(npcs.map(n=>n.id)));
const first=scene.children.find(line=>line.userData.routeKey),geometryBefore=first.geometry,materialBefore=first.material,selectedRoute=scene.children.find(line=>line.userData.routeKey===JSON.stringify(npcs[1].route));
const changed=scene.children.find(line=>line!==first&&line.userData.routeKey===JSON.stringify(npcs[1].route)),changedGeometry=changed.geometry;
manager.sync(npcs,entities,'npc_2');
assert.equal(scene.children[0],first,'selection must not rebuild other routes');
assert.equal(first.geometry,geometryBefore,'unchanged route reuses geometry');
assert.equal(first.material,materialBefore,'unselected routes keep the regular shared material');
assert.notEqual(selectedRoute.material,materialBefore,'selection only changes shared material choice');
assert.equal(first.frustumCulled,false);
const distanceAttribute=first.geometry.attributes.lineDistance;
entities.npc_1.transform3d.position.x=99;manager.sync(npcs,entities,'npc_2');
assert.equal(first.geometry,geometryBefore,'moving start must not rebuild geometry');
assert.equal(first.geometry.attributes.position.points[0].x,99);
assert.equal(first.geometry.attributes.lineDistance,distanceAttribute,'moving start reuses line-distance attribute');
npcs[1].route_index=2;manager.sync(npcs,entities,'npc_2');assert.equal(changedGeometry.disposed,true,'route-index changes dispose stale geometry');
const deadLine=scene.children.find(line=>line.userData.routeKey===JSON.stringify(npcs[2].route)),deadGeometry=deadLine.geometry;
npcs[2].alive=false;npcs[3].route=null;delete entities.npc_6;manager.sync(npcs,entities,'npc_2');assert.equal(manager.diagnostics().count,37);assert.equal(deadGeometry.disposed,true);
npcs[4].route_index=3;const stale=scene.children.find(line=>line.userData.routeKey.includes('"x":4'));manager.sync(npcs,entities,'npc_2');assert.equal(manager.diagnostics().count,36,'arrived residents have no fake route');assert.equal(stale?.geometry.disposed,true);
const paused=structuredClone(entities);paused.npc_6={transform3d:{position:{x:6,y:.04,z:6}}};npcs.forEach((npc,i)=>{npc.alive=true;npc.route=[{x:i,z:1}];npc.route_index=1;});manager.sync(npcs,paused,'npc_2');assert.equal(manager.diagnostics().count,40,'paused snapshots still show authoritative routes');
manager.dispose();assert.equal(scene.children.length,0);console.log('Route checks passed: all-resident coverage, selection independence, geometry reuse, movement, route-index/dead/missing/arrival cleanup, paused positions.');
