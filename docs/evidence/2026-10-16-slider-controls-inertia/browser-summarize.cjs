const fs=require('fs'),path=require('path');
const after=JSON.parse(fs.readFileSync(path.join(__dirname,'after.json'),'utf8'));
const briefGesture=g=>g&&({row:g.row,start:g.start,end:g.end,offsetBefore:g.offsetBefore,released:g.released,remainingAtRelease:g.remainingAtRelease});
const briefInertia=i=>i&&Object.fromEntries(Object.entries(i).map(([key,value])=>[key,{...value,gesture:briefGesture(value.gesture)}]));
const viewportSummary=r=>({
 viewport:r.viewport,pass:r.pass,failure:r.failure,assertions:r.assertions.length,
 uiPackage:r.snapshots.initial?.observations.ui_package,
 release:[...new Set(r.responses.map(x=>x.url.match(/\/releases\/([a-f0-9]+)\//)?.[1]).filter(Boolean))],
 slider:{node:r.sliderNode,lineStart:r.line,at23:r.snapshots.line23?.observations.slider,worldPointerDuringDrag:r.snapshots.line23?.observations.ui_input?.world_pointer_down,outsideHeld:r.snapshots.lineOutsideHeld?.observations.slider,outsideReleased:r.snapshots.lineOutsideReleased?.observations.slider,outsideValue:r.snapshots.lineOutsideReleased?.observations.settings.volume,returnedValue:r.snapshots.lineReturned?.observations.settings.volume,restarted:r.snapshots.lineRestarted?.observations.slider,restartedWorldPointer:r.snapshots.lineRestarted?.observations.ui_input?.world_pointer_down,final:r.snapshots.lineFinal?.observations.slider},
 scrollDescriptor:r.scrollDescriptor&&{axis:r.scrollDescriptor.axis,inertia:r.scrollDescriptor.inertia,deceleration:r.scrollDescriptor.deceleration},
 drag:{physicalRow:r.contentDrag?.row,start:r.contentDrag?.start,end:r.contentDrag?.end,scrollBefore:r.contentDrag?.offsetBefore,heldStill:r.contentDrag?.heldStillOffset,scrollAfter:r.contentDrag?.offsetAfter,presetBefore:r.snapshots.lineFinal?.observations.settings.preset,presetAfter:r.snapshots.contentDragged?.observations.settings.preset,tapSelection:r.snapshots.rowClicked?.observations.settings.preset},
 inertia:briefInertia(r.inertia),
 applyCount:r.snapshots.externalApply?.observations.settings.apply_count,
 quality:r.snapshots.combo?.observations.settings.quality,
 inputProbe:r.snapshots.final?.observations.input_probe,
 frame:[r.snapshots.initial?.frame,r.snapshots.final?.frame],
 mime:r.mime,
 errors:{console:r.console.filter(c=>c.type==='error'),page:r.pageErrors,request:r.requestFailures,http:r.responses.filter(x=>x.status>=400),status:r.finalStatus}
});
const summary={
 url:after.url,phase:after.phase,pass:after.pass,
 browser:'Playwright Microsoft Edge channel msedge, headless, isolated production-page contexts',
 contract:after.contract,
 assertions:after.runs.reduce((n,r)=>n+r.assertions.length,0)+(after.lifecycle?.assertions?.length||0),
 viewports:after.runs.map(viewportSummary),
 lifecycle:after.lifecycle&&{pass:after.lifecycle.pass,eventType:after.lifecycle.eventType,assertions:after.lifecycle.assertions,activatedOffset:after.lifecycle.activatedOffset,resumedOffset:after.lifecycle.resumedOffset,finalOffset:after.lifecycle.finalOffset,presetBefore:after.lifecycle.before?.observations.settings.preset,presetAfter:after.lifecycle.final?.observations.settings.preset},
 export:{root:after.exportRoot,files:after.exportAfter.length,bytes:after.exportAfter.reduce((n,e)=>n+e.bytes,0),sha256Unchanged:after.exportUnchanged,evidence:['after-export-before-sha256.json','after-export-after-sha256.json']},
 runtimeWasmHashes:after.exportAfter.filter(e=>/\.wasm$/i.test(e.path)&&after.runs.some(r=>r.responses.some(x=>new URL(x.url).pathname.replace(/^\//,'')===e.path))),
 visualQa:{reviewedWithViewImage:['after-1440x900.png','after-1020x884.png','after-390x844.png'],finding:'All three images explicitly reviewed after the successful production run. Complete desktop/tablet two-column and mobile single-column layouts, 23 percent level, Studio, scrolled virtual rows, Press 1 / Release 1 and apply/reset controls visible. No error overlay. Partial rows at the virtual viewport boundaries are intentionally clipped.'},
 interpretation:'Natural-coast samples verify continued movement, relative velocity reduction and settling away from content bounds. The configured deceleration 8 is verified from the public descriptor; the browser test does not claim an exact fitted decay coefficient. Synthetic platform events are separately labelled; all primary gestures use physical mouse events.',
 constraints:'Only artifacts/ui-slider-inertia/browser files written. Prior frozen evidence untouched. No source/docs/SDK/export/payload changes, no server start/stop, no Cargo or commit. Production WASM observation ptr/len and memory reads only; no input ABI state writes or manual row materialization.'
};
fs.writeFileSync(path.join(__dirname,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({pass:summary.pass,assertions:summary.assertions,export:summary.export},null,2));
