import {writeFileSync} from 'node:fs';
import {IMAGES,authoredCases,packCase} from './registry.mjs';
import {projectedEntries} from '../../projected.js';
const cases=authoredCases();
for(const c of cases)for(const [w,h] of [[1280,720],[800,600]])projectedEntries(packCase(c,w,h));
writeFileSync(process.argv[2],JSON.stringify({images:IMAGES,cases},null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,pixels:cases.reduce((n,c)=>n+c.points.length,0),transport:'all validated, physical1280x720/800x600'}));
