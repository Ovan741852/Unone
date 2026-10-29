import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const output=path.join(root,'final-example');fs.mkdirSync(output);
let source=fs.readFileSync(path.join(root,'portable-example','main.luau'),'utf8');
source=source.replace(String.raw`    local values: {[string]: ObservationValue} = {}
    for infoKey, value in pairs(api.spatial.info()) do
        values[infoKey] = tostring(value)
    end
    api.observation.set(key, values)`,String.raw`    local info=api.spatial.info()
    api.observation.set(key, {
        api_version=info.api_version,backend=info.backend,packed_format=info.packed_format,
        delivery=info.delivery,external=info.external,indices=info.indices,bodies=info.bodies,
        pending=info.pending,tickets=info.tickets,
    })`);
for(const [name,content] of Object.entries({'project.unone.json':JSON.stringify({name:'GenericSpatialScoutFinal',entry_script:'main.luau'},null,2)+'\n','main.luau':source})) {
 const file=path.join(output,name);fs.writeFileSync(file,content,{flag:'wx'});
 console.log(JSON.stringify({created:file,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')}));
}
console.log('Final example publishes only known scalar info fields. Intermediate tostring(table) pointer observations are deliberately not carried forward.');