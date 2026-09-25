// Presentation catalog only; residents and facility activity come from the snapshot.
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'&&value.trim()?value:'未記錄';
// Stable numbering follows the authored stall order in tools/build-town.mjs.
const stalls=['market_extra_-4_-6','market_extra_4_-6','market_extra_-4_6','market_extra_4_6'];
export function buildingCatalog(layout={},world={}){
 return [...list(layout.buildings).map(b=>({...b,kind:'facility'})),...list(layout.homes).map(b=>({...b,kind:'home'})),
  ...stalls.flatMap((id,i)=>/^mesh:\/\/stall-(green|red)$/.test(world.entities?.[id]?.mesh3d?.asset)?[{id,name:'市集攤位 '+(i+1),kind:'stall'}]:[])];
}
export function buildingPosition(world,building){
 const p=world?.entities?.[building.id]?.transform3d?.position;
 if(Number.isFinite(p?.x)&&Number.isFinite(p?.z))return{x:p.x,y:Number.isFinite(p.y)?p.y:0,z:p.z};
 return Number.isFinite(building.x)&&Number.isFinite(building.z)?{x:building.x,y:0,z:building.z}:null;
}
export function buildingInfo(world,building){
 const vm=world?.observations?.view_model,native=list(vm?.buildings).find(b=>b.id===building.id),home=building.kind==='home',stall=building.kind==='stall';
 return {id:building.id,kind:building.kind,name:text(native?.name||building.name),
  purpose:home?'民居':stall?'雲水市集附屬攤位':text(native?.purpose),
  occupants:Number.isInteger(native?.occupants)&&native.occupants>=0?native.occupants+' 人':'未記錄',
  note:home?'依住所登記列出，不代表目前在家；未記錄所有權或繼承資料。':stall?'未記錄獨立經營者':'人數依目前場域紀錄，不代表住戶或所有人。',
  residents:home?list(vm?.npc).filter(n=>n.residence===building.id).map(n=>({id:n.id,name:text(n.name),role:text(n.role),
   status:n.alive===false?'生前住戶 · 已故':n.alive===true?'登記住戶 · 在世':'登記住戶 · 存歿未記錄'})):[]};
}
