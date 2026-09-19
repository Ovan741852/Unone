import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const labels={
 'building-market':'林間集市','building-forge':'附魔鐵匠鋪','building-alchemy':'煉金房','building-barracks':'兵營','building-keep':'領主城堡','building-curse':'荊棘祭壇',
 'icon-potion-haste':'疾風藥水','icon-potion-life':'延命藥水','icon-potion-recall':'召回藥水','icon-coin':'金幣','icon-crystal':'結晶','icon-life':'壽命','icon-crit':'爆擊',
 'icon-curse-debt':'債務詛咒','icon-curse-frail':'脆弱詛咒','icon-curse-slow':'遲緩詛咒','icon-rune':'符文','icon-refresh':'刷新','icon-sell':'出售',
 'icon-lock':'鎖定目標','icon-auto':'自動射擊','icon-pause':'暫停','icon-close':'關閉','icon-map':'遠征地圖','icon-sound':'音效','icon-cavalry':'騎兵','symbol-manual':'瞄準'
};
const plan=JSON.parse(readFileSync(join(root,'design-v1/hazel-transparent-jobs.json'),'utf8'));
const dir=join(root,'art-source/hazel-transparent-receipts');
const priorPath=join(root,'design-v1/hazel-transparent-manifest.json');
const prior=existsSync(priorPath)?JSON.parse(readFileSync(priorPath,'utf8')):{entries:[]};
const receipts=new Map();
if(existsSync(dir))for(const f of readdirSync(dir).filter(f=>f.endsWith('.json'))){const r=JSON.parse(readFileSync(join(dir,f),'utf8'));if(!r.alphaCheck?.valid)throw Error('Unvalidated artwork: '+r.id);if(receipts.has(r.id))throw Error('Duplicate receipt: '+r.id);receipts.set(r.id,r);}
const entries=[];
for(const job of plan.jobs){const r=receipts.get(job.id);if(!r)continue;const old=prior.entries.find(e=>e.id===job.id&&e.sourceSha256===r.sourceSha256);entries.push({...old,...r,name:labels[job.id]??job.name,resources:job.resources,kind:job.kind,pairedEquipment:job.pairedEquipment});}
if(entries.length!==receipts.size)throw Error('Unknown accepted artwork');
const hashes=entries.map(e=>e.sourceSha256);
if(hashes.some(h=>!h)||new Set(hashes).size!==hashes.length)throw Error('Distinct artworks must have distinct verified source images');
const mapped=entries.flatMap(e=>e.resources);if(mapped.length!==new Set(mapped).size)throw Error('Duplicate resource mapping');
const manifest={version:plan.version,tool:'image_gen.imagegen (built-in)',background:'Native RGBA alpha; no local background removal.',plannedArtworks:plan.artworks,plannedResources:plan.resources,generationComplete:entries.length===plan.artworks,entries};
writeFileSync(priorPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`${entries.length}/${plan.artworks} native transparent images; ${mapped.length}/${plan.resources} resources`);
