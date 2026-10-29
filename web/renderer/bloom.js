import {createBloomTimer} from './bloom-timer.js';
// Opt-in shared output settings. Legacy hosts keep their existing rendering path.
export function normalizePostProcessing(value) {
  if(value===undefined)return null;
  const fail=message=>{throw Error('POSTPROCESSING_CONFIG_INVALID: '+message);};
  if(!value||typeof value!=='object'||Array.isArray(value))fail('an object is required');
  const defaults={toneMapping:'none',exposure:1,bloomThreshold:.55,bloomStrength:.75,aoStrength:1.7};
  for(const key of Object.keys(value))if(!Object.hasOwn(defaults,key))fail('unknown setting '+key);
  const config={...defaults,...value};
  if(!['aces','none'].includes(config.toneMapping))fail('toneMapping must be aces or none');
  for(const [key,min,max]of [['exposure',0,8],['bloomThreshold',0,16],['bloomStrength',0,4],['aoStrength',0,4]]){
    const number=config[key];
    if(typeof number!=='number'||!Number.isFinite(number)||number<min||number>max||(key==='exposure'&&number===0))fail(`${key} is outside ${key==='exposure'?'(': '['}${min},${max}]`);
  }
  return Object.freeze(config);
}

// Quarter-resolution separable Bloom. GPU timers are asynchronous and never stall.
export function createBloom(THREE,renderer,settings) {
  const postprocessing=normalizePostProcessing(settings);
  const gl=renderer.getContext(),timer=createBloomTimer(gl,renderer.domElement??gl.canvas);
  let enabled=true, aoEnabled=false,width=0,height=0,disposed=false;
  const hdr=Boolean(gl.getExtension('EXT_color_buffer_float'));
  const target=()=>new THREE.WebGLRenderTarget(1,1,{type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:false});
  const base=target(),a=target(),b=target();base.depthBuffer=true;
  base.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  base.depthTexture.minFilter=base.depthTexture.magFilter=THREE.NearestFilter;
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const material=(fragment,uniforms)=>new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
  const bright=material('uniform sampler2D image;uniform float threshold;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(threshold,threshold+.4,l),1.);}',{image:{value:base.texture},threshold:{value:postprocessing?.bloomThreshold??.55}});
  const blur=material('uniform sampler2D image;uniform vec2 direction;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb*.227027;c+=texture2D(image,vUv+direction*1.384615).rgb*.316216;c+=texture2D(image,vUv-direction*1.384615).rgb*.316216;c+=texture2D(image,vUv+direction*3.230769).rgb*.070270;c+=texture2D(image,vUv-direction*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}',{image:{value:null},direction:{value:new THREE.Vector2()}});
  // Depth-based SSAO: reconstruct view-space surface positions and normals.
  // This is a reusable presentation effect; no game entities/rules enter it.
  const combine=material(`uniform sampler2D image,bloom,depthImage;uniform float strength,aoStrength;uniform vec2 pixels;uniform mat4 inverseProjection;varying vec2 vUv;
  vec2 depthUV(vec2 uv){return clamp(uv,pixels*.5,vec2(1.)-pixels*.5);}
  vec3 positionAt(vec2 uv){float d=texture2D(depthImage,uv).x;vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);float w=(p.w<0.?-1.:1.)*max(abs(p.w),1.e-6);return p.xyz/w;}
  void main(){float occ=0.;
   if(aoStrength>0.){
    vec2 center=depthUV(vUv);float depth=texture2D(depthImage,center).x;
    if(depth<.99999){
     vec3 p=positionAt(center);
     // Pick the nearer depth neighbour to avoid normals spanning silhouettes.
     vec3 l=p-positionAt(depthUV(center-vec2(pixels.x,0.)));
     vec3 r=positionAt(depthUV(center+vec2(pixels.x,0.)))-p;
     vec3 d=p-positionAt(depthUV(center-vec2(0.,pixels.y)));
     vec3 u=positionAt(depthUV(center+vec2(0.,pixels.y)))-p;
     vec3 n=cross(abs(l.z)<abs(r.z)?l:r,abs(d.z)<abs(u.z)?d:u);
     n/=max(length(n),1.e-6);if(n.z<0.)n=-n;
     for(int i=0;i<12;i++){float angle=float(i)*2.39996;float radius=5.+float(i%4)*4.;vec2 uv=depthUV(center+vec2(cos(angle),sin(angle))*pixels*radius);
      if(texture2D(depthImage,uv).x<.99999){vec3 v=positionAt(uv)-p;float distance=length(v);occ+=smoothstep(.08,.65,dot(n,v/max(.001,distance)))*max(0.,1.-distance/2.2);}
     }
    }
   }
   vec3 c=texture2D(image,vUv).rgb*(1.-clamp(occ/12.*aoStrength,0.,.65));
   if(strength>0.)c+=texture2D(bloom,vUv).rgb*strength;
   gl_FragColor=vec4(c,1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`,{image:{value:base.texture},bloom:{value:a.texture},depthImage:{value:base.depthTexture},strength:{value:.75},aoStrength:{value:0},pixels:{value:new THREE.Vector2()},inverseProjection:{value:null}});
  combine.toneMapped=postprocessing!==null;
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),bright);scene.add(quad);
  const pass=(mat,destination)=>{quad.material=mat;renderer.setRenderTarget(destination);renderer.render(scene,camera);};
  function output() {
    if(!postprocessing){pass(combine,null);return;}
    const previousTone=renderer.toneMapping,previousExposure=renderer.toneMappingExposure;
    try{
      // Three keeps offscreen scene targets linear. Apply exposure/tone mapping
      // only here, then colorspace_fragment encodes the screen exactly once.
      // "none" applies linear exposure without a nonlinear highlight curve.
      renderer.toneMapping=postprocessing.toneMapping==='aces'?THREE.ACESFilmicToneMapping:THREE.LinearToneMapping;
      renderer.toneMappingExposure=postprocessing.exposure;
      pass(combine,null);
    }finally{renderer.toneMapping=previousTone;renderer.toneMappingExposure=previousExposure;}
  }
  return {
    resetMeasurements(){timer.reset();},
    setEnabled(value){enabled=Boolean(value);},
    setAO(value){aoEnabled=Boolean(value);},
    get enabled(){return enabled;},
    draw(worldScene,worldCamera,overlay) {
      if(disposed)throw Error('POSTPROCESSING_DISPOSED');
      const bloomOn=enabled,aoOn=aoEnabled;
      const query=timer.begin(bloomMeasurementMode(bloomOn,aoOn));
      try{
      if(bloomOn||aoOn||postprocessing) {
        const size=renderer.getDrawingBufferSize(new THREE.Vector2());
        size.x=Math.max(1,size.x);size.y=Math.max(1,size.y);
        if(width!==size.x||height!==size.y){width=size.x;height=size.y;base.setSize(width,height);a.setSize(Math.max(1,Math.ceil(width/4)),Math.max(1,Math.ceil(height/4)));b.setSize(a.width,a.height);}
        renderer.setRenderTarget(base);renderer.render(worldScene,worldCamera);overlay?.();
        combine.uniforms.inverseProjection.value=worldCamera.projectionMatrixInverse;
        combine.uniforms.pixels.value.set(1/width,1/height);
        combine.uniforms.aoStrength.value=aoOn?(postprocessing?.aoStrength??1.7):0;
        combine.uniforms.strength.value=bloomOn?(postprocessing?.bloomStrength??.75):0;
        if(bloomOn){
          pass(bright,a);
          blur.uniforms.image.value=a.texture;blur.uniforms.direction.value.set(1/a.width,0);pass(blur,b);
          blur.uniforms.image.value=b.texture;blur.uniforms.direction.value.set(0,1/a.height);pass(blur,a);
        }
        output();
      } else {renderer.setRenderTarget(null);renderer.render(worldScene,worldCamera);overlay?.();}
      }finally{timer.end(query);}
    },
    metrics(){
      const timing=timer.metrics(),gpu=timing.samples;
      return {bloom:enabled,ao:aoEnabled,ao_method:'depth-ssao-12',postprocessing:postprocessing?{...postprocessing}:null,output_pipeline:postprocessing?'linear-tone-srgb':'legacy',bloom_resolution:[a.width,a.height],hdr,gpu_timer_available:timing.available,gpu_timer_context:timing.context,gpu_on:gpu.bloom_on_ao_off,gpu_off:gpu.bloom_off_ao_off,gpu_ao_only:gpu.bloom_off_ao_on,gpu_bloom_with_ao:gpu.bloom_on_ao_on,gpu_samples_by_mode:gpu,gpu_comparison:{gpu_on_off_same_ao_only:true,active_mode:bloomMeasurementMode(enabled,aoEnabled)}};
    },
    dispose(){
      if(disposed)return;disposed=true;
      timer.dispose();
      base.depthTexture.dispose();base.dispose();a.dispose();b.dispose();
      bright.dispose();blur.dispose();combine.dispose();quad.geometry.dispose();scene.remove(quad);
    },
  };
}

export function bloomMeasurementMode(bloomEnabled, aoEnabled) {
  return `bloom_${bloomEnabled?'on':'off'}_ao_${aoEnabled?'on':'off'}`;
}
