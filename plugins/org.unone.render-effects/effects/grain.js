// fx.grain: film grain noise.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.grain',
  title: 'Film grain',
  summary: 'Adds fine noise like film grain; it moves every frame unless animated is false.',
  keywords: ['grain', 'film grain', 'noise', 'film', 'cinematic', '顆粒', '底片', '雜訊', '噪點'],
  params: {
    amount: {type: 'number', default: 0.08, min: 0, max: 1, meaning: 'Noise strength.'},
    size: {type: 'number', default: 1.5, min: 1, max: 8, meaning: 'Grain size in screen pixels.'},
    animated: {type: 'boolean', default: true, meaning: 'Change the noise every drawn frame (presentation only).'},
  },
};

const fragment = `uniform sampler2D image;uniform float amount,size,seed;varying vec2 vUv;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  vec3 color=texture2D(image,vUv).rgb;
  float noise=hash(floor(gl_FragCoord.xy/size)+seed)-.5;
  // Stronger in the mid-tones, where film grain shows most.
  float luma=dot(color,vec3(.2126,.7152,.0722));
  gl_FragColor=vec4(max(color+noise*amount*(.4+luma),0.),1.);
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  () => ({amount: {value: 0}, size: {value: 1}, seed: {value: 0}}),
  (u, v, {frame}) => { u.amount.value = v.amount; u.size.value = v.size; u.seed.value = v.animated ? (frame % 997) * 1.618 : 0; });
