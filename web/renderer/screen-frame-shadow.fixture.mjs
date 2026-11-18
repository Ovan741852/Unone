import * as THREE from '/three.module.js';import {createDepthBlitProbe} from '/prototype.js';
const W=192,H=128;
function draw(depth,fallback){const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;document.body.appendChild(canvas);
 const r=new THREE.WebGLRenderer({canvas,alpha:false,antialias:false,depth,preserveDrawingBuffer:true});r.setPixelRatio(1);r.setSize(W,H,false);r.outputColorSpace=THREE.SRGBColorSpace;r.setClearColor(0x27384a,1);r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFShadowMap;
 const s=new THREE.Scene(),cam=new THREE.OrthographicCamera(-2,2,1.3,-1.3,.1,20);cam.position.z=6;
 const ambient=new THREE.AmbientLight(0xffffff,.5);s.add(ambient);const sun=new THREE.DirectionalLight(0xffffff,1.5);sun.position.set(3,2,5);sun.castShadow=true;sun.shadow.mapSize.set(256,256);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.camera.near=.1;sun.shadow.camera.far=15;s.add(sun);s.add(sun.target);
 const bg=new THREE.Mesh(new THREE.PlaneGeometry(3.6,2.2),new THREE.MeshLambertMaterial({color:0xd8a974}));bg.receiveShadow=true;bg.position.z=0;s.add(bg);
 const foreground=new THREE.Mesh(new THREE.PlaneGeometry(.8,1),new THREE.MeshLambertMaterial({color:0x315ad5}));foreground.castShadow=true;foreground.position.set(.1,.1,1);s.add(foreground);
 const overlay=new THREE.Mesh(new THREE.PlaneGeometry(2,.3),new THREE.MeshBasicMaterial({color:0xf5c66a,transparent:true,opacity:.6,depthTest:false}));overlay.position.set(0,-.85,2.8);overlay.renderOrder=5;s.add(overlay);
 const world=()=>r.render(s,cam);if(fallback)createDepthBlitProbe(THREE,r).draw(world);else world();
 const gl=r.getContext(),pixels=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const out={pixels,attrs:gl.getContextAttributes(),error:gl.getError()};r.dispose();canvas.remove();return out;}
window.runDepthFixture=()=>{const a=draw(true,false),b=draw(false,true);let changedBytes=0,maxDelta=0;for(let i=0;i<a.pixels.length;i++){let d=Math.abs(a.pixels[i]-b.pixels[i]);if(d)changedBytes++;maxDelta=Math.max(maxDelta,d);}return [{changedBytes,maxDelta,errors:[a.error,b.error],referenceAttrs:a.attrs,candidateAttrs:b.attrs}];};
