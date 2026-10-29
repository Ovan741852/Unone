import fs from 'node:fs';import path from 'node:path';import {op,audit} from './runner.mjs';
await op('independent-first-run-verification',process.execPath,[path.join(audit,'verify-report.mjs'),path.join(audit,'030-first-native-six-ticks.stdout')],{nature:'independent-json-verification'});
await op('independent-strict-run-verification',process.execPath,[path.join(audit,'verify-report.mjs'),path.join(audit,'033-strict-native-six-ticks.stdout')],{nature:'independent-json-verification'});
