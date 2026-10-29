import fs from 'node:fs';import path from 'node:path';
import {op,sdk,audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));const game=sdk+'/bin/game.exe';
await op('search-entity-simple',game,['--sdk',sdk,'api','search','entity']);
await op('describe-entity-getPosition',game,['--sdk',sdk,'api','describe','entity.getPosition']);
await op('inspect-own-starter',process.execPath,['-e',`const fs=require('fs');const p=${JSON.stringify(project)};console.log(fs.readFileSync(p+'/project.unone.json','utf8'));const t=fs.readFileSync(p+'/scripts/main.luau','utf8');for(const n of ['EntityApi','ObservationApi','SpatialBody']){const i=t.indexOf('export type '+n); console.log(t.slice(i,t.indexOf('\n}\n',i)+3));} console.log(fs.readdirSync(p+'/scenes'));for(const f of fs.readdirSync(p+'/scenes'))console.log(f,fs.readFileSync(p+'/scenes/'+f,'utf8'));`]);
