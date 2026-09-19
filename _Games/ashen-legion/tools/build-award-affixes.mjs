import {readFileSync,writeFileSync} from 'node:fs';
const main=new URL('../main.luau',import.meta.url),source=new URL('../gameplay/award-affixes.luau',import.meta.url);
const begin='-- BEGIN AWARD AFFIXES',end='-- END AWARD AFFIXES';let s=readFileSync(main,'utf8');
const body=begin+'\n'+readFileSync(source,'utf8').replace(/^\uFEFF/,'')+'\n'+end;
if(s.includes(begin))s=s.slice(0,s.indexOf(begin))+body+s.slice(s.indexOf(end)+end.length);
else s=s.replace('local skillDefinitions={',body+'\nlocal skillDefinitions={');
writeFileSync(main,s);console.log('Bundled game-owned award affixes');
