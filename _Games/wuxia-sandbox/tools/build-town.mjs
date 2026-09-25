// Reproducible offline import of the downloaded CC0 Kenney OBJ meshes.
// No simulation runs here; this only authors assets, the scene and Luau layout data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'assets/imported');fs.mkdirSync(out,{recursive:true});
const town=path.join(root,'assets/external/kenney-town/Models/OBJ format');
const chars=path.join(root,'assets/external/kenney-characters/Models/OBJ format');
const write=(p,v)=>fs.writeFileSync(path.join(root,p),JSON.stringify(v));
const manifest={version:1,assets:[]};
const add=(id,source,kind)=>manifest.assets.push({id,source,kind,bundle:'content'});
for(const [name,dir] of [['town',town],['people',chars]]){
 fs.copyFileSync(path.join(dir,'Textures/colormap.png'),path.join(out,name+'.png'));
 add('texture://'+name,'assets/imported/'+name+'.png','texture2d');
}
const empty=(texture='texture://town')=>({version:1,positions:[],uvs:[],indices:[],texture});
function obj(dir,name,texture='texture://town'){
 const positions=[],uvs=[],mesh=empty(texture),seen=new Map();
 for(const line of fs.readFileSync(path.join(dir,name+'.obj'),'utf8').split(/\r?\n/)){
  const [type,...parts]=line.trim().split(/\s+/);
  if(type==='v')positions.push(parts.slice(0,3).map(Number));
  if(type==='vt')uvs.push(parts.slice(0,2).map(Number));
  if(type==='f'){
   const vertices=parts.map(s=>{if(seen.has(s))return seen.get(s);const [p,t]=s.split('/').map(Number);if(!p||!t)throw Error('OBJ requires positions and UVs: '+name);const id=mesh.positions.length/3;mesh.positions.push(...positions[p<0?positions.length+p:p-1]);mesh.uvs.push(...uvs[t<0?uvs.length+t:t-1]);seen.set(s,id);return id;});
   for(let i=1;i<vertices.length-1;i++)mesh.indices.push(vertices[0],vertices[i],vertices[i+1]);
  }
 }
 return mesh;
}
function merge(dest,src,{x=0,y=0,z=0,sx=1,sy=1,sz=1,angle=0}={}){
 const base=dest.positions.length/3,c=Math.cos(angle),s=Math.sin(angle);
 for(let i=0;i<src.positions.length;i+=3){let a=src.positions[i]*sx,b=src.positions[i+2]*sz;dest.positions.push(+(x+a*c+b*s).toFixed(5),+(y+src.positions[i+1]*sy).toFixed(5),+(z-a*s+b*c).toFixed(5));}
 dest.uvs.push(...src.uvs);dest.indices.push(...src.indices.map(i=>i+base));return dest;
}
function save(name,mesh){write('assets/imported/'+name+'.mesh.json',mesh);add('mesh://'+name,'assets/imported/'+name+'.mesh.json','mesh3d');return 'mesh://'+name;}
const raw=n=>obj(town,n);
for(const n of ['stall-red','stall-green','tree','tree-high-round','rock-large','rock-small','cart','fountain-round','lantern','planks','fence','banner-red','banner-green','stall-bench','stall-stool','road'])save(n,raw(n));
for(let variation=0;variation<4;variation++){
 const mesh=empty(),floors=variation===2?2:1;
 for(let floor=0;floor<floors;floor++)for(let side=0;side<4;side++){
  const name=side===0&&floor===0?'wall-door':(variation===1?'wall-wood-window-shutters':'wall-window-glass');
  merge(mesh,raw(name),{y:floor*2.5,sx:5.2,sy:2.5,sz:5.2,angle:side*Math.PI/2});
 }
 merge(mesh,raw(variation===3?'roof-high-point':'roof-point'),{y:floors*2.5,sx:5.7,sy:3.3,sz:5.7});
 if(variation===1)merge(mesh,raw('chimney'),{x:1.5,y:3.1,z:1.2,sx:1.3,sy:1.3,sz:1.3});
 save('house-'+variation,mesh);
}
for(const sex of ['male','female'])for(const variant of 'abcdef'){
 const name=`character-${sex}-${variant}`,mesh=obj(chars,name,'texture://people');
 const ys=mesh.positions.filter((_,i)=>i%3===1),lo=Math.min(...ys),h=Math.max(...ys)-lo;
 for(let i=0;i<mesh.positions.length;i++)mesh.positions[i]=+((mesh.positions[i]-(i%3===1?lo:0))*1.85/h).toFixed(5);
 save(name,mesh);
}
// Small authored ground palette; downloaded mesh textures remain unmodified.
const colors=['668877','b3a081','d2b992','558a9b','829668','6f786a','e6d7b3','956f47'];
const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
function chunk(type,data){const t=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4);return b;}
const header=Buffer.alloc(13);header.writeUInt32BE(8);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
fs.writeFileSync(path.join(out,'land.png'),Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,...colors.flatMap(c=>[0,2,4].map(i=>parseInt(c.slice(i,i+2),16)))]))),chunk('IEND',Buffer.alloc(0))]));
add('texture://land','assets/imported/land.png','texture2d');
const ground=empty('texture://land');
function quad(x,z,w,d,y,color){const b=ground.positions.length/3;ground.positions.push(x-w/2,y,z-d/2,x+w/2,y,z-d/2,x+w/2,y,z+d/2,x-w/2,y,z+d/2);for(let i=0;i<4;i++)ground.uvs.push((color+.5)/8,.5);ground.indices.push(b,b+2,b+1,b,b+3,b+2);}
quad(0,0,180,144,-.08,0);quad(0,0,7,136,.005,1);quad(0,0,172,6,.006,1);
for(const cx of [-34,34]){
 quad(cx,0,52,5,.007,1);quad(cx,-18,44,3,.008,1);quad(cx,18,44,3,.008,1);
 quad(cx-22,0,3,54,.009,1);quad(cx+22,0,3,54,.009,1);
}
quad(0,0,8,136,.01,2);quad(0,-60,12,5,.011,3);quad(0,60,12,5,.011,3);
quad(-34,26,16,8,.02,7);quad(34,-26,16,8,.02,7);
for(let i=0;i<8;i++){quad(-28+i*2,26,.8,8,.03,4);quad(28+i*2,-26,.8,8,.03,4);}
save('town-land',ground);
const buildings=[
 ['market_gate','market','雲水市集','🏮','交易、說書、接委託',-42,-12,-21,-6,'stall-red',2.8,2.8,2.4],
 ['gate','gate','雲水北境關口','🛡','護送、出入、接鏢',-34,-29,-17,-12,'house-3',.9,3.3,3.3],
 ['forge','forge','玄鐵鋪','🔨','鍛造、修理、工作',-8,-12,-4,-6,'house-1',1,3.3,3.3],
 ['clinic','clinic','回春醫館','🩺','治療、採藥、行醫',-60,8,-30,4,'house-0',1,3.3,3.3],
 ['training_yard','training','雲水演武場','⚔','練武、比武、提升武學',-20,14,-10,7,'banner-red',2,0,0],
 ['inn','inn','聽雨客棧','🍜','吃飯、休息、交談',0,-20,0,-10,'house-2',1.25,4.1,4.1],
 ['herb_field','herb_field','青篁藥田','🌿','採集藥草與食材',-55,25,-28,13,'cart',2,1.4,1.6],
 ['monster_den','monster_den','黑風窟','👹','怪物出沒、巡查、狩獵',-2,26,-1,13,'rock-large',3,3,3],
 ['school','school','松風私塾','📚','教學、讀書、培養下一代',-42,13,-21,7,'house-1',1,3.3,3.3],
 ['temple','temple','照夜寺','🕯','祈願、守鐘、安置亡者',-66,-29,-33,-15,'house-3',1.15,3.7,3.7],
 ['stable','stable','青鬃馬廄','🐎','養馬、出行、鏢隊整備',-9,-27,-5,-14,'house-1',1,3.3,3.3],
 ['archive','archive','鎮史庫','📜','地圖、帳冊、信件與記錄',-42,-27,-21,-14,'house-2',.85,2.9,2.9],
 ['dock','dock','渡口紙坊','⛵','渡河、漁撈、造紙與水運',-68,23,-34,12,'house-1',.8,2.7,2.7],
 ['manor','manor','青石城主府','🏯','城主議事、稅收、城鎮治理',20,-28,10,-14,'house-3',1.15,3.7,3.7],
 ['guild','guild','斬妖公會','⚔','發布斬妖委託、登記功勳、領取賞金',20,15,10,7,'house-2',1.1,3.5,3.5],
 ['wall_gate_b','gate_b','青石南城門','🛡','守衛、出入、巡查城牆',34,-29,17,-12,'house-3',.9,3.3,3.3],
 ['market_b','market_b','青石商街','🧺','行商、交易、交換貨物',42,-13,21,-6,'stall-green',2.8,2.8,2.4],
 ['caravan_gate','caravan_gate','遠行商隊驛站','🐎','行商集結、護送、補給',63,17,32,9,'house-1',.9,3.1,3.1],
 ['training_b','training_b','青石校武台','⚡','守衛訓練、飛劍比試',14,-14,7,-7,'banner-green',2,0,0],
 ['clinic_b','clinic_b','青石藥廬','🩺','治療斬妖傷勢、煉丹',60,10,30,6,'house-0',1,3.3,3.3],
 ['inn_b','inn_b','落霞客舍','🍜','吃飯、休息、旅人住宿',4,-20,2,-10,'house-2',1.25,4.1,4.1],
 ['monster_outskirts','monster_outskirts','荒原斬妖哨','👹','城外怪物、斬妖任務出發點',12,30,6,15,'rock-large',3,3,3]
].map(([id,zone,name,icon,purpose,x,z,ax,az,model,scale,clearanceX,clearanceZ])=>({id,zone,name,icon,purpose,x,z,access:{x:ax,z:az},model,scale,clearanceX,clearanceZ}));
const homes=[];
for(const cx of [-34,34])for(let i=0;i<20;i++){
 const col=i%5,row=Math.floor(i/5),x=cx-20+col*10,z=-21+row*14;
 homes.push({id:'home_'+(homes.length+1),name:`${cx<0?'雲水':'青石'}民居 ${i+1}`,x,z,clearanceX:2.7,clearanceZ:2.7,access:{x:Math.round(x/2),z:Math.round((z+(z<0?4:-4))/2)}});
}
const entities=[];
const obstacles=[];
function entity(id,model,x,z,scale=1,y=0,angle=0){entities.push({id,transform3d:{position:{x,y,z},scale:{x:scale,y:scale,z:scale},rotation:{x:0,y:angle,z:0}},mesh3d:{asset:'mesh://'+model}});}
entity('floor','town-land',0,0);
for(const b of buildings)entity(b.id,b.model,b.x,b.z,b.scale);
homes.forEach((h,i)=>entity(h.id,'house-'+(i%4),h.x,h.z,.8));
for(const cx of [-34,34]){entity('well_'+cx,'fountain-round',cx,0,1.8);for(const x of [cx-8,cx+8])for(const z of [-20,-10,10,20])entity(`lantern_${cx}_${x}_${z}`,'lantern',x,z,1.6);}
for(const x of [-84,-76,-68,-60,-52,-44,-36,-28,-20,-12,12,20,28,36,44,52,60,68,76,84]){entity('tree_n_'+x,'tree-high-round',x,-67,1.6);entity('tree_s_'+x,'tree',x,67,1.25);}
for(const [i,x,z] of [[0,-4,-46],[1,4,-42],[2,-8,45],[3,8,45],[4,-66,44],[5,66,-44],[6,-4,50],[7,4,-50]]){entity('monster_'+i,'rock-large',x,z,1.8);obstacles.push({x,z,radius:1.35});}
for(const [i,x,z] of [[0,-38,0],[1,38,0],[2,0,0],[3,-34,42],[4,34,-42]]){entity('cart_'+i,'cart',x,z,2);obstacles.push({x,z,radius:1.35});}
function wall(id,x,z,angle=0){entity(id,'fence',x,z,2.6,0,angle);}
for(const [prefix,cx] of [['wall_a',-34],['wall_b',34]]){
 for(let x=cx-28;x<=cx+28;x+=4){if(Math.abs(x-cx)>4){wall(prefix+'_n_'+x,x,-34);wall(prefix+'_s_'+x,x,34);}}
 for(let z=-30;z<=30;z+=4){wall(prefix+'_w_'+z,cx-28,z,Math.PI/2);wall(prefix+'_e_'+z,cx+28,z,Math.PI/2);}
}
const female=new Set([2,5,7,9,12,14,15,25,28,29,31,32,35,37,40,42,44,47,50,53,55,58,61,64,67,70,73,76,79]);
for(let i=1;i<=80;i++)entity('npc_'+i,`character-${female.has(i)?'female':'male'}-${'abcdef'[(i-1)%6]}`,0,0);
// Native Unone VFX: gameplay selects these named, deterministic effects through api.particle.play().
const particleEffects={
 'flying_sword_cast':{version:1,duration_frames:1,emitters:[
  {id:'blade',count:1,interval_frames:1,lifetime_frames:10,spread:{x:.05,y:.05,z:.05},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:2.2,size_end:.08,color_start:[.72,.94,1,1],color_end:[.12,.35,1,0],sprite_shape:'streak',additive:true},
  {id:'cast-ring',count:1,interval_frames:1,lifetime_frames:12,spread:{x:0,y:0,z:0},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:.35,size_end:1.45,color_start:[.25,.72,1,.8],color_end:[.08,.2,.8,0],emission_shape:'ring',emission_radius:.65,sprite_shape:'ring',additive:true}
 ]},
 'flying_sword_hit':{version:1,duration_frames:1,emitters:[
  {id:'impact-ring',count:1,interval_frames:1,lifetime_frames:14,spread:{x:0,y:0,z:0},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:.5,size_end:2.8,color_start:[1,.82,.28,1],color_end:[.55,.18,.04,0],emission_shape:'ring',emission_radius:.7,sprite_shape:'ring',additive:true},
  {id:'impact-sparks',count:8,interval_frames:1,lifetime_frames:14,spread:{x:.18,y:.18,z:.18},velocity_min:{x:-3,y:.6,z:-3},velocity_max:{x:3,y:4,z:3},gravity:{x:0,y:-7,z:0},size_start:.24,size_end:.02,color_start:[1,.94,.55,1],color_end:[1,.25,.02,0],sprite_shape:'diamond',additive:true}
 ]},
 'flying_sword_critical':{version:1,duration_frames:1,emitters:[
  {id:'critical-ring',count:1,interval_frames:1,lifetime_frames:18,spread:{x:0,y:0,z:0},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:.7,size_end:3.8,color_start:[1,.95,.62,1],color_end:[.8,.08,.02,0],emission_shape:'ring',emission_radius:.8,sprite_shape:'ring',additive:true},
  {id:'critical-sparks',count:14,interval_frames:1,lifetime_frames:20,spread:{x:.3,y:.25,z:.3},velocity_min:{x:-5,y:1,z:-5},velocity_max:{x:5,y:7,z:5},gravity:{x:0,y:-10,z:0},size_start:.32,size_end:.02,color_start:[1,.42,.08,1],color_end:[.65,.02,.01,0],sprite_shape:'streak',additive:true}
 ]},
 'flying_sword_miss':{version:1,duration_frames:1,emitters:[
  {id:'miss-slash',count:1,interval_frames:1,lifetime_frames:8,spread:{x:.1,y:.08,z:.1},velocity_min:{x:0,y:.1,z:0},velocity_max:{x:0,y:.3,z:0},gravity:{x:0,y:0,z:0},size_start:1.45,size_end:.06,color_start:[.55,.78,1,.8],color_end:[.1,.24,.55,0],sprite_shape:'streak',additive:true},
  {id:'miss-ring',count:1,interval_frames:1,lifetime_frames:9,spread:{x:0,y:0,z:0},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:.28,size_end:1.1,color_start:[.35,.62,1,.7],color_end:[.08,.16,.45,0],emission_shape:'ring',emission_radius:.4,sprite_shape:'ring',additive:true}
 ]},
 'flying_sword_finish':{version:1,duration_frames:1,emitters:[
  {id:'finish-ring',count:1,interval_frames:1,lifetime_frames:20,spread:{x:0,y:0,z:0},velocity_min:{x:0,y:0,z:0},velocity_max:{x:0,y:0,z:0},gravity:{x:0,y:0,z:0},size_start:.9,size_end:4.2,color_start:[.7,.9,1,.9],color_end:[.12,.25,.65,0],emission_shape:'ring',emission_radius:.8,sprite_shape:'ring',additive:true},
  {id:'finish-glow',count:12,interval_frames:1,lifetime_frames:24,spread:{x:.5,y:.25,z:.5},velocity_min:{x:-2,y:1,z:-2},velocity_max:{x:2,y:4,z:2},gravity:{x:0,y:-4,z:0},size_start:.3,size_end:.02,color_start:[.45,.8,1,1],color_end:[.08,.22,.8,0],sprite_shape:'soft_circle',additive:true}
 ]}
};
write('assets/manifest.json',manifest);
write('scenes/main.scene.json',{camera3d:{position:{x:0,y:128,z:150},target:{x:0,y:0,z:0},fov_degrees:50},particle_effects:particleEffects,entities});
write('assets/town-layout.json',{size:{width:180,depth:144,center:{x:0,z:0}},buildings,homes,obstacles,residential_capacity:80,towns:[{id:'yunshui',name:'雲水鎮',center:{x:-34,z:0}},{id:'qingshi',name:'青石鎮',center:{x:34,z:0}}],monsters:[{id:'monster_0',name:'荒原狼',x:-4,z:-46},{id:'monster_1',name:'赤眼猿',x:4,z:-42},{id:'monster_2',name:'黑甲蛛',x:-8,z:45},{id:'monster_3',name:'裂岩獸',x:8,z:45},{id:'monster_4',name:'山魈',x:-66,z:44},{id:'monster_5',name:'夜行狐妖',x:66,z:-44},{id:'monster_6',name:'鐵背熊',x:-4,z:50},{id:'monster_7',name:'風刃狼王',x:4,z:-50}]});
let lua=fs.readFileSync(path.join(root,'scripts/main.luau'),'utf8');
const luauValue=v=>typeof v==='string'?JSON.stringify(v):typeof v==='number'?String(v):'{'+Object.entries(v).map(([k,x])=>k+'='+luauValue(x)).join(',')+'}';
lua=lua.replace(/local BUILDINGS = \{[\s\S]*?\n\}\s*\n(?:local HOMES = \{[\s\S]*?\n\}\s*\n)?(?:local OBSTACLES = \{[\s\S]*?\n\}\s*\n)?local GRID_STEP = [\d.]+/,`local BUILDINGS = {\n${buildings.map(b=>'    '+luauValue(b)).join(',\n')}\n}\nlocal HOMES = {\n${homes.map(h=>'    '+luauValue(h)).join(',\n')}\n}\nlocal OBSTACLES = {\n${obstacles.map(h=>'    '+luauValue(h)).join(',\n')}\n}\n\nlocal GRID_STEP = 2`);
lua=lua.replace(/local GRID_MIN_X, GRID_MAX_X = [^\n]+/,'local GRID_MIN_X, GRID_MAX_X = -45, 45').replace(/local GRID_MIN_Z, GRID_MAX_Z = [^\n]+/,'local GRID_MIN_Z, GRID_MAX_Z = -36, 36');
fs.writeFileSync(path.join(root,'scripts/main.luau'),lua);
console.log(JSON.stringify({assets:manifest.assets.length,entities:entities.length,homes:homes.length,capacity:80,area:180*144}));
