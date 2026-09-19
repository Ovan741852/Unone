import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'tests/formal-layout');mkdirSync(out,{recursive:true});
const cases={defeat:['Start','Choice1','LeaveShop','WaitDefeat'],menu:[],town:['UI_town'],map:['StartMoving'],map_arrived:['Start','ViewMap'],choice:['Start'],shop:['Start','Choice1'],gear:['Start','Choice1','Buy1','UI_gear','Equip1'],runes:['Start','Choice1','UI_runes'],builds:['Start','Choice1','UI_builds','UI_page_next'],battle:['Start','Choice1','LeaveShop'],pause:['Start','Choice1','LeaveShop','Pause']};
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const contains=(a,b)=>a.x<=b.x+.001&&a.y<=b.y+.001&&a.x+a.width>=b.x+b.width-.001&&a.y+a.height>=b.y+b.height-.001;
const reports=[];
cases.auto=['Start','Choice1','LeaveShop','Mode_auto'];cases.auto_empty=['Start','Choice1','LeaveShop','Mode_auto','Auto_none'];
cases.battle_beetle=['Start','Choice1','LeaveShop','WaitBeetle'];
const artGroups={chapter_back:['chapter_crest','chapter','round','shared_pool'],objective_back:['objective','boss_timing'],timer_plate:['time'],coins_plate:['coins','coins_icon'],crystals_plate:['crystals','crystals_icon'],target_plate:['target','target_guard']};
const hitGroups={pause:['pause_plate','pause_icon']};
for(let i=1;i<=10;i++){hitGroups['auto_pick_'+i]=['auto_icon_'+i,'auto_tick_'+i];artGroups['auto_card_'+i]=['auto_icon_'+i,'auto_tick_'+i,'auto_pick_'+i,'auto_name_'+i,'auto_info_'+i];}
for(let k=1;k<=3;k++){hitGroups['hud_unit_'+k]=['hud_unit_plate_'+k,'hud_unit_icon_'+k];artGroups['hud_unit_plate_'+k]=['hud_unit_'+k,'hud_unit_caption_'+k,'hud_unit_icon_'+k];}
for(const mode of ['manual','lock','auto']){hitGroups['mode_'+mode]=['mode_plate_'+mode,'mode_icon_'+mode];artGroups['mode_plate_'+mode]=['mode_'+mode,'mode_label_'+mode,'mode_icon_'+mode];}
for(const [name,actions] of Object.entries(cases)){
 const frames=actions.flatMap(a=>[{actions:{[a==='StartMoving'?'Start':a]:true}},...Array.from({length:a==='WaitDefeat'?10980:a==='WaitBeetle'?2760:a==='Start'?91:1},()=>({actions:{}}))]);if(!frames.length)frames.push({actions:{}});
 const input=join(out,name+'-input.json');writeFileSync(input,JSON.stringify(frames));
 const args=['--project',root,'ui','preview','--json','--frames',String(frames.length),'--input-sequence',input];
 const run=extra=>{const r=spawnSync('D:/Projects/Unone/target/debug/game.exe',[...args,...extra],{encoding:'utf8',timeout:60000,maxBuffer:8e6});if(!r.stdout)throw Error(r.stderr||String(r.error));return JSON.parse(r.stdout)};
 const initial=run([]);if(!initial.ok)throw Error(JSON.stringify(initial.diagnostics));
 const nodes=initial.value.nodes,allowed=[];
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=nodes[i],b=nodes[j];if(!overlap(a.rect,b.rect))continue;
  if(a.kind==='image'&&b.kind==='button'&&hitGroups[b.id]?.includes(a.id)&&contains(b.rect,a.rect)){
   allowed.push({behind:a.id,front:b.id,reason:'Explicit transparent semantic hit area over its own authored icon and caption'});continue;
  }
  if(a.kind!=='image'||!contains(a.rect,b.rect))continue;
  if(artGroups[a.id]?.includes(b.id)||Object.values(hitGroups).some(group=>group[0]===a.id&&group.slice(1).includes(b.id))){
   allowed.push({behind:a.id,front:b.id,reason:'Explicit HUD artwork under its own contained icon and text'});continue;
  }
  // Only authored full backdrops, card frames and a button's own plate may underlay content.
  const reason=['menu_art','menu_ground','menu_banner','screen_back','interior_shade','hud_bottom','map_back','town_scene'].includes(a.id)?'Authored screen backdrop beneath foreground content':/^(stock_panel_|choice_plate_)/.test(a.id)||(a.id==='story_plate'&&/^story_/.test(b.id))?'Authored card frame beneath its contained content':a.id===b.id+'_plate'||a.id===b.id.replace(/_hit_(top|bottom)$/, '')+'_plate'?'Button artwork beneath its semantic control and caption':a.id.replace('map_node_','map_number_')===b.id?'Map number inside its authored marker':null;
  if(reason)allowed.push({behind:a.id,front:b.id,reason});
 }
 const policy=join(out,name+'-policy.json');writeFileSync(policy,JSON.stringify({version:1,screens:{forest_lord:allowed}},null,2));
 const checked=run(['--strict','--overlap-policy',policy]);writeFileSync(join(out,name+'-report.json'),JSON.stringify(checked,null,2));
 reports.push({name,ok:checked.ok,nodes:nodes.length,allowed:allowed.length,findings:checked.value?.findings,diagnostics:checked.diagnostics});
}
writeFileSync(join(out,'summary.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));if(reports.some(r=>!r.ok))process.exitCode=1;
