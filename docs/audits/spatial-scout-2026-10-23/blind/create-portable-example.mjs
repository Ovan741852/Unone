import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const output=path.join(root,'portable-example');fs.mkdirSync(output);
let source=fs.readFileSync(path.join(root,'typed-example','main.luau'),'utf8');
const helper=String.raw`
-- Preserve public info key/value evidence without passing its integers back through observation.
local function publishInfo(api: EngineApi, key: string)
    local values: {[string]: ObservationValue} = {}
    for infoKey, value in pairs(api.spatial.info()) do
        values[infoKey] = tostring(value)
    end
    api.observation.set(key, values)
end
`;
source=source.replace('local game: Game = {',helper+'\nlocal game: Game = {');
for(const key of ['initial_info','after_submit_info','final_info']) source=source.replace(`api.observation.set("${key}", api.spatial.info())`,`publishInfo(api,"${key}")`);
for(const [name,content] of Object.entries({'project.unone.json':JSON.stringify({name:'GenericSpatialScoutPortable',entry_script:'main.luau'},null,2)+'\n','main.luau':source})) {
 const file=path.join(output,name);fs.writeFileSync(file,content,{flag:'wx'});
 console.log(JSON.stringify({created:file,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')}));
}