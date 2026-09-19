import{readFileSync,writeFileSync,readdirSync,existsSync}from'node:fs';import{join}from'node:path';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),path=join(root,'design-v1/hazel-imgen-manifest.json');
const manifest=JSON.parse(readFileSync(path,'utf8')),dir=join(root,'art-source/hazel-imgen-receipts');
const planned=JSON.parse(readFileSync(join(root,'design-v1/hazel-imgen-jobs.json'),'utf8'));
if(existsSync(dir))for(const name of readdirSync(dir).filter(n=>n.endsWith('.json'))){const receipt=JSON.parse(readFileSync(join(dir,name),'utf8'));const old=manifest.entries.find(e=>e.id===receipt.id);if(!old)manifest.entries.push(receipt);}
// Accepted art revisions are explicit; preserve the previous originals and prompts.
const revisionDir=join(root,'art-source/hazel-imgen-revisions');
if(existsSync(revisionDir))for(const name of readdirSync(revisionDir).filter(n=>n.endsWith('.json'))){
 const revision=JSON.parse(readFileSync(join(revisionDir,name),'utf8')),old=manifest.entries.find(e=>e.id===revision.id);
 if(!old)throw Error('Revision without initial artwork: '+revision.id);
 if(old.source!==revision.source){
  const previous={source:old.source,original:old.original,runtime:old.runtime,sourceSha256:old.sourceSha256,prompt:old.prompt};
  const previousVersions=[...(old.previousVersions??[]),previous];
  Object.assign(old,revision,{previousVersions});
 }
}
for(const entry of manifest.entries){const job=planned.jobs.find(j=>j.id===entry.id);if(!job)throw Error('Unplanned image: '+entry.id);entry.resources=job.resources;}
manifest.entries.sort((a,b)=>planned.jobs.findIndex(j=>j.id===a.id)-planned.jobs.findIndex(j=>j.id===b.id));
manifest.plannedArtworks=planned.artworks;manifest.plannedResources=planned.resources;
manifest.generationComplete=manifest.entries.length===planned.artworks;
writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.entries.length+'/'+planned.artworks+' images collected; '+manifest.entries.flatMap(e=>e.resources).length+'/'+planned.resources+' resources');
