// Mechanical container-level geometry audit for the authored formal UI.
// The generic Unone UI preflight checks the 0–100 screen AABB. This pass also
// checks authored child regions (loadout board and equipment drawer), which
// are intentionally represented as a flat UI tree at runtime.
import assert from 'node:assert/strict';
import {module,payload,loadProject,readObservation} from './runtime-harness.mjs';
// The fitter measures real Canvas text for centered labels. Geometry checks do
// not depend on font metrics, so a deterministic 1em advance is sufficient.
globalThis.document={createElement:()=>({getContext:()=>({set font(_){},measureText:value=>({width:String(value).length*16})})})};
const {fitFormalUI}=await import('../presentation/adaptive-ui.mjs');

const gear='for i=1,8 do addItem(gearCatalog[i],12) end;S.worn[1][5]=1;S.phase="loadout";S.loadoutReturn="shop";formalRoute="gear";S.equipSlot=5;';
const cases={gear,choice:'S.phase="choice";S.offer={locationEntries[1],locationEntries[2],locationEntries[3]}'};
const fitCase=code=>{
 const script=payload.script.replace('return Game',`local start=Game.start\nfunction Game.start(api:any)start(api)\n${code}\npublish(api)end\nreturn Game`);
 loadProject(module,{...payload,script},42n);
 return fitFormalUI(JSON.parse(JSON.stringify(readObservation(module)))).world.ui;
};
const tree=fitCase(cases.gear);
const nodes=tree.children;
const byId=new Map(nodes.map(n=>[n.id,n]));
const contains=(outer,inner,tolerance=.02)=>outer.x<=inner.x+tolerance&&outer.y<=inner.y+tolerance&&outer.x+outer.width>=inner.x+inner.width-tolerance&&outer.y+outer.height>=inner.y+inner.height-tolerance;
const failures=[];

for(const n of nodes){
 if(!contains({x:0,y:0,width:100,height:100},n.rect)) failures.push({scope:'screen',id:n.id,rect:n.rect,bound:{x:0,y:0,width:100,height:100}});
}

// Content regions intentionally leave room for the decorative nine-slice frame.
const fromTop=(x,y,width,height)=>({x,y:100-y-height,width,height});
const drawerGrid=fromTop(58.5,21.5,30,54);
const gridIds=/^(pack_tile_|gear_icon_|gear_name_|gear_summary_|gear_cost_|inspect_|equip_)/;
for(const n of nodes.filter(n=>gridIds.test(n.id))){
 if(!contains(drawerGrid,n.rect)) failures.push({scope:'drawer-grid',id:n.id,rect:n.rect,bound:drawerGrid});
}

const board=fromTop(14,31,38,46);
const boardIds=/^(slot_frame_|slot_part_|worn_icon_|slot_|troop_quote|loadout_board_title)$/;
for(const n of nodes.filter(n=>boardIds.test(n.id))){
 if(!contains(board,n.rect)) failures.push({scope:'loadout-board',id:n.id,rect:n.rect,bound:board});
}

const report={screen:tree.node,checked:nodes.length,failures,containers:{loadoutBoard:board,drawerContent:drawerGrid}};
const choice=fitCase(cases.choice);
const choiceNodes=choice.children;
const choiceParts=i=>choiceNodes.filter(n=>n.id.startsWith(`choice_plate_${i}_`));
const union=rs=>{const x=Math.min(...rs.map(r=>r.rect.x)),y=Math.min(...rs.map(r=>r.rect.y));return{x,y,width:Math.max(...rs.map(r=>r.rect.x+r.rect.width))-x,height:Math.max(...rs.map(r=>r.rect.y+r.rect.height))-y};};
for(let i=1;i<=3;i++){
 const frame=union(choiceParts(i));
 const safe={x:frame.x+2,y:frame.y+6,width:frame.width-4,height:frame.height-11};
 for(const n of choiceNodes.filter(n=>new RegExp(`^(choice_(icon|name|desc|action)_${i}|choice_${i}$)`).test(n.id)))
  if(n.id!==`choice_${i}`&&!contains(safe,n.rect)) failures.push({scope:'choice-content-safe-area',id:n.id,rect:n.rect,bound:safe});
  else if(n.id===`choice_${i}`&&!contains(frame,n.rect)) failures.push({scope:'choice-card',id:n.id,rect:n.rect,bound:frame});
}
report.choice={checked:choiceNodes.length,frames:[1,2,3].map(i=>{const rect=union(choiceParts(i));return{i,rect,contentSafe:{x:rect.x+2,y:rect.y+6,width:rect.width-4,height:rect.height-11}}})};
console.log(JSON.stringify(report,null,2));
assert.equal(failures.length,0,`container overflow: ${failures.map(f=>`${f.scope}/${f.id}`).join(', ')}`);
