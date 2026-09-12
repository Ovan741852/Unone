// Development-only asset renderer. Portraits come from the actual authored GLBs.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:8190';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1});
  await page.route('**/__target-portraits',route=>route.fulfill({contentType:'text/html',body:'<script type="importmap">{"imports":{"three":"/presentation/vendor/build/three.module.js"}}</script>'}));
  await page.goto(origin+'/__target-portraits');
  const creatures=JSON.parse(fs.readFileSync(path.join(root,'assets/creatures/manifest.json'),'utf8')).filter(x=>x.rank>0);
  const images=await page.evaluate(async creatures=>{
   const T=await import('/presentation/vendor/build/three.module.js');
   const {GLTFLoader}=await import('/presentation/vendor/addons/loaders/GLTFLoader.js');
   const {createInkStyle}=await import('/presentation/ink-style.mjs');
   const renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.setClearColor(0,0);
   renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
   const scene=new T.Scene(),style=createInkStyle(T);
   scene.add(new T.HemisphereLight(0xffe2bd,0x564664,1.3));
   for(const [color,intensity,p]of [[0xffd49a,2.1,[-4,6,5]],[0xaaa2df,1.3,[5,3,-2]]]){const light=new T.DirectionalLight(color,intensity);light.position.set(...p);scene.add(light);}
   const camera=new T.OrthographicCamera(-1,1,1,-1,.01,100),loader=new GLTFLoader(),images=[];
   for(const def of creatures){
    const gltf=await loader.loadAsync('/assets/creatures/'+def.model),model=gltf.scene;
    const clip=gltf.animations.find(a=>a.name==='idle');if(clip){const mixer=new T.AnimationMixer(model);mixer.clipAction(clip).play();mixer.update(.3);}
    model.updateMatrixWorld(true);
    const box=new T.Box3().setFromObject(model),center=box.getCenter(new T.Vector3());
    camera.position.copy(center).add(new T.Vector3(3,1.8,5).normalize().multiplyScalar(10));camera.lookAt(center);camera.updateMatrixWorld(true);
    let span=0;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);span=Math.max(span,Math.abs(p.x),Math.abs(p.y));}
    span*=1.1;camera.left=-span;camera.right=span;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
    style.apply(model);scene.add(model);renderer.render(scene,camera);
    images.push({id:def.id,data:renderer.domElement.toDataURL('image/png').split(',')[1]});scene.remove(model);
   }
   style.dispose();renderer.dispose();return images;
  },creatures);
  for(const {id,data}of images)fs.writeFileSync(path.join(root,'assets/formal-ui/target-'+id+'.png'),Buffer.from(data,'base64'));
  console.log('Rendered '+images.length+' actual creature portraits.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
