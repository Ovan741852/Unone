import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=JSON.parse(readFileSync(join(root,'design-v1/hazel-imgen-v2-jobs.json'),'utf8'));
const reference='D:/Projects/YesSir/_Games/ashen-legion/assets/formal-ui/quartermaster-v1.png';
const style='Create a NEW fantasy RPG icon, isolated on a transparent background. Use the attached Hazel portrait ONLY as the illustration style reference: confident angular hand-painted color planes, warm amber highlights, restrained olive green, russet leather, ivory steel, old gold and subtle ink outlines. Do not draw the woman. Strong clean silhouette with comfortably empty margins on all four sides, the complete subject fully visible. Beautiful handcrafted storybook game icon art, readable at 48 px.';
function itemType(name){for(const [pattern,type] of [[/匣/,'a rigid portable equipment box or case'],[/法典/,'a closed ornamented spellbook'],[/魂燈/,'a hanging spirit lantern'],[/肩甲/,'a pair of compact armored shoulder pauldrons'],[/戰旗/,'a cloth battle banner on a short pole'],[/護符/,'a pendant charm'],[/指環|契印|手環/,'a ring or wrist ornament'],[/護手/,'a single armored gauntlet'],[/靴/,'a pair of boots'],[/斗篷/,'an empty wearable cloak'],[/鎧|鎧甲|鋼甲|背甲|征甲|軍甲|戰衣/,'a solid wearable chest armor or tunic'],[/冠/,'a crown or circlet'],[/盔|面甲|面具/,'a helmet or armored mask'],[/頭帶/,'a cloth headband'],[/法杖/,'a staff'],[/長柄|戰槍/,'a polearm or spear'],[/戰斧/,'an axe'],[/戰錘/,'a hammer'],[/雙刃/,'a pair of blades'],[/劍|刃/,'a single sword or knife']])if(pattern.test(name))return type;return 'a single physical equipment item';}
const jobs=previous.equipmentSources.map(e=>{
 const gear=e.id.startsWith('gear-');
 const name=e.name??e.id;
 const subject=gear?`EQUIPMENT: ${name}, ${itemType(name)}. Show the actual solid object alone. Use subtle engraved motifs to evoke ${e.skill?.name??name}; do not add active magic effects. Maintain a clear physical item silhouette and believable material boundaries.`:e.subject;
 const prompt=style+'\nSubject: '+subject+'\nThis is a physical EQUIPMENT / BUILDING / INVENTORY item: emphasize the solid object and materials; omit magical rings, slash trails, floating sparks, smoke and bloom clouds. Skill icons will show those active effects separately. A small lit window, liquid inside a bottle or gem inset is fine. Background: genuinely transparent, PNG with alpha. No colored backdrop, no white rectangle, no painted checkerboard, no floor, no cast shadow outside the item, no border, no words or watermark.';
 return {id:e.id,name,kind:gear?'equipment':e.id.startsWith('building-')?'building':'common',resources:e.resources,subject,prompt,reference};
});
for(const e of previous.skillJobs)jobs.push({id:e.id,name:e.name,kind:'skill',resources:e.resources,pairedEquipment:e.pairedEquipment,subject:e.subject,prompt:style+'\nSKILL / ACTIVE EFFECT EMBLEM: '+e.name+'. '+e.subject+'\nDepict the action, transformation or magical buff clearly, visually different from the paired equipment still life. Small figures must be anonymous armored silhouettes, never the reference woman or a portrait. Use appropriate elemental accent colors: fire orange, frost cyan, poison green, arcane violet. Favor a few bold effect shapes over many tiny particles. No inventory display of an empty helmet, cloak, boots or weapon. No surrounding scene or solid backdrop; transparent negative spaces.\nMeaning (do not print words or numbers): '+e.description,reference});
const resources=jobs.flatMap(j=>j.resources);
if(jobs.length!==181||resources.length!==201||new Set(resources).size!==201)throw Error('Unexpected asset coverage');
const plan={version:'hazel-transparent-v2',jobs,artworks:jobs.length,resources:resources.length,reuseApproved:['gear-sharp']};
writeFileSync(join(root,'design-v1/hazel-transparent-jobs.json'),JSON.stringify(plan,null,2)+'\n');
const dir=join(root,'art-source/hazel-transparent-batches');mkdirSync(dir,{recursive:true});
const pending=jobs.filter(j=>!plan.reuseApproved.includes(j.id));
for(let n=0;n<3;n++)writeFileSync(join(dir,'batch-'+(n+1)+'.json'),JSON.stringify(pending.slice(n*60,(n+1)*60),null,2)+'\n');
console.log(`${jobs.length} artwork slots, ${resources.length} resource IDs, ${pending.length} images to generate in three Luna batches.`);
