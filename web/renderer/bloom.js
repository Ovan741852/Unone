// Quarter-resolution separable Bloom. GPU timers are asynchronous and never stall.
export function createBloom(THREE,renderer) {
  const gl=renderer.getContext(), timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending=[],samples={bloom_on_ao_off:[],bloom_off_ao_off:[],bloom_on_ao_on:[],bloom_off_ao_on:[]};
  let enabled=true, aoEnabled=false,width=0,height=0;
  const hdr=Boolean(gl.getExtension('EXT_color_buffer_float'));
  const target=()=>new THREE.WebGLRenderTarget(1,1,{type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:false});
  const base=target(),a=target(),b=target();base.depthBuffer=true;
  base.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  base.depthTexture.minFilter=base.depthTexture.magFilter=THREE.NearestFilter;
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const material=(fragment,uniforms)=>new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
  const bright=material('uniform sampler2D image;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.55,.95,l),1.);}',{image:{value:base.texture}});
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
   #include <colorspace_fragment>
  }`,{image:{value:base.texture},bloom:{value:a.texture},depthImage:{value:base.depthTexture},strength:{value:.75},aoStrength:{value:0},pixels:{value:new THREE.Vector2()},inverseProjection:{value:null}});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),bright);scene.add(quad);
  const pass=(mat,destination)=>{quad.material=mat;renderer.setRenderTarget(destination);renderer.render(scene,camera);};
  function poll() {
    if(!timer)return;
    if(gl.getParameter(timer.GPU_DISJOINT_EXT)) {for(const item of pending)gl.deleteQuery(item.query);pending.length=0;return;}
    while(pending.length && gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)) {
      const item=pending.shift(),ms=gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6;
      gl.deleteQuery(item.query);const bucket=samples[item.mode];bucket.push(ms);if(bucket.length>240)bucket.shift();
    }
  }
  return {
    resetMeasurements(){for(const bucket of Object.values(samples))bucket.length=0;for(const item of pending)gl.deleteQuery(item.query);pending.length=0;},
    setEnabled(value){enabled=Boolean(value);},
    setAO(value){aoEnabled=Boolean(value);},
    get enabled(){return enabled;},
    draw(worldScene,worldCamera,overlay) {
      poll();let query=null;
      const bloomOn=enabled,aoOn=aoEnabled;
      if(timer && pending.length<8){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query);}
      if(bloomOn||aoOn) {
        const size=renderer.getDrawingBufferSize(new THREE.Vector2());
        size.x=Math.max(1,size.x);size.y=Math.max(1,size.y);
        if(width!==size.x||height!==size.y){width=size.x;height=size.y;base.setSize(width,height);a.setSize(Math.max(1,Math.ceil(width/4)),Math.max(1,Math.ceil(height/4)));b.setSize(a.width,a.height);}
        renderer.setRenderTarget(base);renderer.render(worldScene,worldCamera);overlay?.();
        combine.uniforms.inverseProjection.value=worldCamera.projectionMatrixInverse;
        combine.uniforms.pixels.value.set(1/width,1/height);
        combine.uniforms.aoStrength.value=aoOn?1.7:0;
        combine.uniforms.strength.value=bloomOn ? .75 : 0;
        if(bloomOn){
          pass(bright,a);
          blur.uniforms.image.value=a.texture;blur.uniforms.direction.value.set(1/a.width,0);pass(blur,b);
          blur.uniforms.image.value=b.texture;blur.uniforms.direction.value.set(0,1/a.height);pass(blur,a);
        }
        pass(combine,null);
      } else {renderer.setRenderTarget(null);renderer.render(worldScene,worldCamera);overlay?.();}
      if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,mode:bloomMeasurementMode(bloomOn,aoOn)});}
    },
    metrics(){
      const summarize=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.floor(sorted.length*.95)]};};
      const gpu={
        bloom_on_ao_off:summarize(samples.bloom_on_ao_off),
        bloom_off_ao_off:summarize(samples.bloom_off_ao_off),
        bloom_on_ao_on:summarize(samples.bloom_on_ao_on),
        bloom_off_ao_on:summarize(samples.bloom_off_ao_on),
      };
      return {bloom:enabled,ao:aoEnabled,ao_method:'depth-ssao-12',bloom_resolution:[a.width,a.height],hdr,gpu_timer_available:Boolean(timer),gpu_on:gpu.bloom_on_ao_off,gpu_off:gpu.bloom_off_ao_off,gpu_ao_only:gpu.bloom_off_ao_on,gpu_bloom_with_ao:gpu.bloom_on_ao_on,gpu_samples_by_mode:gpu,gpu_comparison:{gpu_on_off_same_ao_only:true,active_mode:bloomMeasurementMode(enabled,aoEnabled)}};
    },
  };
}

export function bloomMeasurementMode(bloomEnabled, aoEnabled) {
  return `bloom_${bloomEnabled?'on':'off'}_ao_${aoEnabled?'on':'off'}`;
}
