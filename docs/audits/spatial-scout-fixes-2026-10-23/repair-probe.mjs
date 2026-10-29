// Preserve the original failed informed fixture. Repair only its Luau pcall
// contextual type and local shadow warning, not the engine or publication path.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const original=await readFile(resolve(here,'probe.mjs'),'utf8');
const corrected=original.replace(
 "local accepted,message=pcall(api.spatial.update,index,{{id=1,position={0,0,0},radius=-1}})",
 "local invalidBodies: {SpatialBody}={{id=1,position={0,0,0},radius=-1}}\n   local accepted,message=pcall(api.spatial.update,index,invalidBodies)"
).replace("local early,message=pcall(api.spatial.take,nextTicket)\n   assert(not early and string.find(tostring(message),'NEXT_TICK'))", "local early,earlyMessage=pcall(api.spatial.take,nextTicket)\n   assert(not early and string.find(tostring(earlyMessage),'NEXT_TICK'))");
await writeFile(resolve(here,'probe-v2.mjs'),corrected,{flag:'wx'});
const runner=(await readFile(resolve(here,'record-captures.mjs'),'utf8')).replace("['probe.mjs','capture-public.json']", "['probe-v2.mjs','capture-public-v2.json']");
await writeFile(resolve(here,'record-captures-v2.mjs'),runner,{flag:'wx'});
