import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const output=path.join(root,'typed-example');
fs.mkdirSync(output);
let source=fs.readFileSync(path.join(root,'example','main.luau'),'utf8');
const helper=String.raw`
-- Explicit publication adapter: the canonical result type is not assignable to ObservationValue.
local function publishResult(api: EngineApi, key: string, result: SpatialBatchResult)
    local rows: {ObservationValue} = {}
    for _, row in ipairs(result.results) do
        local hits: {ObservationValue} = {}
        for _, hit in ipairs(row.hits) do
            local value: ObservationValue = {
                id=hit.id, distance=hit.distance, fraction=hit.fraction,
                point={hit.point[1],hit.point[2],hit.point[3]},
                normal={hit.normal[1],hit.normal[2],hit.normal[3]},
            }
            table.insert(hits,value)
        end
        local value: ObservationValue = {hits=hits}
        table.insert(rows,value)
    end
    api.observation.set(key,{version=result.version,results=rows})
end
`;
source=source.replace('local game: Game = {',helper+'\nlocal game: Game = {')
 .replace('api.observation.set("frozen_v1_result", result)','publishResult(api,"frozen_v1_result",result)')
 .replace('api.observation.set("repaired_v2_result", result)','publishResult(api,"repaired_v2_result",result)');
for(const [name,content] of Object.entries({'project.unone.json':JSON.stringify({name:'GenericSpatialScoutTyped',entry_script:'main.luau'},null,2)+'\n','main.luau':source})) {
 const file=path.join(output,name);fs.writeFileSync(file,content,{flag:'wx'});
 console.log(JSON.stringify({created:file,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')}));
}