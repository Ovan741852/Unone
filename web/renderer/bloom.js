// Quarter-resolution separable Bloom. GPU timers are asynchronous and never stall.
export function createBloom(THREE,renderer) {
  const gl=renderer.getContext(), timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending=[],samples={on:[],off:[]};
  let enabled=true, width=0,height=0;
  const hdr=Boolean(gl.getExtension('EXT_color_buffer_float'));
  const target=()=>new THREE.WebGLRenderTarget(1,1,{type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:false});
  const base=target(),a=target(),b=target();base.depthBuffer=true;
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  const vertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const material=(fragment,uniforms)=>new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
  const bright=material('uniform sampler2D image;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.55,.95,l),1.);}',{image:{value:base.texture}});
  const blur=material('uniform sampler2D image;uniform vec2 direction;varying vec2 vUv;void main(){vec3 c=texture2D(image,vUv).rgb*.227027;c+=texture2D(image,vUv+direction*1.384615).rgb*.316216;c+=texture2D(image,vUv-direction*1.384615).rgb*.316216;c+=texture2D(image,vUv+direction*3.230769).rgb*.070270;c+=texture2D(image,vUv-direction*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}',{image:{value:null},direction:{value:new THREE.Vector2()}});
  const combine=material('uniform sampler2D image;uniform sampler2D bloom;uniform float strength;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb+texture2D(bloom,vUv).rgb*strength,1.);\n#include <colorspace_fragment>\n}',{image:{value:base.texture},bloom:{value:a.texture},strength:{value:.75}});
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
    resetMeasurements(){samples.on.length=0;samples.off.length=0;for(const item of pending)gl.deleteQuery(item.query);pending.length=0;},
    setEnabled(value){enabled=Boolean(value);},
    get enabled(){return enabled;},
    draw(worldScene,worldCamera,overlay) {
      poll();let query=null;
      if(timer && pending.length<8){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query);}
      if(enabled) {
        const size=renderer.getDrawingBufferSize(new THREE.Vector2());
        if(width!==size.x||height!==size.y){width=size.x;height=size.y;base.setSize(width,height);a.setSize(Math.max(1,Math.ceil(width/4)),Math.max(1,Math.ceil(height/4)));b.setSize(a.width,a.height);}
        renderer.setRenderTarget(base);renderer.render(worldScene,worldCamera);overlay?.();
        pass(bright,a);
        blur.uniforms.image.value=a.texture;blur.uniforms.direction.value.set(1/a.width,0);pass(blur,b);
        blur.uniforms.image.value=b.texture;blur.uniforms.direction.value.set(0,1/a.height);pass(blur,a);
        pass(combine,null);
      } else {renderer.setRenderTarget(null);renderer.render(worldScene,worldCamera);overlay?.();}
      if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,mode:enabled?'on':'off'});}
    },
    metrics(){
      const summarize=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.floor(sorted.length*.95)]};};
      return {bloom:enabled,bloom_resolution:[a.width,a.height],hdr,gpu_timer_available:Boolean(timer),gpu_on:summarize(samples.on),gpu_off:summarize(samples.off)};
    },
  };
}
