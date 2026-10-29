import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const example=path.join(root,'example');
fs.mkdirSync(example);
const canonical=fs.readFileSync(path.join(root,'engine-api.luau'),'utf8');
const body=String.raw`
-- This isolated generic geometry probe was authored only from the public guide and typings.
local index: number = 0
local pending: number = 0
local tick: number = 0
local original: {SpatialBody} = {
    {id=10, position={2,0,0}, radius=0.5, category=1},
    {id=20, position={0.5,0,0}, radius=0.1, category=2},
    {id=30, position={5,-2,0}, previous_position={5,2,0}, radius=0.5, category=4},
    {id=40, position={2.5,0,0}, radius=0.5, category=1},
}
local repaired: {SpatialBody} = {
    {id=10, position={9,0,0}, radius=0.5, category=1},
    {id=20, position={0.5,0,0}, radius=0.1, category=2},
    {id=30, position={5,-2,0}, previous_position={5,2,0}, radius=0.5, category=4},
    {id=40, position={2.5,0,0}, radius=0.5, category=1},
}
local queries: {SpatialQuery} = {
    {kind="nearest", point={0,0,0}, max_distance=100, mask=1},
    {kind="overlap_sphere", center={2,0,0}, radius=0.5, mask=1},
    {kind="sweep_sphere", from={0,0,0}, to={10,0,0}, radius=0.5, mask=4},
}
local game: Game = {
    start = function(api: EngineApi)
        index = api.spatial.create(original)
        api.observation.set("phase", "created")
        api.observation.set("initial_info", api.spatial.info())
    end,
    update = function(api: EngineApi, _dt: number)
        tick += 1
        if tick == 1 then
            -- Deliberate negative case: preserve the old version and body state.
            local invalidOk, invalidError = pcall(function()
                api.spatial.update(index, {{id=10, position={2,0,0}, radius=-1, category=1}})
            end)
            api.observation.set("invalid_replacement", {accepted=invalidOk, error=tostring(invalidError)})
            pending = api.spatial.submit(index, queries)
            -- Deliberate timing boundary: error is caught; the submitted ticket must remain valid.
            local earlyOk, earlyError = pcall(function() api.spatial.take(pending) end)
            api.observation.set("same_tick_take", {accepted=earlyOk, error=tostring(earlyError)})
            -- Repair with valid data after submission. Its effect must not change the frozen v1 task.
            local version = api.spatial.update(index, repaired)
            api.observation.set("repair_version", version)
            api.observation.set("phase", "submitted_v1_repaired_to_v2")
            api.observation.set("after_submit_info", api.spatial.info())
        elseif tick == 2 then
            local result = api.spatial.take(pending)
            api.observation.set("frozen_v1_result", result)
            -- Deliberate stale boundary: tickets are one-shot.
            local staleOk, staleError = pcall(function() api.spatial.take(pending) end)
            api.observation.set("consumed_ticket_take", {accepted=staleOk, error=tostring(staleError)})
            pending = api.spatial.submit(index, queries)
            api.observation.set("phase", "v1_delivered_v2_submitted")
        elseif tick == 3 then
            local result = api.spatial.take(pending)
            api.observation.set("repaired_v2_result", result)
            api.observation.set("final_info", api.spatial.info())
            api.observation.set("phase", "v2_delivered")
        end
        api.observation.set("tick", tick)
    end,
}
return game
`;
const files={
 'project.unone.json':JSON.stringify({name:'GenericSpatialScout',entry_script:'main.luau'},null,2)+'\n',
 'main.luau':'--!strict\n-- BEGIN UNONE API TYPES\n'+canonical+'\n-- END UNONE API TYPES\n'+body,
};
for(const [name,content] of Object.entries(files)) {
 const file=path.join(example,name); fs.writeFileSync(file,content,{flag:'wx'});
 console.log(JSON.stringify({created:file,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')}));
}
console.log(JSON.stringify({expectations:{firstSubmissionTick:1,firstDeliveryTick:2,invalidReplacementAccepted:false,sameTickAccepted:false,repairVersion:2,frozenVersion:1,frozenNearestId:10,frozenNearestDistance:2,frozenOverlapIds:[10,40],movingSweepId:30,movingSweepFraction:0.5-1/Math.sqrt(116),movingSweepDistance:10*(0.5-1/Math.sqrt(116)),consumedTicketAccepted:false,repairedDeliveryTick:3,repairedVersion:2,repairedNearestId:40,repairedNearestDistance:2.5,repairedOverlapIds:[40]}}));