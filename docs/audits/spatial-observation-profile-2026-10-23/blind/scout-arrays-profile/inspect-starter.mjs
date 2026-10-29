import fs from 'node:fs';import path from 'node:path';import {audit} from './runner.mjs';
const {project}=JSON.parse(fs.readFileSync(path.join(audit,'project-location.json'),'utf8'));
console.log(fs.readFileSync(path.join(project,'project.unone.json'),'utf8'));
const t=fs.readFileSync(path.join(project,'scripts/main.luau'),'utf8');
for(const n of ['EntityApi','ObservationApi']){const i=t.indexOf('export type '+n);console.log(t.slice(i,t.indexOf('\n}',i)+3));}
function list(p,d){for(const dirent of fs.readdirSync(p,{withFileTypes:true})){console.log(path.relative(project,path.join(p,dirent.name)));if(dirent.isDirectory()&&d>0)list(path.join(p,dirent.name),d-1);}}
list(project,1);
