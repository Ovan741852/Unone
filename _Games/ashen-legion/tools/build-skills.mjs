import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url), main=new URL('main.luau',root);
const start='-- BEGIN GENERATED SKILL RUNTIME',end='-- END GENERATED SKILL RUNTIME';
let text=readFileSync(main,'utf8');
const body=`${start}\n${['composition-runtime','element-runtime','trigger-runtime','resonance-runtime','skill-runtime'].map(name=>readFileSync(new URL('gameplay/'+name+'.luau',root),'utf8')).join('\n')}\n${end}`;
if(!text.includes(start))throw new Error('Skill bundle marker missing');
text=text.slice(0,text.indexOf(start))+body+text.slice(text.indexOf(end)+end.length);
writeFileSync(main,text);console.log('Bundled game-owned skill runtime');
