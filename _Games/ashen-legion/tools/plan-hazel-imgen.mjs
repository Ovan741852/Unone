import{readFileSync,writeFileSync,readdirSync}from'node:fs';
import{fileURLToPath}from'node:url';import{join}from'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const common=JSON.parse(readFileSync(join(root,'design-v1/hazel-imgen-common-prompts.json'),'utf8'));
const equipment=JSON.parse(readFileSync(join(root,'design-v1/equipment-manifest.json'),'utf8'));
const main=readFileSync(join(root,'main.luau'),'utf8');
const descriptions=Object.fromEntries([...main.matchAll(/\{"([a-z_]+)","([^"]+)","([^"]+)",\d+\}/g)].map(m=>[m[1],{name:m[2],description:m[3]}]));
Object.assign(descriptions,{pierce:{name:'穿軍尖鋒',description:'穿透命中多名敵人'},critical:{name:'精準戰技',description:'精準爆擊'},landing_spin:{name:'旋風戰技',description:'落地旋轉斬擊'}});
// One illustration for each skill and its named equipment keeps the visual identity
// consistent between the skill catalog and the item that grants that skill.
const aliases={sharp:['icon-attack','icon-weapon','icon-sword','symbol-sword'],momentum:['icon-spear','symbol-spear'],critical:['icon-helmet'],longlife:['icon-body'],haste:['icon-boots','icon-speed'],giant:['icon-gloves'],double_pierce:['icon-pierce'],landing_spin:['icon-spin'],showdown:['icon-crown']};
const slots={1:'headgear / helmet / crown',2:'armor / chest garment / cloak / banner worn on the back',3:'boots',4:'hand equipment / gauntlet / ring / handheld trinket',5:'weapon'};
const gear=equipment.map(g=>({id:'gear-'+g.id,resources:['gear-'+g.id,'skill-'+g.id,...aliases[g.id]??[]],name:g.name,skill:descriptions[g.id],subject:`One enchanted fantasy equipment item named 「${g.name}」. Physical item category: ${slots[g.slot]}; honor the specific item type in its Chinese name (e.g. 燈=lantern, 法典=spellbook, 匣=equipment case, 旗=banner, 杖=staff, 護手=gauntlet). Show the item alone, with one prominent visual motif or magical flourish evoking 「${descriptions[g.id]?.name??g.id}」: ${descriptions[g.id]?.description??g.id}. Do not draw a character wearing it. This same artwork identifies the equipment and the skill it grants, so communicate the effect visually through the object and its strong magical motif. No numbers, no labels, no words in the picture.`}));
const building=JSON.parse(readFileSync(join(root,'design-v1/hazel-imgen-manifest.json'),'utf8')).entries.filter(e=>e.id.startsWith('building-'));
const jobs=[...building.map(e=>({id:e.id,resources:[e.id],subject:e.subject})),...common.common,...gear].map(j=>({...j,prompt:common.base+'\nSubject: '+j.subject}));
const requested=readdirSync(join(root,'design-v1/svg')).filter(f=>/^(gear-|skill-|icon-|symbol-|building-).+\.svg$/.test(f)).map(f=>f.slice(0,-4));
const mapped=jobs.flatMap(j=>j.resources),missing=requested.filter(id=>!mapped.includes(id));
if(missing.length||mapped.length!==new Set(mapped).size)throw Error('Icon coverage: '+JSON.stringify({missing,count:mapped.length,unique:new Set(mapped).size}));
writeFileSync(join(root,'design-v1/hazel-imgen-jobs.json'),JSON.stringify({version:'hazel-imgen-v1',artworks:jobs.length,resources:mapped.length,jobs},null,2)+'\n');
console.log(jobs.length+' ImageGen artworks mapped to all '+mapped.length+' icon resources');
