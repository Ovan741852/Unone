const fs=require('fs'),path=require('path');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const regression=read('after.json'),responsive=read('responsive.json');
const visualFile=path.join(__dirname,'visual-review.json');
const visual=fs.existsSync(visualFile)?read('visual-review.json'):{status:'pending',reviewed:[]};
const summary={
 url:responsive.url,phase:'official-ui-responsive-layout',
 pass:regression.pass&&responsive.pass&&visual.status==='passed',
 browser:'Playwright Microsoft Edge channel msedge, headless; production official player',
 contract:responsive.contract,
 typeErgonomics:read('type-ergonomics.json'),
 assertions:regression.runs.reduce((sum,r)=>sum+r.assertions.length,0)+(regression.lifecycle?.assertions.length||0)+responsive.assertions.length,
 regression:{pass:regression.pass,runs:regression.runs.map(r=>({viewport:r.viewport,pass:r.pass,assertions:r.assertions.length,failure:r.failure,package:r.snapshots.initial?.observations.ui_package,layout:r.snapshots.initial?.observations.layout,errors:{console:r.console.filter(c=>c.type==='error'),page:r.pageErrors,request:r.requestFailures,http:r.responses.filter(x=>x.status>=400)},mime:r.mime})),lifecycle:{pass:regression.lifecycle?.pass,assertions:regression.lifecycle?.assertions},exportUnchanged:regression.exportUnchanged},
 responsive:{pass:responsive.pass,assertions:responsive.assertions,resizes:responsive.resizes,sliderHeld:responsive.sliderHeld,sliderAfterResize:responsive.sliderAfterResize,coast:responsive.coast,mime:responsive.mime,errors:{console:responsive.console.filter(c=>c.type==='error'),page:responsive.pageErrors,request:responsive.requestFailures,http:responsive.responses.filter(x=>x.status>=400),player:responsive.finalStatus},failure:responsive.failure,exportUnchanged:responsive.exportUnchanged},
 visual,
 export:{root:responsive.exportRoot,files:responsive.exportAfter.length,bytes:responsive.exportAfter.reduce((sum,f)=>sum+f.bytes,0),sha256Unchanged:regression.exportUnchanged&&responsive.exportUnchanged,evidence:['after-export-before-sha256.json','after-export-after-sha256.json','responsive-export-before-sha256.json','responsive-export-after-sha256.json']},
 sourceHashes:['gesture-regression.cjs','responsive.cjs','summarize.cjs'].map(name=>({file:name,sha256:require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex')})),
 scope:'All primary gestures are physical Playwright mouse input. Gesture regression separately labels synthetic platform pause/resume probes. Responsive reflow uses actual browser viewport changes and read-only observations. No exported file, renderer, WASM input state or private layout helper was mutated. Hardware touch and native player appearance are not covered.'
};
fs.writeFileSync(path.join(__dirname,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({pass:summary.pass,assertions:summary.assertions,export:summary.export,visual:summary.visual},null,2));if(!summary.pass)process.exitCode=1;
