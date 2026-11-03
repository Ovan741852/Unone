import fs from 'node:fs';
import {CdpClient} from './cdp-client.mjs';
const cdp=await CdpClient.connect();
const target=await cdp.send('Target.createTarget',{url:process.argv[2]??'about:blank'});
const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
try {
await cdp.send('Runtime.enable',{},sessionId);
await cdp.send('Page.enable',{},sessionId);
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
await new Promise(resolve=>setTimeout(resolve,3000));
if(process.argv[2]?.includes('/player-')) {
  const deadline=Date.now()+120000;
  while(!await cdp.evaluate(sessionId,'Boolean(window.benchmark?.ready)')) {
    const error=await cdp.evaluate(sessionId,'document.body?.dataset.playerError');
    if(error)throw Error(error);
    if(Date.now()>deadline)throw Error('Probe readiness timeout');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}
const info=await cdp.evaluate(sessionId,`(()=>{const c=document.createElement('canvas'),g=c.getContext('webgl2'),e=g?.getExtension('WEBGL_debug_renderer_info');return {url:location.href,visibility:document.visibilityState,dpr:devicePixelRatio,gl:g?{renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),vendor:g.getParameter(e?e.UNMASKED_VENDOR_WEBGL:g.VENDOR),version:g.getParameter(g.VERSION)}:null,ready:window.benchmark?.ready,metadata:window.benchmark?.metadata?.(),playerError:document.body?.dataset.playerError,body:document.body?.innerText.slice(0,2500)}})()`);
const result={browser:cdp.version,info,system:await cdp.send('SystemInfo.getInfo')};
fs.mkdirSync('artifacts/symbol-benchmark/results',{recursive:true});
fs.writeFileSync('artifacts/symbol-benchmark/results/browser-probe.json',JSON.stringify(result,null,2));
if(process.argv[2]){const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync('artifacts/symbol-benchmark/results/smoke.png',Buffer.from(shot.data,'base64'));}
const concise=structuredClone(info);if(concise.metadata?.mediaManifest)concise.metadata.mediaManifest={canonical:concise.metadata.mediaManifest.canonical,video:concise.metadata.mediaManifest.video,atlas_total_bytes:concise.metadata.mediaManifest.atlas_total_bytes};
console.log(JSON.stringify({browser:cdp.version.Browser,info:concise,gpu:result.system.gpu.devices,featureStatus:result.system.gpu.featureStatus},null,2));
} finally {await cdp.send('Target.closeTarget',{targetId:target.targetId});cdp.close();}
