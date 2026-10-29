import fs from 'node:fs';import path from 'node:path';import {audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));
const file=path.join(project,'scripts/main.luau');let main=fs.readFileSync(file,'utf8');
const before='        table.insert(largeQueries, {kind="nearest", point={((i-1)%64)*3, math.floor((i-1)/64)*3, 10}, max_distance=0.1, mask=1})';
const after='        local query: SpatialNearestQuery = {kind="nearest", point={((i-1)%64)*3, math.floor((i-1)/64)*3, 10}, max_distance=0.1, mask=1}\n        table.insert(largeQueries, query)';
if(!main.includes(before))throw Error('repair target missing');main=main.replace(before,after);fs.writeFileSync(file,main);fs.writeFileSync(path.join(audit,'main.final.luau'),main);
const marker='-- END UNONE API TYPES';fs.writeFileSync(path.join(audit,'authored-body.final.luau'),main.slice(main.indexOf(marker)+marker.length).trimStart());
console.log('Repaired query union literal inference using canonical SpatialNearestQuery local; no any/cast/stub.');
