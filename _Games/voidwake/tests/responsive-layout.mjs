// Exercise the real official pure-Luau package and the project's authored View.
// No copied layout algorithm or renderer is used by this geometry regression.
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const argument=process.argv.indexOf('--luau');
const luau=argument<0?resolve(root,'.toolcache/luau-0.734/luau.exe'):process.argv[argument+1];
const componentSource=await readFile(resolve(root,'packages/unone-ui/src/components.luau'),'utf8');
const viewSource=await readFile(resolve(root,'_Games/voidwake/ui.fragment.luau'),'utf8');
const harness=`
local kit=(function(...)
${componentSource}
end)({name="@unone/ui",version="0.4.0"},true,function() return false end,{})
local S:any={}
local soundEnabled=true
local SECTOR_DURATION=40
local function clamp(value:number,minimum:number,maximum:number):number return math.clamp(value,minimum,maximum) end
${viewSource}
local aspect=16/9
local root=nil
local observations={}
local api={
 ui={components=kit,getViewport=function() return {aspect=aspect} end,setRoot=function(value) root=value end},
 observation={set=function(id,value) observations[id]=value end},
}
local checks=0
local function check(condition,message)
 assert(condition,message)
 checks+=1
end
local function overlap(a,b)
 return a.x<b.x+b.width-.000001 and b.x<a.x+a.width-.000001
  and a.y<b.y+b.height-.000001 and b.y<a.y+a.height-.000001
end
local function collect(node,leaves,actions)
 if node.children then for _,child in ipairs(node.children) do collect(child,leaves,actions) end
 else
  check(node.rect~=nil,"Missing leaf rect: "..node.id)
  local r=node.rect
  check(r.x>=0 and r.y>=-.000001 and r.width>0 and r.height>0 and r.x+r.width<=100.000001 and r.y+r.height<=100.000001,
   "Invalid stage bounds: "..node.id)
  leaves[node.id]=node
  if node.kind=="button" then table.insert(actions,node) end
 end
end
local cases={
 {aspect=390/844,variant="portrait"},{aspect=.849999,variant="portrait"},
 {aspect=.85,variant="intermediate"},{aspect=1020/884,variant="intermediate"},
 {aspect=1.399999,variant="intermediate"},{aspect=1.4,variant="desktop"},
 {aspect=1440/900,variant="desktop"},
}
for _,case in ipairs(cases) do
 aspect=case.aspect
 for _,phase in ipairs({"menu","playing","paused","upgrade","gameover","victory"}) do
  S={phase=phase,sector=1,time=90,kills=12,sectorTime=9,credits=120,level=2,xp=10,xpNext=24,
   autoFire=true,burstCooldown=0,dashCooldown=0,upgradesInstalled=3,sectorDraft=false,
   player={hp=85,maxHp=100,shield=40,maxShield=60},enemies={{boss=true,hp=600,maxHp=1000}},
   choices={
    {name="超臨界反應爐",description="主炮傷害 +25%。將每一束餘燼變成穿甲光。",rarity="RARE"},
    {name="磁軌自動裝填",description="射擊間隔 -18%。連續火力，直到深空沉默。",rarity="RARE"},
    {name="電磁過載核心",description="脈衝傷害 +60%，範圍 +20%，冷卻 -15%。",rarity="EPIC"},
   }}
  updateUi(api)
  check(observations.ui_layout.variant==case.variant,"Wrong responsive variant")
  local leaves,actions={},{}
  collect(root,leaves,actions)
  for i,a in ipairs(actions) do for j=i+1,#actions do
   check(not overlap(a.rect,actions[j].rect),"Overlapping actions: "..a.id.." / "..actions[j].id)
  end end
  if phase=="menu" then
   check(leaves.launch.action=="Start","Launch action changed")
   if case.variant=="portrait" then
    local art=assert(uiModels).menu.resolve({aspect=aspect}).rect("menu_showcase")
    check(art.height>=18,"Portrait art region must remain useful")
    for _,id in ipairs({"menu_title","menu_title_accent","menu_story","launch"}) do
     check(not overlap(art,leaves[id].rect),"Portrait showcase overlaps "..id)
    end
   end
  elseif phase=="playing" then
   check((leaves.up~=nil)==(case.variant=="portrait"),"Touch controls must follow authored variant")
   check(not overlap(leaves.boss_plate.rect,leaves.pause.rect),"Boss plate covers pause input")
  elseif phase=="upgrade" then
   local first,second=leaves.choice_plate_1.rect,leaves.choice_plate_2.rect
   check(case.variant=="portrait" and second.y<first.y or case.variant~="portrait" and second.x>first.x,
    "Upgrade grid must stack only in portrait")
   for i=1,3 do
    local description=leaves["choice_desc_"..i]
    check(string.sub(description.text,-1)~="\\n","Upgrade description must not end with an empty line")
    local _,breaks=string.gsub(description.text,"\\n","")
    local lineHeight=description.style.font_size*description.style.line_height
    check((breaks+1)*lineHeight<=description.rect.height+.000001,"Authored description lines exceed card height")
   end
  end
 end
end
print("Official responsive Voidwake geometry: "..checks.." checks passed across 7 aspects and 6 phases")
`;
const temporary=await mkdtemp(join(tmpdir(),'unone-voidwake-layout-'));
try {
 const path=join(temporary,'layout.luau');
 await writeFile(path,harness,'utf8');
 const result=spawnSync(luau,[path],{encoding:'utf8'});
 process.stdout.write(result.stdout||'');
 process.stderr.write(result.stderr||'');
 if(result.error) throw result.error;
 process.exitCode=result.status??1;
} finally { await rm(temporary,{recursive:true,force:true}); }
