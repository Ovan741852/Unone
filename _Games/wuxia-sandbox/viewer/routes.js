// Presentation-only route lines. Native route cells and route_index remain authoritative.
const remainingCells=npc=>{
 const route=Array.isArray(npc?.route)?npc.route:[],index=Number(npc?.route_index||1);
 return npc?.alive!==false&&Number.isInteger(index)&&index>=1&&index<=route.length?route.slice(index-1):[];
};

export function createRouteManager(THREE,scene){
 const lines=new Map();
 const materials={regular:new THREE.LineDashedMaterial({color:0xd8bd63,dashSize:.45,gapSize:.25,depthTest:false,transparent:true,opacity:.62}),selected:new THREE.LineDashedMaterial({color:0xf6d775,dashSize:.45,gapSize:.25,depthTest:false,transparent:true,opacity:.9})};
 const remove=id=>{const line=lines.get(id);if(!line)return;scene.remove(line);line.geometry.dispose();lines.delete(id);};
 const write=(line,start,cells)=>{
  const position=line.geometry.attributes.position;position.setXYZ(0,start.x,.14,start.z);
  const distances=line.geometry.attributes.lineDistance;let total=0,previous={x:start.x,y:.14,z:start.z};
  cells.forEach((cell,index)=>{const point={x:cell.x*2,y:.14,z:cell.z*2};position.setXYZ(index+1,point.x,point.y,point.z);total+=Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z);distances?.setX(index+1,total);previous=point;});
  position.needsUpdate=true;
  if(distances)distances.needsUpdate=true;
 };
 const sync=(npcs=[],entities={},selectedId)=>{
  const liveIds=new Set();
  for(const npc of npcs){
   const cells=remainingCells(npc),position=entities?.[npc.id]?.transform3d?.position;
   if(!cells.length||!position){remove(npc.id);continue;}
   liveIds.add(npc.id);
   const key=JSON.stringify(cells),existing=lines.get(npc.id);
   let line=existing;
   if(!line||line.userData.routeKey!==key){
    if(line){scene.remove(line);line.geometry.dispose();}
    const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),...cells.map(()=>new THREE.Vector3())]);
    line=new THREE.Line(geometry,materials.regular);line.computeLineDistances();line.userData.routeKey=key;line.renderOrder=10;line.frustumCulled=false;scene.add(line);lines.set(npc.id,line);
   }
   line.material=npc.id===selectedId?materials.selected:materials.regular;
   write(line,position,cells);
  }
  for(const id of lines.keys())if(!liveIds.has(id))remove(id);
 };
 const diagnostics=()=>({count:lines.size,ids:[...lines.keys()].sort()});
 const dispose=()=>{for(const id of [...lines.keys()])remove(id);Object.values(materials).forEach(material=>material.dispose());};
 return{sync,diagnostics,dispose};
}
