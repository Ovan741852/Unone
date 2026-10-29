import fs from 'node:fs';import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const output=path.join(root,'info-probe');fs.mkdirSync(output);
const canonical=fs.readFileSync(path.join(root,'engine-api.luau'),'utf8');
const body=String.raw`
local game: Game = {
    start=function(api: EngineApi)
        local info=api.spatial.info()
        local limits=info.limits :: {[string]: ObservationValue}
        local evidence: {[string]: ObservationValue}={}
        for key,value in pairs(limits) do
            evidence[key]=tostring(value)
            local ok,err=pcall(function() api.observation.set("limit/"..key,value) end)
            if not ok then api.observation.set("rejected/"..key,tostring(err)) end
        end
        api.observation.set("all_limit_strings",evidence)
        local ok,err=pcall(function() api.observation.set("complete_info",info) end)
        api.observation.set("complete_info_publication",{accepted=ok,error=tostring(err)})
    end,
    update=function(_api: EngineApi,_dt: number) end,
}
return game
`;
fs.writeFileSync(path.join(output,'project.unone.json'),JSON.stringify({name:'GenericSpatialInfoProbe',entry_script:'main.luau'},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(output,'main.luau'),'--!strict\n-- BEGIN UNONE API TYPES\n'+canonical+'\n-- END UNONE API TYPES\n'+body,{flag:'wx'});
console.log(JSON.stringify({created:output,purpose:'Public API isolation of the observation-incompatible info limit field; no implementation read'}));