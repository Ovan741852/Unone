// fx.posterize: a few colour levels per channel, optionally dithered.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.posterize',
  title: 'Posterize',
  summary: 'Reduces each colour channel to a few levels, with optional ordered dithering, for a poster or retro palette look.',
  keywords: ['posterize', 'posterise', 'dither', 'dithering', 'color levels', 'retro palette', '色階', '抖動', '海報'],
  params: {
    levels: {type: 'number', default: 6, min: 2, max: 64, meaning: 'Levels per channel.'},
    dither: {type: 'number', default: 0.5, min: 0, max: 1, meaning: 'Ordered 4x4 dither strength.'},
  },
};

// Quantize in an approximate gamma space so the steps look even.
const fragment = `uniform sampler2D image;uniform float levels,dither;varying vec2 vUv;
float bayer(vec2 p){
  vec2 q=mod(floor(p),4.);
  float i=q.x+q.y*4.;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for(int k=0;k<16;k++){if(float(k)==i)return m[k]/16.-.5;}
  return 0.;
}
void main(){
  vec3 color=pow(max(texture2D(image,vUv).rgb,0.),vec3(1./2.2));
  float steps=levels-1.;
  color=floor(color*steps+.5+bayer(gl_FragCoord.xy)*dither)/steps;
  gl_FragColor=vec4(pow(clamp(color,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  () => ({levels: {value: 6}, dither: {value: 0}}),
  (u, v) => { u.levels.value = Math.round(v.levels); u.dither.value = v.dither; });
