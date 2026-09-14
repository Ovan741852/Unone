import {cpSync,copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('_Games/ashen-legion'),p=join(root,'presentation');mkdirSync(p,{recursive:true});
cpSync(join(root,'assets/equipment'),join(root,'wardrobe/assets/equipment'),{recursive:true,filter:p=>!p.endsWith('.blend')&&!p.endsWith('.blend1')});
const vendor=join(root,'wardrobe/vendor/package');
copyFileSync(join(vendor,'LICENSE'),join(p,'THREE-LICENSE.txt'));
cpSync(join(vendor,'build'),join(p,'vendor/build'),{recursive:true});
for(const f of ['controls/OrbitControls.js','loaders/GLTFLoader.js','utils/SkeletonUtils.js','utils/BufferGeometryUtils.js']){
 mkdirSync(join(p,'vendor/addons',f,'..'),{recursive:true});copyFileSync(join(vendor,'examples/jsm',f),join(p,'vendor/addons',f));
}
cpSync(join(root,'wardrobe/.unone/staging/unone-animator/runtime'),join(p,'animator'),{recursive:true});
copyFileSync(join(root,'wardrobe/assets/vinyl/soldier-animated-textured.glb'),join(p,'soldier.glb'));
for(const id of ['big-win','mega-win','legendary-win','coin-burst']){
 const document=JSON.parse(readFileSync(join(root,'design-v1/animations',id+'.json')));
 const r=spawnSync(process.execPath,['D:/Projects/Unone/plugins/org.unone.lottie/plugin.mjs'],{env:{...process.env,UNONE_PROJECT_ROOT:root},encoding:'utf8',input:JSON.stringify({tool:'lottie.install',input:{document,filename:id+'.json',force:true}})+'\n'});
 const result=JSON.parse(r.stdout);if(!result.ok)throw Error(r.stdout);console.log('STAGED '+id);
}
cpSync(join(root,'.unone/staging/unone-lottie'),join(p,'lottie'),{recursive:true});
// Official engine delivery, copied verbatim. The game supplies the full Three namespace.
for(const f of ['renderer/three.js','renderer/effekseer.js','shared/asset-encoding.js'])copyFileSync('D:/Projects/Unone/web/'+f,join(root,'dist/web/web',f));
writeFileSync(join(p,'PROVENANCE.json'),JSON.stringify({animator:'org.unone.animator 44ffbee via animator.install',lottie:'org.unone.lottie aa4e914 via lottie.install',renderer:'Unone 7a333b1 official presentation hooks',creatures:'Original Blender source wardrobe/blender/build_forest_creatures.py'},null,2));
