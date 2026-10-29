import {op,audit} from './runner.mjs';import path from 'node:path';
await op('inspect-own-starter-repaired',process.execPath,[path.join(audit,'inspect-starter.mjs')],{nature:'exploration-repair'});
